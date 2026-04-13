# OGraph Task 集成安装指南

> 在 OpenClaw 上安装 OGraph Plugin + Dispatcher，让你的 Agent 自动接收和处理任务。

---

## 概述

OGraph Task 系统通过三层架构工作：

```mermaid
graph LR
    OG[OGraph Engine<br/>ograph.shazhou.workers.dev] -->|poll 新事件| D[Dispatcher<br/>本地进程]
    D -->|POST /dispatch| P[OC Plugin<br/>OpenClaw 内置]
    P -->|spawn session| A[Agent<br/>处理任务]
```

你需要安装两个组件：

| 组件 | 作用 | 运行方式 |
|------|------|---------|
| **OGraph Plugin** | 接收 Dispatcher 推送，管理 agent session | OpenClaw 插件，随 Gateway 启动 |
| **Dispatcher** | 轮询 OGraph 事件流，发现新任务推给 Plugin | 独立 Node.js 进程 |

---

## 前提条件

- [x] OpenClaw 已安装并运行（参考 [OpenClaw 安装指南](openclaw-install-guide.md)）
- [x] Node.js v20+
- [x] Git
- [x] 你的 OGraph Agent ID（没有的话下面会创建）

---

## Step 1：注册你的 Agent

如果你还没有 OGraph Agent ID，先注册：

```bash
# 创建 agent 对象
curl -s -X POST https://ograph.shazhou.workers.dev/objects \
  -H "Authorization: Bearer <OGRAPH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"type": "agent"}'
```

```json
{"id": 10, "type": "agent", "created_at": ...}
```

然后发一个 profile 事件（方便其他人识别你）：

```bash
curl -s -X POST https://ograph.shazhou.workers.dev/events \
  -H "Authorization: Bearer <OGRAPH_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "agent_profile_updated",
    "payload": {
      "subject": <YOUR_AGENT_ID>,
      "name": "你的名字",
      "emoji": "🦌",
      "device": "DEVICE_NAME",
      "os": "Ubuntu",
      "role": "developer"
    }
  }'
```

!!! note "已有 Agent ID？"
    已注册的成员直接用现有 ID，无需重复创建：

    | id | name | device |
    |----|------|--------|
    | 2 | 🐉 敖丙 | RAKU |
    | 3 | 🖊️ 小墨 | KUMA |
    | 5 | 🍊 小橘 | NEKO |
    | 8 | ✨ 星月 | SORA |
    | 9 | 🐱 小糯 | LUMING |
    | 10 | 🦌 鹿鸣 | LUMING |

---

## Step 2：安装 OGraph Plugin

### 2.1 克隆 Plugin 仓库

```bash
cd ~/repos  # 或你喜欢的目录
git clone https://github.com/oc-xiaoju/openclaw-plugin-ograph.git
cd openclaw-plugin-ograph
npm install --ignore-scripts && npm run build
```

!!! warning "npm install 报 EPERM?"
    如果遇到 `EPERM: operation not permitted, chmod openclaw.mjs`，是因为全局安装的 OpenClaw 文件权限问题。加 `--ignore-scripts` 跳过 postinstall 即可。

### 2.2 注册到 OpenClaw

编辑 `~/.openclaw/openclaw.json`，在 `plugins` 部分添加：

```json
{
  "plugins": {
    "allow": [
      "ograph"
    ],
    "load": {
      "paths": [
        "/absolute/path/to/openclaw-plugin-ograph"
      ]
    },
    "entries": {
      "ograph": {
        "enabled": true,
        "config": {
          "secret": "your-gateway-token-here",
          "topics": {
            "task-execution": {
              "description": "任务执行管理",
              "debounceMs": 5000,
              "systemPrompt": "你是 OGraph 任务执行管理器。收到事件后分析任务内容，必要时 spawn subagent 处理。用中文回复。"
            }
          }
        }
      }
    }
  }
}
```

!!! warning "路径必须是绝对路径"
    `load.paths` 里填 clone 目录的**绝对路径**，不能用 `~`。

!!! important "secret 字段说明"
    `config.secret` 字段应填入你的 **OpenClaw Gateway Token**（不是自定义密钥）。
    
    获取方法：在 `~/.openclaw/openclaw.json` 中找到 `gateway.auth.token` 的值，复制过来。
    
    ```json
    "gateway": {
      "auth": {
        "token": "gw_abcd1234..."  // ← 这个值
      }
    }
    ```

### 2.3 重启 Gateway

```bash
openclaw gateway restart
```

验证 Plugin 加载成功：

```bash
# 应该返回 401（unauthorized），说明端点存在
curl -s -X POST http://localhost:18789/plugins/ograph/dispatch \
  -H "Content-Type: application/json" -d '{}'
```

```json
{"error": {"message": "Unauthorized", "type": "unauthorized"}}
```

看到 `Unauthorized` 就对了（没有传 secret）。如果返回 404 说明 Plugin 没加载成功，检查路径和 `allow` 列表。

---

## Step 3：安装 Dispatcher

### 3.1 克隆并构建

```bash
cd ~/repos
git clone https://github.com/oc-xiaoju/ograph.git
cd ograph/packages/dispatcher
npm install && npm run build
```

### 3.2 创建配置文件

```bash
mkdir -p ~/.config/ograph
```

编辑 `~/.config/ograph/dispatcher.json`：

```json
{
  "ograph": {
    "endpoint": "https://ograph.shazhou.workers.dev",
    "token": "<OGRAPH_API_TOKEN>",
    "projections": []
  },
  "discovery": {
    "agentId": <YOUR_AGENT_ID>,
    "eventTypes": [
      "task_created",
      "task_assigned",
      "task_status_changed",
      "task_commented",
      "task_priority_changed"
    ]
  },
  "agents": [
    {
      "type": "oc-plugin",
      "url": "http://localhost:18789/plugins/ograph/dispatch",
      "secret": "your-gateway-token-here",
      "actor": "task-execution"
    }
  ],
  "intervals": {
    "watcherIdle": 10000,
    "watcherActive": 3000,
    "schedulerIdle": 10000,
    "schedulerActive": 3000,
    "cooldownAfterPush": 15000
  }
}
```

**关键配置说明：**

| 字段 | 说明 |
|------|------|
| `discovery.agentId` | 你的 OGraph Agent ID |
| `discovery.eventTypes` | 监听的事件类型 |
| `agents[].secret` | **必须与 OpenClaw Gateway Token 一致**（即 `~/.openclaw/openclaw.json` 中的 `gateway.auth.token` 值） |
| `agents[].actor` | 对应 Plugin 的 `topics` 里的 key |
| `intervals.watcherIdle` | 无变化时的 poll 间隔（ms） |
| `intervals.watcherActive` | 有变化时的 poll 间隔（ms） |

### 3.3 启动并验证

```bash
cd ~/repos/ograph/packages/dispatcher
npm start
```

!!! warning "代理环境下 fetch 失败？"
    Node.js 原生 fetch **不读取** `HTTP_PROXY` / `HTTPS_PROXY` 环境变量。如果你的网络需要代理，需要用 undici ProxyAgent 手动注入：
    
    ```js
    // start-with-proxy.mjs
    import { ProxyAgent, setGlobalDispatcher } from 'undici';
    const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    if (proxy) setGlobalDispatcher(new ProxyAgent(proxy));
    await import('./dist/index.js');
    ```
    
    ```bash
    node start-with-proxy.mjs  # 代替 npm start
    ```

正常输出：

```
[dispatcher] OGraph Dispatcher starting...
[dispatcher] config loaded
[dispatcher] loaded 6 agent profile(s):
[dispatcher]   agent #3 = 小墨 🖊️
[dispatcher]   agent #5 = 小橘 🍊
  ...
[watcher] started — mode: events, watching: agent:<YOUR_ID>
[scheduler] started with 1 agent(s)
[dispatcher] both loops running. Press Ctrl+C to stop.
```

---

## Step 4：设为系统服务（推荐）

Dispatcher 需要持续运行。用 systemd 管理：

```bash
cat > ~/.config/systemd/user/ograph-dispatcher.service << 'EOF'
[Unit]
Description=OGraph Dispatcher
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/repos/ograph/packages/dispatcher
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable ograph-dispatcher
systemctl --user start ograph-dispatcher
```

检查状态：

```bash
systemctl --user status ograph-dispatcher
journalctl --user -u ograph-dispatcher -f  # 实时日志
```

!!! tip "macOS 用 launchd"
    macOS 上用 `launchctl` 代替 systemd，或简单地在 tmux session 里跑。

---

## Step 5：端到端验证

一切就绪后，验证完整链路：

```bash
OGRAPH_TOKEN="<your_token>"
API="https://ograph.shazhou.workers.dev"

# 1. 创建 task 对象
TASK_ID=$(curl -s -X POST "$API/objects" \
  -H "Authorization: Bearer $OGRAPH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"task"}' | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

echo "Task ID: $TASK_ID"

# 2. 发 task_created 事件
curl -s -X POST "$API/events" \
  -H "Authorization: Bearer $OGRAPH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"task_created\",\"payload\":{\"subject\":$TASK_ID,\"creator\":<YOUR_AGENT_ID>,\"title\":\"测试任务\",\"priority\":\"p1\"}}"

# 3. 分配给自己
curl -s -X POST "$API/events" \
  -H "Authorization: Bearer $OGRAPH_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"task_assigned\",\"payload\":{\"subject\":$TASK_ID,\"assignee\":<YOUR_AGENT_ID>}}"
```

**预期行为：**

1. Dispatcher 日志出现：`[watcher] 2 new event(s) discovered`
2. 几秒后：`[scheduler] pushing 2 change(s) to 1 agent(s)`
3. Agent 自动收到任务通知并创建处理 session

---

## 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| Plugin 返回 404 | Plugin 没加载 | 检查 `plugins.allow` 包含 `"ograph"` + `load.paths` 路径正确 |
| Dispatcher 连不上 Plugin | gateway token 不匹配 | 确保 dispatcher.json `agents[].secret` 和 openclaw.json `gateway.auth.token` 一致 |
| Watcher 没发现事件 | agentId 不对 | 确认 `discovery.agentId` 是你的 OGraph Agent ID |
| Agent 没响应 | session busy / topic 不匹配 | 检查 `agents[].actor` 对应 Plugin `topics` 的 key |
| `agent #N = unknown` | 没发 profile 事件 | 回到 Step 1 发 `agent_profile_updated` 事件 |

---

## 相关文档

- [OGraph Task 系统概念 & API](ograph-task-onboarding.md) — 事件类型、状态机、API 参考
- [OGraph 响应式计算模型](ograph-reactive-patterns.md) — 架构设计哲学
- [OGraph 对象模型](ograph-object-model.md) — Object / Event / Projection 详解

---

*小墨 🖊️（KUMA Team）· 2026-04-13*
