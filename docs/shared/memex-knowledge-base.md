# 🧠 Memex 知识管理

> 原子卡片 + 双向链接 — Agent 团队的共享外部记忆

---

## 概述

[Memex](https://github.com/anthropics/memex) 是一个基于 Zettelkasten 方法论的 CLI 知识管理工具。它将知识拆解为**原子卡片**（每张卡片一个知识点），通过 `[[双向链接]]` 构建知识网络。

我们用 memex 作为 Agent 团队的**共享外部记忆**——所有 agent 产生的可复用技术知识都汇聚在这里，跨 session、跨 agent 持久保存。

## 三层记忆体系

我们的知识管理分为三层，各司其职：

```
┌─────────────────────────────────────────────────┐
│                  人类可见层                        │
│  OC Wiki / 飞书文档                               │
│  面向人类的结构化文档、教程、指南                     │
├─────────────────────────────────────────────────┤
│                  外存层（共享）                     │
│  memex (~/.memex/cards/)                         │
│  跨 agent 共享的系统性知识库                        │
│  原子卡片 + 双向链接 + Git 同步                     │
├─────────────────────────────────────────────────┤
│                  内存层（私有）                     │
│  各 agent 的 MEMORY.md + memory/*.md             │
│  个人偏好、与主人的互动记忆、日常操作日志              │
└─────────────────────────────────────────────────┘
```

| 维度 | MEMORY.md（内存） | memex（外存） | OC Wiki（文档） |
|:-----|:-----------------|:-------------|:---------------|
| **范围** | 单个 agent 私有 | 所有 agent 共享 | 面向人类 |
| **内容** | 个人偏好、互动记忆 | 技术知识、架构决策、踩坑记录 | 教程、指南、项目说明 |
| **粒度** | 自由格式 | 原子化，一卡一知识点 | 结构化长文 |
| **链接** | 无 | `[[双向链接]]` | 文档内链接 |
| **持久性** | agent 定期整理 | 长期沉淀，极少删除 | 版本控制 |

## 安装

memex 的 npm 包名为 `@touchskyer/memex`：

```bash
npm install -g @touchskyer/memex
```

验证安装：

```bash
memex --version
# 0.1.24
```

安装后卡片存储在 `~/.memex/cards/` 目录下，纯 Markdown 文件。

## 使用方法

### 搜索卡片

```bash
# 全文搜索
memex search "docker compose"

# 无参数列出所有卡片
memex search
```

### 读取卡片

```bash
memex read <slug>
# 例：memex read docker-compose-port-binding
```

### 写入卡片

```bash
# 方式一：echo + 管道（短卡片）
echo '---
title: "Docker Compose Port Binding Gotcha"
created: "2026-03-25"
source: "openclaw-huasheng"
tags: [docker, devops, gotcha]
category: devops
---

`ports: ["3000:3000"]` 会绑定到 0.0.0.0。
只想本地访问需要 `ports: ["127.0.0.1:3000:3000"]`。

相关：[[docker-network-basics]]' | memex write docker-compose-port-gotcha
```

```bash
# 方式二：heredoc（长卡片，避免引号转义）
memex write api-versioning-strategy << 'CARD'
---
title: "API Versioning Strategy"
created: "2026-03-25"
source: "openclaw-huasheng"
tags: [api, architecture, decision]
category: architecture
---

采用 URL 路径版本控制 `/v1/`, `/v2/`。
CARD
```

### 查看链接图谱

```bash
# 查看某张卡片的出入链
memex links <slug>

# 查看全局链接概览（孤立卡片、热点等）
memex links
```

### 归档卡片

```bash
# 将过时卡片移至 ~/.memex/archive/
memex archive <slug>
```

### Git 同步

```bash
# 首次配置
memex sync --init <repo-url>

# 开启自动同步（每次 write 后自动 push）
memex sync on

# 手动同步
memex sync
```

## 卡片规范

### Frontmatter 必填字段

每张卡片必须包含以下 YAML frontmatter：

```yaml
---
title: "卡片标题"           # 必填，≤60 字符，名词短语
created: "2026-03-25"       # 必填，ISO 日期
source: "openclaw-<agent>"  # 必填，来源标识
tags: [tag1, tag2]          # 可选
category: "architecture"    # 可选
links: [slug1, slug2]       # 可选，显式链接
---
```

!!! warning "三个字段必填"
    `title`、`created`、`source` 缺少任何一个都会报错。

### Slug 命名规则

- **格式**：kebab-case，全英文，3-60 字符
- **要求**：描述性但简洁

| ✅ 好的 | ❌ 不好的 |
|:--------|:----------|
| `docker-compose-port-binding` | `note-1`（无意义） |
| `nextjs-app-router-migration` | `docker`（太宽泛） |
| `openclaw-feishu-doc-api-limits` | `how-to-fix-the-bug-we-found`（太长） |

### 特殊前缀

| 前缀 | 用途 | 示例 |
|:-----|:-----|:-----|
| `adr-*` | 架构决策记录 | `adr-memory-three-layers` |
| `gotcha-*` | 踩坑记录 | `gotcha-yaml-date-auto-parse` |
| `pattern-*` | 设计模式 / 最佳实践 | `pattern-retry-with-backoff` |
| `tool-*` | 工具使用技巧 | `tool-memex-cli-usage` |

### 标签体系

**按领域**：`docker`、`nodejs`、`typescript`、`react`、`api`、`database`、`devops`、`security`、`openclaw`

**按类型**：`decision`、`gotcha`、`pattern`、`howto`、`reference`、`debug`

**分类（category）**：`architecture`、`backend`、`frontend`、`devops`、`tooling`、`security`、`workflow`

## 什么知识放哪里

遇到新知识时，按以下决策树判断归属：

```
新知识产生
  │
  ├─ 只对我一个 agent 有用？
  │   ├─ 是 → MEMORY.md
  │   │       例：主人的偏好、与主人的约定
  │   └─ 否 ↓
  │
  ├─ 可复用的技术知识？
  │   ├─ 是 → memex 卡片
  │   │       例：API 设计模式、Bug 根因、工具配置
  │   └─ 否 ↓
  │
  ├─ 需要人类阅读的文档？
  │   ├─ 是 → OC Wiki
  │   │       例：部署手册、项目说明
  │   └─ 否 → memory/YYYY-MM-DD.md 日志
  │
  └─ 特殊情况：
      ├─ 架构决策记录 (ADR) → memex + OC Wiki（双写）
      └─ 今日操作日志 → memory/YYYY-MM-DD.md
```

## Git 同步（跨 VM）

通过 Git 仓库在多台 VM 之间同步 memex 卡片：

```
KUMA-VM                              NEKO-VM
~/.memex/cards/                      ~/.memex/cards/
     │                                    │
     └──── git push/pull ────────────────┘
                   │
            GitHub Private Repo
```

### 配置步骤

```bash
# 1. 首次配置（每台 VM 执行一次）
memex sync --init <private-repo-url>

# 2. 开启自动同步
memex sync on

# 3. 手动同步（需要时）
memex sync
```

### 同步策略

- **自动同步开启**：`memex sync on`，每次 write 后自动 push
- **读前拉取**：任务开始 recall 前先 `memex sync` 确保最新
- **冲突处理**：定期 `memex links` 检查，organize 会标记冲突
- 卡片粒度小且 slug 唯一，合并冲突概率极低

## 最佳实践

### 任务开始：Recall

每次开始新任务前，先搜索相关知识：

```bash
memex search "<关键词>"     # 搜索相关卡片
memex read <slug>           # 深入阅读
memex links <slug>          # 查看关联
```

!!! tip "先搜再做"
    避免重复踩坑。前人（其他 agent）的经验可能已经记录在卡片里了。

### 任务结束：Capture

完成任务后，如果有**非显而易见的**新知识，写一张卡片：

- 一张卡片一个原子知识点
- 用 `[[wikilink]]` 链接相关卡片
- 只记有价值的，不记琐碎的

### 定期维护：Organize

```bash
# 检查知识图谱健康度
memex links

# 归档过时卡片
memex archive <slug>
```

定期检查：

- **孤立卡片** — 没有任何链接的卡片，考虑补充链接或归档
- **热点卡片** — 被大量引用的卡片，确保内容准确
- **过时卡片** — 信息已不适用，及时归档

!!! info "source 字段约定"
    统一使用 `openclaw-<agent名>` 格式标识来源，如 `openclaw-huasheng`、`openclaw-xiaomo`、`openclaw-lvdou`。便于追溯谁写了什么。

---

<center>
:material-brain:{ .middle } 知识不记下来，就等于没学会
</center>
