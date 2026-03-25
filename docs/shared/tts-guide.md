# OpenClaw TTS 语音功能配置指南

## 1. 概述

OpenClaw 内置 TTS（Text-to-Speech）语音功能，支持以下三种 provider：

| Provider | 是否免费 | 需要 API Key |
|----------|---------|-------------|
| Microsoft Edge TTS | ✅ 免费 | ❌ 不需要 |
| OpenAI TTS | ❌ 付费 | ✅ 需要 |
| ElevenLabs | ❌ 付费 | ✅ 需要 |

> **推荐方案：** Microsoft Edge TTS 免费且无需 API key，推荐作为默认方案。

## 2. 配置方法

在 `openclaw.json` 的 `messages.tts` 下配置：

```json
{
  "messages": {
    "tts": {
      "auto": "off",
      "provider": "microsoft",
      "microsoft": {
        "enabled": true,
        "voice": "zh-CN-XiaoxiaoNeural",
        "lang": "zh-CN"
      }
    }
  }
}
```

### auto 模式说明

| 模式 | 说明 |
|------|------|
| `off` | 默认关闭，可通过 `/tts` 命令或 tts 工具手动触发 |
| `always` | 每条回复自动转语音 |
| `inbound` | 收到语音消息时才回复语音 |
| `tagged` | 回复中包含 `[[tts]]` 标签时才转语音 |

## 3. 可用中文音色

### zh-CN 女声

| 音色名称 | 风格特点 |
|----------|---------|
| `zh-CN-XiaoxiaoNeural` | 温暖（新闻/小说风格） |
| `zh-CN-XiaoyiNeural` | 活泼可爱（卡通/小说风格） |

### zh-CN 男声

| 音色名称 | 风格特点 |
|----------|---------|
| `zh-CN-YunjianNeural` | 热血激情（体育/小说） |
| `zh-CN-YunxiNeural` | 活泼阳光（小说） |
| `zh-CN-YunxiaNeural` | 可爱少年（卡通/小说） |
| `zh-CN-YunyangNeural` | 专业沉稳（新闻） |

### zh-HK 粤语

| 音色名称 | 性别 |
|----------|------|
| `zh-HK-HiuGaaiNeural` | 女 |
| `zh-HK-HiuMaanNeural` | 女 |
| `zh-HK-WanLungNeural` | 男 |

## 4. 使用方式

### tts 工具

Agent 可直接调用内置 `tts` 工具发送语音消息。

### /tts 命令

用户可通过斜杠命令使用：

```
/tts audio <文字>       # 生成一条语音
/tts always             # 开启自动语音模式
/tts off                # 关闭自动语音
/tts inbound            # 收到语音时才回复语音
```

## 5. Telegram 特别说明

- Telegram 会显示**圆形语音气泡**（Opus 格式），体验最佳
- 飞书目前收到的是**音频文件**而非语音气泡

## 6. 踩坑记录

### "produced empty audio file" 错误

- **现象：** Microsoft Edge TTS 返回空音频文件
- **原因：** 服务器网络到 Microsoft 端点不稳定
- **解决：**
    1. 重启 gateway 后通常恢复：`openclaw gateway restart`
    2. 通过命令行验证 Edge TTS 是否可用：`npx node-edge-tts --text "测试" --voice zh-CN-XiaoxiaoNeural`

### 自动 Fallback

如果 Microsoft Edge TTS 不可用，系统会自动尝试 fallback 到 OpenAI 或 ElevenLabs（需要对应的 API key 已配置）。

### 长文本处理

长文本会自动摘要后再转语音（需在配置中设置 `summaryModel`）。

### 短文本跳过

短于 **10 个字符**的回复会自动跳过 TTS，不生成语音。
