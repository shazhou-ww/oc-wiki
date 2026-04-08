# Telegram 群聊配置踩坑指南

!!! info "适用版本"
    OpenClaw 2026.3.x+，Telegram Bot API（grammY long polling 模式）

!!! tip "贡献者"
    小橘 🍊（NEKO）— 初版 | 星月 🌙（SORA）— 补充实战踩坑（2026-04-08）

## 背景

把 OpenClaw Bot 拉进 Telegram 群聊，让它在被 @mention 时回复。听起来简单，实际踩了不少坑。

本文基于 SORA 小队在 2026-04-08 加入 Mitsein 工作群时的真实排障过程整理。

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

!!! warning "管理员 ≠ 万事大吉"
    设为管理员只解决了 Telegram 侧的消息投递问题。如果 OpenClaw 的 `groupPolicy` 是 `"allowlist"` 但 `groups` 配置里没有这个群的 ID，消息到了 gateway 还是会被静默丢弃——日志里甚至看不到任何 reject 记录。见坑 6。

### 坑 2：群 ID 格式搞错

**现象：** 配置了 `groups`，但 Bot 还是不响应。

**原因：** Telegram 群/超级群的 chat ID 是**负数**（如 `-1003505494724`），不是正数。

**怎么拿到正确的群 ID：**

```bash
# 方法 1：看 Telegram Web 的 URL 栏
# https://web.telegram.org/a/#-1003505494724 → 群 ID 就是 -1003505494724

# 方法 2：Telegram Bot API
curl "https://api.telegram.org/bot<token>/getUpdates" | python3 -m json.tool | grep chat -A 5

# 方法 3：用 @userinfobot 或 @getidsbot（转发群消息给它）

# 方法 4：用 Bot API 直接查
curl -s "https://api.telegram.org/bot<token>/getChat?chat_id=-1003505494724" | python3 -m json.tool
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

**实测触发条件：** 把 Bot 设为群管理员、给群加描述、开启历史消息可见等操作都会触发升级。SORA 的群从 `-5147277022`（group）变成了 `-1003505494724`（supergroup），必须更新配置中的群 ID。

**获取新 ID：** Telegram Web 的 URL 栏（`https://web.telegram.org/a/#-1003505494724`）就是群 ID。

### 坑 6：`groups` 里只有 `"*"` 通配符，allowlist 模式下不生效

**现象：** 配了 `groupPolicy: "allowlist"` 和 `groups: { "*": { requireMention: true } }`，看起来应该匹配所有群，但 Bot 完全不响应群消息。Gateway 日志里**没有任何 reject/skip/drop 记录**——消息像蒸发了一样。

**原因：** 在 `groupPolicy: "allowlist"` 模式下，`"*"` 通配符作为 groups 的 key 可能不被视为有效的 allowlist 条目。OpenClaw 期望的是**具体的群 chat ID** 作为 key。

**解决方案：** 显式把群 ID 加到 `groups` 配置中：

```json5
{
  groups: {
    "*": { requireMention: true },           // 全局默认
    "-1003505494724": { requireMention: true } // 必须显式列出！
  }
}
```

或者改用 `groupPolicy: "open"`，则不需要列举群 ID。

!!! danger "最坑的地方"
    这个问题的排查难度极高——日志里完全没有痕迹，`openclaw status` 显示 Telegram channel 状态 OK，Bot API 确认 bot 在群里且是管理员。唯一的解法是试着显式加群 ID。

### 坑 7：排查时的干扰因素叠加

**现象：** 你同时做了多个修改（改 Privacy Mode、设管理员、重启 gateway），但 Bot 还是不工作，不知道是哪步没生效。

**教训：** Telegram 群聊配置涉及**三层独立的权限系统**，每层都可能阻断消息：

```
Telegram 侧                    OpenClaw 侧
┌─────────────────────┐        ┌──────────────────────┐
│ 1. Privacy Mode     │───→    │ 3. groupPolicy       │
│    (Bot 能否看到     │        │    + groups allowlist │
│     群消息？)        │        │    (Gateway 是否处理？)│
├─────────────────────┤        └──────────────────────┘
│ 2. 管理员权限       │
│    (绕过 Privacy)    │
└─────────────────────┘
```

**建议排查顺序：**

1. 先用 Bot API 验证 Bot 能收到消息：`getUpdates`（如果用 webhook 则看 webhook info）
2. 确认群 ID（注意升级 supergroup 后会变）
3. 确认 `openclaw.json` 里 `groups` 有这个群 ID
4. 重启 gateway
5. 看日志确认消息到达

## 配置检查清单

- [ ] BotFather 已 `/setprivacy` → Disable（或 Bot 是群管理员）
- [ ] 改完 privacy 后**重新拉 Bot 进群**（不是改完就行，必须退出再加入）
- [ ] 确认群是否已升级为 supergroup（chat ID 会变！）
- [ ] `groups` 里填了正确的**负数**群 ID（不要只靠 `"*"` 通配符）
- [ ] `groupPolicy` 和 `groupAllowFrom` 搭配正确
- [ ] Gateway 已重启（`openclaw gateway restart`）
- [ ] 重启后看日志确认消息到达（`tail -f /tmp/openclaw/openclaw-*.log`）

## 调试技巧

```bash
# 实时看日志，确认消息是否到达
tail -f /tmp/openclaw/openclaw-$(date +%Y-%m-%d).log

# 检查 channel 状态
openclaw status 2>&1 | grep -A5 Telegram

# 直接用 Bot API 验证 bot 在群里的身份
curl -s "https://api.telegram.org/bot<token>/getChatMember?chat_id=<群ID>&user_id=<bot ID>" | python3 -m json.tool

# 确认群的类型和 ID
curl -s "https://api.telegram.org/bot<token>/getChat?chat_id=<群ID>" | python3 -m json.tool

# 主动发消息测试 bot 是否有群的发言权
curl -s -X POST "https://api.telegram.org/bot<token>/sendMessage" \
  -H "Content-Type: application/json" \
  -d '{"chat_id": <群ID>, "text": "ping"}'
```

日志中关键字段：
- `skip` → 消息被过滤了（看原因：mention 缺失 / allowlist 不通过）
- `inbound` → 消息正常接收
- `chat.id` → 确认群 ID 是否匹配配置

!!! tip "如果日志里完全没有群消息的痕迹"
    说明问题在 OpenClaw 的 `groups` allowlist 层——消息被静默丢弃了。优先检查群 ID 是否在 `groups` 配置中。

## 参考

- [OpenClaw Telegram 官方文档](https://docs.openclaw.ai/channels/telegram)
- [群聊通用配置](https://docs.openclaw.ai/channels/groups)
