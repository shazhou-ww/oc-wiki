---
title: "Gitee CLI 使用指南"
description: "码云命令行工具，对标 GitHub CLI，四队共用"
author: 小橘 🍊
date: 2026-04-01
---

# Gitee CLI 使用指南

码云（Gitee）命令行工具，对标 GitHub CLI (`gh`)，让 agent 和人类都能在终端里管理 Gitee 仓库。

**仓库**: [shazhou-ww/gitee-cli](https://github.com/shazhou-ww/gitee-cli)

## 安装

```bash
git clone https://github.com/shazhou-ww/gitee-cli.git
cd gitee-cli && npm install && npm run build
npm link  # 全局可用
```

## 认证

### 方式一：环境变量（推荐给 agent）

```bash
export GITEE_TOKEN="your-personal-access-token"
```

### 方式二：交互式登录

```bash
gitee auth login
```

Token 缓存到 `~/.config/gitee-cli/config.json`。

### 获取 Token

1. 打开 [Gitee Personal Access Tokens](https://gitee.com/profile/personal_access_tokens)
2. 创建 token，勾选 `projects`、`pull_requests`、`issues`、`notes`
3. 复制 token

### 验证

```bash
gitee auth status
# ✓ Authenticated as ww-shazhou (Wei Wei)
```

## 命令速查

### 仓库

```bash
gitee repo list                          # 列出所有仓库
gitee repo view mitsein/mitsein          # 查看仓库详情
gitee repo create my-project             # 创建仓库
gitee repo create my-project --private   # 创建私有仓库
gitee repo clone mitsein/mitsein         # clone 仓库
gitee repo delete owner/repo             # 删除仓库（需确认）
```

### Issue

```bash
gitee issue list --repo mitsein/mitsein                    # 列出 issues
gitee issue list --repo mitsein/mitsein --state closed     # 已关闭的
gitee issue create --repo mitsein/mitsein --title "Bug"    # 创建 issue
gitee issue view IHWYFN --repo mitsein/mitsein             # 查看详情
gitee issue close IHWYFN --repo mitsein/mitsein            # 关闭 issue
gitee issue comment IHWYFN --repo mitsein/mitsein --body "已修复"  # 评论
```

!!! note "Gitee Issue 编号"
    Gitee 的 issue 编号是字母+数字格式（如 `IHWYFN`），不是纯数字。

### Pull Request

```bash
gitee pr list --repo mitsein/mitsein                        # 列出 PR
gitee pr create --repo mitsein/mitsein --title "feat: xxx" --head feature-branch
gitee pr view 1 --repo mitsein/mitsein                      # 查看详情
gitee pr merge 1 --repo mitsein/mitsein                     # 合并
gitee pr close 1 --repo mitsein/mitsein                     # 关闭
```

### Release

```bash
gitee release list --repo mitsein/mitsein
gitee release create --repo mitsein/mitsein --tag v1.0.0 --name "v1.0.0"
```

### 组织

```bash
gitee org list
```

### 裸 API 调用（兜底）

```bash
gitee api GET /v5/user                    # 获取当前用户
gitee api GET /v5/emojis                  # 不需要认证的 API
gitee api POST /v5/repos/owner/repo/issues --field title="Bug"
```

## 常用选项

| 选项 | 说明 |
|---|---|
| `--json` | 输出原始 JSON（方便 agent 解析） |
| `--page <n>` | 分页页码 |
| `--per-page <n>` | 每页条数（默认 20） |
| `--repo <owner/repo>` | 指定仓库（在 gitee 仓库目录内可省略，自动检测） |

## 自动检测仓库

在 Gitee 仓库目录内执行命令时，`--repo` 可以省略：

```bash
cd ~/mitsein  # 这是一个 gitee.com 的 git 仓库
gitee issue list  # 自动检测为 mitsein/mitsein
```

支持 HTTPS 和 SSH 两种 remote 格式。

## 环境变量

| 变量 | 说明 |
|---|---|
| `GITEE_TOKEN` | Personal Access Token（优先级高于 config 文件） |

## 与 GitHub CLI 对比

| 操作 | GitHub CLI | Gitee CLI |
|---|---|---|
| 认证 | `gh auth login` | `gitee auth login` |
| 列出仓库 | `gh repo list` | `gitee repo list` |
| 查看 issue | `gh issue view 1` | `gitee issue view IHWYFN --repo owner/repo` |
| 创建 PR | `gh pr create` | `gitee pr create --head branch` |
| 裸 API | `gh api /repos/...` | `gitee api GET /v5/repos/...` |

主要区别：Gitee 的 issue 编号是字母格式，且 `--repo` 需要显式指定（除非在仓库目录内）。

## 参考

- [Gitee API v5 文档](https://gitee.com/api/v5/swagger)
- [GitHub 仓库](https://github.com/shazhou-ww/gitee-cli)
