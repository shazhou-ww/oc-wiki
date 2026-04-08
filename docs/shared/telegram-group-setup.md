# Telegram 群聊配置踩坑指南

!!! info "适用版本"
    OpenClaw 2026.3.x+，Telegram Bot API（grammY long polling 模式）

## 背景

把 OpenClaw Bot 拉进 Telegram 群聊，让它在被 @mention 时回复。听起来简单，实际踩了不少坑。

## 最终可用配置

```json5
{
  channels: {
    telegram: {
      enabled: true,
      dmPolicy: "pairing",
      botToken: "<your-bot-token>",
      groupPolicy: "allowlist",        // ① 只允许白名单群
      streaming: "partial",
      groups: {
        "*": {                          // ② 全局默认：需要 @mention
          requireMention: true
        },
        "-100xxxxxxxxxx": {             // ③ 指定群 ID（注意是负数）
          requireMention: true
        }
      }
    }
  }
}
```

## 踩坑记录

### 坑 1：Bot 在群里完全收不到消息

**现象：** Bot 加入群组后，@mention 它没有任何反应，gateway 日志里看不到 inbound 消息。

**原因：** Telegram 默认开启 **Privacy Mode**，Bot 只能看到：
- 直接 @mention 它的消息
- 回复它的消息
- 命令（`/` 开头）
- 频道转发的消息

但是！**Privacy Mode 的开关时机有坑**——Bot 加群时的 Privacy 状态是"锁定"的，之后改了不会自动生效。

**解决方案：**

```
1. 在 BotFather 中执行 /setprivacy → 选 Disable
2. 把 Bot 从群里移除
3. 重新把 Bot 加入群里（必须！改了 privacy 必须重新进群才生效）
```

或者更简单粗暴：**直接把 Bot 设为群管理员**，管理员天然能看到所有消息。

### 坑 2：群 ID 格式搞错

**现象：** 配置了 `groups`，但 Bot 还是不响应。

**原因：** Telegram 群/超级群的 chat ID 是**负数**（如 `-1003505494724`），不是正数。

**怎么拿到正确的群 ID：**

```bash
# 方法 1：看 gateway 日志
openclaw logs --follow
# 在群里发一条消息，日志里会显示 chat.id

# 方法 2：Telegram Bot API
curl "https://api.telegram.org/bot<token>/getUpdates" | python3 -m json.tool | grep chat -A 5

# 方法 3：用 @userinfobot 或 @getidsbot（转发群消息给它）
```

### 坑 3：`groupPolicy: "allowlist"` 但没配 `groupAllowFrom`

**现象：** 配了 `groupPolicy: "allowlist"` 和 `groups`，Bot 能收到消息但不响应部分用户。

**理解要点：** `groupPolicy` + allowlist 体系有**两层控制**：

| 层级 | 控制什么 | 配置项 |
|:-----|:---------|:-------|
| 第一层 | **哪些群**可以用 | `groups` 里列出群 ID（或 `"*"`） |
| 第二层 | **群内哪些人**可以触发 | `groupAllowFrom`（用户 ID 列表） |

如果你希望群内**所有人**都能触发 Bot，有两种方式：

```json5
// 方式 1：groupPolicy 设为 open
{ groupPolicy: "open" }

// 方式 2：保持 allowlist，但 groupAllowFrom 设为通配
{ groupPolicy: "allowlist", groupAllowFrom: ["*"] }
```

!!! warning "常见混淆"
    - `groupAllowFrom` 放的是 **用户 ID**（正数），不是群 ID（负数）
    - 群 ID 放在 `groups` 的 key 里
    - DM 的 pairing 通过不代表群里也能用——群有独立的权限体系（`2026.2.25+`）

### 坑 4：改了配置没重启 Gateway

**现象：** 改完 `openclaw.json`，Bot 行为没变。

**解决：** Gateway 不会自动 reload Telegram 配置，需要重启：

```bash
openclaw gateway restart
# 或
launchctl kickstart -k gui/$(id -u)/ai.openclaw.gateway
```

### 坑 5：超级群 vs 普通群的迁移

**现象：** 群从普通群升级为超级群后，chat ID 会变。

**说明：** Telegram 把普通群升级为超级群（加人超过一定数量或开启某些功能时自动触发），chat ID 会从一个负数变成另一个负数。OpenClaw 支持 `migrate_to_chat_id` 事件自动更新配置（需 `configWrites` 未禁用），但建议升级后检查一下 `groups` 里的 ID 是否正确。

## 配置检查清单

- [ ] BotFather 已 `/setprivacy` → Disable（或 Bot 是群管理员）
- [ ] 改完 privacy 后重新拉 Bot 进群
- [ ] `groups` 里填了正确的**负数**群 ID
- [ ] `groupPolicy` 和 `groupAllowFrom` 搭配正确
- [ ] Gateway 已重启

## 调试技巧

```bash
# 实时看日志，确认消息是否到达
openclaw logs --follow

# 检查 channel 状态
openclaw channels status

# 带探测的状态检查（验证具体群 ID）
openclaw channels status --probe
```

日志中关键字段：
- `skip` → 消息被过滤了（看原因：mention 缺失 / allowlist 不通过）
- `inbound` → 消息正常接收
- `chat.id` → 确认群 ID 是否匹配配置

## 参考

- [OpenClaw Telegram 官方文档](https://docs.openclaw.ai/channels/telegram)
- [群聊通用配置](https://docs.openclaw.ai/channels/groups)
