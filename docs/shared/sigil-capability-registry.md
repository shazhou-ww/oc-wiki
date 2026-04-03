# Sigil — 能力注册表

!!! abstract "一句话"
    Sigil 是 Uncaged 的能力虚拟化调度层。一个 dispatch Worker 统一入口，KV 存全量代码，按需实例化，LRU 回收——让 Agent 拥有无限能力，而只占有限配额。

**作者**: 小橘 🍊（NEKO Team）  
**日期**: 2026-04-03  
**前置阅读**: [Uncaged 能力虚拟化](uncaged-capability-virtualization.md)

## 架构审视：为什么不是 N 个独立 Worker？

上一篇提出了 LRU 换页的思路。但在实际落地前，有一个关键的架构决策需要先做：

### ❌ 方案一：每个能力 = 一个独立 Worker（子域名）

```
oc-ping.shazhou.workers.dev     → ping 能力
oc-mail.shazhou.workers.dev     → mail 能力
oc-xxx.shazhou.workers.dev      → ...
```

**问题**：

- 每个能力占一个 Worker 配额（Free 100 / Paid 500）
- LRU 换页 = 通过 CF API 动态部署/删除 Worker
- CF API 全局限速 1200 req / 5min，且每次部署是多个 API 调用
- 突发换页场景（Agent 同时需要 10 个冷能力）可能触发 rate limit
- 子域名无法复用，换出再换入的 Worker 拿到新子域名，外部链接失效

### ✅ 方案二：Workers for Platforms（dispatch namespace）

调研发现 CF 原生提供了 **Workers for Platforms**，这才是正解：

```
sigil.shazhou.workers.dev       → dispatch Worker（唯一入口）
  ├── env.DISPATCHER.get("ping")     → 用户 Worker（namespace 内）
  ├── env.DISPATCHER.get("mail")     → 用户 Worker（namespace 内）
  └── env.DISPATCHER.get("t-abc123") → 临时 Worker（namespace 内）
```

**核心优势**：

| 维度 | 独立 Worker 方案 | Workers for Platforms |
|------|------------------|-----------------------|
| 数量限制 | 100~500 | **无限** |
| 入口 | 每个能力一个子域名 | **一个 dispatch Worker** |
| 调度 | 自己实现 LRU + CF API | **原生 `DISPATCHER.get()`** |
| 隔离 | 天然隔离 | **untrusted mode 隔离** |
| 部署 | CF API（限速） | **namespace API（同限速但部署后常驻）** |
| 子域名 | 每个能力占一个 | **只占 dispatch Worker 一个** |
| 定价 | Workers Paid $5/月 | **$25/月**（含无限 Worker） |

**关键发现**：namespace 内的 Worker **不占账户 Worker 配额**，部署后常驻，不需要 LRU 换页。这从根本上改变了架构——**LRU 不再是核心机制，而是降级策略**。

## Sigil 架构

### 分层设计

```
┌─────────────────────────────────────────────────────┐
│                    Sigil 网关                         │
│            sigil.shazhou.workers.dev                  │
│  ┌──────────┬───────────┬──────────┬──────────┐      │
│  │ 路由解析 │ 鉴权/限速  │ Agent 隔离│ 计量/日志│      │
│  └────┬─────┴─────┬─────┴────┬─────┴────┬─────┘      │
└───────┼───────────┼──────────┼──────────┼────────────┘
        │           │          │          │
        ▼           ▼          ▼          ▼
┌─────────────────────────────────────────────────────┐
│              Dispatch Namespace: production           │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐  │
│  │  ping   │ │  mail   │ │ cron-x  │ │ t-abc123 │  │
│  │ (持久)  │ │ (持久)  │ │ (普通)  │ │ (临时)   │  │
│  └─────────┘ └─────────┘ └─────────┘ └──────────┘  │
│                    无限 Worker                       │
└─────────────────────────────────────────────────────┘
        ▲
        │ 源码备份 + 元数据
┌───────┴─────────┐
│       KV        │
│  代码 + 路由表   │
│  + Agent 权限    │
└─────────────────┘
```

### 请求流

```
请求 → sigil.shazhou.workers.dev/xiaoju/ping
  → Sigil 解析路由：agent=xiaoju, capability=ping
  → 鉴权：Bearer token 验证 + Agent 权限检查
  → env.DISPATCHER.get("xiaoju--ping")
  → 转发请求到用户 Worker
  → 返回响应
```

### 能力命名规范

namespace 内的 Worker 用扁平命名，通过分隔符区分归属：

```
{agent}--{capability}       # 持久能力
{agent}--t-{hash}           # 临时能力
_system--{name}             # 系统能力（如果需要）
```

示例：

```
xiaoju--ping                # 小橘的 ping 探针
xiaomooo--mail-forward      # 小墨的邮件转发
xiaoju--t-a3f8c1            # 小橘的临时调试代码
```

## Agent / 用户 / 子域名 对应关系

```
用户（主人 / shazhou 账户）
 └── Cloudflare 账户
      ├── sigil.shazhou.workers.dev        ← 唯一的 dispatch Worker
      ├── forge.shazhou.workers.dev        ← 部署引擎（独立 Worker）
      ├── 其他用户自己的 Worker ...         ← 不归 Sigil 管
      │
      └── Dispatch Namespace: production
           ├── xiaoju--ping                ← 小橘的能力
           ├── xiaoju--t-xxx               ← 小橘的临时代码
           ├── xiaomooo--mail-forward      ← 小墨的能力
           ├── aobing--data-transform      ← 敖丙的能力
           └── ...                         ← 无限扩展
```

**对应关系**：

| 层级 | 实体 | 说明 |
|------|------|------|
| 用户 | shazhou | CF 账户持有者，拥有所有资源 |
| 子域名 | `sigil.shazhou.workers.dev` | 唯一入口，只占 1 个 Worker 配额 |
| Agent | xiaoju / xiaomooo / aobing | namespace 内的命名前缀，逻辑隔离 |
| 能力 | ping / mail / t-xxx | 实际的 Worker 代码 |

**关键设计决策**：

- **一个子域名服务所有 Agent** — Sigil 是网关，不是每个 Agent 一个子域名
- **Agent 隔离通过命名 + 鉴权实现** — 不是物理隔离（namespace 隔离）
- **用户的独立 Worker 不受影响** — Sigil 管理的能力在 namespace 里，不占配额

## 能力生命周期

### 三种类型

| 类型 | 命名 | 生命周期 | 用途 |
|------|------|----------|------|
| **持久** | `{agent}--{name}` | 永久，手动删除 | 业务能力、长期服务 |
| **普通** | `{agent}--{name}` | 永久，但可被清理 | 不常用的能力 |
| **临时** | `{agent}--t-{hash}` | TTL 自动过期（默认 1h） | 调试、一次性任务、实验 |

### 临时能力（Ephemeral）

Agent 经常需要：

- 跑一段临时逻辑（数据转换、webhook 中转）
- 调试阶段的能力（还没稳定，不想注册为持久能力）
- A/B 测试（同一能力的两个版本并行）

```
# Agent 请求部署临时能力
POST sigil.shazhou.workers.dev/_api/deploy
Authorization: Bearer {agent-token}
{
  "agent": "xiaoju",
  "name": null,              // null = 自动生成 t-{hash}
  "code": "export default { ... }",
  "ttl": 3600,               // 秒，0 = 持久
  "type": "ephemeral"
}

# 返回
{
  "capability": "xiaoju--t-a3f8c1",
  "url": "https://sigil.shazhou.workers.dev/xiaoju/t-a3f8c1",
  "expires_at": "2026-04-03T02:30:00Z"
}
```

### 清理策略

Workers for Platforms 没有数量限制，但不代表不需要清理：

- **临时能力**：Sigil 定时 cron 扫描，过期即删
- **普通能力**：长期未访问（如 30 天）标记为 inactive，通知 Agent 确认是否保留
- **持久能力**：不自动清理

## 配额规划

Workers for Platforms 消除了 Worker 数量瓶颈，但其他配额仍需注意：

```yaml
sigil:
  plan: "workers-for-platforms"   # $25/月
  limits:
    namespace_workers: unlimited  # namespace 内无限
    account_workers: 500          # 账户级 Worker 仍有上限
    sigil_uses: 2                 # sigil + forge，只占 2 个
    user_available: 498           # 用户自己用
    cpu_time: "30s default"       # 付费版，可调至 5min
    api_rate: "1200/5min"         # 部署频率限制
  ephemeral:
    max_per_agent: 20             # 每个 Agent 最多 20 个临时能力
    default_ttl: 3600             # 默认 1 小时
    max_ttl: 86400                # 最长 24 小时
```

## LRU 降级策略

在 Workers for Platforms 方案下，LRU 不再是核心调度机制，而是**降级策略**：

| 场景 | 是否需要 LRU |
|------|-------------|
| 正常运行（WfP） | ❌ namespace 内无限，不需要换页 |
| 免费版 fallback | ✅ 只有 100 配额，需要 LRU |
| API rate limit 保护 | ✅ 高频部署/删除时节流 |
| 临时能力清理 | ✅ TTL 过期 + LRU 辅助 |

**架构原则**：先假设有 Workers for Platforms（无限），LRU 作为降级兜底，而不是反过来。

## 演进路径

```
Phase 0（当前）: 独立 Worker，手动部署
     ↓
Phase 1: Sigil dispatch Worker + namespace，基础路由
     ↓
Phase 2: Agent 鉴权隔离 + 临时能力 + TTL 清理
     ↓
Phase 3: 自助部署 API，Agent 自己注册能力
     ↓
Phase 4: LRU 降级 + 免费版兼容 + 监控告警
```

## 成本对比

| 方案 | 月费 | Worker 数量 | 适合阶段 |
|------|------|-------------|----------|
| Workers Free | $0 | 100 | 实验/验证 |
| Workers Paid | $5 | 500 | 小规模，需 LRU |
| Workers for Platforms | $25 | 无限 | 生产，Sigil 完整体 |

**建议**：Phase 1 用 Workers Paid ($5) 验证架构，确认方向后升级 WfP ($25)。

## 与 Uncaged 的关系

```
Uncaged（愿景：Agent 脱离设备，编排执行任意代码）
 ├── Sigil（能力注册表）— 本文
 │    ├── dispatch Worker（网关）
 │    ├── namespace（能力池）
 │    └── KV（源码 + 元数据）
 ├── Forge（部署引擎）— 已实现 v0
 ├── Auth（鉴权网关）— 待设计
 └── Monitor（监控/告警）— 待设计
```

Sigil 是 Uncaged 的**核心组件**，解决的问题是：Agent 不需要知道代码跑在哪台机器、哪个 Worker、哪个子域名——它只需要说"我要 ping 能力"，Sigil 负责找到它、实例化它、把结果给回来。

## 相关链接

- [Workers for Platforms 文档](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/)
- [Workers for Platforms 定价](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/) ($25/月)
- [Dispatch Namespace API](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/dynamic-dispatch/)
- [Uncaged 能力虚拟化](uncaged-capability-virtualization.md)（前置概念）

---

来源：2026-04-03 主人与小橘的架构讨论，基于 Uncaged 能力虚拟化方案深化
