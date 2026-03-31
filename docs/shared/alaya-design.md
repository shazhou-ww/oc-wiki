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

## 7. 评估框架

### 7.1 评估哲学

Alaya 的评估体系与传统信息检索（IR）或 RAG 系统有本质区别：

**传统 IR/RAG 评估**:
- 有标准答案（ground truth）
- 衡量 Precision / Recall / F1
- 目标：找到"正确"的文档

**Alaya 评估**:
- 无标准答案（记忆是涌现的）
- 衡量"记忆对 agent 行为的改善程度"
- 目标：让 agent 因为"记住了"而做出更好的决策

**类比认知心理学**:
- 不是测"能背多少知识点"（死记硬背）
- 而是测"记忆是否帮助做出更好决策"（活学活用）

**佛学视角**:
- 最终衡量标准是"**因为记住了,少受了多少苦**"
- 苦 = 重复犯错、低效决策、遗忘重要上下文
- 评估的是记忆系统对"减少痛苦"的贡献

### 7.2 三层评估指标

#### L1 唤醒质量（能不能找到）

衡量向量检索和冷热分层的效果：

| 指标 | 定义 | 目标值 |
|------|------|--------|
| **Recall@K** | 相关卡片是否出现在 top K | R@5 > 0.8 |
| **Latency** | 查询响应时间 | p95 < 100ms |
| **Temperature Accuracy** | 高频卡片是否在 HOT tier | > 0.9 |
| **HOT Tier Hit Rate** | 查询命中 HOT tier 的比例 | > 0.85 |

**计算方法**:
```python
# Recall@K: 相关卡片在 top K 的比例
relevant_in_top_k = len(set(relevant_cards) & set(top_k_results))
recall_at_k = relevant_in_top_k / len(relevant_cards)

# Temperature Accuracy: 高频卡片在 HOT tier 的比例
high_freq_cards = [c for c in cards if c.access_count > 10]
in_hot = [c for c in high_freq_cards if c.tier == 'HOT']
temp_accuracy = len(in_hot) / len(high_freq_cards)
```

#### L2 联想质量（路走对了没有）

衡量知识图谱的质量和图遍历的有效性：

| 指标 | 定义 | 目标值 |
|------|------|--------|
| **Graph Gain** | 图遍历比纯向量多找到的增量 | > 1.3 |
| **Relation Precision** | 指定关系返回的结果是否真满足该关系 | > 0.85 |
| **Navigation Efficiency** | Agent 平均几轮 recall 到达目标 | < 2.5 轮 |
| **Relation Embedding Quality** | 关系聚类的 silhouette score | > 0.6 |

**Graph Gain 计算**:
```python
# 对比同一查询的两种策略
recall_vector_only = alaya.recall(query, graph_expand=False)
recall_with_graph = alaya.recall(query, graph_expand=True)

# 增量比例
graph_gain = len(recall_with_graph.results) / len(recall_vector_only.results)
# 期望: graph_gain > 1.3 (图遍历能多找到 30%+ 相关卡片)
```

**Relation Precision**:
```python
# 对于指定关系的查询
results = alaya.recall(concepts=["A"], relations=["CAUSED_BY"])

# 人工/LLM 判断返回的卡片是否真的满足 CAUSED_BY 关系
correct = sum(1 for r in results if judge(r, "CAUSED_BY"))
relation_precision = correct / len(results)
```

**Navigation Efficiency**:
- Agent 从查询到找到满意结果的 recall 调用次数
- 优秀: 1-2 轮（直接命中或 1 次扩展）
- 可接受: 2-3 轮
- 差: > 3 轮（说明图结构或启发式距离有问题）

**Relation Embedding Quality**:
```python
from sklearn.metrics import silhouette_score
from sklearn.cluster import KMeans

# 对关系 embeddings 做聚类
relation_vecs = [r.vector for r in relation_embeddings]
labels = KMeans(n_clusters=10).fit_predict(relation_vecs)

# Silhouette score: -1 到 1, 越高越好
score = silhouette_score(relation_vecs, labels)
# 目标: > 0.6 (说明关系类型区分度高)
```

#### L3 行为改善（用了之后 agent 变好了没有）

终极指标：记忆是否真的改善了 agent 的行为？

| 指标 | 定义 | 目标值 |
|------|------|--------|
| **Error Avoidance** | 同样的坑是否不再踩（A/B 对比） | 减少 > 50% |
| **Decision Quality** | LLM-as-judge 评分 | 提升 > 0.2 |
| **Context Efficiency** | Token 消耗和工具调用次数 | 减少 > 30% |
| **Forgetting Quality** | 遗忘后悔率（被遗忘后又需要的比例） | < 0.1 |

**Error Avoidance（A/B 测试）**:
```python
# 对比两组 agent:
# Group A: 有 Alaya 记忆
# Group B: 无 Alaya（或清空记忆）

# 同一批任务（如部署、配置变更）
tasks = load_test_tasks()

errors_with_memory = run_tasks(tasks, agent_with_alaya)
errors_without_memory = run_tasks(tasks, agent_baseline)

error_reduction = 1 - (errors_with_memory / errors_without_memory)
# 目标: > 0.5 (减少 50% 重复错误)
```

**Decision Quality（LLM-as-judge）**:
```python
# 对同一问题，对比有/无记忆时的回答
question = "如何避免 Docker 部署时的端口冲突？"

answer_with_memory = agent_with_alaya.answer(question)
answer_without_memory = agent_baseline.answer(question)

# LLM judge 评分（1-5）
score_with = llm_judge(question, answer_with_memory)
score_without = llm_judge(question, answer_without_memory)

quality_gain = score_with - score_without
# 目标: > 0.2 (评分提升 > 0.2 分)
```

**Context Efficiency**:
```python
# 完成同一任务的资源消耗
task = "部署新版本并验证"

metrics_with = {
  'tokens': agent_with_alaya.execute(task).token_count,
  'tool_calls': agent_with_alaya.execute(task).tool_call_count,
  'time': agent_with_alaya.execute(task).duration_ms
}

metrics_without = {
  'tokens': agent_baseline.execute(task).token_count,
  'tool_calls': agent_baseline.execute(task).tool_call_count,
  'time': agent_baseline.execute(task).duration_ms
}

efficiency_gain = {
  'tokens': 1 - (metrics_with['tokens'] / metrics_without['tokens']),
  'tool_calls': 1 - (metrics_with['tool_calls'] / metrics_without['tool_calls'])
}
# 目标: tokens 减少 > 30%, tool_calls 减少 > 30%
```

**Forgetting Quality（遗忘后悔率）**:
```python
# 被遗忘的卡片（从 COLD 删除）
forgotten_cards = get_deleted_cards_in_last_month()

# 遗忘后又被需要的（recall 时搜不到，但应该有）
regretted = []
for card in forgotten_cards:
  # 模拟：如果没删除，会不会被召回？
  if would_have_been_recalled(card):
    regretted.append(card)

regret_rate = len(regretted) / len(forgotten_cards)
# 目标: < 0.1 (90% 的遗忘决策是正确的)
```

### 7.3 评估数据集生成

#### 核心思路：用长篇小说生成 eval 数据集

**为什么小说比真实 session logs 更适合**:

| 维度 | Session Logs | 小说文本 |
|------|-------------|---------|
| Ground Truth | ❌ 难以定义"正确答案" | ✅ 原文就是答案 |
| 关系丰富度 | ⚠️ 取决于实际对话 | ✅ 因果、时序、矛盾天然存在 |
| 规模可控 | ❌ 需积累大量真实数据 | ✅ 选择章节数量即可 |
| 可复现性 | ❌ 每次对话不同 | ✅ 固定文本，结果稳定 |
| 隐私问题 | ⚠️ 可能包含敏感信息 | ✅ 公开文本，无隐私风险 |

#### 数据集生成流程

```
┌─────────────────────────────────────────────────┐
│ 1. 章节切分 → 模拟 Sessions                      │
│    - 每章 = 一个 session                         │
│    - 保留章节标题和内容                           │
└─────────────┬───────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│ 2. Alaya Ingest + Distill                       │
│    - alaya ingest chapter-01.json                │
│    - alaya distill --session chapter-01          │
│    - 生成 Cards + Links                          │
└─────────────┬───────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│ 3. AI 生成 QA 对（按规则）                       │
│    - 基于 Cards 和原文生成查询                    │
│    - 标注期望召回的卡片 ID                        │
└─────────────┬───────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────┐
│ 4. 输出数据集                                    │
│    novel-santi.json                              │
└─────────────────────────────────────────────────┘
```

#### QA 类型（6 种）

| 类型 | 描述 | 示例 | 难度 |
|------|------|------|------|
| **CONCEPT_RECALL** | 给定关键词，期望召回哪些片段 | "三体游戏" → 相关卡片 | Easy |
| **CAUSAL_TRACE** | 给定事件，沿因果链追溯 | "叶文洁发射信号" → "为什么她这么做？" | Medium |
| **SIMILAR_FIND** | 给定模式，联想相似模式 | "科学家自杀" → 其他类似事件 | Medium |
| **TEMPORAL_ORDER** | 验证时序关系 | "事件 A 在事件 B 之前发生吗？" | Easy |
| **CONTRADICTION** | 找矛盾观点 | "汪淼对三体的态度变化" | Hard |
| **NAVIGATION** | 从节点 A 到节点 B 的路径 | 从"红岸基地"导航到"三体文明" | Hard |

#### QA 生成 Prompt 设计

**System Prompt**:
```
你是一个评估数据集生成专家，负责从小说文本和 Alaya 生成的知识卡片中创建测试 QA 对。

输入：
1. 原始小说章节文本
2. Alaya distill 生成的 Cards（包含 ID、标题、内容、关系）

任务：
为以下 6 种查询类型各生成 5-10 个 QA 对：
- CONCEPT_RECALL: 关键词召回
- CAUSAL_TRACE: 因果追溯
- SIMILAR_FIND: 相似联想
- TEMPORAL_ORDER: 时序验证
- CONTRADICTION: 矛盾发现
- NAVIGATION: 路径导航

输出格式（JSON）：
{
  "qa_pairs": [
    {
      "type": "CONCEPT_RECALL",
      "query": "三体游戏",
      "expected_cards": ["card-abc", "card-def"],
      "difficulty": "easy",
      "explanation": "为什么这些卡片应该被召回"
    },
    {
      "type": "CAUSAL_TRACE",
      "query": "叶文洁为什么发射信号？",
      "expected_cards": ["card-xyz"],
      "expected_relations": ["CAUSED_BY"],
      "difficulty": "medium",
      "explanation": "需要沿因果链追溯"
    },
    ...
  ]
}

要求：
1. 查询应自然（像真实 agent 会问的）
2. 难度分布：Easy 40%, Medium 40%, Hard 20%
3. 每个 QA 对必须可验证（有明确的期望结果）
4. 避免过于简单的查询（如直接复制卡片标题）
```

**User Prompt**:
```
章节: 《三体》第一部 - 第 1-5 章

=== 原文摘要 ===
{chapter_summary}

=== Alaya Cards（已提炼）===
{cards_json}

=== 任务 ===
为这 5 章生成 30-50 个 QA 对，覆盖所有 6 种类型。
```

**输出示例**:
```json
{
  "qa_pairs": [
    {
      "type": "CONCEPT_RECALL",
      "query": "红岸基地的用途",
      "expected_cards": ["card-001", "card-003"],
      "difficulty": "easy",
      "explanation": "两张卡片分别描述了红岸基地的表面用途和真实用途"
    },
    {
      "type": "CAUSAL_TRACE",
      "query": "叶文洁失去对人类信心的原因",
      "expected_cards": ["card-007", "card-012"],
      "expected_relations": ["CAUSED_BY"],
      "difficulty": "medium",
      "explanation": "需要追溯到文革经历 → 父亲被害 → 对人性失望"
    },
    {
      "type": "NAVIGATION",
      "query": "从'红岸基地'导航到'三体文明接收信号'",
      "expected_path": ["card-001", "card-005", "card-009"],
      "difficulty": "hard",
      "explanation": "需要经过：红岸基地 → 叶文洁发射 → 信号被接收"
    }
  ]
}
```

#### 难度分级

| 难度 | 定义 | 示例 | 占比 |
|------|------|------|------|
| **Easy** | 单概念召回，无需图遍历 | "三体游戏" → 相关卡片 | 40% |
| **Medium** | 跨关系查询，需要图遍历（1-2 hop） | 因果追溯、相似联想 | 40% |
| **Hard** | 多轮导航，需要 agent 自主探索（2+ hop） | 复杂路径、矛盾发现 | 20% |

#### 推荐素材

| 小说 | 优势 | 适合测什么 | 预期规模 |
|------|------|-----------|---------|
| **《三体》第一部** | 因果链长、矛盾多、科幻设定复杂 | 因果追溯、矛盾发现、时序关系 | 200-300 QA |
| **《红楼梦》** | 人物关系网络复杂、场景丰富 | 关系网络、相似联想、社交图谱 | 300-400 QA |
| **技术文档** | 接近真实 agent 使用场景 | 依赖分析、概念召回、API 查询 | 100-150 QA |

**MVP 选择**:
- 《三体》第一部（前 15 章，约 15 万字）
- 生成 200-300 QA 对
- 覆盖所有 6 种类型
- 难度分布: Easy 40% / Medium 40% / Hard 20%

### 7.4 eval CLI 命令

#### 命令格式

```bash
alaya eval --dataset novel-santi.json --report [--output eval-report.json]
```

**参数**:
- `--dataset`: QA 数据集文件（JSON 格式）
- `--report`: 生成详细报告
- `--output`: 输出文件路径（默认：`~/.alaya/eval/report-{timestamp}.json`）

#### 执行流程

```
1. 加载数据集（qa_pairs）
   ↓
2. 对每个 QA 对：
   - 执行 recall（记录 latency）
   - 检查 expected_cards 是否在结果中（计算 Recall@K）
   - 对于 CAUSAL_TRACE/NAVIGATION，验证关系路径
   - 记录 HOT/WARM/COLD tier 命中情况
   ↓
3. 汇总统计：
   - L1 指标（Recall@K, Latency, Tier Hit Rate）
   - L2 指标（Graph Gain, Relation Precision, Navigation Efficiency）
   - 按难度/类型分组统计
   ↓
4. 生成报告（JSON + 终端输出）
```

#### 输出示例

**终端输出**:
```
🧪 Evaluating Alaya with dataset: novel-santi.json
   Total QA pairs: 247

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
L1 唤醒质量
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Recall@5:           0.847  ✓ (target: >0.8)
  Recall@10:          0.921
  Latency (p50):      67ms   ✓ (target: <100ms)
  Latency (p95):      142ms  ✗ (target: <100ms)
  Temp Accuracy:      0.912  ✓ (target: >0.9)
  HOT Tier Hit Rate:  0.878  ✓ (target: >0.85)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
L2 联想质量
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Graph Gain:         1.42   ✓ (target: >1.3)
  Relation Precision:
    CAUSED_BY:        0.89   ✓
    DEPENDS_ON:       0.82   ✗ (target: >0.85)
    SIMILAR_TO:       0.91   ✓
    Overall:          0.87   ✓
  Navigation Efficiency:
    Avg rounds:       2.1    ✓ (target: <2.5)
    Success rate:     0.84   (84% 找到目标)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
按查询类型分解
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  CONCEPT_RECALL    (98 pairs):  R@5=0.93, Latency=58ms
  CAUSAL_TRACE      (52 pairs):  R@5=0.81, Graph Gain=1.52
  SIMILAR_FIND      (45 pairs):  R@5=0.79, Graph Gain=1.38
  TEMPORAL_ORDER    (21 pairs):  R@5=0.91, Relation Prec=0.88
  CONTRADICTION     (18 pairs):  R@5=0.72, Nav Rounds=2.8
  NAVIGATION        (13 pairs):  Success=0.77, Nav Rounds=3.1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
按难度分解
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Easy    (99 pairs):  R@5=0.94, Latency=61ms
  Medium  (98 pairs):  R@5=0.83, Latency=72ms, Graph Gain=1.45
  Hard    (50 pairs):  R@5=0.76, Nav Rounds=3.0

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
问题卡片（R@5 < 0.6）
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  [NAVIGATION] "从'科学边界'到'三体入侵决策'"
    → R@5=0.4, 期望路径未找到
    → 建议：增强 TEMPORAL_NEXT 关系

  [CONTRADICTION] "汪淼对三体态度的矛盾"
    → R@5=0.5, 遗漏关键卡片 card-087
    → 建议：检查 embedding 质量

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
总结
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Overall Score: 0.847 / 1.0  (B+)
  Passed: 8 / 11 metrics

  Top Issues:
    1. Latency p95 超标 (142ms > 100ms) → 优化 WARM tier 加载
    2. DEPENDS_ON 关系精度偏低 (0.82) → review distill prompt
    3. Hard 难度 Navigation 成功率低 (0.76) → 改进启发式距离

  Next Steps:
    - 优化 WARM tier 索引（目标 p95 < 100ms）
    - 增强 distill 对 DEPENDS_ON 关系的识别
    - 考虑引入 A* 搜索优化导航路径

Report saved to: ~/.alaya/eval/report-20260331-082900.json
```

**JSON 报告结构**:
```json
{
  "meta": {
    "dataset": "novel-santi.json",
    "total_qa": 247,
    "timestamp": 1743403740000,
    "alaya_version": "1.0.0"
  },
  "l1_metrics": {
    "recall_at_5": 0.847,
    "recall_at_10": 0.921,
    "latency_p50": 67,
    "latency_p95": 142,
    "temp_accuracy": 0.912,
    "hot_tier_hit_rate": 0.878
  },
  "l2_metrics": {
    "graph_gain": 1.42,
    "relation_precision": {
      "CAUSED_BY": 0.89,
      "DEPENDS_ON": 0.82,
      "SIMILAR_TO": 0.91,
      "overall": 0.87
    },
    "navigation_efficiency": {
      "avg_rounds": 2.1,
      "success_rate": 0.84
    }
  },
  "by_type": { ... },
  "by_difficulty": { ... },
  "failed_cases": [ ... ],
  "recommendations": [ ... ]
}
```

### 7.5 自动化数据采集

**设计理念**: 大部分评估指标不需要额外标注，从 agent 自然使用行为中自动采集。

#### 自动采集指标

| 指标 | 采集方式 | 数据来源 |
|------|---------|---------|
| **Recall@K** | 每次 recall 记录 query + results + ranking | `alaya recall` 调用日志 |
| **Latency** | 记录每次 recall 的响应时间 | `alaya recall` 内部计时 |
| **HOT Tier Hit Rate** | 统计结果中 HOT/WARM/COLD 分布 | L1 embedding 表的 tier 字段 |
| **Graph Gain** | 对比有/无 graph_expand 的结果差异 | A/B 采样（10% 关闭图遍历） |
| **Navigation Efficiency** | 记录 agent 完成任务的 recall 轮数 | Session 日志分析 |
| **Error Avoidance** | 检测相同错误模式是否重复出现 | 对比历史 session 的错误类型 |
| **Context Efficiency** | 记录每次任务的 token 消耗和工具调用 | Session metadata |

#### 采集实现

**在 recall 时自动记录**:
```typescript
// alaya/src/core/recall.ts
export async function recall(query: RecallQuery): Promise<RecallResult> {
  const start = Date.now();
  
  // 执行检索
  const results = await performRecall(query);
  
  // 记录日志
  await logRecallEvent({
    timestamp: Date.now(),
    query,
    results: results.map(r => r.card_id),
    latency: Date.now() - start,
    tier_distribution: {
      hot: results.filter(r => r.tier === 'HOT').length,
      warm: results.filter(r => r.tier === 'WARM').length,
      cold: results.filter(r => r.tier === 'COLD').length,
    },
    graph_expanded: query.graph_expand ?? true
  });
  
  return results;
}
```

**定期生成无标注 eval 报告**:
```bash
# 每周自动运行
alaya eval --auto-generated --days 7 --report

# 基于过去 7 天的真实 recall 日志生成评估报告
# 不需要 ground truth，只看趋势变化
```

**输出示例**:
```
📊 Auto-Generated Eval Report (2026-03-24 to 2026-03-31)

Recall Performance Trend:
  Latency p95:  138ms → 142ms  ⚠️ (+2.9%, 可能需要优化)
  HOT Hit Rate: 0.891 → 0.878  ⚠️ (-1.5%, 检查温度计算)

Graph Usage:
  Graph Gain:   1.38 → 1.42   ✓ (图谱质量提升)
  Avg Expand:   1.2 hops (稳定)

Agent Behavior:
  Avg Recall/Session:  2.3 → 2.1  ✓ (效率提升)
  Repeat Errors:       12 → 8     ✓ (减少 33%)

Top Missed Queries (没找到期望结果的):
  1. "Docker volume 挂载权限问题" (5 次失败)
  2. "Nginx 反向代理 WebSocket" (3 次失败)
  → 建议：检查是否缺少相关卡片
```

#### 唯一需要人工标注的：Ground Truth 基准集

对于新部署或定期校准，需要少量人工标注的基准集（~50-100 QA 对）：

**半自动化流程**:
```
1. 从真实 recall 日志中采样高频查询（top 100）
   ↓
2. LLM-as-judge 自动标注期望结果
   ↓
3. 人工 review 10-20% 的标注结果
   ↓
4. 生成 ground-truth.json（作为定期校准基准）
```

**LLM-as-judge Prompt**:
```
给定查询和 Alaya 返回的 top 10 结果，判断哪些卡片是相关的。

查询: "Gateway 重启前如何通知用户？"

返回结果:
1. card-abc: "Telegram 消息通知机制"
2. card-def: "Gateway plugins.allow 配置"
3. card-ghi: "服务零停机部署模式"
...

任务: 判断每个卡片的相关性（relevant / partially_relevant / not_relevant）

输出格式:
{
  "relevant": ["card-abc", "card-ghi"],
  "partially_relevant": ["card-def"],
  "not_relevant": [...]
}
```

**人工校准**:
- 每月 review 20 个 LLM 标注结果
- 发现错误 → 更新 judge prompt → 重新标注
- 逐步提升自动标注质量

---

## 8. 技术细节与风险

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

## 9. 配置参考

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

## 10. 总结

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
