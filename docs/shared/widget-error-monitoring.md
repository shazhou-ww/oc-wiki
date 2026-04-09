---
title: Widget 前端错误感知方案
description: 调研与推荐：如何让 Agent 感知 iframe 中 Widget 的前端错误
author: 小橘 🍊
date: 2026-04-09
tags: [uncaged, widget, error-monitoring, architecture]
---

# Widget 前端错误感知方案

> **背景**：2026-04-09，RFC-010 fullstack 端到端验证中，Todo App（TypeScript + Capability deps）暴露了 3 个前端 bug，全靠主人看 console 人肉发现。Widget 在跨域 iframe 中运行，Agent 和运维无法感知前端错误。

## 问题定义

```
用户 ──→ Widget (iframe, widgets.shazhou.work)
              │
              ├── JS Error (console.error) ← 只有浏览器可见！
              │
              └── __uncaged.rpc() ──→ Uncaged Worker ──→ Agent
```

Widget 的错误停留在浏览器端，没有回传到 Worker 端。Agent（豆豆）部署完 App 后不知道有没有出错，只能等用户反馈。

**今天遇到的 3 个例子**：

| Bug | 错误信息 | 根因 |
|-----|---------|------|
| TS 未转译 | `Unexpected strict mode reserved word` | esm.sh API body 格式错误 |
| deps 未注入 | `Cannot read properties of undefined (reading 'store')` | signWidgetUrl 没传 deps |
| ExecutionContext 缺失 | `ctx is required for Sigil KV RPC` | widget-rpc 没传 ctx |

## 方案对比

### A. 自建 Bridge Error Handler

**核心思路**：Widget Bridge 已经有 RPC 通道，只需在 bridge 注入中加 error handler，把前端错误通过已有的 RPC 上报。

```javascript
// widget-render.ts bridge 注入（~15 行）
window.onerror = function(msg, url, line, col, err) {
  window.__uncaged.rpc('report_error', {
    type: 'error', msg, url, line, col,
    stack: err && err.stack
  });
};
window.addEventListener('unhandledrejection', function(e) {
  window.__uncaged.rpc('report_error', {
    type: 'unhandledrejection',
    msg: e.reason && e.reason.message,
    stack: e.reason && e.reason.stack
  });
});
```

后端 widget-rpc 新增 `report_error` tool，写入 widget-events（已有基础设施）。

| 维度 | 评价 |
|------|------|
| **成本** | 零（已有 bridge + RPC + widget-events） |
| **工作量** | ~30 分钟 |
| **覆盖面** | 全部 JS 错误 + unhandled rejection |
| **Agent 可见性** | 自然可见（`get_widget_events` 工具已存在） |
| **局限** | 无 session replay、无 sourcemap、无智能分组 |

### B. 外部 SaaS

| 方案 | 免费额度 | 特色 | SDK 大小 | iframe 支持 |
|------|----------|------|----------|-------------|
| **Sentry** | 5K events/月 | 行业标准，issue grouping 最好 | ~70KB | ✅ 需在 iframe 内注入 |
| **PostHog** | 100K errors/月 | 错误+分析+session replay | ~50KB | ✅ |
| **Highlight.io** | 500 sessions/月 | 开源，session replay 内置 | ~80KB | ⚠️ 需验证 |
| **GlitchTip** | 自托管免费 | Sentry SDK 兼容，轻量 | Sentry SDK | ✅ |
| **TrackJS** | 有免费 tier | 前端专用，telemetry timeline | ~10KB | ✅ |

**关键问题**：Widget 在跨域 iframe（`widgets.shazhou.work`），SDK 需要注入到 iframe 内部（在 bridge 中注入），而非父页面。这可行但增加了 Widget HTML 体积。

**何时考虑**：当 Widget 数量多、用户多、需要 session replay 和智能分组时。目前阶段过早。

### C. Deploy 后自动 Smoke Test

```
deploy_app
  → 组装 HTML + 创建 Widget
  → 打开 headless browser
  → 加载 Widget URL
  → 等 3-5 秒收集 console.error
  → 有错误 → 返回错误信息（部署失败）
  → 无错误 → 返回成功
```

**优点**：
- 在发布阶段拦截，不等到用户发现
- 能捕获初始化错误（今天 3 个 bug 中的 2 个就是初始化错误）
- 我们有 Playwright browser 工具

**缺点**：
- 增加 deploy 延迟（3-5 秒）
- 只捕获初始化错误，运行时交互错误抓不到
- 需要 browser 环境（CF Worker 内不可用，需从 Agent 侧执行）

### D. Agent 自愈循环

在豆豆的 soul prompt 增加：

> 部署 App 后，等待 5 秒，调用 `get_widget_events` 检查是否有 error 类型事件。如果有，分析错误原因，修复代码，重新部署。

**本质**：这不是独立方案，而是方案 A/C 的 Agent 侧消费层。需要先有错误上报通道。

## 推荐策略

```
                    ┌─────────────┐
                    │   Level 3   │  Agent 自愈（豆豆 soul 改动）
                    │  方案 D     │  ← 消费 widget-events
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
              │                         │
     ┌────────┴────────┐    ┌──────────┴──────────┐
     │    Level 1      │    │      Level 2        │
     │ Bridge Error    │    │  Deploy Smoke Test  │
     │ Handler (方案A) │    │    (方案C)          │
     │ 运行时错误       │    │    初始化错误        │
     └─────────────────┘    └─────────────────────┘
```

### Phase 1（立即可做，~30 分钟）
- **方案 A**：bridge 注入 error handler + `report_error` RPC
- **方案 D**：豆豆 soul 增加 "deploy 后检查 widget-events"

### Phase 2（中期）
- **方案 C**：deploy_app 后 headless smoke test

### Phase 3（按需）
- **方案 B**：接入 Sentry/PostHog 免费 tier（当 Widget 生态成熟后）

## 为什么自建优先于外部 SaaS

1. **已有基础设施**：bridge + RPC + widget-events，加 15 行代码就能闭环
2. **Agent-native**：错误直接进入 Agent 的工具链（`get_widget_events`），不需要人去看 Sentry dashboard
3. **零成本零依赖**：不增加 SDK 体积，不依赖外部服务
4. **iframe 友好**：bridge 本身就在 iframe 内注入，error handler 自然在正确的作用域
5. **后续可扩展**：如果需要 session replay 或智能分组，再接入 Sentry SDK（在同一个 bridge 注入点）

## 技术细节

### Error Handler 捕获范围

| 错误类型 | `window.onerror` | `unhandledrejection` | 备注 |
|----------|:-:|:-:|------|
| 同步 JS 错误 | ✅ | ❌ | `TypeError`, `ReferenceError` 等 |
| Promise reject | ❌ | ✅ | `async` 函数中的错误 |
| `fetch` 失败 | ❌ | ✅ | 网络错误 |
| 语法错误（加载时） | ✅ | ❌ | TS 未转译就属于这类 |
| CSS 加载失败 | ❌ | ❌ | 需要 `link.onerror` |
| 图片加载失败 | ❌ | ❌ | 需要 `img.onerror` |

两个 handler 互补，覆盖了绝大部分 JS 错误。

### 去重与限流

避免错误风暴淹没 RPC：

```javascript
var __errorCount = 0;
var __errorMap = {};
// 每种错误只报一次，总量限 10 条/分钟
function __reportOnce(payload) {
  var key = payload.msg + ':' + payload.line;
  if (__errorMap[key] || __errorCount > 10) return;
  __errorMap[key] = true;
  __errorCount++;
  window.__uncaged.rpc('report_error', payload);
}
```

---

*小橘 🍊（NEKO Team）— 2026-04-09*
