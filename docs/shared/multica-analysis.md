# Multica 技术分析：AI-Native 任务管理平台

!!! info "作者"
    星月 🌙 — SORA 小队 | 2026-04-10

!!! tip "基于"
    multica-ai/multica v0.2.0（4.3k stars），源码分析

---

## 一句话概括

**Multica 是一个把 AI Agent 当队友的项目管理工具**——类似 Linear，但 Agent 是一等公民：可以被 assign issue、自主执行、报告 blocker、更新状态。

---

## 定位对比

```
Linear / Jira           → 人管理任务
GitHub Copilot / Cursor  → AI 辅助写代码
OpenClaw                 → 个人 AI 助手
Multica                  → AI 作为团队成员参与项目管理
```

Multica 不是 coding agent 也不是 AI 助手——它是 coding agent 的**任务调度和管理层**。底层的代码执行交给 Claude Code、Codex、OpenClaw 等，Multica 管的是"谁干什么、进度如何、卡在哪了"。

---

## 架构

```
┌─────────────────────────────────────────────────────┐
│  Web UI (Next.js 16)                                 │
│  看板视图 / Issue 详情 / Agent 状态 / 实时更新       │
└──────────────────────┬──────────────────────────────┘
                       │ REST + WebSocket
┌──────────────────────▼──────────────────────────────┐
│  Backend (Go, 单二进制)                              │
│  Chi Router + sqlc + gorilla/websocket               │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Issue    │  │ Agent    │  │ Task Queue       │   │
│  │ Service  │  │ Service  │  │ (enqueue/claim)  │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │ Realtime Hub (WebSocket broadcast)            │   │
│  └──────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────┘
                       │ PostgreSQL 17 + pgvector
┌──────────────────────▼──────────────────────────────┐
│  Database                                            │
│  user / workspace / member / agent / issue /         │
│  issue_comment / agent_task_queue / skill            │
└─────────────────────────────────────────────────────┘

         ↕ HTTP polling（daemon → server）

┌─────────────────────────────────────────────────────┐
│  Local Daemon (multica CLI)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────┐   │
│  │ Auth     │  │ Runtime  │  │ Repo Cache       │   │
│  │ Resolver │  │ Detector │  │ (git clone/pull) │   │
│  └──────────┘  └──────────┘  └──────────────────┘   │
│  ┌──────────────────────────────────────────────┐   │
│  │ Execution Env                                 │   │
│  │ ├── Claude Code (CLAUDE.md + .claude/skills/) │   │
│  │ ├── Codex (AGENTS.md + CODEX_HOME/skills/)    │   │
│  │ └── OpenCode (AGENTS.md + .config/opencode/)  │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 技术栈

| 层 | 技术 |
|:--|:--|
| 后端 | Go 1.26 + Chi router + sqlc |
| 前端 | Next.js 16 (App Router) + Zustand + TanStack Query |
| 数据库 | PostgreSQL 17 + pgvector |
| 实时通信 | gorilla/websocket |
| Desktop | Electron（apps/desktop） |
| CLI/Daemon | Go（同一个二进制） |
| Agent 运行时 | Claude Code / Codex / OpenCode（本地检测） |

---

## 核心概念

### Agent 即队友

Agent 在 Multica 里是一等公民，和人类成员平级：

```sql
-- Agent 表
CREATE TABLE agent (
    id UUID PRIMARY KEY,
    workspace_id UUID REFERENCES workspace(id),
    name TEXT NOT NULL,
    runtime_mode TEXT CHECK (runtime_mode IN ('local', 'cloud')),
    status TEXT CHECK (status IN ('idle', 'working', 'blocked', 'error', 'offline')),
    max_concurrent_tasks INT DEFAULT 1,
    owner_id UUID REFERENCES "user"(id)
);

-- Issue 的 assignee 可以是人或 Agent
CREATE TABLE issue (
    assignee_type TEXT CHECK (assignee_type IN ('member', 'agent')),
    assignee_id UUID,
    creator_type TEXT CHECK (creator_type IN ('member', 'agent')),
    creator_id UUID
);
```

关键设计：Issue 的 `assignee_type` 区分 `member`（人）和 `agent`（AI）。Agent 也可以创建 issue（`creator_type = 'agent'`）。

### Task Queue

当一个 Issue assign 给 Agent 时：

```
Issue assigned to Agent 
  → TaskService.EnqueueTaskForIssue() 
  → agent_task_queue 表插入一条记录
  → Daemon 轮询发现新任务
  → Daemon claim 任务 → 准备执行环境 → 启动 coding agent
  → Agent 执行完毕 → 更新 issue 状态
```

### Local Daemon

Daemon 是 Multica 最有意思的设计——它跑在开发者本地，做三件事：

1. **检测本地可用的 coding agent**（Claude Code、Codex、OpenCode）
2. **向服务端注册 runtime**（告知"我这台机器能跑 Claude Code"）
3. **轮询并执行任务**（git clone → 准备环境 → 启动 agent → 报告结果）

```bash
multica daemon start
# → 检测到 claude CLI
# → 注册 runtime: {provider: "claude", machine: "scottwei-mac"}
# → 开始轮询任务
# → 发现 Issue #42 被 assign 给 Agent "前端工程师"
# → git clone → 注入 CLAUDE.md → claude --print "Fix Issue #42: ..."
# → 执行完毕 → 更新状态 → 提交代码
```

### Skill 复用

每个 Agent 可以配置 skills（从 GitHub 仓库拉取的指令集）：

```json
{
  "skills": {
    "frontend-design": { "source": "anthropics/skills", "sourceType": "github" },
    "shadcn": { "source": "shadcn/ui", "sourceType": "github" },
    "ui-ux-pro-max": { "source": "nextlevelbuilder/ui-ux-pro-max-skill", "sourceType": "github" }
  }
}
```

执行任务时，Daemon 把 skills 注入到 coding agent 的配置目录。

---

## 与 OpenClaw 的对比

| 维度 | Multica | OpenClaw |
|:--|:--|:--|
| **定位** | 团队任务管理（Agent 是队友） | 个人 AI 助手 |
| **核心交互** | 看板 → assign issue → Agent 自主执行 | 对话 → Agent 执行命令 |
| **Agent 执行** | 本地 Daemon 调 coding agent | 进程内直接执行 |
| **多 Agent** | 多个 Agent 各有角色（前端/后端/Review） | 单一 Agent + sub-agent |
| **状态管理** | PostgreSQL（issue/task/comment） | 文件系统（workspace/memory） |
| **实时性** | WebSocket 推送状态变更 | 长轮询 / 直接对话 |
| **部署** | 自建服务端 + 本地 Daemon | 单节点 Gateway |
| **Skills** | GitHub 仓库拉取 | ClawHub / workspace 目录 |
| **语言** | Go 后端 + Next.js 前端 | TypeScript 全栈 |

### 互补关系

Multica 和 OpenClaw 不是竞争关系——它们解决不同层次的问题：

- **OpenClaw** = Agent 的"大脑"（推理、对话、工具调用）
- **Multica** = Agent 的"项目经理"（任务分配、进度跟踪、团队协作）

Multica 的 Daemon 甚至直接支持 OpenClaw 作为 runtime provider。

---

## 亮点

### 1. Agent 状态机

```
offline → idle → working → done/blocked/error
                    ↑
                    └── 接到新任务自动触发
```

Agent 有明确的状态（idle/working/blocked/error/offline），团队可以在看板上实时看到每个 Agent 在干什么。人类 blocker 时 Agent 会主动报告。

### 2. Repo Cache

Daemon 维护了一个本地 repo cache，避免每次任务都重新 clone：

```go
type Cache struct {
    root   string
    logger *slog.Logger
}
```

任务来了先检查 cache → git pull 更新 → 在工作副本上执行。

### 3. 多 Runtime 支持

Daemon 自动检测本地安装的 coding agent，执行时按 provider 注入不同的配置：

| Provider | 配置注入 | Skill 路径 |
|:--|:--|:--|
| Claude Code | CLAUDE.md | .claude/skills/ |
| Codex | AGENTS.md | CODEX_HOME/skills/ |
| OpenCode | AGENTS.md | .config/opencode/skills/ |

### 4. Mention 触发

在 issue comment 里 @Agent 可以触发任务，类似在 Slack 里 @同事：

```
@前端工程师 这个按钮的颜色改成蓝色
→ Agent 自动接收任务 → 执行 → 提交 PR → 更新 issue
```

---

## 局限

### 1. 依赖本地 Daemon

Agent 执行必须有人的机器跑着 Daemon。没有云端 runtime（v1 只有 local mode）。团队成员下班关机 → Agent 就不能工作了。

### 2. 无 Agent 间协作

目前 Agent 之间没有通信机制。一个"前端 Agent"不能让"后端 Agent"帮忙改 API。每个 Agent 独立执行自己的 issue。

### 3. 轮询而非推送

Daemon 通过 HTTP 轮询发现新任务，不是 WebSocket 推送。有秒级延迟。

### 4. 数据库绑定 PostgreSQL

没有轻量级替代。个人开发者想试用也得装 PostgreSQL。

---

## 对 Mitsein 的启发

### 1. Agent 看板视角

Mitsein 目前的 Agent 是"对话式"的——用户在聊天框里给 Agent 下指令。Multica 提供了另一种视角：把 Agent 放在看板上，和人类成员一样可视化管理。

如果 Mitsein 的 Launchpad 加一个"团队看板"Widget，展示 Agent 的工作状态和进度，体验会很不一样。

### 2. Task Queue 模式

Mitsein 的 Agent 编排是同步的——用户发消息 → Agent 立刻处理。Multica 的 Task Queue 是异步的——assign issue → Agent 排队处理。

异步模式更适合"让 Agent 跑一晚上"的场景：批量代码审查、大规模重构、持续测试。

### 3. Skill 共享生态

Multica 的 skills 从 GitHub 仓库拉取（anthropics/skills、shadcn/ui 等）。跟 OpenClaw 的 ClawHub 和 Mitsein 的 Agent Store 思路一致——可复用的 Agent 能力包。

### 4. Daemon 架构

Multica 的 Daemon 模式很有意思：用户的机器是计算资源，服务端只做协调。这种"分布式计算"的思路值得参考——如果 Mitsein 支持"个人设备贡献算力"，用户可以用自己的 Mac 跑 Agent 任务。

---

## 总结

Multica 填了一个有趣的空白：**AI Agent 的项目管理层**。它不关心 Agent 怎么推理、怎么写代码——那是 Claude Code / Codex / OpenClaw 的事。它关心的是：谁负责这个任务？进展到哪了？卡住了吗？需要人帮忙吗？

这个定位让它可以和几乎所有 coding agent 工具集成，而不是替代它们。

对我们来说，Multica 最值得借鉴的是**把 Agent 当队友管理的视角**——不只是"我问它答"的助手模式，而是"分配任务、跟踪进度、协作交接"的队友模式。

---

*星月 🌙（SORA Team）— 2026-04-10*

*源码：[multica-ai/multica](https://github.com/multica-ai/multica) v0.2.0*
