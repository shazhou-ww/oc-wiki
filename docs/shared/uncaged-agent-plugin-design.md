# Uncaged Agent 插件化设计：两个抽象，完整生命周期

!!! info "作者"
    沙洲 & 星月 🌙 | 2026-04-08

---

## 核心设计

Uncaged 的 Agent 插件化只需要**两个抽象**：

1. **Lifecycle Hooks** — Agent 生命周期各阶段的拦截点
2. **Context Middleware Chain** — 对 LLM 调用参数的上下文驱动变换链

这两个抽象覆盖了 Agent 从启动到关闭、从收到消息到返回响应的完整生命周期。

---

## 抽象 1：Lifecycle Hooks

11 个 hook 点，分四层：

```typescript
interface AgentLifecycleHooks {
  // ═══ 系统层 ═══
  on_startup(): void;
  on_shutdown(): void;

  // ═══ 会话层 ═══
  on_session_start(session: Session): void;
  on_session_end(session: Session): void;

  // ═══ 消息层 ═══
  on_message_received(msg: InboundMessage): InboundMessage | void;
  on_message_sending(msg: OutboundMessage): OutboundMessage | { cancel: true } | void;

  // ═══ 心跳 ═══
  on_heartbeat(ctx: HeartbeatContext): void;

  // ═══ 编排层 ═══
  before_llm_call(params: LlmCallParams): LlmCallParams | void;
  after_llm_call(response: LlmResponse): LlmResponse | void;
  before_tool_call(call: ToolCall): ToolCall | { block: true } | void;
  after_tool_call(result: ToolResult): ToolResult | void;
}
```

### 层次模型

```
系统层    on_startup ──── on_heartbeat (定时) ──── on_shutdown
              │                                        ▲
              ▼                                        │
会话层    on_session_start ────────────────── on_session_end
              │                                    ▲
              ▼                                    │
消息层    on_message_received ────────── on_message_sending
              │                                ▲
              ▼                                │
编排层    before_llm_call ──→ LLM ──→ after_llm_call
          before_tool_call ─→ Tool ─→ after_tool_call
```

每层关注不同粒度。插件**按需注册**，不需要实现全部 hook。

### Hook 语义

| Hook | 返回值语义 |
|:-----|:----------|
| 返回修改后的对象 | 替换原始输入（拦截并修改） |
| 返回 `void` / `undefined` | 不修改，继续执行 |
| 返回 `{ block: true }` | 阻止执行（仅 `before_tool_call`） |
| 返回 `{ cancel: true }` | 取消发送（仅 `on_message_sending`） |
| 抛异常 | 中断整个链路 |

多个插件注册同一 hook 时按优先级顺序执行，前一个的输出是后一个的输入（pipeline 模式）。

---

## 抽象 2：Context Middleware Chain

一组有序的中间件，每个基于当前上下文对 LLM 调用参数产生副作用：

```typescript
type ContextMiddleware = (
  ctx: OrchestratorContext,
  params: LlmCallParams,
) => LlmCallParams;
```

### OrchestratorContext

```typescript
interface OrchestratorContext {
  // 会话
  session: Session;
  user: User;

  // 对话
  messages: Message[];           // 当前对话历史
  lastToolResults: ToolResult[]; // 上一轮工具执行结果

  // Agent 配置
  agentConfig: AgentConfig;      // YAML 定义的 agent 配置
  availableTools: ToolDef[];     // 当前可用工具列表

  // 运行时
  turnIndex: number;             // 当前对话轮次
  parentContext?: OrchestratorContext;  // 嵌套调用时的父上下文
}
```

### LlmCallParams

```typescript
interface LlmCallParams {
  model: string;
  messages: LlmMessage[];
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  // ...其他 LLM API 参数
}
```

### 特征

- **有序执行** — 顺序可配置，有明确的优先级
- **纯函数式** — 输入 context + params，输出 params，无隐式副作用
- **可独立测试** — 每个 middleware 可以单独 mock context 测试
- **可组合** — 插件注册自己的 middleware，与核心 middleware 共存

### 注册

```typescript
// 核心自带的 middleware（不可移除，可覆盖）
orchestrator.use(buildConversationHistory, { priority: 0 });
orchestrator.use(truncateToContextWindow, { priority: 100 });

// 插件注册的 middleware
orchestrator.use(selectModelByPlan, { priority: 10 });
orchestrator.use(injectRAGContext, { priority: 50 });
orchestrator.use(applyThinkingMode, { priority: 60 });
```

执行顺序按 priority 升序。同 priority 按注册顺序。

---

## 插件注册

```typescript
interface AgentPlugin {
  id: string;
  name: string;
  version: string;

  hooks?: Partial<AgentLifecycleHooks>;
  middlewares?: Array<{
    fn: ContextMiddleware;
    priority?: number;  // 默认 50
  }>;
}

function registerPlugin(plugin: AgentPlugin): void;
```

---

## 示例

### Billing 插件

```typescript
registerPlugin({
  id: "billing",
  name: "Usage Billing",
  version: "1.0.0",
  hooks: {
    on_session_start(session) {
      initBillingSession(session.user);
    },
    before_llm_call(params) {
      if (getUserCredits(params) <= 0) {
        throw new InsufficientCreditsError();
      }
    },
    after_llm_call(response) {
      deductCredits(response.usage);
    },
    on_session_end(session) {
      finalizeBilling(session);
    },
  },
  middlewares: [{
    fn: (ctx, params) => ({
      ...params,
      model: ctx.user.plan === "pro" ? "claude-sonnet-4" : "claude-haiku-4",
    }),
    priority: 10,
  }],
});
```

### 内容安全插件

```typescript
registerPlugin({
  id: "content-safety",
  name: "Content Safety Filter",
  version: "1.0.0",
  hooks: {
    on_message_received(msg) {
      if (containsBlockedContent(msg.text)) {
        return { ...msg, blocked: true, reason: "policy_violation" };
      }
    },
    on_message_sending(msg) {
      return { ...msg, text: redactPII(msg.text) };
    },
    before_tool_call(call) {
      if (isDangerousTool(call.name)) {
        return { block: true };
      }
    },
  },
});
```

### RAG 插件

```typescript
registerPlugin({
  id: "rag",
  name: "Retrieval Augmented Generation",
  version: "1.0.0",
  middlewares: [{
    fn: async (ctx, params) => {
      const lastUserMsg = ctx.messages.findLast(m => m.role === "user");
      const docs = await vectorSearch(lastUserMsg.content);
      return {
        ...params,
        systemPrompt: params.systemPrompt + formatRetrievedDocs(docs),
      };
    },
    priority: 50,
  }],
});
```

### 监控插件

```typescript
registerPlugin({
  id: "monitoring",
  name: "Observability",
  version: "1.0.0",
  hooks: {
    on_startup() {
      initMetricsCollector();
    },
    on_heartbeat(ctx) {
      reportHealthMetrics(ctx);
    },
    after_llm_call(response) {
      recordLatency(response.model, response.timing);
      recordTokenUsage(response.model, response.usage);
    },
    after_tool_call(result) {
      recordToolExecution(result.toolName, result.duration, result.success);
    },
    on_shutdown() {
      flushMetrics();
    },
  },
});
```

---

## 设计决策

### 为什么 Hook 而不是事件？

Hook 是**同步拦截**（可以修改输入输出），事件是**异步通知**（只能观察）。Agent 编排需要拦截能力——比如 `before_llm_call` 要能改 model，`before_tool_call` 要能 block。纯事件做不到。

### 为什么 Middleware 是独立抽象？

`before_llm_call` hook 虽然也能修改 params，但它是"一锤子"的——一个 hook 做一件事。Middleware chain 是"流水线"的——多个 middleware 依次变换 params，每个只关注一个维度（选模型、裁历史、注入 context...）。两者互补：

- Hook = 拦截/决策（要不要做、做了之后怎么办）
- Middleware = 变换/准备（怎么准备 LLM 的输入）

### 为什么不用 OpenClaw 的 44-hook 模式？

OpenClaw 把 Provider 注册（catalog/auth/诊断）和 Orchestrator 运行时（params/stream/replay）混在同一个对象里，导致 hook 数量膨胀。我们做了关注点分离：

- Provider 注册 = 静态元数据声明（不在这个插件体系里）
- Agent 运行时 = 两个抽象（11 hooks + middleware chain）

分离后，运行时层更简洁、更易理解、更好测试。

---

*沙洲 & 星月 🌙 — 2026-04-08*
