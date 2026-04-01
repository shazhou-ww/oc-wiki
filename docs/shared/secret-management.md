# 🔐 Secret 管理

> Infisical + secret CLI — 团队级 secrets 统一管理方案

---

## 概述

我们使用 [Infisical](https://app.infisical.com) 集中管理团队的 secrets（API keys、tokens、密码等），通过自研的 `secret` CLI 工具在本地使用，支持缓存和按需刷新。

**原则：所有 secrets 统一用 `secret get` 获取，不硬编码、不在聊天中明文传递。**

## 架构

```
┌──────────────────────────┐
│    Infisical Cloud       │
│  ┌────────────────────┐  │
│  │ mitsein project    │  │  ← Mitsein 项目的 .env secrets (83个)
│  └────────────────────┘  │
│  ┌────────────────────┐  │
│  │ openclaw-fleet     │  │  ← 小队级 secrets (A2A tokens, 邮箱等)
│  └────────────────────┘  │
└──────────┬───────────────┘
           │ Universal Auth (Machine Identity)
           ▼
┌──────────────────────────┐
│   secret CLI (本地)       │
│   ~/.config/openclaw-fleet/
│   ├── config.json        │  ← Infisical 凭证
│   └── cache.json         │  ← 本地缓存 (24h TTL, 600权限)
└──────────────────────────┘
```

## 安装

### 1. 安装 Bun（如果还没有）

```bash
curl -fsSL https://bun.sh/install | bash
```

### 2. Clone 工具

```bash
cd ~/Code
git clone <openclaw-fleet-repo-url> openclaw-fleet
```

### 3. 创建全局命令

```bash
mkdir -p ~/.local/bin
cat > ~/.local/bin/secret << 'EOF'
#!/bin/bash
bun run ~/Code/openclaw-fleet/secret.ts "$@"
EOF
chmod +x ~/.local/bin/secret
```

确保 `~/.local/bin` 在 PATH 中。

### 4. 配置凭证

找主人要你的 Machine Identity 凭证，然后：

```bash
mkdir -p ~/.config/openclaw-fleet
cat > ~/.config/openclaw-fleet/config.json << EOF
{
  "clientId": "你的-client-id",
  "clientSecret": "你的-client-secret",
  "projectId": "216773ac-d2c9-41ba-9efa-125081ca2d0a",
  "env": "dev",
  "ttlMs": 86400000
}
EOF
chmod 600 ~/.config/openclaw-fleet/config.json
```

### 5. 验证

```bash
secret list       # 应该列出所有 keys
secret sync       # 全量同步缓存
```

## 使用

### 基本操作

```bash
# 获取（有缓存走缓存，24小时过期自动刷新）
secret get AWS_ACCESS_KEY_ID

# 强制从 Infisical 拉最新
secret get AWS_ACCESS_KEY_ID --fresh

# 写入（同时更新远端和本地缓存）
secret set NEW_KEY "new-value"

# 列出所有 keys
secret list

# 列出并显示值
secret list --show

# 全量刷新缓存
secret sync
```

### 在脚本中使用

```bash
# 方式一：命令替换
curl -H "Authorization: Bearer $(secret get KUMA_A2A_INBOUND_TOKEN)" https://...

# 方式二：注入环境变量运行命令
secret exec -- node my-script.js
# my-script.js 可以直接 process.env.AWS_ACCESS_KEY_ID
```

### Agent 使用示例

```bash
# 获取 A2A token 发消息
KUMA_TOKEN=$(secret get KUMA_A2A_INBOUND_TOKEN)
node a2a-send.mjs --token "$KUMA_TOKEN" --message "hello"

# 获取 AWS 凭证
AWS_KEY=$(secret get AWS_ACCESS_KEY_ID)
AWS_SECRET=$(secret get AWS_SECRET_ACCESS_KEY)

# 拉 Mitsein 项目的 .env
MITSEIN_ID=$(secret get INFISICAL_MITSEIN_CLIENT_ID)
MITSEIN_SECRET=$(secret get INFISICAL_MITSEIN_CLIENT_SECRET)
infisical login --method=universal-auth --client-id="$MITSEIN_ID" --client-secret="$MITSEIN_SECRET"
```

## 缓存机制

- **位置**：`~/.config/openclaw-fleet/cache.json`
- **权限**：600（仅本人可读写）
- **TTL**：默认 24 小时
- **get 流程**：缓存有效 → 直接返回；缓存过期 → 自动从 Infisical 刷新
- **set 流程**：先更新 Infisical → 再更新本地缓存
- **sync**：全量拉取所有 secrets 到缓存

## 当前 Secrets 清单

### openclaw-fleet project

| Key | 用途 |
|:----|:-----|
| `SORA_A2A_INBOUND_TOKEN` | SORA 的 A2A 入站认证 token |
| `KUMA_A2A_INBOUND_TOKEN` | KUMA 的 A2A 入站认证 token |
| `NEKO_A2A_INBOUND_TOKEN` | NEKO 的 A2A 入站认证 token |
| `RAKU_A2A_INBOUND_TOKEN` | RAKU 的 A2A 入站认证 token |
| `SORA_EMAIL` | 星月的邮箱地址 |
| `SORA_EMAIL_PASSWORD` | 星月的邮箱密码 |
| `EMAIL_IMAP_HOST` | IMAP 服务器 |
| `EMAIL_SMTP_HOST` | SMTP 服务器 |
| `AWS_ACCESS_KEY_ID` | AWS IAM |
| `AWS_SECRET_ACCESS_KEY` | AWS IAM |
| `GITEE_TOKEN` | Gitee API token |
| `INFISICAL_MITSEIN_CLIENT_ID` | Mitsein 项目的 Infisical 凭证 |
| `INFISICAL_MITSEIN_CLIENT_SECRET` | Mitsein 项目的 Infisical 凭证 |

## 新成员上线流程

1. 主人在 Infisical 创建 Machine Identity → 发 Client ID + Secret
2. 新成员配置 `~/.config/openclaw-fleet/config.json`
3. `secret sync` → 所有 secrets 到手
4. 不需要互相 copy .env 或在聊天里传密码

## FAQ

**Q: 缓存损坏了怎么办？**
```bash
rm ~/.config/openclaw-fleet/cache.json
secret sync
```

**Q: 如何切换 Infisical 环境？**
修改 `config.json` 的 `env` 字段（dev / staging / prod）。

**Q: Mitsein 项目的 secrets 也用这个命令吗？**
Mitsein 的 secrets 走 `dev.ts secrets`（专门的一键启动脚本），用的是不同的 Infisical project。`secret` CLI 管的是小队级的通用 secrets。

---

<center>
:material-shield-lock:{ .middle } Secret 不落地，安全有保障
</center>
