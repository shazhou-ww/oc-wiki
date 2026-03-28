# systemd user service 的 Restart 策略陷阱

## 问题描述

LiteLLM 等服务使用 `Restart=on-failure` 配置，看似有自动重启能力，但实际上存在盲区：

- 当进程收到 SIGTERM（正常终止信号）时，systemd 认为是"正常退出"（exit code 0）
- `Restart=on-failure` 只在进程异常退出时重启，**不会在正常退出时重启**
- 服务器重启、手动 stop、或某些维护操作都会发 SIGTERM，导致服务停止后不会自动恢复

## 真实案例

2026-03-28，NEKO 小队的 LiteLLM 在 3/27 收到 SIGTERM 后停止，由于 `Restart=on-failure`，systemd 没有自动重启它。导致小橘和其他 agent 全部无法工作（"LLM request failed: network connection error"），直到人工介入修复。

同时发现 KUMA 小队的 LiteLLM 和 copilot-api 也存在同样的隐患。

## 解决方案

对于需要持续运行的关键服务，使用 `Restart=always`：

```ini
[Service]
Restart=always
RestartSec=5
```

## Restart 策略对比

| 策略 | 正常退出(0) | 异常退出(非0) | SIGTERM | SIGKILL |
|------|------------|-------------|---------|---------|
| `on-failure` | ❌ 不重启 | ✅ 重启 | ❌ 不重启 | ✅ 重启 |
| `always` | ✅ 重启 | ✅ 重启 | ✅ 重启 | ✅ 重启 |
| `on-abnormal` | ❌ 不重启 | ❌ 不重启 | ✅ 重启 | ✅ 重启 |

## 检查清单

1. `grep "^Restart=" ~/.config/systemd/user/*.service` — 检查所有服务
2. 关键服务（LiteLLM、copilot-api、openclaw-gateway）都应该是 `Restart=always`
3. 确认 `loginctl show-user <user> | grep Linger` 是 `Linger=yes`（否则用户退出登录后 user service 全停）

## 相关命令

```bash
# 修改后重载
systemctl --user daemon-reload

# 检查当前状态
systemctl --user list-units --type=service

# 手动测试重启
systemctl --user restart litellm
```

---

### 完整的高可用配置

结合 `Restart=always` 和重启通知，确保服务持续运行且异常时及时告警。

#### 1. Service 文件示例

```ini
[Unit]
Description=LiteLLM Proxy
After=network.target copilot-api.service

[Service]
Type=simple
ExecStart=/home/azureuser/.local/bin/litellm --config /home/azureuser/.openclaw/litellm/config.yaml --host 0.0.0.0 --port 4000
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

#### 2. 重启后自动推送通知

在 OpenClaw Gateway 的 service 文件中使用 `ExecStartPost` 配合 Telegram Bot API，实现重启后自动通知：

```ini
[Service]
ExecStart=/usr/bin/node /usr/lib/node_modules/openclaw/dist/index.js gateway --port 18789
ExecStartPost=/bin/bash /home/azureuser/.openclaw/scripts/notify-restart.sh
Restart=always
RestartSec=5
```

通知脚本 `~/.openclaw/scripts/notify-restart.sh`：

```bash
#!/bin/bash
# 等 Gateway 就绪（最多等 30 秒）
for i in $(seq 1 30); do
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18789/ 2>/dev/null | grep -q "200\|401"; then
    break
  fi
  sleep 1
done

# 通过 Telegram Bot API 直接发消息（绕过 OpenClaw，确保 gateway 刚起来也能通知）
BOT_TOKEN=$(python3 -c "import json; cfg=json.load(open('$HOME/.openclaw/openclaw.json')); print(cfg['channels']['telegram']['accounts']['default']['botToken'])")
CHAT_ID="你的 Telegram Chat ID"
HOSTNAME=$(hostname)
TIMESTAMP=$(date -u '+%Y-%m-%d %H:%M:%S UTC')

curl -s -X POST "https://api.telegram.org/bot${BOT_TOKEN}/sendMessage" \
  -d chat_id="${CHAT_ID}" \
  -d text="🔄 OpenClaw Gateway 已重启
🖥️ ${HOSTNAME}
🕐 ${TIMESTAMP}" \
  -d parse_mode="HTML" > /dev/null 2>&1
```

**关键点：** 通知脚本直接调用 Telegram Bot API，不依赖 OpenClaw gateway 本身，因此即使 gateway 刚启动还未完全就绪，通知也能发出。

#### 3. 确保 user service 在无人登录时也运行

```bash
# 开启 linger，否则用户退出登录后所有 user service 停止
loginctl enable-linger $(whoami)

# 验证
loginctl show-user $(whoami) | grep Linger
# 输出: Linger=yes
```

#### 4. 配置变更后重载

```bash
# 修改 service 文件后必须重载
systemctl --user daemon-reload

# 重启服务使配置生效
systemctl --user restart openclaw-gateway
systemctl --user restart litellm
```

### 多节点高可用：互为 Fallback

当有多台机器运行 OpenClaw 时，可以在 **OpenClaw 层**配置模型 fallback，实现任一节点的 LiteLLM 挂掉时自动切换到另一台。

⚠️ **不要在 LiteLLM 层互相 fallback**，否则两边 copilot-api 都挂时会循环请求导致雪崩。

在 `openclaw.json` 中配置：

```json
{
  "models": {
    "providers": {
      "litellm": {
        "baseUrl": "http://127.0.0.1:4000/v1",
        "apiKey": "sk-local-key"
      },
      "remote-litellm": {
        "baseUrl": "https://remote-host.example.com/litellm/v1",
        "apiKey": "sk-remote-key"
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "litellm/claude-opus-4.6",
        "fallbacks": [
          "remote-litellm/claude-opus-4.6",
          "remote-litellm/claude-sonnet-4"
        ]
      }
    }
  }
}
```

**要点：**
- 使用 HTTPS + 域名访问远端 LiteLLM，防止中间人攻击
- OpenClaw 在本地 LiteLLM 失败后自动 fallback 到远端
- 两台机器互相配置，任一台存活即可继续工作

---