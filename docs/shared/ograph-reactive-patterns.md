# OGraph 响应式计算模型

OGraph 不只是事件存储系统，而是一个分布式响应式计算模型。它基于三个核心原语：**Event**（事件）、**Projection**（投影）、**Reaction**（反应），构建了一套声明式的分布式计算范式。

## 核心概念

### Event：不可变事实

Event 是系统中的不可变事实，每个事件通过版本链锚定 schema：

```json
{
  "type": "task_created",
  "version": "v1.0",
  "data": {
    "task_id": "task-123",
    "title": "实现用户认证",
    "assignee": "alice",
    "project": "web-app"
  },
  "timestamp": "2026-04-12T10:30:00Z",
  "hash": "sha256:abc123..."
}
```

事件一旦写入就不可修改，但可以通过新事件表达状态变更：

```json
{
  "type": "task_status_changed",
  "version": "v1.0", 
  "data": {
    "task_id": "task-123",
    "from": "pending",
    "to": "in_progress"
  }
}
```

### Projection：本地归约

Projection 是从事件流计算状态的本地归约器，具有 **lazy** 和 **增量** 特性：

```javascript
// task_status projection
const task_status = {
  sources: [
    { type: "task_created", bindings: {}, expression: "(state, event) => event.data.status || 'pending'" },
    { type: "task_status_changed", bindings: {}, expression: "(state, event) => event.data.to" }
  ],
  initial: null
}
```

**Lazy**：只有在被查询时才计算  
**增量**：基于上次计算结果和新事件增量更新，不重放全部历史

### Reaction：跨边界事件路由

Reaction 监听 Projection 的值变化，当变化发生时触发副作用：

```javascript
const task_assignment_notification = {
  projection: "task_assignee",
  handler: "(old_value, new_value, context) => {
    if (new_value && new_value !== old_value) {
      emit_event('notification_required', {
        type: 'task_assigned',
        assignee: new_value,
        task_id: context.object_id
      });
    }
  }"
}
```

## 设计原则

### 事实不可变，解读可进化

- **事实**（Event）一旦发生就不能改变
- **解读**（Projection）可以随业务需求进化
- 同一组事实可以有多种不同的投影解读

### 名字是指针，hash 是锚点

- Object/Event 的名字（ID）是可变指针，用于引用
- Hash 是不变锚点，用于验证和去重
- 版本链通过 hash 建立，保证数据完整性

### Projection 是 lazy 增量 reduce

- **不是**实时物化视图：不会在每个事件到达时立即更新
- **是** lazy 计算：查询时按需计算到最新状态
- **是**增量 reduce：基于上次结果 + 新事件增量更新

### Reaction 是声明式管道

- **不是**命令式回调：不直接执行具体操作
- **是**声明式路由：描述"当 X 变化时应该发生 Y"
- 支持事件的扇出、转换、过滤

## Projection 多态 Sources

一个 Projection 可以消费多种事件类型，每种类型有独立的处理逻辑：

```javascript
const my_active_tasks = {
  sources: [
    {
      type: "task_assigned",
      bindings: { assignee: "$user_id" },
      expression: "(state, event) => [...(state || []), event.data.task_id]"
    },
    {
      type: "task_completed", 
      bindings: { assignee: "$user_id" },
      expression: "(state, event) => (state || []).filter(id => id !== event.data.task_id)"
    },
    {
      type: "task_cancelled",
      bindings: {},
      expression: "(state, event) => (state || []).filter(id => id !== event.data.task_id)"
    }
  ],
  initial: []
}
```

**执行流程**：
1. 引擎按时序获取所有匹配的事件
2. 根据事件类型 dispatch 到对应的 source
3. 用该 source 的 expression 更新 state

**职责分工**：
- **bindings**：SQL 层预筛选，减少查询规模
- **expression**：应用层归约逻辑，处理跨事件类型的复杂过滤

## Bindings：结构化查询优化

Bindings 将 Projection 参数转换为高效的 SQL 查询：

```javascript
// Projection 定义
{
  bindings: { 
    assignee: "$user_id",
    project: "web-app",
    status: "$task_status" 
  }
}

// 翻译为 SQL（简化版）
SELECT events.* FROM events 
JOIN event_refs ON events.id = event_refs.event_id
WHERE event_refs.key = 'assignee' AND event_refs.value = ?
  AND event_refs.key = 'project' AND event_refs.value = 'web-app'  
  AND event_refs.key = 'status' AND event_refs.value = ?
```

**语法规则**：
- `$param`：引用 Projection 的参数
- 裸字符串：字面量值
- 数组：IN 查询

**替代 JSONata filter 的原因**：Filter 的唯一价值是减少查询规模，必须能转换为高效的 SQL。复杂的应用逻辑在 expression 中处理。

## 模式：Projection-Driven Reaction Topology

**核心思想**：Projection 的值决定系统中应该存在哪些 Reaction。

### 例子：动态任务监听

```javascript
// 1. Projection: 我的活跃任务列表
const my_active_tasks = {
  sources: [...], // 如前所述
  initial: []
}

// 2. Reaction: 根据任务列表变化管理监听器
const manage_task_listeners = {
  projection: "my_active_tasks",
  handler: `(old_tasks, new_tasks) => {
    const old_set = new Set(old_tasks || []);
    const new_set = new Set(new_tasks || []);
    
    // 为新增任务创建状态监听 Reaction
    for (const task_id of new_set) {
      if (!old_set.has(task_id)) {
        create_reaction(\`task_\${task_id}_status_listener\`, {
          projection: "task_status",
          params: { task_id },
          handler: "(old_status, new_status) => emit_event('task_status_notification', { task_id, old_status, new_status })"
        });
      }
    }
    
    // 删除已完成任务的监听器
    for (const task_id of old_set) {
      if (!new_set.has(task_id)) {
        delete_reaction(\`task_\${task_id}_status_listener\`);
      }
    }
  }`
}
```

**类比**：类似 Kubernetes controller 的 reconciliation loop，系统根据期望状态（Projection 值）调整实际状态（Reaction 拓扑）。

**应用场景**：
- 动态订阅管理
- 资源生命周期管理  
- 权限控制的动态路由

## 模式：事件扇出（Event Fan-Out）

通用事件通过 Reaction 转换为更精确的 scoped 事件：

```javascript
// 通用事件
{
  type: "task_status_changed",
  data: { task_id: "task-123", assignee: "alice", from: "pending", to: "in_progress" }
}

// Reaction: 扇出为用户特定事件
const task_status_fanout = {
  projection: "task_assignee", // 获取任务的分配者
  handler: `(old_assignee, new_assignee, context, trigger_event) => {
    if (trigger_event.type === 'task_status_changed') {
      // 发出用户范围的事件
      emit_event('agent_task_updated', {
        agent_id: trigger_event.data.assignee,
        task_id: trigger_event.data.task_id,
        status_change: {
          from: trigger_event.data.from,
          to: trigger_event.data.to
        }
      });
    }
  }`
}
```

**价值**：
- 将宽泛事件转化为可精确绑定的事件
- 降低下游 Projection 的 bindings 复杂度
- 支持事件的语义转换和丰富

## 建模实例：Task 系统

### Object Types
```yaml
task:
  fields: [id, title, description, created_at]
  
agent: 
  fields: [id, name, email]
  
project:
  fields: [id, name, team]
```

### Event Types
```yaml
task_created:
  schema: { task_id, title, assignee?, project?, priority? }
  
task_assigned:
  schema: { task_id, assignee, assigned_by }
  
task_status_changed:
  schema: { task_id, from, to, changed_by }
  
task_commented:
  schema: { task_id, comment, author }
  
task_updated:
  schema: { task_id, field, old_value, new_value }
```

### Projections

```javascript
// 基础投影
const task_assignee = {
  sources: [
    { type: "task_created", bindings: {}, expression: "(s, e) => e.data.assignee || null" },
    { type: "task_assigned", bindings: {}, expression: "(s, e) => e.data.assignee" }
  ],
  initial: null
}

const task_status = {
  sources: [
    { type: "task_created", bindings: {}, expression: "(s, e) => e.data.status || 'pending'" },
    { type: "task_status_changed", bindings: {}, expression: "(s, e) => e.data.to" }
  ],
  initial: "pending"
}

const task_comment_count = {
  sources: [
    { type: "task_commented", bindings: {}, expression: "(s, e) => (s || 0) + 1" }
  ],
  initial: 0
}

// 聚合投影：完整任务快照
const task_snapshot = {
  sources: [
    { type: "task_created", bindings: {}, expression: `(state, event) => ({
      ...state,
      id: event.data.task_id,
      title: event.data.title,
      assignee: event.data.assignee,
      project: event.data.project,
      status: event.data.status || 'pending',
      created_at: event.timestamp
    })` },
    { type: "task_assigned", bindings: {}, expression: `(state, event) => ({
      ...state,
      assignee: event.data.assignee
    })` },
    { type: "task_status_changed", bindings: {}, expression: `(state, event) => ({
      ...state,
      status: event.data.to
    })` }
  ],
  initial: {}
}

// 多态投影：我的活跃任务
const my_active_tasks = {
  sources: [
    {
      type: "task_created",
      bindings: { assignee: "$user_id" },
      expression: "(state, event) => [...(state || []), event.data.task_id]"
    },
    {
      type: "task_assigned", 
      bindings: { assignee: "$user_id" },
      expression: `(state, event) => {
        const tasks = state || [];
        return tasks.includes(event.data.task_id) ? tasks : [...tasks, event.data.task_id];
      }`
    },
    {
      type: "task_status_changed",
      bindings: {},  // 空 bindings，在 expression 中过滤
      expression: `(state, event) => {
        if (['completed', 'cancelled'].includes(event.data.to)) {
          return (state || []).filter(id => id !== event.data.task_id);
        }
        return state;
      }`
    }
  ],
  initial: []
}
```

### Reactions

```javascript
// 任务分配通知
const assignment_notification = {
  projection: "task_assignee",
  handler: `(old_assignee, new_assignee, context) => {
    if (new_assignee && new_assignee !== old_assignee) {
      emit_event('notification_required', {
        type: 'task_assigned',
        recipient: new_assignee,
        task_id: context.object_id,
        message: \`您被分配了新任务：\${context.object_id}\`
      });
    }
  }`
}

// 状态变更通知
const status_change_notification = {
  projection: "task_status",
  handler: `(old_status, new_status, context) => {
    if (new_status !== old_status) {
      emit_event('task_status_notification', {
        task_id: context.object_id,
        status_change: { from: old_status, to: new_status },
        timestamp: new Date().toISOString()
      });
    }
  }`
}
```

## 方法论总结

### 核心分工
- **Projection**：管理状态，提供当前值的查询接口
- **Reaction**：管理副作用管道，响应状态变化执行路由

### 自举模式
Projection 的 Reaction 可以管理其他 Reaction 的生命周期：

```javascript
const reaction_topology_manager = {
  projection: "active_user_sessions", 
  handler: `(old_sessions, new_sessions) => {
    // 为新会话创建专属通知 Reaction
    // 为结束会话删除对应 Reaction
  }`
}
```

### diff(old_value, new_value) 模式
Reaction handler 的核心操作是对比新旧值的差异：

```javascript
const handler = `(old_value, new_value) => {
  const added = new_value.filter(x => !old_value.includes(x));
  const removed = old_value.filter(x => !new_value.includes(x));
  
  added.forEach(item => handle_added(item));
  removed.forEach(item => handle_removed(item)); 
}`
```

### 事件衍生策略
- **简单场景**：bindings 空 + reducer 过滤，在 expression 中处理跨类型逻辑
- **复杂场景**：通用事件 → Reaction 扇出 → 精确 scoped 事件，便于下游绑定

### 渐进式复杂度
1. **起步**：简单的 Event → Projection → 查询
2. **扩展**：多态 sources，在 reducer 中处理复杂逻辑  
3. **优化**：Reaction 扇出，将复杂 reducer 拆解为简单管道
4. **高级**：Projection-driven topology，动态调整计算拓扑

OGraph 的设计哲学是**声明式**和**组合式**的：通过组合简单的原语（Event-Projection-Reaction），构建出复杂而高效的分布式响应式系统。