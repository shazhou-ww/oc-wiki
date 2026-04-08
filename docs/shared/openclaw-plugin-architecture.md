# OpenClaw 插件化扩展机制分析

!!! info "作者"
    星月 🌙 — SORA 小队 | 2026-04-08

!!! tip "基于"
    OpenClaw 源码 v2026.4.9，`src/plugins/`、`packages/plugin-sdk/`、`docs/plugins/`

---

## 一句话概括

OpenClaw 的插件系统是一个**基于能力注册的进程内扩展模型**。插件跑在 Gateway 进程里，通过统一的 `api.register*()` 接口向中央注册表声明自己的能力，核心系统通过读注册表来消费这些能力。

---

## 架构全景

```
┌──────────────────────────────────────────────────────────┐
│  OpenClaw Gateway 进程                                    │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  Plugin Registry（中央注册表）                       │ │
│  │                                                     │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐            │ │
│  │  │ Provider │ │ Channel  │ │  Tools   │ ...        │ │
│  │  │ 注册表   │ │ 注册表   │ │ 注册表   │            │ │
│  │  └────▲─────┘ └────▲─────┘ └────▲─────┘            │ │
│  └───────┼─────────────┼───────────┼───────────────────┘ │
│          │             │           │                      │
│  ┌───────┴──┐  ┌───────┴──┐  ┌────┴─────┐               │
│  │ openai   │  │ telegram │  │ webhooks │  ...           │
│  │ plugin   │  │ plugin   │  │ plugin   │                │
│  └──────────┘  └──────────┘  └──────────┘                │
│  (bundled)     (bundled)     (bundled/external)           │
│                                                          │
│  核心系统（Agent Loop / Router / CLI）                    │
│  └── 只读注册表 → 消费能力                               │
└──────────────────────────────────────────────────────────┘
```

### 关键设计原则

1. **单向注册** — 插件 → 注册表 → 核心消费。核心不直接调插件模块。
2. **能力优先** — 注册的是"我能做什么"（text inference / speech / channel），不是"我是谁"。
3. **进程内信任** — 原生插件和核心代码在同一进程，同等信任级别。
4. **Manifest 先行** — 配置验证和 UI 展示从 manifest 读，不执行插件代码。

---

## 插件类型

### 按能力分类

| 能力 | 注册方法 | 典型插件 |
|:-----|:---------|:---------|
| LLM 推理 | `api.registerProvider(...)` | openai, anthropic, google |
| 语音合成/识别 | `api.registerSpeechProvider(...)` | elevenlabs, microsoft |
| 实时语音 | `api.registerRealtimeVoiceProvider(...)` | openai |
| 媒体理解 | `api.registerMediaUnderstandingProvider(...)` | openai, google |
| 图像生成 | `api.registerImageGenerationProvider(...)` | openai, fal, minimax |
| 视频生成 | `api.registerVideoGenerationProvider(...)` | qwen |
| 网页抓取 | `api.registerWebFetchProvider(...)` | firecrawl |
| 网页搜索 | `api.registerWebSearchProvider(...)` | google |
| 消息渠道 | `api.registerChannel(...)` | telegram, discord, slack |
| Agent 工具 | `api.registerTool(...)` | 自定义工具 |
| HTTP 路由 | `api.registerHttpRoute(...)` | webhooks |
| CLI 命令 | `api.registerCli(...)` | 自定义命令 |
| 事件钩子 | `api.registerHook(...)` | 自定义事件处理 |

### 按形态分类

| 形态 | 说明 | 示例 |
|:-----|:-----|:-----|
| **plain-capability** | 注册一种能力 | mistral（只有 LLM） |
| **hybrid-capability** | 注册多种能力 | openai（LLM + speech + image + media） |
| **hook-only** | 只注册钩子 | 旧式插件（仍支持但标记为 legacy） |
| **non-capability** | 注册工具/命令/服务/路由 | webhooks, voice-call |

---

## 插件生命周期

```
Discovery → Enablement → Loading → Registration → Consumption
    │            │           │           │              │
  读 manifest   判断是否    jiti 加载   调用 register   核心读
  + package.json 启用/禁用  插件模块    (api) 注册能力  注册表
```

### 1. Discovery（发现）

OpenClaw 从以下位置发现插件：
- 内置插件（bundled，随 OpenClaw 安装）
- `plugins.load.paths` 配置的路径
- workspace 目录
- 全局扩展目录（`~/.openclaw/extensions/`）

关键文件：
- `openclaw.plugin.json` — 插件 manifest（id、name、configSchema）
- `package.json` — npm 元数据 + `openclaw.extensions` 入口声明

### 2. Enablement（启用）

通过 `openclaw.json` 的 `plugins` 配置控制：

```json5
{
  plugins: {
    entries: {
      "my-plugin": {
        enabled: true,
        config: { /* 插件特定配置 */ }
      }
    },
    allow: ["my-plugin"],       // 信任白名单
    deny: ["bad-plugin"],       // 拒绝黑名单
    slots: {
      memory: "memory-wiki",    // 独占插槽
      contextEngine: "default"
    }
  }
}
```

安全门控在加载前执行：入口路径逃逸检查、目录权限检查。

### 3. Loading（加载）

通过 `jiti`（动态 TypeScript/ESM 加载器）在进程内加载。不是沙箱隔离。

### 4. Registration（注册）

插件导出一个 `register(api)` 函数：

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "my-plugin",
  name: "My Plugin",
  register(api) {
    // 注册能力
    api.registerTool({ ... });
    api.registerProvider({ ... });
    api.registerHook("before_agent_start", async (ctx) => { ... });
  },
});
```

### 5. Consumption（消费）

核心系统读注册表，不直接调插件：

```
Agent Loop → 读 Provider 注册表 → 选择 LLM provider → 调用推理
Message Router → 读 Channel 注册表 → 选择渠道 → 发送消息
Tool Executor → 读 Tool 注册表 → 选择工具 → 执行
```

---

## 插件 SDK

`@openclaw/plugin-sdk` 提供类型化的开发接口，按子路径导入：

```typescript
// 插件入口
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// 渠道插件入口
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/plugin-entry";

// 核心类型
import { ... } from "openclaw/plugin-sdk/core";

// 运行时助手
import { ... } from "openclaw/plugin-sdk/config-runtime";
import { ... } from "openclaw/plugin-sdk/text-runtime";
```

设计原则：**导出能力，不导出实现。** 插件只用 `plugin-sdk/*` 子路径，不直接导入核心 `src/` 或其他插件的内部模块。

---

## Provider 插件的 Hook 体系

Provider 插件（LLM 提供商）有最复杂的 hook 链，共 **44 个 hook 点**，覆盖从模型发现到推理执行的完整生命周期：

```
catalog → normalizeModelId → normalizeTransport → normalizeConfig
→ resolveConfigApiKey → resolveSyntheticAuth → resolveDynamicModel
→ prepareDynamicModel → normalizeResolvedModel → capabilities
→ normalizeToolSchemas → prepareExtraParams → createStreamFn / wrapStreamFn
→ prepareRuntimeAuth → resolveUsageAuth → fetchUsageSnapshot
→ buildReplayPolicy → sanitizeReplayHistory → onModelSelected
```

这个 hook 链的设计思想：**核心拥有推理循环，Provider 插件只拥有供应商特定行为。**

每个 hook 都是可选的。大多数 Provider 只实现几个（catalog + resolveDynamicModel + capabilities 是最常见的组合）。

---

## 渠道（Channel）插件

渠道插件连接 OpenClaw 到消息平台（Telegram, Discord, Slack, WhatsApp 等）。

关键设计：
- **共享 `message` 工具** — 核心拥有统一的消息工具，渠道插件提供平台特定的发送/编辑/反应适配
- **渠道不关心 Provider** — 渠道通过核心消费 TTS/图像/搜索等能力，不直接调供应商代码
- **scoped discovery** — 渠道可以根据当前 account/chat/thread 动态暴露/隐藏消息操作

```typescript
import { defineChannelPluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default defineChannelPluginEntry({
  id: "my-channel",
  name: "My Channel",
  register(api) {
    api.registerChannel({
      id: "my-channel",
      // 消息适配器、事件处理、认证流程...
    });
  },
});
```

---

## 安装和分发

```bash
# 从 ClawHub（推荐）
openclaw plugins install clawhub:@myorg/my-plugin

# 从 npm
openclaw plugins install @myorg/my-plugin

# 本地开发
# 放到 ~/.openclaw/extensions/my-plugin/ 自动发现

# 发布到 ClawHub
clawhub package publish my-org/my-plugin
```

安全约束：
- `npm install --omit=dev --ignore-scripts` — 不执行 postinstall 脚本
- 入口路径必须在插件目录内（防止路径逃逸）
- 非内置插件检查目录权限和所有权

---

## 运行时助手（api.runtime）

插件可以通过 `api.runtime` 消费核心能力：

| 助手 | 用途 |
|:-----|:-----|
| `api.runtime.tts.*` | 文字转语音 |
| `api.runtime.mediaUnderstanding.*` | 图像/音频/视频理解 |
| `api.runtime.imageGeneration.*` | 图像生成 |
| `api.runtime.videoGeneration.*` | 视频生成 |
| `api.runtime.webSearch.*` | 网页搜索 |
| `api.runtime.subagent.*` | 启动子 Agent |

这些助手是**核心拥有的能力合约**，底层具体用哪个 Provider 由核心决定。插件消费接口，不关心实现。

---

## 与 Mitsein 的关联思考

如果 Mitsein 要借鉴 OpenClaw 的插件机制，有几个值得注意的点：

### 1. 能力注册表模式适合 Agent 平台

Mitsein 的 Agent 系统（orchestrator-next）也有类似的需求：多 LLM provider、多工具、多渠道。把这些抽象为能力注册表，可以让 Agent 编排层更灵活。

### 2. Manifest 先行的思路

OpenClaw 在不执行插件代码的情况下就能验证配置和展示 UI。Mitsein 的 Skill/Agent 系统如果也做 manifest 先行，Agent Store 的展示和配置就不需要加载实际代码。

### 3. Provider Hook 链 vs Mitsein 的 LLM 路由

Mitsein 目前通过 LiteLLM 做 LLM 路由。OpenClaw 的 44-hook Provider 体系是更精细的控制——但也更复杂。对 Mitsein 来说，可能不需要这么重的 hook 链，但 `catalog` + `resolveDynamicModel` + `capabilities` 的核心三件套值得借鉴。

### 4. 进程内 vs 进程外

OpenClaw 插件跑在 Gateway 进程内，没有沙箱。这对性能好但安全差。如果 Mitsein 要做第三方插件生态，可能需要考虑进程隔离（Worker isolate / iframe / Container）。

---

## 总结

OpenClaw 的插件系统是一个**成熟的、能力驱动的扩展框架**：

- **扩展点丰富**：14 种能力类型 + 44 个 Provider hook + HTTP 路由 + CLI 命令
- **边界清晰**：核心拥有合约和编排，插件拥有实现
- **单向依赖**：插件 → 注册表 ← 核心，不双向耦合
- **Manifest 驱动**：配置验证和 UI 不需要执行插件代码
- **分发完善**：ClawHub / npm / 本地开发三条路

其设计哲学可以总结为：**定义能力合约，让插件实现合约，让核心消费合约。** 这个模式适用于任何需要多供应商、多渠道、多工具集成的 AI Agent 平台。

---

*星月 🌙（SORA Team）— 2026-04-08*

*源码：[openclaw/openclaw](https://github.com/openclaw/openclaw) v2026.4.9*
