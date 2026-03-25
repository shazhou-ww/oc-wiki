# 🎤 语音转文字配置指南

> 使用 SiliconFlow（硅基流动）API 实现语音消息自动转写

---

## 概述

通过 SiliconFlow 的语音转文字 API，让 Agent 能听懂语音消息。API 兼容 OpenAI Whisper 接口格式，国内访问稳定，延迟低。

## 前置条件

- SiliconFlow 账号 — 注册地址：[https://cloud.siliconflow.cn](https://cloud.siliconflow.cn)
- API Key — 在 [账号设置 > API Keys](https://cloud.siliconflow.cn/account/ak) 获取

## 配置步骤

### 1. 设置环境变量

```bash
# 写入 ~/.bashrc 持久化
echo 'export SILICONFLOW_API_KEY="sk-your-api-key-here"' >> ~/.bashrc
source ~/.bashrc
```

### 2. 安装 Skill

```bash
cd ~/.openclaw/workspace
openclaw skills install openai-whisper-api
```

### 3. 修改转写脚本

默认脚本指向 OpenAI，需要改为 SiliconFlow。编辑 `skills/openai-whisper-api/scripts/transcribe.sh`，修改三处：

**默认模型**（约第 22 行）：
```bash
# 改前
model="whisper-1"
# 改后
model="${WHISPER_MODEL:-FunAudioLLM/SenseVoiceSmall}"
```

**API Key 和 Base URL**（约第 55 行）：
```bash
# 改前
if [[ "${OPENAI_API_KEY:-}" == "" ]]; then
  echo "Missing OPENAI_API_KEY" >&2
  exit 1
fi

# 改后
API_KEY="${SILICONFLOW_API_KEY:-${OPENAI_API_KEY:-}}"
API_BASE="${WHISPER_API_BASE:-https://api.siliconflow.cn/v1}"

if [[ "${API_KEY:-}" == "" ]]; then
  echo "Missing SILICONFLOW_API_KEY or OPENAI_API_KEY" >&2
  exit 1
fi
```

**curl 请求地址**（约第 70 行）：
```bash
# 改前
curl -sS https://api.openai.com/v1/audio/transcriptions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \

# 改后
curl -sS "${API_BASE}/audio/transcriptions" \
  -H "Authorization: Bearer $API_KEY" \
```

### 4. 测试

```bash
export SILICONFLOW_API_KEY="sk-your-key"
bash ~/.openclaw/workspace/skills/openai-whisper-api/scripts/transcribe.sh \
  /path/to/audio.ogg --out /tmp/test.txt

cat /tmp/test.txt
# 输出类似: {"text":"这是转写后的文字内容"}
```

## 支持的音频格式

| 格式 | 扩展名 | 说明 |
|:-----|:-------|:-----|
| Opus | `.ogg` | 飞书/Telegram 语音消息默认格式 |
| MP3 | `.mp3` | 通用音频 |
| M4A | `.m4a` | iPhone 录音 |
| WAV | `.wav` | 无压缩音频 |
| FLAC | `.flac` | 无损压缩 |

## 可用模型

| 模型 | 说明 | 推荐场景 |
|:-----|:-----|:---------|
| `FunAudioLLM/SenseVoiceSmall` | 默认，中文效果好，速度快 | 日常语音消息 |
| `whisper-1` | OpenAI Whisper 兼容 | 多语言混合 |

切换模型：
```bash
export WHISPER_MODEL="whisper-1"
```

## 环境变量参考

| 变量 | 说明 | 默认值 |
|:-----|:-----|:-------|
| `SILICONFLOW_API_KEY` | SiliconFlow API Key | _(必填)_ |
| `WHISPER_MODEL` | 转写模型 | `FunAudioLLM/SenseVoiceSmall` |
| `WHISPER_API_BASE` | API 地址 | `https://api.siliconflow.cn/v1` |

## 费用

SiliconFlow 语音转文字按时长计费，具体价格见 [官方定价页](https://siliconflow.cn/pricing)。日常语音消息（几秒到几十秒）费用极低。

## 注意事项

!!! warning "安全提醒"
    - API Key 只存在环境变量中，**不要写入代码或提交到 Git**
    - 每台 VM 使用独立的环境变量配置
    - 如需多台机器共享，各自配置各自的 `~/.bashrc`

!!! tip "适用于所有小队"
    此方案对 KUMA 和 NEKO 小队通用。只需在各自 VM 上配置环境变量和安装 skill 即可。

---

<center>
:material-microphone:{ .middle } 让 Agent 听懂你的声音
</center>
