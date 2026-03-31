# Alaya 技术设计文档

**版本**: 1.0  
**日期**: 2026-03-31  
**状态**: Draft  
**包名**: `@mitsein-ai/alaya`  
**发布账号**: shazhou-ww @ npm

---

## 1. 概述

### 1.1 项目背景

当前 OpenClaw 的 memory 系统存在根本性缺失：只有"业"（raw session logs），没有"识"（可迭代、可查询、可联想的经验智慧）。

Alaya（阿赖耶识）系统基于佛教唯识学理念，将 Agent 记忆分为三层：
- **L3 沉淀层（业）**: 原始 session 历史，完整上下文记录
- **L2 联想层（识）**: 知识图谱，概念关系网络
- **L1 唤醒层（现行识）**: 向量检索，快速激活相关记忆

### 1.2 核心目标

- ✅ 从 session logs 中提炼可复用的知识卡片
- ✅ 建立知识之间的语义关系网络
- ✅ 支持高效的语义检索和联想推理
- ✅ 实现冷热分层，优化内存和查询效率
- ✅ 与 OpenClaw 生态无缝集成

### 1.3 技术约束

- **服务器环境**: KUMA 2 vCPU / 8GB RAM
- **零额外服务**: LanceDB + Kuzu 均为嵌入式数据库
- **轻量级**: Node.js 实现，最小依赖
- **数据目录**: `~/.alaya/` (可配置)

---

## 2. 系统架构

### 2.1 架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                         OpenClaw Agent                          │
│  ┌──────────────┐       ┌──────────────┐      ┌──────────────┐ │
│  │ Session Chat │──────▶│ Alaya Skill  │◀────▶│ Alaya CLI    │ │
│  └──────────────┘       └──────────────┘      └──────────────┘ │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │    Alaya Core Engine    │
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
┌───────▼────────┐     ┌─────────▼────────┐    ┌─────────▼─────────┐
│  L1 唤醒层      │     │  L2 联想层        │    │  L3 沉淀层         │
│  (Embedding)   │     │  (Graph)         │    │  (Raw Storage)    │
├────────────────┤     ├──────────────────┤    ├───────────────────┤
│  LanceDB       │     │  Kuzu Graph DB   │    │  File System      │
│                │     │                  │    │                   │
│  HOT (Memory)  │     │  Nodes: Cards    │    │  session-*.json   │
│  WARM (Disk)   │◀───▶│  Edges: Links    │◀──▶│  session-*.md     │
│  COLD (Archive)│     │                  │    │  context/*.json   │
└────────────────┘     └──────────────────┘    └───────────────────┘
        │                       │                        │
        └───────────────────────┴────────────────────────┘
                                 │
                      ┌──────────▼───────────┐
                      │  Embedding Provider  │
                      │  (SiliconFlow/OpenAI)│
                      └──────────────────────┘
```

### 2.2 数据流

#### 记忆形成（Ingest → Distill）
```
Session End
    ↓
L3: Ingest (保存原始 session)
    ↓
Distill (LLM 提取知识)
    ↓
L2: Create Cards + Links (图谱节点和边)
    ↓
L1: Generate Embeddings (向量化)
    ↓
Update Temperature (计算初始热度)
```

#### 记忆召回（Recall）
```
Query String
    ↓
L1: Vector Search (找到相似 embeddings)
    ↓ (card_ids)
L2: Graph Traversal (沿关系扩展)
    ↓ (expanded_card_ids)
L3: Fetch Context (回溯原始上下文)
    ↓
Return Ranked Results
```

---

## 3. 数据模型

### 3.1 L3 沉淀层（Raw Storage）

#### 目录结构
```
~/.alaya/
├── raw/
│   ├── sessions/
│   │   ├── 2026-03/
│   │   │   ├── session-20260331-062900.json
│   │   │   └── session-20260331-062900.md
│   │   └── 2026-04/
│   └── contexts/
│       ├── card-abc123-context.json
│       └── card-def456-context.json
└── config.json
```

#### Session 文件格式
```json
{
  "id": "session-20260331-062900",
  "timestamp": 1743403740000,
  "channel": "telegram",
  "agent": "main",
  "turns": [
    {
      "role": "user",
      "content": "帮我分析一下...",
      "timestamp": 1743403740000
    },
    {
      "role": "assistant",
      "content": "好的，我来分析...",
      "timestamp": 1743403745000,
      "tool_calls": [...]
    }
  ],
  "metadata": {
    "duration_ms": 12000,
    "model": "claude-sonnet-4.5",
    "tokens": 2345
  }
}
```

### 3.2 L2 联想层（Graph DB）

#### 节点类型（Node Schema）

```cypher
// 知识卡片节点
CREATE (c:Card {
  id: STRING,              // 唯一标识 "card-{uuid}"
  title: STRING,           // 卡片标题
  content: STRING,         // 卡片内容（markdown）
  type: STRING,            // 类型: concept/pattern/gotcha/decision
  created_at: TIMESTAMP,   // 创建时间
  updated_at: TIMESTAMP,   // 更新时间
  source_sessions: LIST,   // 来源 session IDs
  tags: LIST,              // 标签列表
  temperature: FLOAT       // 当前温度 (0.0-1.0)
})

// Session 元节点（用于回溯）
CREATE (s:Session {
  id: STRING,
  timestamp: TIMESTAMP,
  channel: STRING,
  summary: STRING
})
```

#### 边类型（Edge Schema）

**一级关系（系统内置，有索引加速）：**

| 关系类型 | 方向 | 含义 | 示例 |
|---------|------|------|------|
| `CAUSES` / `CAUSED_BY` | 单向 | 因果关系 | 内存溢出由于未设 limit |
| `DEPENDS_ON` | 单向 | 依赖关系 | Docker 部署依赖于构建脚本 |
| `SIMILAR_TO` | 双向 | 相似模式 | 两个 Bug 都是类型错误 |
| `CONTRADICTS` | 双向 | 矛盾/替代 | 旧方案 vs 新方案 |
| `TEMPORAL_NEXT` | 单向 | 时序后继 | 决策 B 在决策 A 之后 |
| `EXTRACTED_FROM` | 单向 | 提取自 session | Card → Session |

**二级关系（自定义，自由命名）：**

- 在 Kuzu 里用统一的 `CUSTOM` 边表，`type` 字段区分关系名
- distill 时 LLM 可以自由命名关系（如 `INSPIRED_BY`, `CONFLICTS_WITH`, `SUPERSEDES` 等）
- introspect 的 consolidate 阶段做关系聚类，高频自定义关系可提升为一级
- **这体现了"识从业中涌现"的理念** — 系统从实际使用中学习新的关系类型

#### Edge 属性

**一级关系示例**：
```cypher
CREATE (a:Card)-[r:DEPENDS_ON {
  weight: FLOAT,        // 关系强度 (0.0-1.0)
  created_at: TIMESTAMP,
  reason: STRING        // 关系说明
}]->(b:Card)
```

**自定义关系示例**：
```cypher
CREATE (a:Card)-[r:CUSTOM {
  type: STRING,         // 自定义关系名（如 "INSPIRED_BY"）
  weight: FLOAT,
  created_at: TIMESTAMP,
  reason: STRING
}]->(b:Card)
```

#### 关系 Embedding

每种关系（包括自定义）都有 embedding，用于关系聚类和相似度计算：

```typescript
interface RelationEmbedding {
  relation: string;      // 关系名（如 "DEPENDS_ON" 或 "INSPIRED_BY"）
  vector: number[];      // embedding (1024-dim)
  frequency: number;     // 使用频次
  is_core: boolean;      // 是否为一级关系
  examples: string[];    // 使用示例
}
```

**关系 embedding 生成策略**：
- 核心关系在 `init` 时预生成（基于关系名 + 定义）
- 自定义关系在 distill 创建时自动生成（基于关系名 + reason）
- introspect 时做关系聚类，发现高相似度的关系对→建议合并或标记别名
- 存储在 L1 的独立表中

### 3.3 L1 唤醒层（Embedding DB）

#### LanceDB Schema

**卡片 Embedding 表**：
```typescript
interface EmbeddingRecord {
  id: string;              // card-{uuid}
  vector: number[];        // embedding (1024-dim for BAAI/bge-large-zh-v1.5)
  card_id: string;         // 对应的 L2 Card ID
  content_hash: string;    // 内容 hash，用于检测变更
  temperature: number;     // 当前温度 (0.0-1.0)
  tier: 'HOT' | 'WARM' | 'COLD';
  last_accessed: number;   // 最后访问时间
  access_count: number;    // 访问次数
  created_at: number;      // 创建时间
  metadata: {
    title: string;
    tags: string[];
    type: string;
  };
}
```

**关系 Embedding 表**：
```typescript
interface RelationEmbedding {
  relation: string;        // 关系名
  vector: number[];        // embedding (1024-dim)
  frequency: number;       // 使用频次
  is_core: boolean;        // 是否为一级关系
  examples: string[];      // 使用示例（用于生成 embedding）
  created_at: number;
  updated_at: number;
}
```

#### 冷热分层策略

| Tier | 条件 | 存储方式 | 数量上限 |
|------|------|----------|---------|
| **HOT** | temp ≥ 0.7 OR 最近 7 天 OR access_count > 10 | 内存常驻 | 5000 |
| **WARM** | 0.3 ≤ temp < 0.7 | 磁盘索引，按需加载 | 20000 |
| **COLD** | temp < 0.3 AND 未访问 > 30 天 | 仅保留 metadata，丢弃 embedding | 无限 |

#### 温度计算公式

```
temperature = recency_score × frequency_score × relevance_score

recency_score = exp(-days_since_created / 30)
frequency_score = min(1.0, access_count / 20)
relevance_score = avg(similarity_scores from recent recalls)
```

每次 `introspect` 时重新计算所有卡片温度，并执行升降级。

---

## 4. CLI 命令详解

### 4.1 `alaya init`

**功能**: 初始化 Alaya 数据库

**行为**:
- 创建 `~/.alaya/` 目录结构
- 初始化 LanceDB（创建表和索引）
- 初始化 Kuzu（创建节点和边的 schema）
- 生成默认配置文件 `~/.alaya/config.json`

**输出**:
```
✓ Created directory structure at ~/.alaya/
✓ Initialized LanceDB at ~/.alaya/lancedb/
✓ Initialized Kuzu Graph DB at ~/.alaya/kuzu/
✓ Created config file at ~/.alaya/config.json
✓ Alaya is ready!
```

**配置文件示例**:
```json
{
  "version": "1.0",
  "data_dir": "~/.alaya",
  "embedding": {
    "provider": "siliconflow",
    "model": "BAAI/bge-large-zh-v1.5",
    "dimensions": 1024,
    "api_key_env": "SILICONFLOW_API_KEY"
  },
  "temperature": {
    "hot_threshold": 0.7,
    "warm_threshold": 0.3,
    "cold_days": 30,
    "hot_limit": 5000,
    "warm_limit": 20000
  },
  "distill": {
    "llm_provider": "openai",
    "model": "gpt-4o",
    "prompt_template": "~/.alaya/prompts/distill.txt"
  }
}
```

---

### 4.2 `alaya ingest <session-file>`

**功能**: 导入 session 历史到 L3

**参数**:
- `<session-file>`: OpenClaw session JSON 文件路径

**行为**:
1. 解析 session JSON
2. 提取 metadata（时间、channel、agent、tokens）
3. 保存到 `~/.alaya/raw/sessions/YYYY-MM/session-{id}.json`
4. 生成 markdown 摘要到 `session-{id}.md`
5. 在 L2 创建 Session 元节点

**输出**:
```
📥 Ingesting session: session-20260331-062900
   Duration: 12.0s | Tokens: 2345 | Channel: telegram
✓ Saved to ~/.alaya/raw/sessions/2026-03/session-20260331-062900.json
✓ Created Session node in graph
```

---

### 4.3 `alaya distill [--session <id>]`

**功能**: 从业（session logs）提炼识（知识卡片）

**参数**:
- `--session <id>`: 指定 session ID，不指定则处理所有未 distill 的 sessions

**流程**:

```
1. 从 L3 读取 session 内容
   ↓
2. 构建 LLM prompt（见 4.3.1）
   ↓
3. 调用 LLM 提取知识卡片
   ↓
4. 解析 LLM 返回的结构化输出
   ↓
5. 在 L2 创建 Card 节点 + 关系边
   ↓
6. 为每个 Card 生成 embedding
   ↓
7. 插入 L1 (初始 temperature = 1.0)
   ↓
8. 保存 context 到 L3 (card-{id}-context.json)
```

#### 4.3.1 Distill Prompt 设计

**System Prompt**:
```
你是一个知识提炼专家，负责从 AI Agent 的对话历史中提取可复用的知识卡片。

要求：
1. 识别非平凡的知识点（gotchas、patterns、decisions）
2. 每个卡片独立自洽，包含足够上下文
3. 避免提取常识性内容
4. 识别卡片之间的关系（依赖、因果、相似等）

输出格式（JSON）：
{
  "cards": [
    {
      "title": "简洁标题",
      "content": "详细内容（markdown）",
      "type": "concept|pattern|gotcha|decision",
      "tags": ["标签1", "标签2"],
      "importance": 0.8  // 0.0-1.0
    }
  ],
  "links": [
    {
      "from_title": "卡片A标题",
      "to_title": "卡片B标题",
      "relation": "DEPENDS_ON|CAUSED_BY|SIMILAR_TO|...",
      "reason": "关系说明"
    }
  ]
}
```

**User Prompt**:
```
Session ID: {session_id}
Timestamp: {timestamp}
Channel: {channel}

=== 对话内容 ===
{session_content}

=== 任务 ===
提取可复用的知识卡片，并识别它们之间的关系。
```

**输出示例**:
```
🧠 Distilling session-20260331-062900
   Found 3 cards:
     ✓ Card: Telegram 消息通知机制 [concept]
     ✓ Card: Gateway 重启前发通知的模式 [pattern]
     ✓ Card: 避免漏掉 plugins.allow 配置 [gotcha]
   Created 2 links:
     ✓ "Gateway 重启前发通知的模式" DEPENDS_ON "Telegram 消息通知机制"
     ✓ "避免漏掉 plugins.allow 配置" CAUSED_BY "Gateway 重启前发通知的模式"
   Generated embeddings for 3 cards
✓ Distillation complete
```

---

### 4.4 `alaya recall`

**功能**: 从概念/关系快速激活相关记忆（启发式搜索导航模式）

**设计哲学变化**: recall 的调用者是 agent，不是人类用户。Agent 有结构化表达能力，不需要退化成自然语言搜索。recall 不是一次性搜索，而是知识空间的导航——每次返回"当前位置 + 可走的路 + 离目标的距离"。

**三种调用模式**:

```bash
# 简单模式（向后兼容，人类手动查询）
alaya recall "Gateway 配置"

# 结构化模式（agent 专用）
alaya recall --concepts "Gateway重启,Telegram消息" --rel CAUSED_BY --depth 2

# JSON stdin 模式（agent 通过 exec 调用）
echo '{"concepts":["Gateway重启"],"relations":["CAUSED_BY"],"depth":2}' | alaya recall --json
```

**Agent 如何知道可用关系**:
- Skill 里静态声明核心关系类型（见 5.1 节）
- `alaya schema --relations` 命令动态发现所有关系（含自定义）

**Recall 内部零 LLM 调用**:
- 概念提取由 agent 完成（agent 本来就在推理）
- 关系选择由 agent 指定
- recall 内部只做 embedding API + 本地图查询
- 延迟 <100ms

**流程**:

```
1. 对 concepts 生成 embeddings（如果是自然语言查询，先提取概念）
   ↓
2. L1: 向量检索（top 20，cosine similarity）
   ↓
3. L2: 图遍历扩展
   - 如果指定了 relations，只沿这些边类型遍历
   - 计算每个节点的 h_distance（启发式距离）
   - 按 h_distance 排序
   ↓
4. 返回：当前节点 + 可探索的路径 + 平均距离
   ↓
5. 更新 access_count + last_accessed
```

**启发式距离公式**:
```
h(node) = α × concept_distance + β × relation_distance + γ × depth_penalty

其中：
- concept_distance: 概念 embedding 与节点 embedding 的余弦距离
- relation_distance: 1 - rel_similarity（关系匹配度）
- depth_penalty: 遍历深度的惩罚项（0.1 × depth）
- α=0.5, β=0.3, γ=0.2（可配置）
```

**返回结构（启发式导航模式）**:
```json
{
  "nodes": [
    {
      "card_id": "card-abc",
      "title": "Gateway plugins.allow 遗漏导致消息中断",
      "content": "...",
      "score": 0.89,
      "h_distance": 0.15,
      "matched_rel": "CAUSED_BY",
      "rel_similarity": 1.0
    },
    {
      "card_id": "card-def",
      "title": "配置变更引发的连锁故障",
      "content": "...",
      "score": 0.72,
      "h_distance": 0.31,
      "matched_rel": "LED_TO",
      "rel_similarity": 0.93
    }
  ],
  "explorable": [
    {"rel": "DEPENDS_ON", "count": 2, "rel_sim_to_query": 0.41},
    {"rel": "TEMPORAL_NEXT", "count": 1, "rel_sim_to_query": 0.22}
  ],
  "h_distance_avg": 0.23
}
```

**多轮导航（Agent 自主探索）**:

Agent 拿到结果后判断 `h_distance_avg` 是否足够小（< 0.3）：
- 如果足够小，说明已找到相关知识，结束
- 如果不够，可以从返回的节点出发，沿 `explorable` 的关系继续探索
- 支持 `from_nodes` 参数：从指定节点继续导航

```json
{
  "from_nodes": ["card-abc"],
  "relations": ["DEPENDS_ON"],
  "depth": 1
}
```

**Agent 自己决定什么时候停。**

**CLI 输出示例**:
```
🔍 Recalling: concepts=["Gateway重启"] relations=["CAUSED_BY"] depth=2

[1] Gateway plugins.allow 遗漏导致消息中断 (h=0.15) #gotcha
    matched: CAUSED_BY (rel_sim=1.0)
    ...（内容预览）...

[2] 配置变更引发的连锁故障 (h=0.31) #pattern
    matched: LED_TO (rel_sim=0.93)
    ...（内容预览）...

Explorable paths:
  - DEPENDS_ON (2 nodes, rel_sim=0.41)
  - TEMPORAL_NEXT (1 node, rel_sim=0.22)

Average h_distance: 0.23 (🎯 close to target)
```

---

### 4.5 `alaya schema`

**功能**: 查看数据模型信息（关系类型、节点统计等）

**子命令**:

#### `alaya schema --relations`

列出所有关系类型及使用频次（包括核心关系和自定义关系）。

**输出示例**:
```
📊 Relation Types

Core Relations (built-in, indexed):
  CAUSES / CAUSED_BY    1,234 uses
  DEPENDS_ON            3,456 uses
  SIMILAR_TO            2,890 uses
  CONTRADICTS             456 uses
  TEMPORAL_NEXT         1,234 uses
  EXTRACTED_FROM        8,512 uses

Custom Relations (emergent):
  INSPIRED_BY             89 uses  [high freq → consider promoting]
  SUPERSEDES              67 uses
  CONFLICTS_WITH          45 uses
  RELATES_TO             234 uses  [generic, consider splitting]
  ...

Total: 15,678 edges (6 core types + 23 custom types)
```

#### `alaya schema --node-types`

列出节点类型统计。

**输出示例**:
```
📊 Node Types

Cards:
  concept    3,241 (38%)
  pattern    2,103 (25%)
  gotcha     1,876 (22%)
  decision   1,292 (15%)
  Total:     8,512

Sessions:  1,234
```

---

### 4.6 `alaya trace <card-id>`

**功能**: 从识（card）回溯到业（原始 session 上下文）

**参数**:
- `<card-id>`: 卡片 ID（如 `card-abc123`）

**行为**:
1. 从 L2 读取 Card 节点的 `source_sessions`
2. 从 L3 读取对应的 session 文件
3. 读取 `card-{id}-context.json`（提炼时保存的相关 turns）
4. 输出完整上下文

**输出**:
```
🔬 Tracing card-abc123: "Telegram 消息通知机制"

=== Source Sessions ===
- session-20260331-062900 (2026-03-31 06:29 UTC)

=== Relevant Context ===
[Turn 3] User: 为什么没收到通知？
[Turn 4] Assistant: 我来检查 Gateway 配置...

=== Full Session ===
[View at ~/.alaya/raw/sessions/2026-03/session-20260331-062900.json]
```

---

### 4.7 `alaya introspect`

**功能**: 高阶命令，执行深度记忆整理

**子任务**:

1. **Distill**: 处理所有新 session
2. **Consolidate**: 合并相似卡片，发现新链接
3. **Cool-down**: 冷热分层，降温过期 embeddings
4. **Forget**: 合理遗忘（低温 → 归档）

**流程细节**:

#### 4.7.1 Consolidate（合并相似卡片 + 关系聚类）

**卡片聚类**:
```
1. 对所有 HOT/WARM 卡片做聚类（embedding clustering）
   ↓
2. 对于相似度 > 0.95 的卡片对：
   - 调用 LLM 判断是否真的重复
   - 如果是，合并为一张卡片
   - 更新 L2 关系（边指向合并后的卡片）
   - 删除旧卡片的 embedding
   ↓
3. 对于相似度 0.7-0.95 的卡片对：
   - 检查是否已有关系边
   - 如果没有，建议创建 SIMILAR_TO 边
```

**关系聚类（识从业中涌现）**:
```
1. 对所有自定义关系做 embedding clustering
   ↓
2. 对于相似度 > 0.9 的关系对：
   - 建议合并或标记别名（如 "INSPIRED_BY" ≈ "INFLUENCED_BY"）
   - 提示用户是否统一命名
   ↓
3. 对于使用频次 > 100 的高频自定义关系：
   - 建议提升为一级关系（添加索引）
   - 输出升级脚本
   ↓
4. 对于关系名模糊的（如 "RELATES_TO", "LINKED_TO"）：
   - 建议细化为更具体的关系类型
```

#### 4.7.2 Cool-down（温度降级）
```
1. 重新计算所有卡片温度
   ↓
2. 按温度阈值重新分层：
   - temp ≥ 0.7 → HOT
   - 0.3 ≤ temp < 0.7 → WARM
   - temp < 0.3 → COLD
   ↓
3. HOT 层超限时，按温度排序，溢出部分降为 WARM
   ↓
4. COLD 层卡片：
   - 删除 embedding（释放存储）
   - 保留 L2 节点和 metadata
```

#### 4.7.3 Forget（合理遗忘）
```
对于满足以下条件的 COLD 卡片：
  - temperature < 0.1
  - 未访问 > 90 天
  - access_count < 3
  - 无出边（没有其他卡片依赖它）

操作：
  - 从 L2 删除节点
  - 从 L1 删除 embedding（如果还有）
  - L3 保持归档（可选的回溯能力）
```

**输出**:
```
🧘 Starting introspection...

[1/4] Distill
   Processed 12 new sessions
   Created 28 cards, 41 links

[2/4] Consolidate
   Found 3 duplicate pairs, merged into 3 cards
   Created 7 new SIMILAR_TO links

[3/4] Cool-down
   HOT: 4823 cards (177 upgraded, 215 downgraded)
   WARM: 18456 cards
   COLD: 3201 cards (122 newly archived)

[4/4] Forget
   Deleted 15 low-value cards
   Freed 15 MB of embedding storage

✓ Introspection complete (took 2m 34s)
```

---

### 4.8 `alaya link <id-a> <id-b> [--rel type]`

**功能**: 手动补充 L2 关系

**参数**:
- `<id-a>`, `<id-b>`: 两个卡片 ID
- `--rel`: 关系类型（默认 `RELATES_TO`）

**行为**:
- 在 L2 创建边 `(a)-[rel]->(b)`
- 如果是双向关系类型，也创建 `(b)-[rel]->(a)`

**输出**:
```
✓ Created link: card-abc123 DEPENDS_ON card-def456
```

---

### 4.9 `alaya status`

**功能**: 各层统计

**输出**:
```
📊 Alaya Status

L3 Raw Storage
  Sessions: 1,234 (42 GB)
  Oldest: 2025-11-15
  Newest: 2026-03-31

L2 Graph DB
  Cards: 8,512
    - concept: 3,241
    - pattern: 2,103
    - gotcha: 1,876
    - decision: 1,292
  Links: 15,678
    - RELATES_TO: 6,234
    - DEPENDS_ON: 3,456
    - SIMILAR_TO: 2,890
    - CAUSED_BY: 1,234
    - others: 1,864

L1 Embedding DB
  Total: 8,512
  HOT: 4,823 (memory: 120 MB)
  WARM: 3,567 (disk: 89 MB)
  COLD: 122 (archived)

Temperature Distribution
  0.9-1.0: ████████░░ 15%
  0.7-0.9: ██████████ 42%
  0.5-0.7: ████░░░░░░ 18%
  0.3-0.5: ██░░░░░░░░ 12%
  0.0-0.3: ███░░░░░░░ 13%
```

---

### 4.10 `alaya export`

**功能**: 导出为可读格式

**行为**:
- 生成 `~/.alaya/export/` 目录
- 导出所有 Cards 为 markdown 文件（按 type 分目录）
- 导出关系图为 GraphML（可用 Gephi 可视化）
- 生成索引文件 `index.md`

**输出**:
```
📦 Exporting Alaya data...

✓ Exported 8,512 cards to ~/.alaya/export/cards/
  - concept/
  - pattern/
  - gotcha/
  - decision/
✓ Exported graph to ~/.alaya/export/graph.graphml
✓ Created index at ~/.alaya/export/index.md

Export complete: ~/.alaya/export/
```

---

## 5. 与现有系统集成

### 5.1 OC Skill: `skills/alaya/`

#### SKILL.md
```markdown
# Alaya Memory Skill

Activate when:
- Agent needs to recall past knowledge
- Session ends (trigger ingest + distill)
- User asks "do you remember..."

## 可用关系类型（核心关系）

在结构化 recall 中，优先使用以下核心关系：
- `CAUSES` / `CAUSED_BY` - 因果关系
- `DEPENDS_ON` - 依赖关系
- `SIMILAR_TO` - 相似模式
- `CONTRADICTS` - 矛盾/替代
- `TEMPORAL_NEXT` - 时序后继
- `EXTRACTED_FROM` - 提取自 session

动态发现所有关系（含自定义）：
```bash
alaya schema --relations
```

## 使用方法

### 简单查询（向后兼容）
```bash
alaya recall "Gateway 配置"
```

### 结构化查询（推荐 Agent 使用）
```bash
# 指定概念和关系
alaya recall --concepts "Gateway重启,Telegram消息" --rel CAUSED_BY --depth 2

# JSON stdin 模式（exec 调用）
echo '{"concepts":["Gateway重启"],"relations":["CAUSED_BY"],"depth":2}' | alaya recall --json
```

### 多轮导航模式
```bash
# 第一轮：初始查询
result=$(alaya recall --concepts "Gateway重启" --json)
h_distance=$(echo $result | jq '.h_distance_avg')

# 如果 h_distance > 0.3，继续探索
if (( $(echo "$h_distance > 0.3" | bc -l) )); then
  from_nodes=$(echo $result | jq -r '.nodes[0].card_id')
  alaya recall --from-nodes "$from_nodes" --rel DEPENDS_ON --depth 1 --json
fi
```

### 追踪原始上下文
```bash
alaya trace <card-id>
```
```

#### 触发时机

1. **Session 开始时**:
   ```javascript
   const recentCards = await alaya.recall(`keywords from user's first message`);
   // 将相关卡片注入 system prompt
   ```

2. **Session 结束时**:
   ```javascript
   await alaya.ingest(sessionFile);
   await alaya.distill(`--session ${sessionId}`);
   ```

3. **用户明确询问时**:
   - "你还记得上次我们讨论的 X 吗？"
   - "之前关于 Y 的解决方案是什么？"

### 5.2 OC Cron 调度

**定时任务配置** (`~/.openclaw/config/cron.json`):
```json
{
  "jobs": [
    {
      "name": "alaya-introspect",
      "schedule": "0 */4 * * *",  // 每 4 小时
      "command": "alaya introspect",
      "timeout": 600000  // 10 分钟
    },
    {
      "name": "alaya-backup",
      "schedule": "0 3 * * *",  // 每天凌晨 3 点
      "command": "tar -czf ~/.alaya/backup/alaya-$(date +%Y%m%d).tar.gz ~/.alaya/raw ~/.alaya/lancedb ~/.alaya/kuzu"
    }
  ]
}
```

### 5.3 Memex 集成

**导入现有 memex 卡片**:
```bash
# 一次性导入（在 alaya init 之后）
alaya import-memex ~/.memex/cards/

# 流程：
# 1. 读取所有 .md 卡片
# 2. 在 L2 创建 Card 节点
# 3. 解析 [[wikilinks]] 为 RELATES_TO 边
# 4. 生成 embeddings 插入 L1
```

**持续同步**:
- memex 创建新卡片 → 触发 alaya ingest
- alaya recall 结果包含 memex 来源标记

### 5.4 OC Memory Search 替代路径

**当前**:
```javascript
const results = await oc.memory_search("query");
```

**未来**:
```javascript
const results = await alaya.recall("query", {
  include_memex: true,
  include_sessions: true,
  max_results: 10
});
```

Alaya 是 memory_search 的超集，提供：
- 更好的语义理解（embedding + graph）
- 关联推理（graph traversal）
- 冷热分层（更快的查询）

---

## 6. 实施计划

### Phase 1: MVP（2-3 周）

**目标**: 核心功能可用，验证架构可行性

**Scope**:
- ✅ L3: 文件系统存储（sessions）
- ✅ L1: LanceDB 基础向量检索（仅 HOT tier）
- ✅ CLI: `init`, `ingest`, `recall`
- ✅ Embedding: SiliconFlow API 集成
- ✅ 简化版 distill（LLM 提取卡片，不做复杂关系推理）

**不包含**:
- L2 Graph DB（手动维护简单的 JSON links）
- 冷热分层（所有 embeddings 都在 HOT）
- introspect 自动整理

**验收标准**:
```bash
alaya init
alaya ingest session-example.json
alaya recall "Telegram notification"
# → 返回相关卡片
```

---

### Phase 2: 完整三层架构（3-4 周）

**新增**:
- ✅ L2: Kuzu Graph DB 集成
- ✅ Distill 增强：提取关系边
- ✅ Graph traversal recall（从向量结果扩展到关联卡片）
- ✅ CLI: `trace`, `link`
- ✅ OC Skill 初步集成

**验收标准**:
```bash
alaya recall "Docker deployment" | jq '.results[0].related'
# → 显示关联卡片（通过 graph）

alaya trace card-abc123
# → 回溯到原始 session
```

---

### Phase 3: 冷热分层与自动整理（2-3 周）

**新增**:
- ✅ 温度计算与分层逻辑
- ✅ CLI: `introspect`（distill + consolidate + cool-down + forget）
- ✅ HOT/WARM/COLD tier 实现
- ✅ OC Cron 调度

**验收标准**:
```bash
alaya status
# → 显示冷热分层统计

alaya introspect
# → 自动合并重复卡片，降温过期 embeddings
```

---

### Phase 4: 生产优化与生态集成（2-3 周）

**新增**:
- ✅ Memex 导入与同步
- ✅ OC Memory Search 替代接口
- ✅ Export 功能（markdown + GraphML）
- ✅ 性能优化（批量 embedding、索引优化）
- ✅ 监控与日志
- ✅ 单元测试与集成测试

**发布**:
- 📦 发布到 npm: `@mitsein-ai/alaya@1.0.0`
- 📝 编写文档和使用示例
- 🚀 在主人的 OC 环境中部署

---

## 7. 技术细节与风险

### 7.1 LLM 调用成本控制

**问题**: Distill 过程频繁调用 LLM，可能产生高额费用

**解决方案**:
1. **批量处理**: 一次 distill 处理多个 sessions
2. **缓存机制**: 相同 session 内容不重复 distill
3. **增量模式**: 只处理新增的 turns（对于长 session）
4. **质量阈值**: 只对"有价值"的 session 做 distill（基于 token 数、工具调用等启发式规则）

### 7.2 Embedding 生成效率

**问题**: 为 8000+ 卡片生成 embeddings 耗时较长

**解决方案**:
1. **批量 API 调用**: 每次请求 100 条（SiliconFlow 支持）
2. **异步队列**: 使用 p-queue 限制并发数（避免 rate limit）
3. **渐进式索引**: 先处理 HOT tier，WARM tier 可延后

### 7.3 Graph DB 查询性能

**问题**: 复杂 Cypher 查询可能很慢

**解决方案**:
1. **索引优化**: 在 `Card.id`, `Card.type`, `Card.temperature` 上建索引
2. **限制遍历深度**: Graph traversal 最多 2-hop
3. **缓存热门路径**: 对高频查询结果做 TTL 缓存

### 7.4 数据一致性

**问题**: L1/L2/L3 之间可能不同步

**解决方案**:
1. **写入顺序**: L3 → L2 → L1（出错时从 L3 重建）
2. **校验命令**: `alaya verify`（检查三层数据一致性）
3. **修复工具**: `alaya rebuild-l1` 从 L2 重新生成 embeddings

---

## 8. 配置参考

### 8.1 完整配置文件

**~/.alaya/config.json**:
```json
{
  "version": "1.0",
  "data_dir": "~/.alaya",
  
  "embedding": {
    "provider": "siliconflow",
    "model": "BAAI/bge-large-zh-v1.5",
    "dimensions": 1024,
    "api_key_env": "SILICONFLOW_API_KEY",
    "batch_size": 100,
    "max_concurrency": 5
  },
  
  "temperature": {
    "hot_threshold": 0.7,
    "warm_threshold": 0.3,
    "cold_days": 30,
    "hot_limit": 5000,
    "warm_limit": 20000,
    "recency_decay": 30,
    "frequency_cap": 20
  },
  
  "distill": {
    "llm_provider": "openai",
    "model": "gpt-4o",
    "prompt_template": "~/.alaya/prompts/distill.txt",
    "min_session_tokens": 200,
    "max_cards_per_session": 10,
    "auto_distill": true
  },
  
  "recall": {
    "vector_top_k": 20,
    "graph_expand_depth": 1,
    "min_similarity": 0.6,
    "max_results": 10
  },
  
  "introspect": {
    "schedule": "0 */4 * * *",
    "consolidate_threshold": 0.95,
    "forget_threshold": 0.1,
    "forget_days": 90
  },
  
  "logging": {
    "level": "info",
    "file": "~/.alaya/logs/alaya.log"
  }
}
```

---

## 9. 总结

Alaya 通过三层架构（L3 沉淀 → L2 联想 → L1 唤醒），将 AI Agent 的"业"（raw logs）转化为"识"（可复用的知识网络）。

**核心价值**:
1. **语义检索**: 从意象快速激活相关记忆
2. **关联推理**: 通过图谱发现知识之间的隐含关系
3. **冷热分层**: 优化内存和查询效率
4. **自动整理**: introspect 定期合并、降温、遗忘

**实施路径**:
- Phase 1 (MVP): 核心功能验证
- Phase 2: 完整三层架构
- Phase 3: 冷热分层与自动整理
- Phase 4: 生产优化与生态集成

**技术栈**:
- L1: LanceDB (embedding)
- L2: Kuzu (graph)
- L3: File system (raw storage)
- Node.js + TypeScript

**下一步**: 主人 review 本文档后，进入 Phase 1 开发。

---

_"业不唐捐，识自流转。" — 愿 Alaya 成为 Agent 的长久记忆。_
