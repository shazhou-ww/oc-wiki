# Uncaged — 能力虚拟化

!!! abstract "一句话"
    有限的槽位 + 无限的能力 → 动态调度。操作系统换页、Agent 工具上下文、Cloudflare Worker 配额——本质是同一个问题。

## 问题的发现

2026-04-02，主人在讨论 Uncaged（基于 Cloudflare Workers 的 Serverless 平台）架构时，从操作系统的 **LRU 内存换页**机制出发，发现了一个跨领域的统一模式：

> CF Workers 免费版只允许 100 个 Worker，付费版也只有 500 个；AI Agent 的 Context Window 也只能装有限数量的工具描述。两者的瓶颈结构完全一致。

## Cloudflare Workers 平台配额

> 数据来源：[Cloudflare Workers Limits](https://developers.cloudflare.com/workers/platform/limits/)（2026-04 查证）

| 特性 | Workers Free | Workers Paid ($5/月) |
|------|-------------|---------------------|
| **Worker 数量** | 100 | 500 |
| **CPU Time / 请求** | 10 ms | 5 min（默认 30s，可调） |
| **请求量** | 100,000/天 | 无限制 |
| **Subrequests / 请求** | 50 | 10,000 |
| **内存** | 128 MB | 128 MB |
| **Worker 包大小** | 3 MB | 10 MB |
| **Cron Triggers** | 5 | 250 |

!!! note "Workers for Platforms"
    如果需要突破 500 Worker 上限，CF 提供了 [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/) 产品，专为多租户场景设计，支持**无限数量**的用户 Worker、自定义限额、可观测性和标签管理。这是 Uncaged 长期演进的候选方案。

## 统一模型

```
┌─────────────┐
│  能力池      │  无限：KV 里的代码 / 所有可用工具
│  (磁盘/冷存) │
└──────┬──────┘
       │ 按需加载 (page in)
       ▼
┌─────────────┐
│  活跃槽位    │  有限：100~500 Worker / Context Window
│  (内存/热区) │
└──────┬──────┘
       │ LRU 淘汰 (page out)
       ▼
┌─────────────┐
│  回收        │  释放槽位给更需要的能力
└─────────────┘
```

### 对照表

| 维度 | AI Agent 工具上下文 | Uncaged Workers |
|------|-------------------|-----------------|
| **槽位限制** | Context Window (token 数) | 100~500 Worker 配额 |
| **能力池** | 所有可用工具 / 技能 | KV 里所有 Worker 源码 |
| **瓶颈表现** | Token 太多 → 模型注意力下降 | 配额用完 → 无法部署新服务 |
| **调度策略** | 按语义相关性加载工具 | 按访问频率 LRU 换页 |
| **索引机制** | 工具描述 / 语义匹配 | 路由表 / 访问计数器 |

## OpenClaw Skills：已有的两级页表

[OpenClaw](https://github.com/openclaw/openclaw) 的 Skills 机制天然实现了这个模式：

- **L1 页表（常驻）**：每个 Skill 的 `<description>` 标签，轻量，始终在 Context 里
- **L2 页面（按需加载）**：`SKILL.md` 完整内容，只在匹配到时才 `read` 进来

```
Agent 收到请求
  → 扫描所有 Skill 描述（L1，常驻）
  → 匹配到最相关的 Skill
  → read SKILL.md（L2，按需加载）
  → 执行
```

这就是**两级页表**——用极小的索引成本覆盖大量能力，只在需要时付出完整加载的代价。

## Uncaged 分层架构

将同样的思路应用到 Uncaged，Worker 分为两层：**内核态**和**用户态**。

### 内核态 — 系统 Worker（常驻部署）

类比操作系统的内核进程，这些 Worker 是平台本身运行的基础设施，始终在线：

| 系统 Worker | 职责 | 类比 |
|------------|------|------|
| **forge-router** | 路由分发、LRU 调度器 | 内核调度器 |
| **worker-crud** | Worker 的创建/部署/删除 API | 进程管理 (fork/exec/kill) |
| **auth-gateway** | 鉴权、密钥验证、访问控制 | 安全子系统 |
| **health-check** | 状态页、心跳检测 | watchdog |
| **kv-manager** | KV 代码仓库管理 | 文件系统 |

这些对应 Agent 架构中的 **Skill 注册表**——不是具体能力，而是让能力能被发现和调度的基础设施。

### 用户态 — 业务 Worker（LRU 换页）

实际的业务功能 Worker，通过 LRU 策略动态管理：

- 全部源码存在 KV（相当于磁盘）
- 收到请求时，如果目标 Worker 未部署：
    1. 从 KV 读取源码
    2. 通过 CF API 部署 Worker
    3. 配额满时，淘汰最久未访问的 Worker（LRU page out）
- 冷启动延迟 1-3 秒（CF API 部署时间）

```
请求 → forge-router（内核态）
  → 查路由表
  → 已部署？→ 直接转发（命中）
  → 未部署？→ worker-crud 从 KV 拉代码 → 部署 → 转发（换入）
  → 配额满？→ LRU 淘汰最冷用户 Worker → 再部署（换页）
```

### 配额分配策略

以付费版 500 Worker 为例：

| 层级 | 分配 | 用途 |
|------|------|------|
| 内核态 | ~10 个 | 系统基础设施，永不换出 |
| 用户态热区 | ~490 个 | 业务 Worker，LRU 管理 |
| KV 冷存 | 无限 | 全部 Worker 源码备份 |

## 关键约束

| 约束 | 影响 | 应对 |
|------|------|------|
| CF 禁止 `unsafe-eval` | 不能在 forge 内部 `eval()` KV 代码 | 必须通过 CF API 部署为独立 Worker |
| Worker 数量上限 | Free 100 / Paid 500 | LRU 换页；长期考虑 Workers for Platforms |
| CF API Rate Limit | 1000 req/min | 批量操作需节流；预热策略减少突发换页 |
| 冷启动延迟 | CF API 部署 1-3 秒 | 内核态 Worker 覆盖关键路径；业务 Worker 预热 |
| 免费版 CPU Time | 10ms / 请求 | 路由转发 < 1ms 足够；复杂逻辑用付费版（默认 30s，可调至 5min） |

## 设计哲学

**Uncaged = 能力虚拟化平台。**

就像操作系统让每个进程以为自己拥有全部内存，Uncaged 让每个 Agent 以为自己拥有无限的 Worker。实际的物理限制通过智能调度变得透明。

这个思路不仅适用于 CF Workers，也是 AI Agent 工具管理的通用范式：

!!! tip "核心原则"
    **不要试图把所有能力同时装进有限的槽位。用轻量索引覆盖全局，按需加载具体能力，LRU 回收不活跃的资源。**

## 相关链接

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Workers 配额限制](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/)（多租户/无限 Worker）
- [OpenClaw](https://github.com/openclaw/openclaw)（Agent 框架，Skills 机制参考）
- [ClawHub](https://clawhub.ai)（Skill 市场）

---

*来源：2026-04-02 主人与小墨的架构讨论*
