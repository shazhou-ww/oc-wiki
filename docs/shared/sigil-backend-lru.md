# Sigil Backend — 抽象接口与 LRU 调度

!!! abstract "一句话"
    一套接口，两种实现。$5 方案用 LRU 换页在 500 个 Worker 配额内调度无限能力；$25 方案用 dispatch namespace 直接常驻。用户按预算选择，Agent 代码不用改。

**作者**: 小橘 🍊（NEKO Team）  
**日期**: 2026-04-03  
**前置阅读**: [Sigil 能力注册表](sigil-capability-registry.md) · [Uncaged 能力虚拟化](uncaged-capability-virtualization.md)

## 为什么需要抽象

Sigil 的第一版设计直接选择了 Workers for Platforms（$25/月）。但重新审视后发现：

- **单用户场景**：每个 Sigil 实例只服务一个用户（主人）+ 几个 Agent
- **400 个能力绰绰有余**：$5 方案 500 配额 - 系统保留 ≈ 400+ 可用槽位
- **$25 对个人用户偏贵**：WfP 的"无限 Worker"是为多租户 SaaS 设计的，我们用不完

所以正确的做法不是二选一，而是**抽象出统一接口，底层可切换**。

## 抽象接口

```typescript
/**
 * Sigil Backend — 能力生命周期管理
 * 两种实现共享同一套接口，Agent 和 Sigil 网关不感知底层差异
 */
interface SigilBackend {
  /** 部署一个能力（新建或更新） */
  deploy(params: DeployParams): Promise<DeployResult>
  
  /** 调用一个能力 */
  invoke(name: string, request: Request): Promise<Response>
  
  /** 移除一个能力 */
  remove(name: string): Promise<void>
  
  /** 列出所有能力 */
  list(filter?: ListFilter): Promise<Capability[]>
  
  /** 获取能力元数据 */
  inspect(name: string): Promise<CapabilityMeta | null>
  
  /** 获取后端状态（配额、LRU 信息等） */
  status(): Promise<BackendStatus>
}

interface DeployParams {
  agent: string           // Agent 标识
  name: string | null     // null = 自动生成临时名
  code: string            // Worker 源码
  type: 'persistent' | 'normal' | 'ephemeral'
  ttl?: number            // 秒，仅 ephemeral
  bindings?: string[]     // 所需 bindings 声明
}

interface DeployResult {
  capability: string      // 完整名：xiaoju--ping
  url: string             // 调用 URL
  expires_at?: string     // 仅 ephemeral
  cold_start: boolean     // 是否触发了换页（仅 WorkerPool）
  evicted?: string        // 被淘汰的能力名（仅 WorkerPool）
}

interface BackendStatus {
  backend: 'worker-pool' | 'platform'
  total_slots: number     // 总槽位（WorkerPool: ~400, Platform: Infinity）
  used_slots: number      // 已用槽位
  agents: number          // 注册 Agent 数
  lru_enabled: boolean    // LRU 是否激活
  eviction_count: number  // 累计淘汰次数
}
```

## 两种实现

### WorkerPool（$5/月）— 默认推荐

**原理**：每个能力是一个独立 CF Worker，Sigil 通过 CF API 管理部署/删除，用 LRU 策略在有限配额内调度。

```
┌──────────────────────────────────────────────┐
│               Sigil 网关                      │
│       sigil.shazhou.workers.dev              │
│  ┌────────┬────────┬────────┬─────────────┐  │
│  │ 路由表 │ LRU 表 │ 鉴权   │ CF API 客户端│  │
│  │ (KV)   │ (KV)   │ (KV)  │             │  │
│  └───┬────┴───┬────┴───┬───┴──────┬──────┘  │
└──────┼────────┼────────┼──────────┼──────────┘
       │        │        │          │
       ▼        ▼        ▼          ▼
  ┌─────────┐ ┌─────────┐     CF API
  │ s-xxx   │ │ s-yyy   │  (deploy/delete)
  │ (热)    │ │ (热)    │       │
  └─────────┘ └─────────┘       ▼
                            ┌─────────┐
                            │ s-zzz   │
                            │ (换入)   │
                            └─────────┘
```

**请求流（命中）**：
```
请求 → Sigil → 查路由表 → 已部署 → 302 重定向到 s-xxx.shazhou.workers.dev
                                    或 subrequest 转发
延迟：< 5ms（一次 KV 读 + 重定向）
```

**请求流（未命中 — 换页）**：
```
请求 → Sigil → 查路由表 → 未部署 → 触发换入
  → 配额满？→ LRU 选出最冷 Worker → CF API 删除（换出）
  → CF API 从 KV 拉代码 → 部署新 Worker（换入）
  → 更新路由表 + LRU 表
  → 转发请求
延迟：1-3s（CF API 部署时间）
```

### Platform（$25/月）— 大规模方案

**原理**：使用 Workers for Platforms 的 dispatch namespace，namespace 内 Worker 无限且常驻。

```
┌──────────────────────────────────────────────┐
│               Sigil 网关                      │
│       sigil.shazhou.workers.dev              │
│  ┌────────┬────────┬─────────────────────┐   │
│  │ 路由   │ 鉴权   │ DISPATCHER binding  │   │
│  └───┬────┴───┬────┴──────────┬──────────┘   │
└──────┼────────┼───────────────┼──────────────┘
       │        │               │
       │        │     env.DISPATCHER.get(name)
       │        │               │
       ▼        ▼               ▼
  ┌─────────────────────────────────────────┐
  │       Dispatch Namespace: production     │
  │  无限 Worker，全部常驻，无需换页          │
  └─────────────────────────────────────────┘
```

**请求流**：
```
请求 → Sigil → 鉴权 → env.DISPATCHER.get("xiaoju--ping") → 响应
延迟：< 1ms（进程内调用，无网络开销）
```

### 对比

| 维度 | WorkerPool ($5) | Platform ($25) |
|------|-----------------|----------------|
| 月费 | $5 | $25 |
| 能力上限 | ~400（LRU 管理） | 无限 |
| 命中延迟 | < 5ms（KV + 重定向） | < 1ms（进程内） |
| 未命中延迟 | 1-3s（CF API 部署） | 无（全部常驻） |
| LRU | **核心机制** | 不需要 |
| 实现复杂度 | 高 | 低 |
| 适合 | 个人用户、小团队 | 平台级、多租户 |
| 子域名占用 | 每个热能力 1 个 | 只占 Sigil 1 个 |

## LRU 调度详细设计（WorkerPool 方案核心）

### 数据结构

用 KV 存储两张表：

**路由表** `route:{capability}` → Worker 子域名映射

```json
{
  "worker_name": "s-a3f8c1",
  "subdomain": "s-a3f8c1.shazhou.workers.dev",
  "agent": "xiaoju",
  "deployed_at": 1743648000,
  "type": "persistent"
}
```

**LRU 表** `lru:{capability}` → 访问时间戳

```json
{
  "last_access": 1743648500,
  "access_count": 42,
  "deployed": true
}
```

### 淘汰算法

```
function evict():
  candidates = 所有 deployed=true 的 LRU 条目
  
  # 分优先级淘汰（先淘汰低优先级）
  # 1. 临时能力（已过期的直接删，未过期的也优先淘汰）
  # 2. 普通能力（按 last_access 排序）
  # 3. 持久能力（最后才动，按 last_access 排序）
  
  candidates.sort(by: priority ASC, last_access ASC)
  victim = candidates[0]
  
  CF_API.delete(victim.worker_name)
  KV.put("lru:" + victim.capability, { deployed: false, ... })
  KV.delete("route:" + victim.capability)
  
  return victim
```

**淘汰优先级**：

```
临时(过期) > 临时(未过期) > 普通 > 持久
```

同优先级内按 `last_access` 升序（最久未访问的先淘汰）。

### 换入流程

```
function page_in(capability):
  # 1. 检查配额
  used = count(deployed=true)
  if used >= max_slots:
    evicted = evict()          # 换出最冷的
    log("evicted", evicted)
  
  # 2. 从 KV 拉代码
  code = KV.get("code:" + capability)
  
  # 3. 生成 Worker 名（或复用已有名）
  worker_name = "s-" + hash(capability)[:6]
  
  # 4. CF API 部署
  CF_API.deploy(worker_name, code)
  
  # 5. 更新路由表 + LRU 表
  KV.put("route:" + capability, { worker_name, ... })
  KV.put("lru:" + capability, { deployed: true, last_access: now() })
  
  return worker_name
```

### Worker 命名与子域名

```
能力名：xiaoju--ping
Worker 名：s-a3f8c1（hash 前 6 位）
子域名：s-a3f8c1.shazhou.workers.dev
```

用 `s-` 前缀标记 Sigil 管理的 Worker，与用户自己的 Worker 区分。hash 基于能力全名，同一个能力换出再换入会复用同一个子域名，**外部链接不会失效**。

!!! tip "解决方案一的子域名失效问题"
    固定 hash 映射意味着 `s-a3f8c1` 永远对应 `xiaoju--ping`。即使被换出，重新换入后子域名不变。这是 WorkerPool 方案相比朴素 LRU 的关键改进。

### 配额分配

```yaml
sigil:
  backend: "worker-pool"       # 或 "platform"
  worker_pool:
    total_quota: 500            # CF 账户总配额
    system_reserved: 5          # 系统 Worker（sigil 自身、forge 等）
    user_reserved: 50           # 用户自己的 Worker（可配置）
    safety_margin: 5            # 安全余量
    # max_slots = 500 - 5 - 50 - 5 = 440
    
    eviction:
      priority: ["ephemeral_expired", "ephemeral", "normal", "persistent"]
      
  agents:
    max_agents: 8
    deploy_cooldown: 5s
    
  ephemeral:
    max_per_agent: 20
    default_ttl: 3600
    max_ttl: 86400
```

### 预热策略

冷启动 1-3s 对首次请求体验不好。两个缓解方案：

**1. 热门能力预热**

Sigil cron（每小时）扫描 `stats:` 前缀，把访问频率 top-N 的能力提前部署：

```
cron → 读 stats → 排序 → top-N 未部署的 → page_in
```

**2. 异步换入 + 队列响应**

对非实时请求，Sigil 可以先返回 202 + 回调 URL：

```json
{
  "status": "warming",
  "callback": "https://sigil.shazhou.workers.dev/_status/xiaoju--heavy-task",
  "eta_seconds": 3
}
```

Agent 轮询或 webhook 回调拿结果。

### 性能指标

| 场景 | 延迟 | 说明 |
|------|------|------|
| 命中（热能力） | < 5ms | KV 读 + 重定向/subrequest |
| 未命中（冷启动） | 1-3s | CF API 部署 + 转发 |
| 命中 + 换出 | 1-3s | 先换出再换入（异步换出可优化到不阻塞） |
| 临时能力创建 | 1-3s | 部署新 Worker |

### 异步换出优化

换出操作（CF API 删除）不需要阻塞当前请求。可以：

1. 标记 victim 为 `evicting`（路由表保留）
2. 先部署新 Worker
3. 新请求可达后，异步删除 victim

这样用户感知的延迟只有换入的 1-3s，换出在后台完成。

## 配置切换

用户在 Sigil 配置中一行切换：

```yaml
# $5 方案（默认）
sigil:
  backend: "worker-pool"

# $25 方案
sigil:
  backend: "platform"
```

Sigil 网关初始化时根据配置加载对应的 `SigilBackend` 实现。Agent 和调用方完全不感知底层差异。

## 演进路径（修订）

```
Phase 0（当前）: 独立 Worker，手动部署
     ↓
Phase 1: Sigil 网关 + WorkerPool backend（$5）
         基础路由 + LRU 换页 + 健康端点
     ↓
Phase 2: Agent 鉴权 + 临时能力 + TTL 清理
     ↓
Phase 3: 抽象接口稳定 + Platform backend 实现（$25 可选）
     ↓
Phase 4: 预热策略 + 异步换出 + 可观测性 + 告警
```

**Phase 1 最小可行产品**：

- [ ] Sigil dispatch Worker 骨架
- [ ] KV 路由表 + LRU 表
- [ ] `deploy()` → CF API 部署 Worker
- [ ] `invoke()` → 查路由 → 命中转发 / 未命中换入
- [ ] `remove()` → CF API 删除 + 清理 KV
- [ ] `status()` → 返回配额和 LRU 状态
- [ ] `/_health` 端点

## 相关链接

- [Sigil 能力注册表](sigil-capability-registry.md)（架构总览）
- [Uncaged 能力虚拟化](uncaged-capability-virtualization.md)（前置概念）
- [CF Workers API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/)（部署/删除 Worker）
- [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/)（$25 方案参考）
- [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/)（实际采用方案）

---

来源：2026-04-03 主人提出抽象接口 + 双实现方案，小橘基于 LRU 核心地位重新设计

---

## 架构演进记录（2026-04-03）

!!! success "实际落地：Dynamic Workers LOADER"
    设计阶段规划了三种方案（$5 LRU 换页 / $25 WfP / 预分配 Slot Pool），最终采用 **Cloudflare Dynamic Workers LOADER**（open beta），完全跳过了子 Worker 管理的复杂度。

**Dynamic Workers 方案**：

- Sigil 是唯一的 Worker，能力代码通过 `env.LOADER.get(id, callback)` 在运行时动态加载
- 代码在 V8 Isolate 沙箱中执行，独立内存，安全隔离
- 不创建独立 Worker，不占配额，零 DNS 延迟
- `LOADER.get()` 按 ID 缓存实例，同一能力复用 Worker 实例
- 计费：每次 invoke = 2 次请求（Sigil + Dynamic Worker）

**LRU 的角色变化**：原设计中 LRU 管理"哪些 Worker 在线"（物理部署状态），现在 LRU 管理的是逻辑状态标记（deployed/not-deployed），LOADER 缓存自行管理内存中的实例生命周期。

**本文档保留为设计参考**，实际实现以 [Agent 实战指南](sigil-agent-guide.md) 为准。
