# Onboarding Buddy Checklist

新设备 onboarding 的完整检查清单。由 buddy agent 在 SSH 进入新设备后逐项执行。

---

## Phase 0：Bootstrap（人类完成）

- [ ] 设备已开机联网
- [ ] 运行 bootstrap 脚本（SSH + Cloudflare Tunnel）
- [ ] Buddy agent 已 SSH 连通

## Phase 1：基础环境

- [ ] Node.js v22+ 安装
- [ ] OpenClaw 安装（`npm install -g openclaw`）
- [ ] pnpm 安装（skill 安装需要）
- [ ] git 配置（user.name / user.email）

## Phase 2：身份与人格

- [ ] 起名（双音节日语词传统：KUMA/NEKO/RAKU/SORA...）
- [ ] SOUL.md — 人格、语气、核心原则
- [ ] USER.md — 人类主人的信息
- [ ] IDENTITY.md — 名字、emoji、角色描述
- [ ] AGENTS.md — 行为规范、M2 三层管理模式
- [ ] HEARTBEAT.md — 定期检查任务

## Phase 3：LLM Provider 配置

- [ ] LiteLLM 接入（共享实例或自建）
- [ ] copilot-api 配置（如有 Copilot 订阅）
- [ ] openclaw.json models 配置
- [ ] Model fallbacks 设置（主 → 备 → 兜底）
- [ ] 验证：agent 能正常回复消息

## Phase 4：消息通道

- [ ] Telegram Bot 创建 + Token 配置
- [ ] 飞书应用配置（如需要）
- [ ] 验证：人类能通过 IM 跟 agent 聊天
- [ ] 设备配对（手机 App）

## Phase 5：开发工具链

- [ ] GitHub CLI (`gh`) 安装 + 认证
- [ ] git 全局配置
- [ ] copilot-cli 安装（如有订阅）
- [ ] cursor-agent 安装（如有订阅）
- [ ] claude-code 安装（如有订阅）
- [ ] 开发相关 CLI（docker, make 等按需）

## Phase 6：Skills 安装

基础 skill 集（根据角色调整）：

- [ ] github — GitHub 操作
- [ ] summarize — 总结 URL/文件
- [ ] weather — 天气查询
- [ ] skill-creator — 创建/管理 skill
- [ ] tmux — 终端操作
- [ ] 其他按角色需求安装

## Phase 7：A2A 互联

- [ ] A2A Gateway 插件安装
- [ ] 生成入站 Token
- [ ] 配置 peers（与现有小队互联）
- [ ] 现有小队的 peers 反向配置新成员
- [ ] 双向 A2A 通信验证（ping-pong 测试）
- [ ] 公网域名配置（Named Tunnel / DNS 记录）
- [ ] nginx 反代 + SSL（如在 VM 上）

## Phase 8：知识系统

- [ ] memex CLI 安装 + 配置
- [ ] memex cards 仓库 clone（shazhou-ww/memex-cards）
- [ ] oc-wiki 仓库 clone
- [ ] MEMORY.md 初始化
- [ ] memory/ 目录创建

## Phase 9：权限与凭证

需要人类主人提供的权限清单：

- [ ] GitHub 账号/Token（或 gh auth login 授权）
- [ ] Cloudflare API Token（DNS 管理）
- [ ] LiteLLM API Key
- [ ] SiliconFlow API Key（如需要）
- [ ] npm Token（如需要发包）
- [ ] 邮箱账号（如需要收发邮件）
- [ ] 其他 API Keys（按需）

## Phase 10：Gateway 上线

- [ ] openclaw gateway start
- [ ] systemd / launchd 服务安装（开机自启）
- [ ] Gateway 健康检查
- [ ] Telegram/飞书消息收发验证
- [ ] A2A 端到端验证

## Phase 11：Smoke Test

- [ ] Agent 能通过 IM 正常对话
- [ ] Agent 能执行 shell 命令
- [ ] Agent 能访问 web
- [ ] Agent 能使用 skills
- [ ] Agent 能通过 A2A 与其他小队通信
- [ ] Heartbeat 正常运行
- [ ] 人类确认满意 ✅

---

## 注意事项

- **先立新再拆旧** — 如果是迁移，确保新环境完全验证后再关旧的
- **Token 传输** — 只通过 A2A 或主人居中传递，不在 IM 里发
- **每完成一个 Phase 汇报一次** — 让主人知道进度
- **出错就停** — 不要带着错误继续，先修再推进
