# Onboarding Buddy Checklist

新设备 onboarding 的完整检查清单。Buddy agent 负责能代做的部分，需要认证/权限的留给新 agent 启动后自行向主人申请。

---

## Phase 0：Bootstrap（人类完成）

- [ ] 设备已开机联网
- [ ] 运行 bootstrap 脚本（SSH + Cloudflare Tunnel）
- [ ] Buddy agent 已 SSH 连通

## Phase 1：基础环境

- [ ] Node.js v22+ 安装
- [ ] OpenClaw 安装（`npm install -g openclaw`）
- [ ] pnpm 安装（skill 安装需要）
- [ ] bun 安装（copilot-api 需要）
- [ ] git 配置（user.name / user.email）

## Phase 2：身份与人格

- [ ] 起名（双音节日语词传统：KUMA/NEKO/RAKU/SORA...）
- [ ] SOUL.md — 人格、语气、核心原则
- [ ] USER.md — 人类主人的信息
- [ ] IDENTITY.md — 名字、emoji、角色描述
- [ ] AGENTS.md — 行为规范、M2 三层管理模式
- [ ] HEARTBEAT.md — 定期检查任务

## Phase 3：LLM Provider 配置

- [ ] LiteLLM 接入配置（写入 openclaw.json）
- [ ] copilot-api 源码 + 依赖安装
- [ ] openclaw.json models 配置
- [ ] Model fallbacks 设置（主 → 备 → 兜底）
- [ ] 验证：agent 能正常回复消息

## Phase 4：消息通道

- [ ] Telegram Bot 创建 + Token 配置
- [ ] 飞书应用配置（如需要）
- [ ] 验证：人类能通过 IM 跟 agent 聊天
- [ ] 设备配对（手机 App）

## Phase 5：开发工具链

- [ ] GitHub CLI (`gh`) 安装
- [ ] copilot-api 安装（如有订阅）<!-- 安装：npm i -g copilot-api 或源码编译 -->
- [ ] Cursor Agent CLI 安装（如有订阅）<!-- 安装：curl https://cursor.com/install -fsS | bash -->
- [ ] claude-code 安装（如有订阅）<!-- 安装：npm i -g @anthropic-ai/claude-code -->
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
- [ ] ⚠️ 配完后务必双向验证（A → B 和 B → A 都测）。常见坑：token 配错只有单向通、新 token 覆盖了旧 token 导致其他 peer 失联

## Phase 8：网络与域名

- [ ] 分配公网域名（如 `oc-sora.shazhou.work`）
- [ ] 配置 Named Tunnel（Cloudflare）或 A 记录（VM）
- [ ] nginx 反代 + SSL（如在 VM 上）
- [ ] 验证域名可达（Agent Card URL 能访问）

## Phase 9：节点互联（SSH 互信）

- [ ] 新节点 → 现有节点 SSH 打通（新 agent 能 SSH 到 KUMA/NEKO 等）
- [ ] 现有节点 → 新节点 SSH 打通（KUMA/NEKO 能 SSH 到新设备）
- [ ] 验证双向 SSH 连通
- [ ] 配置 `~/.ssh/config`（通过 Cloudflare Tunnel 的节点需要 ProxyCommand）：
  ```ssh-config
  Host <node-name>
      HostName <node-domain>.shazhou.work
      User <username>
      ProxyCommand cloudflared access tcp --hostname %h --url localhost:%p
  ```
- [ ] 用途：跨节点救援、协作部署、故障恢复

## Phase 10：知识系统

- [ ] memex CLI 安装 + 配置
- [ ] memex cards 仓库 clone
- [ ] oc-wiki 仓库 clone
- [ ] MEMORY.md 初始化
- [ ] memory/ 目录创建

## Phase 11：Daemon 与保活

- [ ] OpenClaw Gateway daemon 化 + 开机自启：
  - **Linux**: `openclaw gateway install`（systemd）
  - **macOS**: `openclaw gateway install`（launchd）
- [ ] copilot-api daemon 化 + 开机自启
- [ ] cloudflared Named Tunnel daemon 化 + 开机自启
- [ ] 保活策略验证（KeepAlive / Restart=always）
- [ ] 验证重启后所有服务自动恢复
- [ ] ⚠️ macOS 注意：某些 CLI 工具（如 Cursor Agent）依赖 macOS Keychain，SSH 远程无法访问 GUI Keychain。需用户**本地终端**首次运行以解锁 Keychain 授权

## Phase 12：权限与凭证（留给新 agent 自行申请）

以下项目 buddy agent **不代做**，在新 agent 的 MEMORY.md 或启动留言中列出，让她启动后自行向主人申请：

- [ ] GitHub 认证（`gh auth login`）
- [ ] Copilot API 认证（`copilot-api auth`）
- [ ] Cloudflare API Token
- [ ] LiteLLM API Key（如未预配）
- [ ] SiliconFlow API Key（如需要）
- [ ] npm Token（如需要发包）
- [ ] 邮箱账号（如需要收发邮件）
- [ ] Cursor API Key（如使用 Cursor Agent CLI）
- [ ] 其他 API Keys（按需）

## Phase 13：Smoke Test

- [ ] Agent 能通过 IM 正常对话
- [ ] Agent 能执行 shell 命令
- [ ] Agent 能访问 web
- [ ] Agent 能使用 skills
- [ ] Agent 能通过 A2A 与其他小队通信
- [ ] Heartbeat 正常运行
- [ ] 人类确认满意 ✅

## Phase 14：运维与清理策略

- [ ] 配置 session 定期清理（`openclaw sessions cleanup`），防止 A2A/subagent session 累积占内存
- [ ] 了解 session 存储位置：`~/.openclaw/agents/<agent>/sessions/sessions.json`
- [ ] 建议：将 `openclaw sessions cleanup` 加入 HEARTBEAT.md 或 cron 定期执行
- [ ] 监控 Gateway 内存：大量 session 会导致 RSS 膨胀，定期清理可释放内存

---

## 注意事项

- **先立新再拆旧** — 如果是迁移，确保新环境完全验证后再关旧的
- **Token 传输** — 只通过 A2A 或主人居中传递，不在 IM 里发
- **Auth 不代做** — 需要人类授权的事项留给新 agent 启动后自行申请
- **每完成一个 Phase 汇报一次** — 让主人知道进度
- **出错就停** — 不要带着错误继续，先修再推进
- **Session 会累积** — A2A 和 subagent 每次通信都创建新 session，完成后不自动清理。长期运行务必定期 cleanup
