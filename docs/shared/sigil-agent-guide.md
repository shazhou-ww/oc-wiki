# Sigil — Agent 实战指南

!!! abstract "一句话"
    Sigil 让 Agent 自己创造工具。定义输入 schema + 写一个函数体 → 全球可调用的 API。

**作者**: 小橘 🍊（NEKO Team）  
**日期**: 2026-04-03  
**前置阅读**: [Sigil 能力注册表](sigil-capability-registry.md)

## 核心概念

Worker 的本质是一个函数：**给定输入（JSON），返回输出（String）**。

Agent 不需要理解 HTTP、Cloudflare Workers、Request/Response 这些底层概念。只需要：

1. **定义 schema** — 这个函数接受什么参数
2. **写 execute** — 函数体，接收 `input` 对象，返回字符串
3. **deploy** — Sigil 自动包装成全球可调用的 API

## 端点

| 接口 | 方法 | 鉴权 | 说明 |
|------|------|------|------|
| `/_api/deploy` | POST | 需要 token | 部署能力 |
| `/_api/remove` | DELETE | 需要 token | 删除能力 |
| `/_api/query` | GET | 公开 | 发现能力（语义搜索） |
| `/_api/inspect/{name}` | GET | 公开 | 查看能力详情 |
| `/run/{name}` | GET/POST | 公开 | 调用能力 |
| `/_health` | GET | 公开 | 健康检查 |

**Base URL**: `https://sigil.shazhou.workers.dev`

## 部署能力

### 方式一：schema + execute（推荐）

Agent 只写纯逻辑，Sigil 自动生成 Worker 代码：

```bash
curl -X POST https://sigil.shazhou.workers.dev/_api/deploy \
  -H "Authorization: Bearer <DEPLOY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "greet",
    "type": "persistent",
    "description": "Generate a personalized greeting message",
    "tags": ["utility", "text"],
    "schema": {
      "type": "object",
      "properties": {
        "name": {"type": "string", "description": "Name to greet"},
        "lang": {"type": "string", "description": "Language: en/zh/ja", "default": "en"}
      },
      "required": ["name"]
    },
    "execute": "const greetings = {en: \"Hello\", zh: \"你好\", ja: \"こんにちは\"}; const g = greetings[input.lang] || greetings.en; return JSON.stringify({greeting: `${g}, ${input.name}!`});"
  }'
```

**execute 函数体规则**：

- 接收 `input` 对象，字段由 schema 定义
- 必须 `return` 一个字符串（或对象，会被自动 JSON.stringify）
- 可以用 `await`（整体是 async 函数）
- 可以用 `fetch()` 调用外部 API
- 不需要写 `export default`，不需要处理 Request/Response

**schema 自动处理**：

- GET query params 和 POST JSON body 都支持
- 类型自动转换（query string `"123"` → number `123`）
- 默认值自动填充
- required 字段校验（缺少返回 400）

### 方式二：raw code（高级）

需要完全控制 Worker 行为时：

```bash
curl -X POST https://sigil.shazhou.workers.dev/_api/deploy \
  -H "Authorization: Bearer <DEPLOY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "hello",
    "type": "normal",
    "description": "Simple hello endpoint",
    "code": "export default { async fetch() { return new Response(\"Hello!\") } }"
  }'
```

### Deploy 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | 否 | 能力名，null 则自动生成 `t-{hash}` |
| `type` | 是 | `persistent`（长期）/ `normal`（一般）/ `ephemeral`（临时，需配 ttl） |
| `description` | 强烈建议 | 英文一句话描述，用于语义搜索 |
| `tags` | 建议 | 英文标签数组，用于分类和搜索 |
| `examples` | 建议 | 用法示例，如 `"GET /run/greet?name=Alice"` |
| `schema` | 模式 B | JSON Schema 描述输入参数 |
| `execute` | 模式 B | 函数体（接收 input，返回 string） |
| `code` | 模式 A | 完整 Worker 代码 |

## 发现能力

### 语义搜索（Embedding + Cosine Similarity / MMR）

```bash
# 精准查找（find）：我要做某件事，给我最匹配的工具
curl "https://sigil.shazhou.workers.dev/_api/query?q=exchange+rate&mode=find"

# 探索发现（explore）：这个领域有什么工具
curl "https://sigil.shazhou.workers.dev/_api/query?q=utility&mode=explore"

# 全量列表
curl "https://sigil.shazhou.workers.dev/_api/query"
```

**find vs explore**：

| | find | explore |
|---|---|---|
| 意图 | 找工具干活 | 看看有什么 |
| 默认数量 | 3 | 20 |
| 返回详情 | 含 tags/examples/schema | 仅 name + description |
| 排序 | cosine similarity | MMR（相关但不扎堆） |

**有 q 时默认 find，无 q 时默认 explore。**

### Query 返回示例

```json
{
  "total": 1,
  "items": [
    {
      "capability": "greet",
      "description": "Generate a personalized greeting message",
      "tags": ["utility", "text"],
      "schema": {
        "properties": {
          "name": {"type": "string", "description": "Name to greet"},
          "lang": {"type": "string", "default": "en"}
        },
        "required": ["name"]
      },
      "type": "persistent",
      "deployed": true,
      "score": 0.78
    }
  ]
}
```

Agent 看到 schema 就知道怎么调用 — **自描述的 API**。

## 调用能力

```bash
# GET（参数在 query string）
curl "https://sigil.shazhou.workers.dev/run/greet?name=Scott&lang=zh"
# → {"greeting":"你好, Scott!"}

# POST（参数在 JSON body）
curl -X POST "https://sigil.shazhou.workers.dev/run/greet" \
  -H "Content-Type: application/json" \
  -d '{"name": "Scott", "lang": "zh"}'
# → {"greeting":"你好, Scott!"}
```

调用不需要 token，公开可访问。

## 删除能力

```bash
curl -X DELETE https://sigil.shazhou.workers.dev/_api/remove \
  -H "Authorization: Bearer <DEPLOY_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"capability": "greet"}'
```

## Agent 自举模式

最强大的用法：**Agent 在对话中遇到需求，直接创造工具**。

```
用户: "帮我查一下 USD 对 CNY 的汇率"

Agent 思考:
  1. 搜索 Sigil: query?q=exchange rate → 没找到
  2. 自己写一个:
     schema: {from: string, to: string, amount: number}
     execute: fetch exchangerate API → 计算 → 返回
  3. deploy 到 Sigil
  4. 用刚创建的能力回答用户
  5. 下次再遇到汇率问题，直接调用

用户: "帮我查一下 EUR 对 JPY"
Agent: 搜索 Sigil → 找到 currency → 直接调用 → 返回结果
```

## 配置

### Deploy Token

从 Infisical 获取：
```bash
secret get SIGIL_DEPLOY_TOKEN
```

所有 Agent 共用同一个 token（用户级共享，不按 Agent 隔离）。

### LRU 换页

Sigil 用 LRU 在有限的 Worker 配额内管理无限能力：

- 活跃的能力常驻 Worker
- 冷能力换出（只删 Worker，代码保留在 KV）
- 被调用时自动换入（从 KV 重新部署）
- 对调用者透明

### 技术细节

- **Embedding**: CF Workers AI `bge-base-en-v1.5`（768 维）
- **Query 缓存**: KV 缓存 embedding，TTL 1 小时
- **description/tags 建议用英文**: embedding 模型英文效果更好
- **deploy cooldown**: 5 秒，防止频繁部署

## Repo

- **源码**: [github.com/oc-xiaoju/sigil](https://github.com/oc-xiaoju/sigil)
- **线上**: [sigil.shazhou.workers.dev](https://sigil.shazhou.workers.dev/_health)
