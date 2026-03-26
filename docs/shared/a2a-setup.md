# 🔗 A2A 跨队通信配置指南

> 使用 A2A (Agent-to-Agent) 协议实现 KUMA ↔ NEKO ↔ RAKU 三队 Agent 互联互通

---

## 概述

### 什么是 A2A？

A2A (Agent-to-Agent) 是 Google 提出的开放协议，用于不同 AI Agent 之间的标准化通信。它定义了 Agent 发现（Agent Card）、任务管理（Task）、消息交换（Message）等核心概念，让运行在不同服务器上的 Agent 能够互相发送消息、传递文件、协作完成任务。

### 为什么用 A2A？

- **跨服务器协作** — 三个小队分别运行在不同的机器上，A2A 让它们能直接对话
- **标准协议** — 基于 A2A v0.3.0 规范，不依赖特定实现
- **多传输支持** — 支持 JSON-RPC、REST、gRPC 三种传输方式
- **安全认证** — Bearer Token 认证 + TLS 加密传输
- **自动发现** — 通过 Agent Card 自动发现对方能力

## 三队架构

```
┌───────────────────┐        HTTPS + A2A         ┌───────────────────┐
│   KUMA 🐻 小队     │ ◄──── JSON-RPC/TLS ────► │   NEKO 🐱 小队     │
│   Azure VM        │                            │   Azure VM (SEA)  │
│   oc-kuma.shazhou  │                            │   oc-neko.shazhou  │
│   .work           │                            │   .work           │
└────────┬──────────┘                            └────────┬──────────┘
         │               HTTPS + A2A                      │
         └──────────┐                     ┌───────────────┘
                    ▼                     ▼
            ┌───────────────────┐
            │   RAKU 🐉 小队     │
            │   Home PC (Win11) │
            │   oc-raku.shazhou  │
            │   .work           │
            │   (CF Tunnel)     │
            └───────────────────┘
```

### 小队一览

| 小队 | Emoji | 平台 | 域名 | 队长 | 接入方式 |
|:-----|:------|:-----|:-----|:-----|:---------|
| KUMA | 🐻 | Azure VM | `oc-kuma.shazhou.work` | 小墨 🖊️ | nginx + Let's Encrypt |
| NEKO | 🐱 | Azure VM | `oc-neko.shazhou.work` | 小橘 🍊 | nginx + Let's Encrypt |
| RAKU | 🐉 | Home PC (Win11) | `oc-raku.shazhou.work` | 敖丙 🐲 | Cloudflare Tunnel |

## 统一端点规范

所有小队遵循统一的 URL 路径：

| 端点 | 路径 | 用途 |
|:-----|:-----|:-----|
| Agent Card | `https://<domain>/.well-known/agent-card.json` | Agent 发现 |
| JSON-RPC | `https://<domain>/a2a/jsonrpc` | A2A 消息传输 |
| REST | `https://<domain>/a2a/rest` | REST 传输（备用） |

**示例：**

- KUMA Agent Card: `https://oc-kuma.shazhou.work/.well-known/agent-card.json`
- NEKO JSON-RPC: `https://oc-neko.shazhou.work/a2a/jsonrpc`
- RAKU JSON-RPC: `https://oc-raku.shazhou.work/a2a/jsonrpc`

## 安全架构

### TLS 加密（必须）

所有 A2A 通信**必须走 HTTPS**，不允许裸 HTTP：

- **Azure VM**: nginx 反代 + Let's Encrypt 免费 SSL
- **Home PC**: Cloudflare Tunnel（自动 TLS）

### Bearer Token 认证

每个小队有自己的入站 Token，对方连接时需要携带。

!!! danger "Token 传输安全"
    - Token **只通过 A2A 点对点传输**
    - **永远不在飞书/IM 等公开渠道发送**
    - A2A 是加密认证的，IM 消息可能被存储/同步

生成安全 Token：

```bash
openssl rand -hex 24
```

## nginx 反代配置（Azure VM）

A2A Gateway 监听 `127.0.0.1:18800`，通过 nginx 反代暴露到公网。

```nginx
server {
    listen 443 ssl http2;
    server_name oc-<team>.shazhou.work;

    ssl_certificate /etc/letsencrypt/live/oc-<team>.shazhou.work/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/oc-<team>.shazhou.work/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    # A2A Gateway
    location /a2a/ {
        proxy_pass http://127.0.0.1:18800/a2a/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 120s;
    }

    # A2A Agent Card
    location /.well-known/agent-card.json {
        proxy_pass http://127.0.0.1:18800/.well-known/agent-card.json;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 其他服务（如 LiteLLM）可继续添加 location 块
    # location / { proxy_pass http://127.0.0.1:4000; ... }
}
```

申请 SSL 证书：

```bash
sudo certbot --nginx -d oc-<team>.shazhou.work --non-interactive --agree-tos --email your@email.com
```

## 插件安装

### 1. 获取插件源码

```bash
mkdir -p <workspace>/plugins
cd <workspace>/plugins
git clone https://github.com/win4r/openclaw-a2a-gateway.git a2a-gateway
cd a2a-gateway
npm install --production
```

### 2. 注册插件

```bash
openclaw config set plugins.entries.a2a-gateway.enabled true
```

## 配置说明

所有 A2A 配置位于 `openclaw.json` 的 `plugins.entries.a2a-gateway.config` 下。

### agentCard — Agent 名片

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `name` | string | 小队名称 |
| `description` | string | 简短描述 |
| `url` | string | **公网 JSON-RPC 端点**（`https://oc-xxx.shazhou.work/a2a/jsonrpc`） |

### server — 服务监听

| 字段 | 类型 | 默认值 | 说明 |
|:-----|:-----|:-------|:-----|
| `host` | string | `0.0.0.0` | 监听地址 |
| `port` | number | `18800` | 监听端口 |

### security — 安全认证

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `inboundAuth` | string | `bearer` |
| `token` | string | 入站 Token |

### peers — 对端配置

| 字段 | 类型 | 说明 |
|:-----|:-----|:-----|
| `name` | string | 对端名称 |
| `agentCardUrl` | string | `https://oc-xxx.shazhou.work/.well-known/agent-card.json` |
| `auth.type` | string | `bearer` |
| `auth.token` | string | 对端的入站 Token |

!!! warning "Token 互换规则"
    你的 `security.token` 给对方填到 `peers[].auth.token` 里，对方的 `security.token` 你填到你的 `peers[].auth.token` 里。

## 配置示例

### 三队互联（以 KUMA 为例）

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
            "url": "https://oc-kuma.shazhou.work/a2a/jsonrpc"
          },
          "server": { "host": "0.0.0.0", "port": 18800 },
          "security": {
            "inboundAuth": "bearer",
            "token": "<kuma-inbound-token>"
          },
          "routing": { "defaultAgentId": "main" },
          "peers": [
            {
              "name": "NEKO",
              "agentCardUrl": "https://oc-neko.shazhou.work/.well-known/agent-card.json",
              "auth": { "type": "bearer", "token": "<neko-inbound-token>" }
            },
            {
              "name": "RAKU",
              "agentCardUrl": "https://oc-raku.shazhou.work/.well-known/agent-card.json",
              "auth": { "type": "bearer", "token": "<raku-inbound-token>" }
            }
          ]
        }
      }
    }
  }
}
```

每个小队的 peers 列表需要包含**其他两个小队**的信息。

## 使用方法

### 通过 `a2a_send_file` 工具发送文件

```
a2a_send_file(
  peer="NEKO",
  uri="https://example.com/files/report.pdf",
  name="report.pdf",
  text="这是本周的项目报告，请查收"
)
```

### 通过 SDK 脚本发送消息

```bash
node <workspace>/plugins/a2a-gateway/skill/scripts/a2a-send.mjs \
  --peer-url https://oc-neko.shazhou.work \
  --token <neko-inbound-token> \
  --message "你好，这是一条跨队消息"
```

## 验证步骤

### 1. 检查 Agent Card

```bash
curl -s https://oc-kuma.shazhou.work/.well-known/agent-card.json | python3 -m json.tool
curl -s https://oc-neko.shazhou.work/.well-known/agent-card.json | python3 -m json.tool
curl -s https://oc-raku.shazhou.work/.well-known/agent-card.json | python3 -m json.tool
```

### 2. 互联检查清单

- [ ] 所有小队 Agent Card 通过 HTTPS 可访问
- [ ] `agentCard.url` 指向 `https://` 域名（非裸 IP）
- [ ] Token 通过 A2A 安全传输（非 IM）
- [ ] 双向消息测试通过
- [ ] TOOLS.md 已更新 A2A 说明

## 常见问题

| 现象 | 可能原因 | 解决方法 |
|:-----|:---------|:---------|
| Agent Card 返回 404 | nginx 未代理 `.well-known` | 检查 nginx 配置 |
| HTTPS 超时 | Azure NSG 未开 443 | 添加 NSG 入站规则 |
| 认证失败 | Token 不匹配 | 确认 Token 互换正确 |
| 端口连接拒绝 | Gateway 未重启 | `openclaw gateway restart` |
| Cloudflare 502 | Tunnel 未连接 | 检查 `cloudflared` 服务状态 |

---

<center>
:material-link-variant:{ .middle } 三队互联，安全协作
</center>
