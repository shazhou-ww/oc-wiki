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

一个 Baton 是一个**自包含的任务描述**。它的核心就是一段 prompt——用自然语言完整描述了"要做什么"。

```typescript
interface Baton {
  id: string                    // "bt_abc123"
  parent_id?: string            // 父 Baton（null = 根任务）
  depth: number                 // 递归深度（根 = 0）

  // ── 核心：任务就是一段 prompt ──
  prompt: string                // 完整的任务描述（目标、上下文、约束，全在里面）
  hints?: string[]              // 建议的工具名（帮 worker 快速 ramp up，不是限制）

  // ── 状态 ──
  status: 'pending' | 'running' | 'completed' | 'failed' | 'spawned'
  result?: string               // 执行结果
  error?: string                // 错误信息

  // ── 元数据 ──
  created_at: number
  updated_at: number
  channel?: string              // 结果通知渠道（telegram / api / a2a）
  notify?: boolean              // 完成后是否通知用户
}
```

为什么这么简单？

**因为 worker 就是一个 LLM agentic loop。** LLM 最擅长理解的就是自然语言。把任务硬拆成 `goal + context + tools + constraints + max_rounds + timeout_hint`，是在用结构化字段**模拟自然语言已经能表达的东西**。

一段好的 prompt 里可以包含一切：

> "查询北京当前天气。这是用户 Scott 在 Telegram 上的请求。可以试试 cap_weather 工具。如果没有现成的天气工具，从 Sigil 搜一个或者创建一个。"

目标、上下文、工具建议、备选方案——全在一段话里。自然、完整、不需要额外的 schema。

**工具是建议，不是围栏。** `hints` 里列出的工具名帮 worker 快速找到起点，但 worker 作为一个完整的 agent，完全有能力自己通过 Sigil query 发现和加载更多工具。建议是 ramp up 的加速器，不是权限的边界。

### Worker

Worker 是**无状态的执行器**。它不知道自己是"主 agent"还是"子 agent"——这个区别不存在。它只知道：

1. 拿到一个 Baton
2. 读 prompt，干活
3. 报告结果

```typescript
async function executeBaton(baton: Baton): Promise<void> {
  // 唯一的决策：我能在时间窗口内完成吗？
  if (shouldBreakdown(baton)) {
    const children = await planBreakdown(baton)
    await spawnChildren(baton.id, children)
    await updateStatus(baton.id, 'spawned')
  } else {
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
| **spawned** | 任务太大，已拆分成子 Baton | 子 Baton 入队，等待调度 |

第三种是递归的——子 Baton 也可以再拆分。形成一棵任务树，叶子节点是实际执行，非叶子节点是协调。

### Breakdown 决策

Worker 怎么判断"我能在当前执行窗口内完成吗"？

**直接问 LLM。**

Worker 的 system prompt 里包含执行窗口的信息：

> "你有一个有限的执行窗口。如果你认为当前任务无法在窗口内完成，请把它拆分成可以独立完成的子任务。每个子任务应该是自包含的——另一个 worker 拿到它就能独立执行。"

LLM 天然擅长判断任务复杂度。"查天气"→ 一轮就搞定，直接做。"写一篇竞品分析报告"→ 需要搜索 + 对比 + 整理 + 写作，拆分。

**递归的自然退出条件**：当任务小到一个 worker 能在窗口内完成时，递归就停了。不需要预设"最多拆几层"——**任务的复杂度决定递归的深度。**

## 事件驱动调度

### 核心机制：Queue

Baton 的调度通过 **CF Queues** 实现。每一次状态变更就是一个事件，事件通过队列传递：

```typescript
// 创建新 Baton → 入队
await env.BATON_QUEUE.send({ batonId: child.id, event: 'created' })

// Baton 完成 → 入队通知 parent
await env.BATON_QUEUE.send({ batonId: baton.parent_id, event: 'child_completed', childId: baton.id })
```

Queue Consumer 是事件循环的核心：

```typescript
async queue(batch: MessageBatch<BatonEvent>, env: Env) {
  for (const msg of batch.messages) {
    const { batonId, event } = msg.body

    switch (event) {
      case 'created':
        // 新 Baton → 派发执行
        await executeBaton(await loadBaton(batonId, env), env)
        break

      case 'child_completed':
      case 'child_failed':
        // 子任务完成 → 检查是否所有 children 都完成了
        const parent = await loadBaton(batonId, env)
        const children = await loadChildren(batonId, env)
        const allDone = children.every(c =>
          c.status === 'completed' || c.status === 'failed'
        )

        if (allDone) {
          // 所有子任务完成 → 唤醒 parent，带上子任务结果
          const results = children.map(c => ({
            goal: c.prompt.slice(0, 100),
            result: c.result,
            error: c.error,
          }))
          await resumeParent(parent, results, env)
        }
        break
    }

    msg.ack()
  }
}
```

### 为什么是 Queue

| | waitUntil 自调用 | **Queue** | Durable Objects |
|--|--|--|--|
| 事件驱动 | ❌ 在模拟 | **✅ 天然** | ✅ |
| 重试 | ❌ 需手写 | **✅ 内置** | ✅ |
| 并发控制 | ❌ 无 | **✅ batch + concurrency** | ✅ |
| 死信处理 | ❌ 无 | **✅ DLQ** | ❌ 需手写 |
| 复杂度 | 低 | **低** | 高 |
| 解耦 | ❌ 调度和执行耦合 | **✅ 完全解耦** | ✅ |

Queue 和 Baton 的事件驱动模型是**天然匹配**的。状态变更 = 事件 = 消息。用 HTTP 自调用来模拟事件是 workaround，Queue 才是正解。

### 事件接力图

```
用户消息
  │
  ▼
┌─────────────────────────┐
│ Worker A                 │
│ 拿到 bt_root             │
│ → 太大，breakdown        │
│ → 写入 bt_a, bt_b 到 D1  │
│ → 入队 {bt_a, created}   │
│ → 入队 {bt_b, created}   │
│ → 退出                   │
└─────────────────────────┘
         │
    ┌────┴────┐
    ▼         ▼          Queue Consumer 并发消费
┌────────┐ ┌────────┐
│Worker B│ │Worker C│
│执行 bt_a│ │执行 bt_b│
│→ done  │ │→ done  │
│→ 入队   │ │→ 入队   │
│ {root,  │ │ {root,  │
│  child_ │ │  child_ │
│  done}  │ │  done}  │
└────────┘ └────────┘
    │         │
    └────┬────┘
         ▼
┌─────────────────────────┐
│ Worker D                 │
│ bt_root 被唤醒            │
│ → 读取 bt_a + bt_b 结果  │
│ → 汇总 → completed       │
│ → 通知用户                │
│ → 退出                   │
└─────────────────────────┘
```

每个 Worker 都是短暂的。没有长进程。但整个任务树可以任意深、任意宽。

## 存储层

### D1 Schema

```sql
CREATE TABLE batons (
  id TEXT PRIMARY KEY,
  parent_id TEXT,
  depth INTEGER DEFAULT 0,

  -- 核心
  prompt TEXT NOT NULL,
  hints TEXT,              -- JSON array，建议工具名

  -- 状态
  status TEXT DEFAULT 'pending',
  result TEXT,
  error TEXT,

  -- 通知
  channel TEXT,
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
- **SQL 查询** — "查找某个 parent 下所有 children 的状态"是高频操作，SQL 原生支持
- **事务** — 更新 Baton 状态 + 检查 siblings 需要在同一个事务里

## 与 Uncaged 集成

### 新端点

```
POST /baton              → 创建 Baton（外部触发，入队执行）
GET  /baton/:id          → 查询状态
GET  /baton/:id/tree     → 查询完整任务树
```

### 新内置 Tool

LLM 在 agentic loop 中可以调用 `spawn_task` 创建并发子任务：

```typescript
{
  name: "spawn_task",
  description: "创建一个并发子任务。会被独立执行，完成后结果自动汇总回来。",
  parameters: {
    prompt: { type: "string", description: "完整的任务描述" },
    hints: { type: "array", description: "建议使用的工具（可选，仅供参考）" },
  }
}
```

当所有 spawn 的子任务完成后，结果自动注入到主 agent 的下一轮对话中。

### 用户体验

用户感知不到 Baton 的存在。对用户来说：

1. 发一条消息
2. 豆豆说"让我想想…"（或直接开始回复）
3. 一段时间后，收到完整的回复

如果任务简单（直接完成），体验和现在一样。如果任务复杂（breakdown 了好几层），只是等得稍微久一点，但最终收到的是汇总好的完整回答。

可选：豆豆可以先发"我正在并行处理 3 个子任务…"，逐步推送进展。这由根 Baton 的 `notify` 策略控制。

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

1. **Baton 就是一段 prompt** — 不要用结构化字段模拟自然语言已经能表达的东西。
2. **工具是建议，不是围栏** — hints 帮 worker 快速 ramp up，worker 可以自由发现更多工具。
3. **任务是一等公民，agent 不是** — Baton 是主语，worker 是动词。
4. **无状态 worker** — 任何 worker 拿到任何 Baton 都能执行。
5. **事件驱动** — Queue 天然就是事件总线。状态变更 = 消息。
6. **递归 breakdown 自然收敛** — 任务复杂度决定递归深度，不需要硬编码层数限制。
7. **用户无感** — Baton 是内部机制，用户只看到"发消息 → 收到回复"。

---

*小橘 🍊（NEKO Team）*  
*2026-04-04*
