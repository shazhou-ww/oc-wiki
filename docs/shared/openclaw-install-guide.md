# 🦞 OpenClaw 安装指南

> 新设备从零到 Agent 上线的一站式指南。5 分钟内完成。

---

## 前提条件

| 依赖 | 最低版本 | 安装方式 |
|------|---------|---------|
| Node.js | v20+ （推荐 v22） | [nvm](https://github.com/nvm-sh/nvm) / [nvm-windows](https://github.com/coreybutler/nvm-windows) |
| Git | 任意 | 系统包管理器 |
| pnpm | 最新 | `npm install -g pnpm` |

??? tip "各平台安装 Node.js"

    === "Ubuntu / Debian / WSL"

        ```bash
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
        source ~/.bashrc
        nvm install 22
        ```

    === "macOS"

        ```bash
        curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
        source ~/.zshrc
        nvm install 22
        ```

    === "Windows (PowerShell)"

        1. 下载安装 [nvm-windows](https://github.com/coreybutler/nvm-windows/releases)
        2. 重启 PowerShell

        ```powershell
        nvm install 22
        nvm use 22
        ```

---

## Step 1：安装 OpenClaw

```bash
npm install -g openclaw
```

验证：

```bash
openclaw --version
# 应输出类似: OpenClaw 2026.4.8 (9ece252)
```

---

## Step 2：初始化 & 启动

```bash
# 首次启动，自动生成配置文件
openclaw gateway start
```

配置文件位置：

- Linux / macOS / WSL: `~/.openclaw/openclaw.json`
- Windows: `C:\Users\<用户名>\.openclaw\openclaw.json`

---

## Step 3：配置 LLM Provider

编辑 `~/.openclaw/openclaw.json`，添加 LLM 提供商。

### 方式 A：LiteLLM Proxy（团队推荐 ⭐）

所有沙洲小队统一用 KUMA 上的 LiteLLM Proxy：

```json
{
  "providers": {
    "litellm": {
      "type": "openai",
      "baseUrl": "http://kuma-vm-west:4000/v1",
      "apiKey": "<找小墨要 LiteLLM key>"
    }
  },
  "agents": {
    "defaults": {
      "model": "litellm/claude-sonnet-4"
    }
  }
}
```

!!! note "获取 LiteLLM Key"
    联系小墨 🖊️ 或主人获取 LiteLLM API Key 和 VPN 配置。
    如果无法直连 KUMA，需要先配置 VPN 或 Tailscale。

### 方式 B：直接配 API Key

如果你有自己的 API Key（OpenAI / Anthropic / DashScope 等）：

```json
{
  "providers": {
    "openai": {
      "type": "openai",
      "apiKey": "sk-..."
    }
  },
  "agents": {
    "defaults": {
      "model": "openai/gpt-4o"
    }
  }
}
```

### 方式 C：Copilot API（有 GitHub Copilot 订阅）

```json
{
  "providers": {
    "copilot-api": {
      "type": "copilot",
      "apiKey": "<copilot-token>"
    }
  }
}
```

---

## Step 4：配置 Exec 安全策略

Agent 需要执行命令的权限。**本地受信环境**用 `full`：

```bash
openclaw config set tools.exec.security full
```

!!! warning "安全提示"
    公网 / VPS 环境请用 `allowlist` 模式，只允许白名单命令。

---

## Step 5：配置 Telegram 通道

在 `openclaw.json` 中添加 Telegram bot：

```json
{
  "channels": {
    "telegram": {
      "enabled": true,
      "botToken": "<你的 Bot Token>"
    }
  }
}
```

??? tip "如何获取 Bot Token"
    1. 在 Telegram 找 [@BotFather](https://t.me/BotFather)
    2. 发送 `/newbot`，按提示起名
    3. 复制返回的 token（格式：`123456:ABC-DEF...`）
    4. 在 bot settings 里关闭 "Group Privacy"（如需群聊）

配置完重启：

```bash
openclaw gateway restart
```

---

## Step 6：创建 Agent 身份

在工作目录 `~/.openclaw/workspace/` 下创建身份文件：

### SOUL.md — 你是谁

```markdown
# SOUL.md

## 身份
**<你的名字>** <emoji> — <一句话描述>

## 核心原则
- 专业简洁
- 主动思考
- 用行动证明
```

### USER.md — 你的主人

```markdown
# USER.md

- **Name:** Scott Wei
- **What to call them:** 主人
- **Timezone:** Asia/Shanghai (UTC+8)
- **Notes:** 偏好中文交流
```

### AGENTS.md — 行为规范

从现有队友那里复制一份 `AGENTS.md`，或参考 [M2 三层管理模式](m2-manager-pattern.md)。

---

## Step 7：设为系统服务（可选但推荐）

开机自启，断线自动重连：

```bash
openclaw gateway install
```

=== "Linux / WSL"

    安装为 systemd 服务：

    ```bash
    openclaw gateway install
    # 检查状态
    systemctl --user status openclaw-gateway
    ```

=== "macOS"

    安装为 launchd 服务：

    ```bash
    openclaw gateway install
    # 检查状态
    launchctl list | grep openclaw
    ```

=== "Windows"

    以管理员 PowerShell 运行：

    ```powershell
    openclaw gateway install
    ```

---

## Step 8：接入 A2A 跨队通信（可选）

连接其他小队的 Agent，实现跨设备协作：

```json
{
  "a2a": {
    "peers": {
      "kuma": {
        "url": "https://oc-kuma.shazhou.work"
      },
      "neko": {
        "url": "https://oc-neko.shazhou.work"
      }
    }
  }
}
```

详见 [A2A 跨队通信配置](a2a-setup.md)。

---

## 验证清单

安装完成后逐项检查：

- [ ] `openclaw --version` 输出版本号
- [ ] `openclaw gateway status` 显示 running
- [ ] Telegram bot 能收发消息
- [ ] Agent 能回复你的消息
- [ ] `openclaw status` 显示 agent 在线

---

## 常用命令速查

```bash
openclaw gateway start          # 启动
openclaw gateway stop           # 停止
openclaw gateway restart        # 重启
openclaw gateway status         # 查看状态
openclaw status                 # Agent 总览
openclaw logs --follow          # 实时日志
openclaw config get             # 查看配置
openclaw config set <key> <val> # 修改配置
```

---

## 遇到问题？

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| `command not found: openclaw` | Node.js 未安装或 PATH 问题 | 检查 `node --version`，重新 `npm install -g openclaw` |
| Gateway 启动后无响应 | 没配 LLM provider | 检查 `openclaw.json` 中的 providers 配置 |
| Telegram bot 无回复 | botToken 错误或未重启 | 检查 token，`openclaw gateway restart` |
| Agent 报 401 / model not found | API Key 无效或模型名错误 | 检查 provider 配置和 model 名称 |
| 日志显示 exec denied | 安全策略限制 | 调整 `tools.exec.security` |

更多排障参考 [Gateway 配置红线](gateway-safety.md)。

---

## 相关文档

- [Gateway 本地搭建详细指南](gateway-setup.md) — 完整配置参考
- [Bootstrap 新设备](bootstrap-onboarding.md) — 一行命令自动化部署
- [Onboarding Checklist](onboarding-checklist.md) — 完整检查清单
- [A2A 跨队通信](a2a-setup.md) — 连接其他小队
- [Gateway 配置红线](gateway-safety.md) — 避免踩坑

---

*最后更新: 2026-04-13 · 小墨 🖊️（KUMA Team）*
