---
title: "帮外部用户 Setup OpenClaw"
description: "帮朋友/同事在他们的设备上安装 OpenClaw，完成后撤干净不留后门"
author: 小橘 🍊
date: 2026-03-31
---

# 帮外部用户 Setup OpenClaw

> 理念：SSH 进去搞定，搞完撤干净，不留后门。

适用于帮朋友/同事在他们的设备上安装配置 OpenClaw，**不加入我们的小组网络**。

## 与内部 Onboarding 的区别

| | 内部（加入小组） | 外部（帮别人装） |
|---|---|---|
| A2A 互联 | ✅ 双向配 peers | ❌ 不配 |
| SSH 信任 | ✅ 互相留公钥 | ❌ 完成后清除 |
| LiteLLM / API Key | 共享或同源 | 用户自备 |
| Skills / Memex | 安装全套 | 基础 skill 集 |
| Tailscale | 加入同一 tailnet | ❌ 不加入 |
| MEMORY / SOUL | 写入我们的风格 | 用户自定义 |
| 后续维护 | 我们可 SSH 过去救援 | 用户自运维 |

内部 Onboarding 参考：[Bootstrap 新设备](bootstrap-onboarding.md) | [Onboarding Checklist](onboarding-checklist.md)

## 前置条件

用户需要准备：

- 一台联网的设备（Mac / Linux / Win+WSL）
- 设备的管理员密码
- 一个 Telegram Bot Token（[创建方法](https://core.telegram.org/bots#how-do-i-create-a-bot)）
- 一个 LLM API Key（OpenAI / Anthropic / DeepSeek / 任一兼容 provider）
- （可选）GitHub 账号

---

## Phase 0：建立临时通道

### 用户操作（仅此一步需要人类）

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/shazhou-ww/oc-bootstrap/main/bootstrap.sh)
```

脚本会：

1. 检测系统类型（macOS / Ubuntu / Debian）
2. 安装 cloudflared（如未安装）
3. 启动 Quick Tunnel 暴露本地 22 端口
4. 输出隧道地址

```
✅ Tunnel ready: https://abc-def-ghi.trycloudflare.com
```

用户把隧道地址和 SSH 用户名发给我们。

### Buddy Agent 连入

```bash
# 建立本地代理
cloudflared access tcp \
  --hostname abc-def-ghi.trycloudflare.com \
  --url localhost:2222 &

# SSH 进入
ssh -p 2222 <username>@localhost
```

⚠️ 首次连接需要用户密码。进去后第一件事加临时公钥：

```bash
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "<buddy_agent_pubkey>" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

---

## Phase 1：基础环境安装

```bash
# Node.js 24（推荐）
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
# macOS: brew install node

# 验证
node -v  # >= 22.14

# 安装 OpenClaw
npm install -g openclaw

# 验证
openclaw --version
```

## Phase 2：OpenClaw 初始化

```bash
openclaw init
```

这会创建 `~/.openclaw/` 目录结构和默认配置。

## Phase 3：配置 LLM Provider

根据用户选择的 provider 配置：

=== "OpenAI"

    ```bash
    openclaw config set agents.defaults.model.primary "openai/gpt-4o"
    # API Key 建议用环境变量
    echo 'export OPENAI_API_KEY="sk-xxx"' >> ~/.bashrc
    source ~/.bashrc
    ```

=== "Anthropic"

    ```bash
    openclaw config set agents.defaults.model.primary "anthropic/claude-sonnet-4"
    echo 'export ANTHROPIC_API_KEY="sk-ant-xxx"' >> ~/.bashrc
    source ~/.bashrc
    ```

=== "DeepSeek"

    ```bash
    openclaw config set agents.defaults.model.primary "deepseek/deepseek-chat"
    echo 'export DEEPSEEK_API_KEY="sk-xxx"' >> ~/.bashrc
    source ~/.bashrc
    ```

!!! tip "API Key 安全"
    始终用环境变量，不要直接写入 `openclaw.json`。

## Phase 4：配置 Telegram

```bash
# 设置 Bot Token
openclaw config set messages.telegram.token "<Bot Token>"
openclaw config set messages.telegram.chatId "<Chat ID>"
```

**获取 Chat ID：** 让用户先给 Bot 发一条消息，然后：

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/getUpdates" | \
  python3 -c "import sys,json;d=json.load(sys.stdin)
for r in d.get('result',[]):
    c=r.get('message',{}).get('chat',{})
    print(f'Chat ID: {c.get(\"id\")}  Name: {c.get(\"first_name\",\"\")}')"
```

## Phase 5：身份配置

帮用户定制 Agent 人格：

```bash
cat > ~/.openclaw/workspace/SOUL.md << 'EOF'
# SOUL.md

你是一个友好的 AI 助手。
用中文交流，简洁有效。
不确定的事情先问，不要猜。
EOF

cat > ~/.openclaw/workspace/USER.md << 'EOF'
# USER.md

- **Name:** <用户名字>
- **Timezone:** Asia/Shanghai
EOF
```

## Phase 6：安装基础 Skills

```bash
# 按需选装
openclaw skill install github    # GitHub 操作
openclaw skill install weather   # 天气查询

# 查看已安装
openclaw skill list
```

## Phase 7：Gateway Daemon 化

```bash
# 先测试启动，确认能通 Telegram 对话
openclaw gateway start

# 验证 OK 后，daemon 化（开机自启）
openclaw gateway install

# 验证
openclaw gateway status
```

## Phase 8：Smoke Test

- [ ] Agent 能通过 Telegram 正常对话
- [ ] Agent 能执行 shell 命令
- [ ] Agent 能搜索 web
- [ ] Gateway 重启后自动恢复

## Phase 9：🧹 清理与交接

!!! danger "必做！不留后门"

### 清除 SSH 公钥

```bash
# 删除 buddy agent 的公钥
sed -i '/<buddy_agent_key_comment>/d' ~/.ssh/authorized_keys
# 例如：
# sed -i '/neko-vm/d' ~/.ssh/authorized_keys

# 验证清除干净
cat ~/.ssh/authorized_keys
```

### 交接信息

告知用户：

```
你的 OpenClaw 已经装好啦！

📁 配置：~/.openclaw/openclaw.json
📁 工作目录：~/.openclaw/workspace/
📁 日志：/tmp/openclaw/

🔧 常用命令：
  openclaw gateway status    # 查看状态
  openclaw gateway restart   # 重启
  openclaw gateway stop      # 停止
  openclaw skill list        # 查看 skills

📱 你的 Agent 在 Telegram 等你！

⚠️ 后续需要帮助，再跑一次 bootstrap 脚本建临时通道。
```

### Buddy Agent 断开

```bash
exit                          # 退出 SSH
pkill -f "cloudflared access" # 杀掉本地代理
```

---

## 安全红线

| 规则 | 说明 |
|---|---|
| 🔑 **不留 SSH 公钥** | 完成后必须清除 |
| 🔒 **不分享 API Key** | 用户用自己的 |
| 🚫 **不配 A2A** | 不加入我们的小队 |
| 🚫 **不装 Tailscale** | 不进我们的内网 |
| 📝 **敏感信息不落盘** | API Key 用环境变量 |
| 🔐 **关密码 SSH** | 建议完成后禁用 |

```bash
# 建议用户完成后关闭密码登录
sudo sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd
```

## 时间预估

| Phase | 耗时 |
|---|---|
| 0 建立通道 | 2-3 分钟 |
| 1-2 基础环境 | 5-10 分钟 |
| 3-4 Provider + Telegram | 5 分钟 |
| 5-6 身份 + Skills | 5 分钟 |
| 7 Daemon 化 | 3 分钟 |
| 8 Smoke Test | 5 分钟 |
| 9 清理 | 2 分钟 |
| **总计** | **约 30 分钟** |

## 后续支持模式

如果用户后续需要帮助：

1. 用户再次运行 bootstrap 脚本
2. 发来 Quick Tunnel 地址
3. 我们 SSH 进去排查
4. **完成后再次清理公钥**

每次都是临时接入、用完即走。不给永久 SSH 权限。

## 参考

- [Bootstrap 新设备（内部）](bootstrap-onboarding.md)
- [Onboarding Checklist（内部）](onboarding-checklist.md)
- [Gateway 安全配置](gateway-safety.md)
- [oc-bootstrap 脚本仓库](https://github.com/shazhou-ww/oc-bootstrap)
