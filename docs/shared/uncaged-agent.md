---
title: "Uncaged Agent — 能力虚拟内存的第一个消费者"
description: "Sigil-native AI Agent：动态工具加载、上下文压缩自动卸载、能力即虚拟内存"
date: 2026-04-03
authors: [小橘 🍊]
tags: [uncaged, sigil, agent, architecture]
---

# Uncaged Agent 🔓

**Sigil-native AI Agent** — 一个能自主发现、创建、使用 serverless 能力的 AI agent。

仓库：[oc-xiaoju/uncaged](https://github.com/oc-xiaoju/uncaged)  
Bot：[@scottwei_doudou_bot](https://t.me/scottwei_doudou_bot)（豆豆）  
运行环境：Cloudflare Workers  

## 核心洞察：Tools = f(Chat History)

传统 agent 的工具列表是静态的——启动时注册 N 个 tools，运行时永远是这 N 个。Uncaged 不一样：

> **tools 列表是 chat history 的纯函数。**

每一轮构建 LLM request 时，从 history 中提取所有 `sigil_query` 的返回结果和 `sigil_deploy` 的调用记录，将其中的 capability 动态映射为 LLM tools。

这意味着：
- **LLM 调 `sigil_query("hash")`** → 返回结果出现在 history → 下一轮 `cap_sha256_hash` 自动成为可调用 tool
- **上下文压缩** → 旧的 query 结果从 history 中被压缩掉 → 对应的 tool 自动消失
- **再次需要时** → LLM 重新 `sigil_query` → tool 重新出现

不需要任何显式的 load/unload 机制。

## 能力虚拟内存

这套机制天然实现了虚拟内存的语义：

| 操作系统 | Uncaged |
|---------|---------|
| Page fault（缺页中断）| `sigil_query` 发现能力 → tool 出现 |
| Page eviction（页面淘汰）| 上下文压缩 → tool 消失 |
| Working set（工作集）| 当前 tools 列表 |
| Physical memory（物理内存）| Context window 大小 |
| Disk（磁盘）| Sigil KV（永久存储所有能力）|
| TLB | 单轮的 tools 快照 |

而且 tools 本身占用 context window 的 token，所以 **context window 大小天然约束了 working set 上限** ——就像物理内存约束 working set 一样。

## 架构

```
Telegram
   ↓ Webhook
CF Worker (Uncaged)
   ├── Chat History (KV) ← 多轮对话持久化
   ├── LLM (DashScope/Qwen)
   │     ├── Static tools: sigil_query, sigil_deploy
   │     └── Dynamic tools: cap_* (从 history 派生)
   └── Sigil (sigil.shazhou.work)
         └── query / deploy / run / inspect
```

### Agentic Loop

每轮处理：

1. 从 KV 加载 chat history
2. 检查是否需要上下文压缩（> 40 条消息）
3. 从 history 中 **动态提取** capability → 生成 `cap_*` tools
4. 拼装 `[static_tools + dynamic_tools]` + messages → 发给 LLM
5. LLM 返回 tool calls → 执行 → 结果反馈 → 循环（最多 6 轮）
6. 最终文本回复 → 保存 history → 发 Telegram

### 错误恢复

工具调用失败时，错误信息作为 tool result 返回给 LLM。LLM 可以：
- 修正参数重试
- 换一种策略
- 告诉用户需要什么信息

不会因为一次工具调用失败就整体崩溃。

## 上下文压缩

当 history 超过 40 条消息：
- 保留第一条 user message + 最近 10 条
- 中间的 tool call 链被丢弃
- 孤儿 tool result（没有对应 assistant tool_call）被清理

**关键副作用**：被丢弃的 `sigil_query` 结果中的 capability 从 tools 中消失。这不是 bug，**这就是自动卸载机制**。

## Static vs Dynamic Tools

| 类型 | 工具 | 生命周期 |
|------|------|---------|
| Static | `sigil_query` | 永远可用 |
| Static | `sigil_deploy` | 永远可用 |
| Dynamic | `cap_{name}` | 随 history 中的 query/deploy 结果出现/消失 |

Dynamic tool 的命名规则：`cap_` + capability 名（`-` 替换为 `_`）。例如 capability `sha256-hash` → tool `cap_sha256_hash`。

## CF Worker 间调用（Error 1042）

Uncaged 和 Sigil 都是 CF Worker。同 account 的 Worker 不能通过 `.workers.dev` 子域名互相 `fetch()`（CF error 1042，防止递归调用）。

解决方案：给 Sigil 绑定 custom domain `sigil.shazhou.work`。不同 zone 的请求不受此限制。

## 典型交互

### 发现已有能力并使用

```
用户: 帮我把 hello world 编码成 base64
豆豆: [sigil_query("base64") → 找到 encode → cap_encode({text:"hello world", format:"base64"})]
      base64 编码结果: aGVsbG8gd29ybGQ=
```

### 从零创建能力

```
用户: 做个 SHA-256 hash 计算的能力
豆豆: [sigil_query("sha256") → 没找到 → sigil_deploy(sha256-hash, ...) → 确认]
      🔮 已创建 sha256-hash！告诉我你想 hash 什么文本。

用户: hash一下 hello world
豆豆: [cap_sha256_hash({text:"hello world"}) → 直接调用]
      SHA-256: b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9
```

## 项目文件

```
src/
├── index.ts        — CF Worker 入口（webhook + health check）
├── telegram.ts     — Telegram 消息处理
├── llm.ts          — 动态 tool 加载 + agentic loop
├── sigil.ts        — Sigil API 客户端
└── chat-store.ts   — KV chat history + 压缩
```

## 相关链接

- [Sigil 能力注册表](../sigil-capability-registry/)
- [Sigil Backend 与 LRU 调度](../sigil-backend-lru/)
- [Uncaged 能力虚拟化](../uncaged-capability-virtualization/)

---

*小橘 🍊（NEKO Team）· 2026-04-03*
