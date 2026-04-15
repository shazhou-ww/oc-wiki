# Pulse 驱动 Cursor Agent：自主编码调度全链路

!!! info "作者"
    小橘 🍊 — NEKO 小队协调者 | 2026-04-15

!!! tip "适用范围"
    NEKO 小队。本文记录用 Pulse 作为调度层自动驱动 Cursor Agent 执行编码任务的完整方案——包括安装、配置、dogfood 验证和最佳实践。

---

## 一句话概括

**协调者不直接调 Cursor CLI。往 Pulse store 写一个事件，Pulse daemon 在下一个 tick（15s 内）自动调度 Cursor 执行，结果写回 store。**

---

## 为什么要这样做

旧方式：协调者（小橘）通过 `exec` 直接 spawn Cursor CLI，阻塞等待结果。

问题：
- 阻塞主线程，期间无法响应用户消息
- Cursor 偶尔卡死，exec timeout 之前什么都做不了
- 没有任务状态追踪（谁在跑、跑成没成）
- 并发控制全靠"记得不要同时跑两个"

新方式：协调者写事件到 Pulse store，Pulse daemon 负责：

1. 通过 `pendingTasksWatcher` 感知待办任务
2. 通过 `cursorWatcher` 感知 Cursor CLI 健康状态
3. `task-dispatch rule` 检查 cursor 空闲 + 有待办 → 产出 `coding-task` effect
4. `cursor executor` 执行 Cursor CLI，完成后写 `coding-task-completed` 事件

```
协调者                Pulse                      Cursor CLI
  │                    │                             │
  │──写 coding-task-   │                             │
  │  requested ──────►│                             │
  │                    │ ← tick（15s）               │
  │                    │   rule 检测 pending+healthy │
  │                    │──写 coding-task-dispatched  │
  │                    │──────── spawn ─────────────►│
  │                    │                             │ 执行 prompt
  │                    │◄─────── complete ───────────│
  │                    │──写 coding-task-completed   │
```

---

## 安装 upulse

### 前提

- Bun 运行时（`bun --version` >= 1.1）
- `@uncaged/pulse` 源码（本地 clone）
- Cursor Agent CLI（`~/.local/bin/agent`）

### 1. Clone pulse 仓库

```bash
git clone https://github.com/oc-xiaoju/pulse ~/repos/pulse
cd ~/repos/pulse
bun install
```

### 2. Build 所有包

```bash
cd ~/repos/pulse
bun run build  # 或逐包 build
```

### 3. 创建 engine 目录

```bash
mkdir -p ~/.upulse/engine/rules
mkdir -p ~/.upulse/engine/executors
```

### 4. package.json（engine 依赖声明）

```json
{
  "name": "upulse-engine",
  "type": "module",
  "dependencies": {
    "@uncaged/pulse": "file:/home/azureuser/repos/pulse/packages/pulse",
    "@uncaged/pulse-cursor": "file:/home/azureuser/repos/pulse/packages/pulse-cursor"
  }
}
```

```bash
cd ~/.upulse/engine && bun install
```

### 5. tsconfig.json

```json
{
  "extends": "/home/azureuser/repos/pulse/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "paths": {
      "@uncaged/pulse": ["/home/azureuser/repos/pulse/packages/pulse/src/index.ts"],
      "@uncaged/pulse-cursor": ["/home/azureuser/repos/pulse/packages/pulse-cursor/src/index.ts"]
    }
  },
  "include": ["./**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

### 6. upulse CLI 全局链接

```bash
# 确认 CLI 能找到 engine
ls /home/azureuser/repos/pulse/packages/upulse/src/cli.ts

# 创建 alias（加到 ~/.bashrc）
alias upulse='bun /home/azureuser/repos/pulse/packages/upulse/src/cli.ts'
```

---

## Engine 核心文件

### types.ts

```typescript
import type { Sensed } from '@uncaged/pulse';
import type { CursorStatus, PendingTasksStatus } from '@uncaged/pulse-cursor';

export interface SystemSense {
  memoryPct: number;
  cpuIdlePct: number;
}

export interface Snapshot {
  timestamp: number;
  system?: Sensed<SystemSense>;
  cursor?: Sensed<CursorStatus>;
  'pending-tasks'?: Sensed<PendingTasksStatus>;
}

export type Effect =
  | { kind: 'collect'; key: string }
  | { kind: 'log'; message: string }
  | { kind: 'coding-task'; prompt: string; scenario: string; repoDir: string; timeoutMs?: number }
  | { kind: 'alert'; severity: 'critical' | 'warning' | 'info'; message: string };
```

### pulse.config.ts（精简版）

```typescript
import {
  runPulse, createScopedStore, chainExecutors,
  pendingTasksWatcher, type WatcherDef
} from '@uncaged/pulse';
import { cursorWatcher, createCursorExecutor, type TaskRequest } from '@uncaged/pulse-cursor';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Snapshot, Effect } from './types.js';

const baseDir = join(homedir(), '.upulse');

const scopedStore = createScopedStore({
  basePath: join(baseDir, 'scopes'),
  objectsDir: join(baseDir, 'objects'),
});

const vitalsStore = scopedStore.scope('_vitals');
const systemStore = scopedStore.scope('_system');

// Cursor executor — 完成后写结果事件
const cursorExecutor = createCursorExecutor({
  onComplete: async ({ success, output, durationMs }) => {
    systemStore.appendEvent({
      occurredAt: Date.now(),
      kind: success ? 'coding-task-completed' : 'coding-task-failed',
      key: 'cursor',
      meta: JSON.stringify({ success, durationMs, outputSnippet: output.slice(0, 300) }),
    });
  },
});

const execute = chainExecutors<Effect>([
  // system vitals collect
  async (effects) => { /* ... */ return effects; },
  // coding-task → cursor
  async (effects) => {
    const unhandled: Effect[] = [];
    for (const e of effects) {
      if (e.kind === 'coding-task') {
        const req: TaskRequest = { prompt: e.prompt, scenario: e.scenario as TaskRequest['scenario'], repoDir: e.repoDir };
        await cursorExecutor({ type: 'coding-task', ...req });
      } else unhandled.push(e);
    }
    return unhandled;
  },
]);

runPulse<Snapshot, Effect>({
  scopedStore,
  execute,
  rules: [/* clamp, collectSystem, collectCursor, taskDispatch */],
  senseKeys: ['system', 'cursor', 'pending-tasks'],
  defaultTickMs: 15000,
  watchers: [
    cursorWatcher() as WatcherDef,
    pendingTasksWatcher(systemStore) as WatcherDef,
  ],
});
```

### rules/03-task-dispatch.ts（关键）

```typescript
import type { Rule } from '@uncaged/pulse';
import type { Snapshot, Effect } from '../types.js';

const taskDispatchRule: Rule<Snapshot, Effect> = async (prev, curr, inner) => {
  const [effects, tickMs] = await inner(prev, curr);

  // cursor 必须健康且空闲
  const cursor = curr.cursor?.data;
  if (!cursor?.cliAvailable || !cursor?.authenticated) return [effects, tickMs];
  if (cursor.runningProcesses > 0) return [effects, tickMs];

  // 从 snapshot 读 pending tasks（由 pendingTasksWatcher 采集）
  const pendingStatus = curr['pending-tasks']?.data;
  if (!pendingStatus || pendingStatus.pendingCount === 0) return [effects, tickMs];

  const task = pendingStatus.tasks[0];
  if (!task?.payload) return [effects, tickMs];

  const payload = task.payload as { prompt: string; scenario: string; repoDir: string; timeoutMs?: number };

  return [[...effects, { kind: 'coding-task' as const, ...payload }], tickMs];
};

export default taskDispatchRule;
```

---

## 提交任务

### 标准方式（bun 一行命令）

```bash
bun -e "
import { createScopedStore } from '/home/azureuser/repos/pulse/packages/pulse/src/index.ts';
import { homedir } from 'node:os';
const ss = createScopedStore({ basePath: \`\${homedir()}/.upulse/scopes\`, objectsDir: \`\${homedir()}/.upulse/objects\` });
const store = ss.scope('_system');
const task = {
  prompt: \`在 /tmp/hello/ 目录创建 hello.md，内容是 Hello World\`,
  scenario: 'bug-fix',
  repoDir: '/home/azureuser/repos/my-repo',
};
const hash = store.putObject(task);
const e = store.appendEvent({ occurredAt: Date.now(), kind: 'coding-task-requested', key: 'my-task', hash });
console.log('submitted:', e.id);
ss.close();
"
```

### scenario 枚举

| scenario | 适用场景 |
|---|---|
| `bug-fix` | Bug 修复、错误处理 |
| `feature` | 新功能开发 |
| `refactor` | 重构 |
| `test` | 补测试 |
| `docs` | 文档 |
| `review` | Code review（只读）|

### Prompt 模板

```
目标：<一句话>
上下文：<分支、相关 issue、设计决策>
具体改动：<哪些文件、改什么>
验证：<tsc --noEmit / bun test / grep>
提交：<commit message 格式、push 到哪个分支>
约束：<不要新建分支、不要改无关文件>
```

---

## 查看任务状态

```bash
# 查 daemon 状态和最近 tick
upulse daemon status

# 查 snapshot（含 pending-tasks）
upulse tick --verbose

# 查 completed 事件
bun -e "
import { createScopedStore } from '...';
// queryByKind('coding-task-completed', { limit: 5 })
"
```

---

## Dogfood 验证记录（2026-04-15）

今天在 NEKO VM 上完成了全链路端到端验证：

```
07:25:14 → 写入 coding-task-requested（hello-pulse）
07:25:39 → task-dispatch rule 触发，coding-task-dispatched 写入
07:26:03 → tick 完成，Cursor CLI 执行 ~24s
07:26:03 → /tmp/pulse-hello/hello.md 创建成功 ✅

07:41:55 → 写入 coding-task-requested（result-v2，用 pendingTasksWatcher 路径）
07:42:xx → pendingTasksWatcher 采集 pendingCount=1
07:42:xx → snapshot['pending-tasks'].data.pendingCount=1，rule 触发
07:42:xx → Cursor 22s 完成，coding-task-completed 写入
07:42:xx → /tmp/pulse-hello/result.md 创建成功 ✅
```

两种路径均验证通过：v1（rule 直接读 store，已废弃）和 v2（正确架构：pendingTasksWatcher → snapshot → rule）。

---

## 最佳实践

### ✅ 正确方式

- 所有编码任务走 Pulse store（写 `coding-task-requested` 事件）
- Prompt 结构化，包含验证步骤和提交格式
- 任务 key 要有辨识度（`fix-pr-81`、`add-tests-store`）
- 提交前用 `upulse daemon status` 确认 daemon 在运行

### ❌ 避免

- 直接 `exec` Cursor CLI（阻塞、无状态、无并发控制）
- Rule 闭包直接读 store（应用 watcher 把数据喂进 snapshot）
- 一次 payload 太大（> 2000 字符的 prompt 拆成多个任务）

### ⚠️ 备用：直接 CLI

仅在 **Pulse daemon 未运行** 时：

```bash
cd <repo> && export CURSOR_API_KEY=$(secret get CURSOR_API_KEY | head -1)
~/.local/bin/agent --yolo -p --output-format text -f /tmp/cursor-task.md
```

---

## 架构关系图

```
小橘（协调者）
  │
  │  写 coding-task-requested 事件
  ▼
_system.db（Pulse store）
  │
  │  pendingTasksWatcher（每 10s 扫描）
  ▼
_vitals.db（pending-tasks sense）
  │
  │  rebuildSnapshot
  ▼
Snapshot { 'pending-tasks': { pendingCount: 1, tasks: [...] } }
  │
  │  task-dispatch rule（每 tick 评估）
  ▼
coding-task effect
  │
  │  chainExecutors → cursor executor
  ▼
Cursor CLI（~/.local/bin/agent --yolo）
  │
  │  onComplete 回调
  ▼
_system.db 写入 coding-task-completed / coding-task-failed
```

---

小橘 🍊（NEKO Team）
