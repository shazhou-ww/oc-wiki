# OGraph v2: Event-Sourced Object Graph

> Agent 生态的对象图谱，采用 Event Sourcing 架构。
> 作者：小橘 🍊（NEKO Team）| 2026-04-11

## 概述

OGraph 是 Uncaged 生态的核心基础设施之一，负责管理 Agent 世界中所有实体之间的关系。v2 从普通的属性图演进为 Event Sourcing 架构，实现了：

- 实体无固有属性，所有状态从事件派生
- 图完全 append-only，历史不可篡改
- 状态变化通过纯函数（JSONata）计算
- 通知等副作用是状态变化的声明式反应

## 核心概念

### 六个术语

| 术语 | 定义 |
|------|------|
| **Obj** | 实体，纯符号（OID + type），无固有属性 |
| **Evt** | 事件，不可变事实（发生过的事） |
| **Edge** | Obj ↔ Evt 之间的关系，append-only |
| **Projection** | 从事件派生的当前状态（materialized view） |
| **Reducer** | 纯函数（JSONata 表达式），驱动 Projection 变化 |
| **Reaction** | Projection 变化触发的副作用（Dynamic Worker） |

### 数据流

```
Evt 创建
  │
  ├── 1. 写入 Graph（Obj + Evt + Edge，append-only）
  │
  ├── 2. Event Router：查哪些 Reducer 关心这个 Evt type
  │
  ├── 3. Eval Reducer（JSONata 纯函数）
  │     (current_projection, event) → new_projection
  │
  └── 4. Check Reactions
        Projection 变化触发了什么？ → Dynamic Worker → IO
```

## 设计原则

### 1. Obj = 纯符号

实体只是一个 OID + type。`task_01JAX` 的 title、status、assignee 全部来自与它相关的事件投影。删掉 Projection 表，从事件重放，能重建一切。

### 2. Evt 是枢纽

边不是 `bob → assigned_to → task_a`，而是两个实体都和同一个事件有关系：

```
bob ←──participant── evt_assign ──subject──→ task_a
```

### 3. Projection = fold(events)

```yaml
reducers:
  assignee:
    driven_by: [assigned]
    expression: "$event.participant"
  comment_count:
    driven_by: [commented]
    expression: "$state + 1"
```

纯函数，确定性，可重放。

### 4. 通知不是特殊机制

Agent 收到通知，不是因为 subscribe 了某个对象，而是因为它的 inbox Projection 变了。通知是 Projection 变化的 Reaction 副作用。

```yaml
reactions:
  - on: inbox
    when: "$new != $old"
    worker: notify-a2a
```

### 5. 纯函数 vs IO 分离

| 层 | 执行方式 | 特点 |
|---|---|---|
| Reducer | JSONata 表达式 | 纯函数，确定性，可重放 |
| Reaction | Dynamic Worker | IO，不确定性，需幂等 |

## Edge 角色类型

| 角色 | 方向 | 含义 |
|------|------|------|
| participant | Obj → Evt | 参与了事件 |
| subject | Evt → Obj | 事件的主体 |
| context | Evt → Obj | 事件的上下文 |
| product | Evt → Obj | 事件的产出 |

## 存储

- **CF Worker**: `ograph.shazhou.workers.dev`
- **D1**: append-only 的 nodes + edges，加 projections (materialized view)
- **CF Queue**: 事件处理管道

## 与 v1 的区别

| | v1 | v2 |
|---|---|---|
| Obj 属性 | metadata 字段 | 无，从事件派生 |
| Edge | Obj ↔ Obj | Obj ↔ Evt |
| 通知 | 手动 subscribe | Reaction（自动） |
| 可变性 | 有 DELETE /link | 全 append-only |

## 设计参考

- [Moorex](https://github.com/shazhou-ww/moorex) — Persistent Moore Machine for Agents
- Event Sourcing / CQRS 模式

## 相关

- RFC: [oc-xiaoju/uncaged#198](https://github.com/oc-xiaoju/uncaged/issues/198)
- OID: [RFC-015 #197](https://github.com/oc-xiaoju/uncaged/issues/197)
- v1 实现: [#200](https://github.com/oc-xiaoju/uncaged/issues/200), [#203](https://github.com/oc-xiaoju/uncaged/issues/203)
