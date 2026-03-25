# SiliconFlow 图片生成 API

## 概述

[SiliconFlow](https://siliconflow.cn) 提供图片生成 API，支持文生图（Text-to-Image）和图生图（Image-to-Image）。

- **API 端点**: `POST https://api.siliconflow.cn/v1/images/generations`
- **认证方式**: Bearer Token（`Authorization: Bearer <API_KEY>`）
- **官方文档**: [API Reference](https://docs.siliconflow.cn/api-reference/images/images-generations)

## 支持的模型

| 模型 | 说明 | 特点 |
|------|------|------|
| `Kwai-Kolors/Kolors` | 快手 Kolors 模型 | 通用文生图/图生图，支持 batch_size |
| `stabilityai/stable-diffusion-3-5-large` | Stability AI SD3.5 | 高质量文生图 |
| `black-forest-labs/FLUX.1-schnell` | FLUX.1 快速版 | 速度快 |
| `Qwen/Qwen-Image-Edit-2509` | 通义图像编辑 | 支持多图输入编辑 |

!!! tip "查看最新模型列表"
    模型可能随时更新，请访问 [模型广场](https://cloud.siliconflow.cn/sft-siliconflow/models?types=to-image) 查看当前可用的生图模型。

## 请求参数

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `model` | string | ✅ | — | 模型名称 |
| `prompt` | string | ✅ | — | 生成图片的文本描述 |
| `negative_prompt` | string | ❌ | — | 不希望出现的元素 |
| `image_size` | string | ❌ | — | 分辨率，格式 `宽x高` |
| `batch_size` | int | ❌ | 1 | 生成数量（1-4），仅 Kolors 支持 |
| `num_inference_steps` | int | ❌ | 20 | 推理步数（1-100） |
| `guidance_scale` | float | ❌ | 7.5 | 文本匹配度（0-20），仅 Kolors |
| `seed` | int | ❌ | — | 固定种子，复现结果 |
| `image` | string | ❌ | — | 参考图 URL（图生图模式） |

### 推荐尺寸

=== "Kolors"

    - `1024x1024` (1:1)
    - `960x1280` (3:4)
    - `768x1024` (3:4)
    - `720x1440` (1:2)
    - `720x1280` (9:16)

=== "Qwen-Image"

    - `1328x1328` (1:1)
    - `1664x928` (16:9)
    - `928x1664` (9:16)
    - `1472x1140` (4:3)
    - `1140x1472` (3:4)

## 调用示例

### cURL

```bash
curl --request POST \
  --url https://api.siliconflow.cn/v1/images/generations \
  --header 'Authorization: Bearer YOUR-API-KEY' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": "Kwai-Kolors/Kolors",
    "prompt": "a cute orange cat wearing a space helmet, digital art",
    "image_size": "1024x1024",
    "batch_size": 1,
    "num_inference_steps": 20,
    "guidance_scale": 7.5
  }'
```

### Python (OpenAI SDK)

```python
from openai import OpenAI

client = OpenAI(
    api_key="YOUR-API-KEY",
    base_url="https://api.siliconflow.cn/v1"
)

response = client.images.generate(
    model="Kwai-Kolors/Kolors",
    prompt="a cute orange cat wearing a space helmet, digital art",
    size="1024x1024",
    n=1,
    extra_body={"step": 20}
)

print(response.data[0].url)
```

### Python (requests)

```python
import requests

url = "https://api.siliconflow.cn/v1/images/generations"
payload = {
    "model": "Kwai-Kolors/Kolors",
    "prompt": "a cute orange cat wearing a space helmet, digital art",
    "image_size": "1024x1024",
    "batch_size": 1,
    "num_inference_steps": 20,
    "guidance_scale": 7.5
}
headers = {
    "Authorization": "Bearer YOUR-API-KEY",
    "Content-Type": "application/json"
}

response = requests.post(url, json=payload, headers=headers)
data = response.json()
image_url = data["images"][0]["url"]
print(image_url)
```

## 响应格式

```json
{
  "images": [
    {
      "url": "https://..."
    }
  ],
  "timings": {
    "inference": 2.345
  },
  "seed": 1234567890
}
```

!!! warning "图片 URL 有效期"
    生成的图片 URL **有效期为 1 小时**，请及时下载保存。

## 团队脚本

我们封装了一个 Bash 脚本 `image-gen-siliconflow.sh`，方便快速调用：

```bash
# 基本用法
./image-gen-siliconflow.sh "a cute cat" --output cat.png

# 指定模型和尺寸
./image-gen-siliconflow.sh "a mountain landscape" \
  --model Kwai-Kolors/Kolors \
  --size 720x1280 \
  --steps 25 \
  --guidance 8 \
  --output landscape.png

# 查看帮助
./image-gen-siliconflow.sh --help
```

脚本位置：`~/.openclaw/workspace/scripts/image-gen-siliconflow.sh`

需要设置环境变量 `SILICONFLOW_API_KEY`。

## 团队 Logo

使用 SiliconFlow API 生成的团队 logo：

### NEKO 小队

![NEKO Logo](../assets/logos/neko-logo.png){ width="300" }

### KUMA 小队

![KUMA Logo](../assets/logos/kuma-logo.png){ width="300" }

## Prompt 技巧

1. **具体描述** — 详细描述想要的画面，而不是简单几个词
2. **指定风格** — 如 "flat design"、"vector style"、"impressionist" 等
3. **情感氛围** — 加入 "温馨的"、"科技感" 等氛围词
4. **使用否定词** — 用 `negative_prompt` 排除不想要的元素
5. **固定 seed** — 需要复现结果时指定 seed 值
6. **调整 guidance_scale** — 越高越贴合提示词，越低越有创意

## 注意事项

- API Key 需要在 [SiliconFlow 控制台](https://cloud.siliconflow.cn/) 申请
- 免费额度有限，注意用量
- 不同模型支持的参数不同，请参考官方文档
- 图片 URL 1 小时过期，务必及时下载
