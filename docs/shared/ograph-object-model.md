# OGraph 对象模型与 API Protocol

> OGraph v2.4+ 系统架构与 API 接口规范文档

## 概述

OGraph v2.4+ 采用三层架构设计：

```
Definition Layer (定义层)
    ↓
Instance Layer (实例层)  
    ↓
Reaction Layer (响应层)
```

### 核心原则

- **事实不可变，解读可进化** — 原始事件永不修改，Projection 可以升级
- **名字是指针，hash 是锚点** — 名字在 API 入口解析，系统内部全用 content hash

## Definition Layer（定义层）

### 2.1 Object Def

最简单的定义，纯名字标识，无版本控制。

**数据表：**
```sql
object_defs (
  name TEXT PRIMARY KEY
)
```

**API：**
- `POST /object-defs { name }` — 注册 Object 类型
- `GET /object-defs` — 列出所有 Object 类型

### 2.2 Event Def（版本链）

定义事件的 schema 结构，支持版本演进。

**PropertyDef 类型：**
- `ref` — 引用 Object，可带 `object_type` 实现多态
- `string` — 字符串
- `number` — 数值  
- `boolean` — 布尔值

**版本链机制：**
- Content hash 做 ID，确保内容唯一性
- `parent_hash` 串联形成版本链
- 名字是可变指针，指向当前版本的 hash

**数据表：**
```sql
event_def_versions (
  hash TEXT PRIMARY KEY,
  name TEXT,
  parent_hash TEXT,
  schema TEXT, -- JSON
  created_at INTEGER
)

event_def_names (
  name TEXT PRIMARY KEY,
  current_hash TEXT -- → event_def_versions.hash
)
```

**API：**
- `POST /event-defs { name, schema: { properties: {...} } }` — 注册/更新 Event 类型（upsert）
- `GET /event-defs` — 列出所有 Event 类型

**特性：**
- `ref` 类型的属性会自动提取到 `event_refs` 表
- 名字只在 API 入口解析，进入系统后全走 hash

### 2.3 Projection Def（版本链 + 多态 Sources）

定义如何将事件流聚合成状态视图。

**核心组件：**
- **params** — 声明投影参数（通常是 ref 类型）
- **sources** — 事件源数组，每个 source 绑定一种 event def hash：
  - **bindings** — 结构化查询条件，`$param` 引用 params，裸字符串是字面量
  - **expression** — JSONata reducer，签名 `(state, event, params) → new_state`
- **value_schema** + **initial_value**（NOT NULL）

**数据表：**
```sql
projection_def_versions (
  hash TEXT PRIMARY KEY,
  name TEXT,
  parent_hash TEXT,
  params TEXT, -- JSON
  value_schema TEXT, -- JSON
  initial_value TEXT, -- JSON
  created_at INTEGER
)

projection_def_sources (
  projection_hash TEXT,
  event_def_hash TEXT,
  bindings TEXT, -- JSON
  expression TEXT -- JSONata
)

projection_def_names (
  name TEXT PRIMARY KEY,
  current_hash TEXT -- → projection_def_versions.hash
)
```

**API：**
- `POST /projection-defs { name, sources: [{ event_def, bindings, expression }], params, value_schema, initial_value }` — 注册/更新 Projection（upsert）
- `GET /projection-defs` — 列出所有 Projection 定义

## Instance Layer（实例层）

### 3.1 Object

纯标识实体，`id + type + created_at`。

**数据表：**
```sql
objects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, -- → object_defs.name
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
```

**ID 策略：**
- 内部 ID 使用 `INTEGER AUTOINCREMENT`，简单高效
- 外部系统标识（GitHub issue number 等）不放在 Object 表上，而是通过事件 payload 记录（如 `external_id_linked` 事件），由 Adapter 层自行管理映射

**API：**
- `POST /objects { type }` — 创建 Object 实例
- `GET /objects/:id` — 查询 Object
- `GET /objects?type=<name>` — 按类型列出 Objects

### 3.2 Event

不可变事件记录，`id + type_hash + payload + created_at`。

**数据表：**
```sql
events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type_hash TEXT NOT NULL, -- → event_def_versions.hash
  payload TEXT NOT NULL,   -- JSON
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

event_refs (
  event_id INTEGER NOT NULL, -- → events.id
  property TEXT NOT NULL,
  ref_id INTEGER NOT NULL,   -- → objects.id
  PRIMARY KEY (event_id, property)
);
CREATE INDEX idx_event_refs_obj ON event_refs(ref_id);
```

**ID 策略：**
- Event ID 使用 `INTEGER AUTOINCREMENT`，严格递增，天然全序
- 排序只需 `ORDER BY id ASC`，不再需要 `ORDER BY created_at ASC, id ASC`
- 为 Projection 增量计算提供精确边界（`WHERE id > last_event_id`）

**发射流程：**
1. 名字解析为 hash
2. Schema 校验
3. 写入 `events` + `event_refs`
4. 触发 reaction chain

**API：**
- `POST /events { type, payload }` — 发射事件
- `GET /events/:id` — 查询事件
- `GET /events?ref=<object_id>` — 按 Object 查相关事件

### 3.3 Projection（缓存）

`(def_hash, params_hash) → value` 的 lazy 增量计算缓存。

**数据表：**
```sql
projections (
  def_hash TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  params TEXT NOT NULL,           -- JSON: 原始参数
  value TEXT NOT NULL,            -- JSON: 计算结果
  last_event_id INTEGER NOT NULL DEFAULT 0, -- 增量边界：上次处理到的 event id
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  PRIMARY KEY (def_hash, params_hash)
);
```

**计算流程：**
1. 查缓存，取 `value` + `last_event_id`
2. 对每个 source，用 bindings 查 `id > last_event_id` 的增量事件
3. 所有 source 的增量事件按 `id ASC` 排序（integer 自增天然全序）
4. 逐条 dispatch 到对应 source 的 expression
5. 更新缓存的 `value` 和 `last_event_id`

无缓存时从 `initial_value` + 全量事件计算（`WHERE id > 0`）。

**增量精度：** 使用 `last_event_id`（integer）替代 `updated_at`（timestamp），精确到条，零遗漏零重复。

**API：**
- `GET /projections/:name?param1=val1&param2=val2` — 查询 Projection 值

## Reaction Layer（响应层）

### 4.1 Reaction

订阅 projection 变化并执行响应动作。

**Action 类型：**
- **webhook** — POST 到 `webhook_url`，payload 包含 `old_value`, `new_value`, `params`, `event`
- **emit_event** — 发射新事件到 OGraph（事件衍生/扇出），支持 payload template（JSONata）

**数据表：**
```sql
reactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  projection_def_hash TEXT,
  params_hash TEXT,
  params TEXT,        -- JSON: 原始参数
  action TEXT,        -- 'webhook' | 'emit_event'
  webhook_url TEXT,
  emit_event_type TEXT,
  emit_payload_template TEXT, -- JSONata
  created_at INTEGER
)
```

**触发链路：**
```
Event 发生 
→ 查 projection_def_sources 找到受影响的 projection
→ 查 reactions 
→ 对有 reaction 的执行 bindings 匹配
→ 重算 projection
→ diff(old, new)
→ 触发 action
```

**API：**
- `POST /reactions { projection_def, params, action?, webhook_url?, emit_event_type?, emit_payload_template? }` — 创建 Reaction
- `GET /reactions` — 列出所有 Reactions
- `DELETE /reactions/:id` — 删除 Reaction

## 表结构总览

| 分类 | 表 | 可变性 |
|---|---|---|
| 定义（无版本） | `object_defs` | append-only |
| 定义版本 | `event_def_versions`, `projection_def_versions` | immutable |
| 定义 sources | `projection_def_sources` | immutable（随版本） |
| 名字指针 | `event_def_names`, `projection_def_names` | mutable（UPDATE current_hash） |
| 实例 | `objects`, `events` | append-only（ID 均为 INTEGER AUTOINCREMENT） |
| 关联 | `event_refs` | append-only |
| 缓存 | `projections` | mutable（缓存刷新） |
| 响应 | `reactions` | CRUD |

## API 速查表

```
POST   /object-defs                 注册 Object 类型
GET    /object-defs                 列出所有 Object 类型
POST   /objects                     创建 Object 实例
GET    /objects/:id                 查询 Object
GET    /objects?type=<name>         按类型列出 Objects
POST   /event-defs                  注册/更新 Event 类型（upsert，版本链）
GET    /event-defs                  列出所有 Event 类型
POST   /events                      发射事件
GET    /events/:id                  查询事件
GET    /events?ref=<id>             按 Object 查相关事件
POST   /projection-defs             注册/更新 Projection（upsert，版本链）
GET    /projection-defs             列出所有 Projection 定义
GET    /projections/:name?params    查询 Projection 值
POST   /reactions                   创建 Reaction
GET    /reactions                   列出所有 Reactions
DELETE /reactions/:id               删除 Reaction
GET    /health                      健康检查
GET    /ui                          管理界面
```

## Bindings 详解

**语法规则：**
- `$param` — `$` 开头引用 params 值
- 裸字符串 — 字面量

**SQL 翻译：**
每个 binding 变成 `JOIN event_refs ON property = ? AND ref_id = ?`

**特殊情况：**
空 bindings = 拉该类型全部事件（reducer 自行过滤）

## Expression 详解

**JSONata 表达式特性：**
- **输入变量：**
  - `state` — 当前值
  - `event` — 单条事件 context  
  - `params` — 投影参数
- **Event context 包含：**
  - `id`, `type` (hash), `timestamp`
  - payload 展开的所有字段
- **执行方式：** 逐条 dispatch，不是批量

## Reaction 触发链路详解

完整流程：

```
POST /events { type: "assigned", payload: {...} }
  ↓
解析名字 → hash
  ↓
校验 schema  
  ↓
INSERT events + event_refs
  ↓
SELECT projection_hash FROM projection_def_sources WHERE event_def_hash = ?
  ↓
对每个匹配的 projection：
  ↓
  SELECT reactions WHERE projection_def_hash = ?
  ↓
  对每个 reaction：
    ↓
    bindings 匹配（params → event_refs 查询）
    ↓
    重算 projection（lazy incremental reduce）
    ↓
    diff(old_value, new_value)
    ↓
    如果有变化：
      ↓
      webhook: POST webhook_url { old_value, new_value, params, event }
      或
      emit_event: POST /events { 
        type: emit_event_type, 
        payload: template(old, new, params, event) 
      }
```

---

## ID 策略总结

| 实体 | ID 类型 | 理由 |
|---|---|---|
| Object | INTEGER AUTOINCREMENT | 内部标识足够，外部引用通过事件 payload 记录 |
| Event | INTEGER AUTOINCREMENT | 严格递增，做增量边界，天然全序 |
| Reaction | INTEGER AUTOINCREMENT | 纯内部实体 |
| Def versions | content hash (TEXT) | 内容寻址，版本链语义需要 |
| Def names | name (TEXT) | 可变指针 |

**原则：** 实例层全部 integer（性能 + 精度），定义层保持 content hash（语义需要）。

---

*本文档作为 OGraph v2.4+ 的技术规范，供系统集成和 API 调用参考。*

*维护: 小墨 🖊️（KUMA Team）*