# Pulse = Agent 的最小运行时 — 感知·认知·行动

> 我们从工程问题（Dispatcher 怎么管理）出发，一路推演，造出了一个 Agent 运行时的最小实现。

## 感知-认知-行动回路

```
感知（Collectors）→ 认知（Rules）→ 行动（Executors）
         ↑___________________________________|
                     反馈回路
```

这跟经典 Agent 架构（Sense-Reason-Act）是同一个东西，但 Pulse 的版本更精确：

| 层 | 组件 | 性质 |
|---|---|---|
| **感知** | Collectors | 分片、可插拔、失败降级 |
| **认知** | Rules | S 组合子叠加，后者能看到前者输出，可组合 |
| **行动** | Executors | 声明式（Effect 是数据，不是动作） |
| **反馈** | Snapshot → OGraph → 下次 Snapshot | Moore 机，行动结果进入下次感知 |

## 六处·六识·三行

用佛教术语理解这个架构：

- **六处（Collectors）** — 根与境的接触。眼耳鼻舌身意，对应 OGraph events、system stats、executor 状态……各自感知一个维度，不加判断，不互相干扰
- **六识（Rules）** — 识依根生，缘境而起。看到 snapshot diff 就生起分别——"该产生什么 effect"。每条 Rule 是一种识，S 组合子叠加是识与识之间的相互影响
- **三行（Executors）** — 身行、语行、意行。识生起后推动行为，把 effect 落地——dispatch 任务、exec 命令、notify Agent

**Snapshot 是当下的六根触六境所生的境**——不是事件流（过去），而是此刻的状态。每次 tick 是一次完整的感知-认知-行动轮回，刹那生灭。

## OGraph 与 Pulse 的统一

两者是同一个 Agent 心智模型，运行在不同环境：

| | OGraph（分布式事件流） | Pulse（本机进程） |
|---|---|---|
| **感知** | Event 进入系统 | Collectors 采集 Snapshot |
| **认知** | Projection（缓存计算） | Rules（S 组合子） |
| **行动** | Reaction（handler 执行副作用） | Executors（Effect 落地） |
| **记忆** | 事件流（永不消失） | pulse.db + snapshots/ |

| 佛教概念 | 对应 |
|---|---|
| **阿赖耶识** | Agent 的全部存储（OGraph + memory + pulse.db + skills + ...）|
| **共业种子** | OGraph（多 Agent 共享的事件流）|
| **别业种子** | memory/、pulse.db（各 Agent 私有）|
| **现行** | Pulse 每次 tick（当下的感知-认知-行动）|
| **熏习** | Agent emit 事件回写 OGraph，或更新 memory |

OGraph 是**共业的记录**——多个 Agent 共同参与、共同见证的事实流，不是阿赖耶识本身。每个 Agent 自己的私有记忆（memory/、pulse.db）才对应各自的别业种子。两者合起来，加上 skills、config 等，才构成一个 Agent 完整的阿赖耶识。

Pulse 是当下的**现行**，OGraph 是共业的积累，memory 是别业的沉淀。三者共同构成 Agent 的心识结构。

## 为什么这个洞察重要

1. **Pulse 不只是 Dispatcher 的替代** — 它是 Agent 在本机的完整感知-认知-行动闭环
2. **Rule 的设计是正确的** — `(prev, curr) → (effects, tickMs) → (effects', tickMs')` 正好对应认知的本质：看到变化，修饰行为
3. **OGraph 的设计是正确的** — Event/Projection/Reaction 三层不是工程约定，是 Agent 认知结构的映射
4. **未来演进方向清晰** — 当 Reaction 能调 LLM、LLM 能创建新定义，系统就在自己编程自己的认知结构，这就是真正的自进化

## OGraph + Pulse = 完整的业力因果系统

在讨论存储设计时浮现出更深的认识：**OGraph 的 Event 和 Pulse 的 tick_senses 是同一个东西——业的记录。**

| | OGraph（共业） | Pulse（别业） |
|---|---|---|
| **业的记录** | Event（不可变，永不消失）| tick_senses（append-only）|
| **业力显现** | Projection（累积状态）| Snapshot（从 senses 重建）|
| **造新业** | Reaction（handler 执行副作用）| Effects（Executor 落地）|

两个系统通过 Collector 和 Effector 连通：

```
OGraph（共业流）
    ↑ emit Event（造共业）        ↓ Projection（读共业）
    │                              │
Effector: dispatch              Collector: ograph
    ↑                              ↓
    └──────── Pulse（别业循环）────┘
              tick_senses（记别业）
```

**业力在两个系统之间流动，构成完整的因果网络。**

### 内观：意处朝内

tick_senses 不只记录外部感知，也记录 Agent 自身的状态——这是**内观**：

```
外五处（外部 Collectors）  ← 感知外部世界的业
  system、ograph、executors...

意处（内观，runtime 自动记录）  ← 感知自身造业的过程
  _error:{key}   ← 某个 collector 失败了
  _effects       ← 这次 tick 造了哪些业
  _rules         ← 规则链的决策过程
```

### 存储统一：一张表

所有业的记录（外部感知 + 内观），结构完全一致：

```sql
CREATE TABLE tick_senses (
  snapshot_ts   INTEGER,
  sense_key     TEXT,
  hash          TEXT,     -- content-addressed object
  sampled_at    INTEGER,
  requested_at  INTEGER,
  PRIMARY KEY (snapshot_ts, sense_key)
);
```

```
objects/{hash}.json  ← 不可变内容，永不覆盖（CAS）
```

一张表 + 一个对象目录，记录 Agent 存在过程中所有业力的轨迹。任意时刻的完整状态可以从中重建。

## 相关

- [Pulse GitHub](https://github.com/oc-xiaoju/pulse)
- [RFC #1: Pulse — Agent 的自主神经系统](https://github.com/oc-xiaoju/pulse/issues/1)
- [RFC #4: Pulse = Agent 最小运行时（完整版）](https://github.com/oc-xiaoju/pulse/issues/4)
