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