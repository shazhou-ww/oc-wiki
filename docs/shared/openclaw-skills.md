# 🧩 OpenClaw Skills

> 模块化能力扩展 — 让 Agent 按需装备新技能

---

## 什么是 Skills

Skills 是 OpenClaw 的模块化能力扩展机制。每个 Skill 是一个独立的指令包，教会 Agent 如何完成特定类型的任务。

核心思想：

- **按需加载** — Agent 根据任务自动匹配并加载相关 Skill
- **可复用** — 一个 Skill 可以被多个 Agent 使用
- **可分享** — 通过 ClawHub 社区市场发布和安装
- **声明式** — 用 Markdown 描述，不需要写代码

## 我们的自建 Skills

以下是 `/home/azureuser/.openclaw/workspace/skills/` 下的自建 Skills：

| Skill | 描述 |
|:------|:-----|
| **agent-team-orchestration** | 编排多 Agent 团队：角色定义、任务生命周期、交接协议、Review 工作流。适用于 2+ Agent 协作场景 |
| **memex-zettelkasten** | 基于 memex CLI 的共享知识库（Zettelkasten 原子卡片 + 双向链接）。任务开始 recall、任务结束 capture、知识图谱健康检查 |
| **openai-whisper-api** | 通过 OpenAI Audio Transcriptions API（Whisper）转写音频。支持 SiliconFlow 等兼容 API |
| **project-management-2** | 项目管理：任务追踪、优先级排序、项目规划、截止日期管理。覆盖多种方法论和工具选择 |
| **session-logs** | 使用 jq 搜索和分析 Agent 的历史 session 日志 |
| **story-time** | 互动式小说 — 自选冒险。内置故事和自定义创作框架 |
| **summarize** | 使用 summarize CLI 摘要 URL、PDF、图片、音频、YouTube 视频等 |

## Skill 结构

一个标准的 Skill 目录结构如下：

```
my-skill/
├── SKILL.md          # 必需 — Skill 主文件，包含描述和指令
├── scripts/          # 可选 — 辅助脚本
│   └── run.sh
├── references/       # 可选 — 参考资料（API 文档、示例等）
│   └── api-spec.md
└── assets/           # 可选 — 静态资源
    └── template.json
```

### SKILL.md 规范

`SKILL.md` 是 Skill 的核心文件，包含 YAML frontmatter 和 Markdown 正文：

```yaml
---
name: my-skill
description: >
  简要描述这个 Skill 做什么，以及什么时候触发。
  Use when: (1) 场景一, (2) 场景二...
  NOT for: 不适用的场景。
---

# My Skill

这里是 Agent 执行任务时遵循的具体指令。
包括步骤、命令模板、注意事项等。
```

**关键字段**：

| 字段 | 说明 |
|:-----|:-----|
| `name` | Skill 名称，kebab-case |
| `description` | 描述 + 触发条件，Agent 据此判断是否加载 |
| 正文 | 具体操作指令，Agent 加载后按此执行 |

!!! tip "description 很重要"
    Agent 通过 description 判断是否匹配当前任务。写清楚"什么时候用"和"什么时候不用"。

## 如何创建新 Skill

### 1. 创建目录

```bash
mkdir -p ~/.openclaw/workspace/skills/my-new-skill
```

### 2. 编写 SKILL.md

```bash
cat > ~/.openclaw/workspace/skills/my-new-skill/SKILL.md << 'EOF'
---
name: my-new-skill
description: >
  一句话描述。Use when: 触发场景。NOT for: 排除场景。
---

# My New Skill

## 步骤

1. 第一步...
2. 第二步...

## 注意事项

- 注意点一
- 注意点二
EOF
```

### 3. 添加辅助文件（可选）

```bash
# 脚本
mkdir scripts/
# 参考资料
mkdir references/
# 静态资源
mkdir assets/
```

### 4. 测试

创建完成后，Agent 会自动在 `<available_skills>` 列表中看到新 Skill。向 Agent 发送匹配 description 的任务，验证是否能正确触发。

## ClawHub — 社区 Skill 市场

[ClawHub](https://clawhub.com) 是 OpenClaw 的社区 Skill 市场，可以搜索、安装和发布 Skills。

### 搜索 Skill

```bash
clawhub search "关键词"
```

### 安装 Skill

```bash
clawhub install <skill-name>
```

安装后 Skill 会出现在 `~/.local/share/npm/lib/node_modules/openclaw/skills/` 下，Agent 自动可用。

### 更新 Skill

```bash
# 更新所有已安装的 ClawHub skills
clawhub sync

# 更新指定 skill 到最新版
clawhub sync <skill-name>
```

### 发布 Skill

将自建 Skill 发布到 ClawHub 分享给社区：

```bash
clawhub publish ~/.openclaw/workspace/skills/my-skill
```

!!! info "两类 Skills 的位置"
    - **ClawHub 安装的**: `~/.local/share/npm/lib/node_modules/openclaw/skills/`
    - **自建的**: `~/.openclaw/workspace/skills/`
    
    两个位置的 Skills 都会出现在 Agent 的 `<available_skills>` 列表中。

---

<center>
:material-puzzle:{ .middle } 模块化组装，按需赋能
</center>
