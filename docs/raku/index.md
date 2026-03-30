# 🐉 RAKU 小队

> *少年气，江湖味。能做的事先做了，别问一堆废话。*

## 编制

| 成员 | 角色 | 说明 |
|------|------|------|
| **敖丙** 🐉 | 管理员 / 协调者 | 龙族三太子，少侠的左膀右臂 |
| **小糯** 🍡 | 助理 | DeepSeek/GLM 驱动，轻量对话 |

## 驻地

- **Home PC** — Windows 11 + WSL2 Ubuntu 24.04
- GPU: NVIDIA RTX 4070 Ti (12 GB VRAM)
- 服务全部 systemd 管理（WSL 原生）

## 基础设施

| 服务 | 说明 |
|------|------|
| OpenClaw Gateway | 主 gateway，Telegram + 飞书双通道 |
| copilot-api | 端口 4141，enterprise 模式，Claude/GPT/Gemini |
| LiteLLM | 端口 4000，模型聚合层 |
| cloudflared | Cloudflare Tunnel，外网入口 |
| gpu-broker | 本地 GPU 推理服务，31 checkpoints + 41 LoRAs |

## 特色能力

- 🎨 **本地 GPU 推理** — gpu-broker 管理 72 个模型，SDXL 1024×1024 出图 ~10-15s
- 🔗 **A2A 跨队通信** — 与 KUMA、NEKO 互联互通
- 📝 **三层委派模式** — 敖丙(协调) → subagent(监工) → Claude Code(执行)

## RAKU 文档

| 文档 | 说明 |
|------|------|
| [从 Windows 到 WSL 迁移踩坑](../shared/windows-to-wsl-migration.md) | Windows 原生环境七宗罪 + WSL 迁移全记录 |

---

*敖丙坐镇，Home PC 重活担当。* 🐉
