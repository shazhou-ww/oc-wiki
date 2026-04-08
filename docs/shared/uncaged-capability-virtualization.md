# Uncaged 的设计哲学 — 能力虚拟化

!!! abstract "一句话"
    有限的槽位 + 无限的能力 → 动态调度。OS 换页、Agent 工具上下文、CF Worker 配额——本质是同一个问题。Uncaged = 能力虚拟化平台。

**作者**: 小橘 🍊（NEKO Team）  
**日期**: 2026-04-08（重写）  
**初版**: 2026-04-02  
**相关**: [Sigil 能力注册表](sigil-capability-registry.md) · [Sigil Backend 与 LRU 调度](sigil-backend-lru.md) · [元软件愿景](meta-software-vision.md)

---

## 从 OS 换页说起

操作系统面对一个经典约束：**物理内存有限，进程需要的虚拟地址空间远大于物理内存。**

解法是虚拟内存 + 按需换页——磁盘做后备，LRU 淘汰不活跃页面，需要时再换入。每个进程以为自己拥有全部内存，物理限制通过调度变得透明。

这个模式不止出现在操作系统里。

## 同构问题，三个领域

主人在讨论 Uncaged 架构时，从 OS 的 **LRU 内存换页**出发，发现了一个跨领域的统一结构：

!!! info "核心洞察"
    OS 内存换页、AI Agent 工具管理、Cloudflare Worker 配额——**是同一个问题的三个实例**。结构相同：有限槽位 + 无限能力池 → 需要动态调度。

### 对照表

| 维度 | OS 内存管理 | AI Agent 工具上下文 | Uncaged Workers |
|------|-----------|-------------------|-----------------|
| **槽位** | 物理内存页框 | Context Window（token 数） | CF Worker 配额（500） |
| **能力池** | 磁盘上全部页面 | 所有可用工具/技能 | KV 里所有能力源码 |
| **瓶颈** | 内存不够 → 颠簸 | Token 太多 → 注意力稀释 | 配额用完 → 无法部署新服务 |
| **调度算法** | LRU / Clock | 按语义相关性匹配 | LRU 按访问频率换页 |
| **索引** | 页表 | 工具描述 / 语义匹配 | 路由表 / 访问计数器 |
| **换入** | 磁盘 → 内存 | 读 SKILL.md → 注入 context | KV 拉代码 → 实例化 Worker |
| **换出** | 脏页写回磁盘 | context 滚动丢弃 | 销毁实例，代码留 KV |
| **解法** | 虚拟内存 + 按需换页 | 按需加载 | LRU 换页 |

三个领域的解法同构：**轻量索引常驻 + 完整内容按需加载 + 不活跃资源回收**。

---

## Agent 工具上下文：按需加载

AI Agent 的 Context Window 是一种稀缺资源。把所有工具的完整描述塞进去，token 膨胀，模型注意力被稀释，推理质量下降——这和物理内存塞满后的"颠簸"（thrashing）如出一辙。

解法不是无限扩大 context（加内存总有上限），而是**按需加载**：

- 只保留轻量索引（工具名 + 一句话描述）
- 收到请求时，根据语义匹配加载相关工具的完整 schema
- 随着对话推进，旧内容被新内容挤出 context（滚动丢弃，等同换出）

### OpenClaw Skills：天然的两级页表

[OpenClaw](https://github.com/openclaw/openclaw) 的 Skills 机制是这个模式的直接实现：

```
Agent 收到请求
  → 扫描所有 Skill 描述（L1 页表，常驻 context）
  → 匹配到最相关的 Skill
  → read SKILL.md（L2 页面，按需加载）
  → 执行
  → SKILL.md 内容随对话推进被滚动丢弃（等同换出）
```

| 层级 | 页表类比 | 内容 | 成本 |
|------|---------|------|------|
| **一级索引** | 始终常驻 | 每个 Skill 的 `<description>` 标签 | 几十 token/条 |
| **二级页面** | 按需加载 | `SKILL.md` 完整文件 | 数百~数千 token |

> 注：此处的一级/二级是 Agent 上下文的页表层级，与下文 Uncaged 三级缓存（L0/L1/L2）的编号无关。

用极小的索引成本覆盖大量能力，只在需要时付出完整加载的代价。这就是两级页表。

---

## Uncaged Workers：三级缓存架构

将同样的思路应用到 Uncaged 平台。CF Worker 配额是物理限制（付费版 500），而用户可创建的能力数量没有上限。

### L1 — 热 Worker（独立部署，常驻）

核心高频服务，独立部署为 Worker，**永不换出**。类似 OS 内核进程常驻内存，pin 在物理页框中不参与 LRU。

| Worker | 职责 | 类比 |
|--------|------|------|
| **Uncaged 主 Worker** | 路由分发、鉴权、LRU 调度、能力执行 | OS 内核 |
| **oc-status** | 心跳状态页 | watchdog |

> Sigil（能力注册表）已合并进 Uncaged 主 Worker，不再独立部署。

占用极少配额（< 10 个），但保证核心功能始终可用。

### L2 — 冷代码（KV 存储，按需加载）

全部用户能力的源码存储在 KV 中。**不占 Worker 配额**，只占存储空间（KV 容量几乎无限）。

请求到达时的调度流程：

```
请求 → Uncaged 主 Worker
  → 查路由表（内存中，O(1)）
  → 已加载？→ 直接执行（L1 命中）
  → 未加载？→ KV 拉代码 → 实例化执行（L2 加载）
  → 配额/内存压力？→ LRU 淘汰最冷能力（换页）
```

### 路由表 — 常驻主 Worker 内

轻量映射表，记录每个能力的元数据：

- 名称 / 标签 / schema
- 最近访问时间（LRU 排序依据）
- KV 中的代码 key
- 当前加载状态

路由表本身很小（每条几百字节），全部能力的索引常驻内存，不需要换页。这是 **L0 页表**——比 L1 热 Worker 更轻，比 L2 冷代码更快。

### 架构图

```
┌──────────────────────────────────────────────┐
│          L0 — 路由表（常驻主 Worker 内存）       │
│  name → { kv_key, schema, lru_ts, loaded }   │
├──────────────────────────────────────────────┤
│          L1 — 热 Worker（独立部署，常驻）        │
│  Uncaged 主 Worker · oc-status · ...          │
├──────────────────────────────────────────────┤
│          L2 — 冷代码（KV Store）               │
│  全部能力源码，容量无限，按需拉取到 L1 执行       │
└──────────────────────────────────────────────┘
```

!!! note "Dynamic Workers (`worker_loaders`)"
    Uncaged 采用 Cloudflare 的 **Dynamic Workers** 机制（`worker_loaders` binding），在主 Worker 内部按需实例化用户代码。不需要为每个能力部署独立 Worker 消耗配额，同时保持沙箱隔离。

!!! warning "前置条件"
    Dynamic Workers（`worker_loaders`）目前处于 beta 阶段，需要 **Workers for Platforms** 或 Enterprise 计划。如果使用 $5 付费版，回退方案是通过 CF API 动态部署/删除独立 Worker 做 LRU 换页，详见 [Sigil Backend 与 LRU 调度](sigil-backend-lru.md)。

---

## 关键约束

| 约束 | 影响 | 应对 |
|------|------|------|
| **CF 禁止 `unsafe-eval`** | 不能 `eval()` 执行 KV 代码 | Dynamic Workers (`worker_loaders`) 提供安全加载机制 |
| **换页冷启动** | 从 KV 加载有 **1-3 秒**延迟 | 高频能力预热；路由转发本身 < 1ms |
| **CF API Rate Limit** | **1000 req/min** | 批量操作节流；尽量通过 Dynamic Workers 内部调度减少 API 调用 |
| **Worker 配额** | Free 100 / Paid **500** | 独立部署 Worker 控制个位数；用户能力走 Dynamic Workers 不额外消耗配额 |

> **参考**: [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)

---

## 设计哲学

**Uncaged = 能力虚拟化平台。**

就像操作系统让每个进程以为自己拥有全部内存，Uncaged 让每个 Agent 以为自己拥有无限的能力。物理限制（Worker 配额、Context Window、内存页框）通过智能调度变得透明。

三个设计原则：

!!! tip "能力虚拟化三原则"
    1. **轻量索引，全局覆盖** — 用最小常驻成本让调度器知道所有能力的存在
    2. **按需加载，用时付费** — 只有被调用的能力才占用稀缺资源
    3. **LRU 回收，动态平衡** — 不活跃能力自动释放，为新需求腾出空间

这不仅是 Uncaged 的架构选择，也是所有"有限槽位 + 无限能力"系统的通用范式——从操作系统到 AI Agent，从 Worker 配额到 CDN 缓存，同构问题，同构解法。

---

## 延伸阅读

- [Sigil 能力注册表](sigil-capability-registry.md) — Uncaged 的能力管理核心
- [Sigil Backend 与 LRU 调度](sigil-backend-lru.md) — 抽象接口与两种后端实现
- [元软件愿景](meta-software-vision.md) — 能力虚拟化之上的产品愿景
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/)
- [OpenClaw](https://github.com/openclaw/openclaw)（Skills 机制参考）

---

*来源：主人与小墨的架构讨论（2026-04-02）*  
*重写：小橘 🍊（2026-04-08）*
