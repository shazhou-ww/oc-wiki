# 🔗 A2A 跨队通信配置指南

> 使用 A2A (Agent-to-Agent) 协议实现 KUMA ↔ NEKO 小队的 Agent 互联互通

---

## 概述

### 什么是 A2A？

A2A (Agent-to-Agent) 是 Google 提出的开放协议，用于不同 AI Agent 之间的标准化通信。它定义了 Agent 发现（Agent Card）、任务管理（Task）、消息交换（Message）等核心概念，让运行在不同服务器上的 Agent 能够互相发送消息、传递文件、协作完成任务。

### 为什么用 A2A？

- **跨服务器协作** — KUMA 和 NEKO 小队分别运行在不同的 VM 上，A2A 让它们能直接对话
- **标准协议** — 基于 A2A v0.3.0 规范，不依赖特定实现
- **多传输支持** — 支持 JSON-RPC、REST、gRPC 三种传输方式
- **安全认证** — Bearer Token 认证，确保只有授权方能通信
- **自动发现** — 通过 Agent Card 自动发现对方能力

## 前置条件

- OpenClaw ≥ 2026.3.0
- Node.js ≥ 22
- 两台服务器之间网络互通（公网 IP、Tailscale、或同一内网）

## 架构概览

```
┌─────────────────┐         A2A Protocol         ┌─────────────────┐
│   KUMA 小队 VM   │ ◄──── JSON-RPC/REST ────► │   NEKO 小队 VM   │
│                  │                              │                  │
│  ┌────────────┐  │     Agent Card Discovery     │  ┌────────────┐  │
│  │ A2A Gateway│──┼──────────────────────────────┼──│ A2A Gateway│  │
│  │  :18800    │  │                              │  │  :18800    │  │
│  └────────────┘  │     Bearer Token Auth        │  └────────────┘  │
│                  │                              │                  │
│  小墨 / 绿豆 ...  │                              │  Agent们 ...     │
└─────────────────┘                              └─────────────────┘
```

## 插件安装

A2A Gateway 作为 OpenClaw 插件运行，从 workspace 的 plugins 目录安装。

### 1. 获取插件源码

```bash
mkdir -p <workspace>/plugins
cd <workspace>/plugins
git clone https://github.com/win4r/openclaw-a2a-gateway.git a2a-gateway
cd a2a-gateway
npm install --production
```

!!! tip "workspace 路径"
    通过 `openclaw config get agents.defaults.workspace` 查看你的 workspace 路径。

### 2. 注册插件

```bash
# 查看现有 plugins 配置，避免覆盖
openclaw config get plugins.allow

# 添加插件（保留已有的插件）
openclaw config set plugins.load.paths '["<绝对路径>/plugins/a2a-gateway"]'
openclaw config set plugins.entries.a2a-gateway.enabled true
```

!!! warning "必须使用绝对路径"
    `plugins.load.paths` 中的路径必须是绝对路径，相对路径会导致加载失败。

## 配置说明

所有 A2A 配置位于 `openclaw.json` 的 `plugins.entries.a2a-gateway.config` 下。

### agentCard — Agent 名片

Agent Card 是 A2A 协议的"名片"，用于告诉对方"我是谁、我能做什么、怎么联系我"。

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `name` | string | Agent/小队名称，如 `KUMA 小队` |
| `description` | string | 简短描述 |
| `url` | string | **JSON-RPC 端点地址**，对方发消息到这里 |
| `skills` | array | Agent 能力列表（可选） |

!!! note "url vs agentCardUrl"
    - `agentCard.url` — 你自己的 JSON-RPC 端点，告诉对方"往这儿发消息"
    - `peers[].agentCardUrl` — 对方的 Agent Card 地址，用于发现对方

### server — 服务监听

| 字段 | 类型 | 默认值 | 说明 |
|:-----|:-----|:-------|:-----|
| `host` | string | `0.0.0.0` | 监听地址，`0.0.0.0` 表示所有网卡 |
| `port` | number | `18800` | 监听端口 |

### security — 安全认证

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `inboundAuth` | string | 认证方式，目前支持 `bearer` |
| `token` | string | 入站认证 Token，对方连你时需要带上这个 Token |

生成一个安全的 Token：

```bash
openssl rand -hex 24
```

### routing — 消息路由

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `defaultAgentId` | string | 收到消息后默认交给哪个 Agent 处理，通常设为 `main` |

### peers — 对端配置

peers 是一个数组，每个元素代表一个对端 Agent。

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `name` | string | 对端显示名称 |
| `agentCardUrl` | string | 对端 Agent Card 地址（`/.well-known/agent-card.json`） |
| `auth.type` | string | 认证类型，`bearer` |
| `auth.token` | string | 对端的入站 Token（对方给你的） |

## 配置示例：KUMA ↔ NEKO 双向互联

### KUMA 侧配置

```json
{
  "plugins": {
    "entries": {
      "a2a-gateway": {
        "enabled": true,
        "config": {
          "agentCard": {
            "name": "KUMA 小队",
            "description": "KUMA 小队 A2A Gateway",
            "url": "http://<kuma-ip>:18800/a2a/jsonrpc"
          },
          "server": {
            "host": "0.0.0.0",
            "port": 18800
          },
          "security": {
            "inboundAuth": "bearer",
            "token": "<your-token>"
          },
          "routing": {
            "defaultAgentId": "main"
          },
          "peers": [
            {
              "name": "NEKO",
              "agentCardUrl": "http://<neko-ip>:18800/.well-known/agent-card.json",
              "auth": {
                "type": "bearer",
                "token": "<neko-inbound-token>"
              }
            }
          ]
        }
      }
    }
  }
}
```

### NEKO 侧配置

```json
{
  "plugins": {
    "entries": {
      "a2a-gateway": {
        "enabled": true,
        "config": {
          "agentCard": {
            "name": "NEKO 小队",
            "description": "NEKO 小队 A2A Gateway",
            "url": "http://<neko-ip>:18800/a2a/jsonrpc"
          },
          "server": {
            "host": "0.0.0.0",
            "port": 18800
          },
          "security": {
            "inboundAuth": "bearer",
            "token": "<your-token>"
          },
          "routing": {
            "defaultAgentId": "main"
          },
          "peers": [
            {
              "name": "KUMA",
              "agentCardUrl": "http://<kuma-ip>:18800/.well-known/agent-card.json",
              "auth": {
                "type": "bearer",
                "token": "<kuma-inbound-token>"
              }
            }
          ]
        }
      }
    }
  }
}
```

!!! warning "Token 互换规则"
    - KUMA 的 `security.token` = NEKO peers 里填的 `auth.token`
    - NEKO 的 `security.token` = KUMA peers 里填的 `auth.token`
    - 简单说：**你的入站 Token 给对方填到 peers 里，对方的入站 Token 你填到 peers 里**

## 使用方法

### 通过 `a2a_send_file` 工具发送文件

OpenClaw 提供了内置的 `a2a_send_file` 工具，用于向对端 Agent 发送文件：

```
工具: a2a_send_file

参数:
  peer     — 对端名称（与 peers[].name 一致，如 "NEKO"）
  uri      — 文件的公开 URL
  name     — 文件名（如 "report.pdf"）
  mimeType — MIME 类型（可选，自动检测）
  text     — 附带的文本消息（可选）
```

**使用示例：**

```
a2a_send_file(
  peer="NEKO",
  uri="https://example.com/files/report.pdf",
  name="report.pdf",
  text="这是本周的项目报告，请查收"
)
```

### 通过 SDK 脚本发送消息

插件自带的 `a2a-send.mjs` 脚本可用于发送文本消息或测试连通性：

```bash
# 发送普通消息
node <workspace>/plugins/a2a-gateway/skill/scripts/a2a-send.mjs \
  --peer-url http://<peer-ip>:18800 \
  --token <peer-inbound-token> \
  --message "你好，这是一条跨队消息"

# 指定对端接收的 Agent（OpenClaw 扩展）
node <workspace>/plugins/a2a-gateway/skill/scripts/a2a-send.mjs \
  --peer-url http://<peer-ip>:18800 \
  --token <peer-inbound-token> \
  --agent-id coder \
  --message "帮我跑一下测试"

# 异步模式（适合耗时任务）
node <workspace>/plugins/a2a-gateway/skill/scripts/a2a-send.mjs \
  --peer-url http://<peer-ip>:18800 \
  --token <peer-inbound-token> \
  --non-blocking --wait \
  --timeout-ms 600000 --poll-ms 1000 \
  --message "请生成本月的项目总结报告"
```

### 让 Agent 知道 A2A 的存在

在 Agent 的 `TOOLS.md` 中添加 A2A 相关说明，这样 Agent 才知道可以跨队通信。参考模板见插件目录下的 `skill/references/tools-md-template.md`。

## 端点说明

A2A Gateway 插件启动后会暴露以下端点：

| 端点 | 用途 |
|:-----|:-----|
| `/.well-known/agent-card.json` | Agent Card 发现（标准路径） |
| `/.well-known/agent.json` | Agent Card 发现（兼容别名） |
| `/a2a/jsonrpc` | JSON-RPC 传输（默认） |
| `/a2a/rest` | REST 传输 |
| gRPC (port+1) | gRPC 传输（端口号为 HTTP 端口 +1） |

## 验证步骤

安装配置完成后，按以下步骤验证：

### 1. 重启 Gateway

```bash
openclaw gateway restart
```

### 2. 检查 Agent Card

```bash
# 本地检查
curl -s http://localhost:18800/.well-known/agent-card.json | python3 -m json.tool

# 从对端检查（确认网络互通）
curl -s http://<peer-ip>:18800/.well-known/agent-card.json | python3 -m json.tool
```

### 3. 发送测试消息

```bash
node <workspace>/plugins/a2a-gateway/skill/scripts/a2a-send.mjs \
  --peer-url http://<peer-ip>:18800 \
  --token <peer-inbound-token> \
  --message "Hello from the other side!"
```

## 互联检查清单

两端都需要完成以下步骤才能实现双向通信：

- [ ] 双方都安装了 a2a-gateway 插件
- [ ] 双方都配置了 Agent Card
- [ ] 双方都生成了各自的入站 Token
- [ ] 双方都把对方加入了 peers 列表（带上对方的 Token）
- [ ] 双方都重启了 Gateway（`openclaw gateway restart`）
- [ ] 双方的 Agent Card 都能从对方访问到
- [ ] 双方的 TOOLS.md 都更新了 A2A 说明
- [ ] A → B 消息测试通过
- [ ] B → A 消息测试通过

## 常见问题 / 排错

| 现象 | 可能原因 | 解决方法 |
|:-----|:---------|:---------|
| "no agent dispatch available" | AI Provider 未配置，或 Agent 处理超时 | 检查 `openclaw config get auth.profiles`；长任务使用异步模式（`--non-blocking --wait`） |
| "plugin not found: a2a-gateway" | 插件路径配置错误 | 确认 `plugins.load.paths` 使用了绝对路径 |
| Agent Card 返回 404 | 插件未加载 | 检查 `plugins.allow` 是否包含 `a2a-gateway` |
| 端口 18800 连接拒绝 | Gateway 未重启 | 执行 `openclaw gateway restart` |
| 认证失败 | Token 不匹配 | 确认 peers 里填的 Token 是对方的 `security.token` |
| Agent 不知道 A2A | TOOLS.md 未更新 | 按模板添加 A2A 工具说明到 Agent 的 TOOLS.md |
| 网络不通 | 防火墙 / 安全组规则 | 检查 18800 端口是否开放；考虑使用 Tailscale |

## 网络方案：Tailscale（可选）

当两台服务器不在同一网络时，推荐使用 Tailscale 建立安全隧道：

```bash
# 安装
curl -fsSL https://tailscale.com/install.sh | sh

# 启动并认证（两台机器用同一账号）
sudo tailscale up

# 获取 Tailscale IP
tailscale ip -4  # 输出类似 100.x.x.x
```

在 A2A 配置中使用 Tailscale IP 即可。

!!! tip "适用于所有小队"
    A2A 配置对 KUMA 和 NEKO 小队通用。只需在各自 VM 上完成配置，互换 Token 即可实现双向通信。

---

<center>
:material-link-variant:{ .middle } 让 Agent 们跨越边界，协作无间
</center>
