# Uncaged 的设计哲学 — 能力虚拟化

!!! abstract "一句话"
    有限的槽位 + 无限的能力 → 动态调度。操作系统换页、Agent 工具上下文、Cloudflare Worker 配额——本质是同一个问题。Uncaged = 能力虚拟化平台。

**作者**: 小橘 🍊（NEKO Team）  
**日期**: 2026-04-08（重写）  
**初版**: 2026-04-02  
**相关**: [Sigil 能力注册表](sigil-capability-registry.md) · [Sigil Backend 与 LRU 调度](sigil-backend-lru.md) · [元软件愿景](meta-software-vision.md)

---

## 从 OS 换页说起

操作系统面对一个经典问题：物理内存有限，进程需要的虚拟地址空间远超物理内存。解法是**虚拟内存 + 按需换页**——用磁盘做后备，把不活跃的页面换出去，需要时再换回来。每个进程以为自己拥有全部内存，实际的物理限制通过调度变得透明。

这个模式不止出现在操作系统里。

## 同构问题，三个领域

2026-04-02，主人在讨论 Uncaged 架构时，从 OS 的 **LRU 内存换页**出发，发现了一个跨领域的统一结构：

!!! info "核心洞察"
    **OS 内存换页、AI Agent 工具管理、Cloudflare Worker 配额——是同一个问题的三个实例。**  
    结构相同：有限槽位 + 无限能力池 → 需要动态调度。

### 对照表

| 维度 | OS 内存管理 | AI Agent 工具上下文 | Uncaged Workers |
|------|------------|-------------------|-----------------|
| **槽位** | 物理内存页框 | Context Window（token 数） | Worker 配额（Free 100 / Paid 500） |
| **能力池** | 磁盘上的全部页面 | 所有可用工具 / 技能 | KV 里所有 Worker 源码 |
| **瓶颈** | 内存不够 → 颠簸 | Token 太多 → 模型注意力下降 | 配额用完 → 无法部署新服务 |
| **调度** | LRU / Clock 算法 | 按语义相关性加载 | LRU 按访问频率换页 |
| **索引** | 页表 | 工具描述 / 语义匹配 | 路由表 / 访问计数器 |
| **换入** | 磁盘 → 内存 | 读 SKILL.md → 注入 context | KV 拉代码 → 部署 Worker |
| **换出** | 内存 → 磁盘 | 从 context 移除 | 删除 Worker，代码留在 KV |

三个领域的解法也是同构的：**轻量索引常驻 + 完整内容按需加载 + 不活跃资源回收**。

## Agent 工具上下文：按需加载

AI Agent 的 Context Window 是一种稀缺资源。把所有工具的完整描述塞进去，token 膨胀，模型注意力被稀释，推理质量下降。这和物理内存塞满后的"颠簸"（thrashing）如出一辙。

解法不是扩大 context（就像加内存总有上限），而是**按需加载**：

- 只保留轻量索引（工具名 + 一句话描述）
- 收到请求时，根据语义匹配加载相关工具的完整 schema
- 用完后从 context 释放

### OpenClaw Skills：天然的两级页表

[OpenClaw](https://github.com/openclaw/openclaw) 的 Skills 机制就是这个模式的实现：

```
Agent 收到请求
  → 扫描所有 Skill 描述（L1 页表，常驻 context）
  → 匹配到最相关的 Skill
  → read SKILL.md（L2 页面，按需加载）
  → 执行
  → SKILL.md 内容在后续对话中自然衰减
```

- **L1（页表条目）**：每个 Skill 的 `<description>` 标签，几十个 token，始终在 system prompt
- **L2（页面内容）**：`SKILL.md` 完整文件，可能上千 token，只在匹配时加载

用极小的索引成本覆盖大量能力，只在需要时付出完整加载的代价。这就是两级页表。

## Uncaged Workers：三级缓存架构

将同样的思路应用到 Uncaged 的 Cloudflare Workers 平台。Worker 配额是物理限制（付费版 500 个），而用户可能创建的能力数量没有上限。

### L1 — 热 Worker（独立部署，常驻）

核心高频服务，独立部署为 Worker，**永不换出**。类似 OS 内核进程常驻内存。

| Worker | 职责 | 类比 |
|--------|------|------|
| **Uncaged 主 Worker** | 路由分发、鉴权、LRU 调度 | 内核 |
| **oc-status** | 心跳状态页 | watchdog |

这些是平台基础设施，占用极少配额（< 10 个），但保证核心功能始终可用。

### L2 — 冷代码（KV 存储，按需加载）

全部用户能力的源码存储在 KV 中。不占 Worker 配额，只占存储空间（KV 几乎无限）。

当请求到达时：

```
请求 → Uncaged 主 Worker
  → 查路由表（内存中，O(1)）
  → 能力已加载？→ 直接执行（L1 命中）
  → 未加载？→ 从 KV 拉代码 → 实例化执行（L2 加载）
  → 配额/内存压力？→ LRU 淘汰最冷能力（换页）
```

### 路由表 — 常驻 Uncaged 主 Worker 内

轻量映射，记录每个能力的：

- 名称 / 标签 / schema
- 最近访问时间（LRU 排序依据）
- 代码在 KV 中的 key
- 当前是否已加载

路由表本身很小（每条几百字节），全部能力的索引可以常驻内存，不需要换页。这是 L1 页表的等价物。

### 架构图

```
┌──────────────────────────────────────────┐
│              L1 — 热 Worker               │
│  Uncaged 主 Worker（路由 + 调度 + 执行）    │
│  oc-status, ...                           │
│  ┌──────────────────────────────────┐     │
│  │ 路由表（常驻内存）                  │     │
│  │ name → { kv_key, schema, lru_ts }│     │
│  └──────────────────────────────────┘     │
├──────────────────────────────────────────┤
│              L2 — 冷代码                  │
│  KV Store: 全部能力源码                    │
│  容量无限，按需拉取到 L1 执行              │
└──────────────────────────────────────────┘
```

!!! note "Dynamic Workers (worker_loaders)"
    Uncaged 当前采用 Cloudflare 的 **Dynamic Workers** 机制（`worker_loaders` binding），在主 Worker 内部按需加载用户代码。这避免了为每个能力部署独立 Worker 消耗配额的问题，同时保持了沙箱隔离。

## 关键约束

| 约束 | 影响 | 应对 |
|------|------|------|
| **CF 禁止 `unsafe-eval`** | 不能在 Worker 内部 `eval()` 执行 KV 代码 | Dynamic Workers (`worker_loaders`) 提供安全的代码加载机制 |
| **冷启动延迟** | 从 KV 加载代码有 1-3 秒延迟 | 高频能力预热；路由转发本身 < 1ms |
| **CF API Rate Limit** | 1000 req/min | 批量操作节流；尽量通过 Dynamic Workers 内部调度减少 API 调用 |
| **Worker 配额** | Free 100 / Paid 500 | 独立部署的 Worker 控制在个位数；用户能力通过 Dynamic Workers 加载不额外消耗配额 |

> **数据来源**: [Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)（2026-04 查证）

## 设计哲学

**Uncaged = 能力虚拟化平台。**

就像操作系统让每个进程以为自己拥有全部内存，Uncaged 让每个 Agent 以为自己拥有无限的能力。物理限制（Worker 配额、context window、内存页框）通过智能调度变得透明。

这个哲学贯穿三个层面：

1. **轻量索引，全局覆盖** — 用最小的常驻成本，让调度器知道所有能力的存在
2. **按需加载，用时付费** — 只有被调用的能力才占用稀缺资源
3. **LRU 回收，动态平衡** — 不活跃的能力自动释放，为新需求腾出空间

!!! tip "核心原则"
    **不要试图把所有能力同时装进有限的槽位。用轻量索引覆盖全局，按需加载具体能力，LRU 回收不活跃的资源。**

这不仅是 Uncaged 的设计哲学，也是 AI Agent 工具管理的通用范式。任何面对"有限槽位 + 无限能力"的系统，都可以从这个模型中获得启发。

## 相关链接

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Workers 配额限制](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/)
- [OpenClaw](https://github.com/openclaw/openclaw)（Agent 框架，Skills 机制参考）
- [ClawHub](https://clawhub.ai)（Skill 市场）

---

*初版来源：2026-04-02 主人与小墨的架构讨论*  
*重写：2026-04-08 小橘 🍊，根据 Uncaged 架构演进更新*
