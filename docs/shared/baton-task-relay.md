---
title: "Baton — Serverless 任务接力系统"
description: "WorkItem 驱动、事件接力、递归 breakdown 的纯 serverless 任务调度架构"
date: 2026-04-04
authors: [小橘 🍊]
tags: [baton, uncaged, architecture, serverless, task-scheduling]
---

# Baton 🏃 — Serverless 任务接力系统

!!! abstract "一句话"
    没有 subagent，没有长进程。只有接力棒（Baton）在无状态 worker 之间传递，直到任务完成。

## 问题

传统 AI Agent 架构中，"subagent"是一个被广泛使用的概念：主 agent spawn 一个子 agent 来处理子任务。但这个模型有几个根本问题：

1. **Subagent 是重量级的** — 每个 subagent 有自己的身份、system prompt、上下文窗口，spawn 开销大
2. **暗示长进程** — subagent "活着"直到任务完成，在 serverless 环境（如 CF Workers）中不可行
3. **概念上是错的** — agent 不是在"生孩子"，它只是在并发地做几件事

### 核心洞察

> **根本不存在 subagent。只有 agent 对特定任务的工作过程。**

就像 goroutine——不是创建一个新的"程序"，而是在同一个程序里开了一个并发的执行流。轻量、共享上下文、做完就没了。

## 设计

### Baton（接力棒）

一个 Baton 是一个**完整的、自包含的任务描述**。任何一个无状态的 worker 拿到它就能开始工作：

```typescript
interface Baton {
  id: string                    // "bt_abc123"
  
  // ── 任务定义 ──
  goal: string                  // 要完成什么
  context: Record<string, any>  // 上下文信息（用户、来源、任何相关数据）
  tools?: string[]              // 工具白名单（空 = 全部可用）
  prompt?: string               // 针对这个任务的额外指令
  constraints?: {
    max_rounds?: number         // agentic loop 最大轮数
    timeout_hint?: number       // 建议执行时间（秒），worker 据此决定是否 breakdown
  }
  
  // ── 任务树 ──
  parent_id?: string            // 父 Baton（null = 根任务）
  children?: string[]           // 子 Baton ID 列表（breakdown 时填入）
  depth: number                 // 递归深度（根 = 0）
  
  // ── 状态 ──
  status: 'pending' | 'running' | 'completed' | 'failed' | 'spawned'
  result?: any                  // 执行结果（completed 时）
  error?: string                // 错误信息（failed 时）
  
  // ── 元数据 ──
  created_at: number
  updated_at: number
  channel?: string              // 结果通知渠道（telegram / api / a2a）
  notify?: boolean              // 完成后是否通知用户
}
```

### Worker

Worker 是**无状态的执行器**。它不知道自己是"主 agent"还是"子 agent"——这个区别不存在。它只知道：

1. 拿到一个 Baton
2. 执行它
3. 报告结果

```typescript
async function executeBaton(baton: Baton): Promise<void> {
  // 唯一的决策：我能在时间窗口内完成吗？
  if (shouldBreakdown(baton)) {
    // 太大了 → 拆分
    const children = await planBreakdown(baton)
    await spawnChildren(baton.id, children)
    await updateStatus(baton.id, 'spawned')
  } else {
    // 可以完成 → 执行
    try {
      const result = await runAgentLoop(baton)
      await complete(baton.id, result)
    } catch (e) {
      await fail(baton.id, e.message)
    }
  }
}
```

### 三种结局

每个 worker 执行一个 Baton，只有三种可能的结果：

| 结局 | 含义 | 触发什么 |
|------|------|----------|
| **completed** | 任务完成，result 填入 | 触发 parent 的 children check |
| **failed** | 任务失败，error 填入 | 触发 parent 的错误处理 |
| **spawned** | 任务太大，已拆分成子 Baton | 子 Baton 进入 pending，等待调度 |

第三种是递归的——子 Baton 也可以再拆分。

### 事件驱动调度

**没有轮询，没有长连接。** 全靠事件：

```
Baton 状态变更 → 事件 → 调度器检查 → 触发下一步
```

核心调度逻辑：

```typescript
async function onBatonStatusChange(batonId: string, newStatus: string) {
  const baton = await loadBaton(batonId)
  
  if (newStatus === 'completed' || newStatus === 'failed') {
    if (baton.parent_id) {
      // 有 parent → 检查所有 siblings 是否都完成了
      const parent = await loadBaton(baton.parent_id)
      const children = await loadChildren(parent.id)
      const allDone = children.every(c => c.status === 'completed' || c.status === 'failed')
      
      if (allDone) {
        // 所有子任务完成 → 唤醒 parent 继续执行
        const childResults = children.map(c => ({ id: c.id, goal: c.goal, result: c.result, error: c.error }))
        await resumeParent(parent, childResults)
      }
    } else {
      // 没有 parent → 根任务完成 → 通知用户
      if (baton.notify) {
        await notifyUser(baton)
      }
    }
  }
  
  if (newStatus === 'pending') {
    // 新任务 → 派发给 worker 执行
    await dispatchToWorker(baton)
  }
}
```

### 事件接力图

```
用户消息
  │
  ▼
┌─────────────────────┐
│ 请求 1: Worker       │
│ 拿到 bt_root         │
│ → 太大，breakdown    │
│ → spawn bt_a, bt_b   │
│ → 退出               │
└─────────────────────┘
  │                │
  ▼                ▼
┌──────────┐  ┌──────────┐
│ 请求 2    │  │ 请求 3    │    ← 并发！
│ 执行 bt_a │  │ 执行 bt_b │
│ → completed│  │ → completed│
└──────────┘  └──────────┘
  │                │
  └───────┬────────┘
          ▼
┌─────────────────────┐
│ 请求 4: Worker       │
│ bt_root 被唤醒       │
│ → 汇总 bt_a + bt_b  │
│ → completed          │
│ → 通知用户           │
└─────────────────────┘
```

每个请求都是短暂的。没有任何一个 Worker 需要跑超过执行窗口。但整个任务可以跨越任意长的时间、任意深的递归。

**用事件接力代替长进程。**

### Breakdown 决策

Worker 怎么判断"我能完成吗"？两个信号：

**1. 时间预估（硬约束）**

```typescript
function shouldBreakdown(baton: Baton): boolean {
  const timeHint = baton.constraints?.timeout_hint || 25  // 默认 25 秒窗口
  const estimatedRounds = estimateRounds(baton.goal, baton.tools)
  const avgRoundTime = 5  // 每轮 LLM 调用约 5 秒
  
  return estimatedRounds * avgRoundTime > timeHint
}
```

**2. LLM 判断（软约束）**

也可以直接问 LLM：

> "你有约 25 秒的执行窗口。以下任务能在窗口内完成吗？如果不能，请拆分成可以独立完成的子任务。"

LLM 天然擅长判断任务复杂度。如果它认为"查天气"一轮就搞定，就直接做；如果认为"写一篇分析报告"需要搜索 + 整理 + 写作，就拆分。

**递归的自然退出条件**：任务小到一个 worker 能在时间窗口内完成时，递归就停了。不需要预设"最多拆几层"——复杂度决定深度。

## 存储层

### D1 Schema

```sql
CREATE TABLE batons (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  depth INTEGER DEFAULT 0,
  
  -- 任务定义
  goal TEXT NOT NULL,
  context TEXT,          -- JSON
  tools TEXT,            -- JSON array
  prompt TEXT,
  max_rounds INTEGER DEFAULT 6,
  timeout_hint INTEGER DEFAULT 25,
  
  -- 状态
  status TEXT DEFAULT 'pending',  -- pending/running/completed/failed/spawned
  result TEXT,           -- JSON
  error TEXT,
  
  -- 通知
  channel TEXT,          -- telegram / api / a2a
  notify INTEGER DEFAULT 0,
  
  -- 时间
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  
  FOREIGN KEY (parent_id) REFERENCES batons(id)
);

CREATE INDEX idx_batons_parent ON batons(parent_id);
CREATE INDEX idx_batons_status ON batons(status);
```

### 为什么是 D1 而不是 KV

- **强一致性** — 状态机需要 read-then-write 原子性，KV 的 60 秒最终一致性会导致 race condition
- **SQL 查询** — "查找某个 parent 下所有 children 的状态"是高频操作，D1 原生支持
- **事务** — 更新 Baton 状态 + 检查 siblings 需要在同一个事务里

## 调度机制

### CF Workers 实现

在 CF Workers 环境下，调度有几种方式：

**方案 A：自调用 + waitUntil（推荐起步）**

```typescript
// 创建子 Baton 后，通过 waitUntil 异步触发执行
for (const child of children) {
  ctx.waitUntil(
    fetch(`https://doudou.shazhou.work/baton/${child.id}/run`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
    })
  )
}
```

- ✅ 零额外基础设施
- ✅ 天然并发（多个 waitUntil 并行）
- ⚠️ 需要 Custom Domain（避免同 account Worker 互调限制）

**方案 B：Queue + Consumer**

```typescript
// Baton 状态变更时推入 Queue
await env.BATON_QUEUE.send({ batonId: child.id, action: 'execute' })
```

CF Queues 的 Consumer 天然是事件驱动的，重试、死信队列都有。

- ✅ 真正的异步，解耦调度和执行
- ✅ 内置重试和错误处理
- ⚠️ 需要配置 Queue binding

**方案 C：Durable Objects 协调器（远期）**

一个 DO 实例管理整棵任务树的状态。

- ✅ 强一致 + 实时事件
- ⚠️ 复杂度高，起步不需要

### 建议路径

**Phase 1**：方案 A（自调用 + waitUntil）。验证 Baton 模型本身是否 work。

**Phase 2**：方案 B（Queue）。当任务量上来需要更可靠的调度时引入。

**Phase 3**：方案 C（DO）。当需要实时状态推送、复杂协调逻辑时考虑。

## 与 Uncaged 集成

### 新端点

```
POST /baton              → 创建 Baton（外部触发）
POST /baton/:id/run      → 执行 Baton（内部调度）
GET  /baton/:id          → 查询状态
GET  /baton/:id/tree     → 查询完整任务树
```

### 新内置 Tool

```typescript
// 主 agent 的 agentic loop 中可用
{
  name: "spawn_task",
  description: "创建一个并发子任务。任务会被独立执行，完成后结果自动汇总。",
  parameters: {
    goal: { type: "string", description: "子任务目标" },
    tools: { type: "array", description: "工具白名单（可选）" },
    context: { type: "object", description: "额外上下文（可选）" },
  }
}
```

LLM 可以在 agentic loop 中调用 `spawn_task` 创建并发子任务。当所有子任务完成后，结果自动注入到主 agent 的下一轮对话中。

### 用户体验

用户感知不到 Baton 的存在。对用户来说：

1. 发一条消息
2. 豆豆说"让我想想…"（或直接开始回复）
3. 一段时间后，收到完整的回复

如果任务很快（单个 Baton 直接完成），体验和现在一样。如果任务复杂（breakdown 了好几层），用户只是等得稍微久一点，但最终收到的是一个汇总好的完整回答。

可选的透明度增强：

- 豆豆可以先发一条"我正在并行处理 3 个子任务…"
- 子任务完成时逐个推送进展
- 这由根 Baton 的 `notify` 策略控制

## 与 Sigil 的关系

| | Sigil | Baton |
|--|-------|-------|
| 管理什么 | 能力（Capability） | 任务（Task） |
| 核心隐喻 | 印记 — 刻在石头上的符文 | 接力棒 — 手递手传递 |
| 虚拟化 | 能力虚拟内存（按需加载/卸载） | 执行虚拟化（事件接力/递归 breakdown） |
| 存储 | KV（能力代码 + 元数据） | D1（任务状态 + 树结构） |
| 生命周期 | 持久（能力一直在，按需换入换出） | 短暂（任务完成即消失） |

Sigil + Baton = **agent 既不需要预装所有工具，也不需要一口气跑完所有任务。**

能力按需加载，执行按需接力。完全的 serverless 范式。

## 设计原则

1. **任务是一等公民，agent 不是** — Baton 是主语，worker 是动词。没有"子 agent"的概念。
2. **无状态 worker** — 任何 worker 拿到任何 Baton 都能执行。不依赖特定实例。
3. **事件驱动** — 没有轮询，没有长连接。状态变更触发下一步。
4. **递归 breakdown 自然收敛** — 时间窗口是唯一约束，任务复杂度决定递归深度。
5. **用户无感** — Baton 是内部实现，用户只看到"发消息 → 收到回复"。

---

*小橘 🍊（NEKO Team）*  
*2026-04-04*
