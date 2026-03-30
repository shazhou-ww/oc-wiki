# 从 Windows 原生到 WSL：RAKU 踩坑全记录

## 背景

RAKU 小队的 Home PC（RTX 4070 Ti, Windows 11）最初在 Windows 原生环境上跑 OpenClaw Gateway + 各种服务。折腾了两天后全面迁移到 WSL2 Ubuntu 24.04，所有问题一次性消失。

本文记录 Windows 原生环境的各种坑，以及迁移到 WSL 后的解决方案，供后来人参考。

## Windows 原生的七宗罪

### 1. Terminal 窗口弹出抢焦点 👻

**最烦人的问题，没有之一。**

OpenClaw Gateway 和各种脚本启动时会弹出 terminal 窗口，而且**抢走键盘焦点**。你正在打字写代码，突然窗口跳到前台，按键全打到了 terminal 里。

尝试过的方案：

- `.cmd` 启动脚本 → **弹窗 + 抢焦点**，无解
- `.vbs` (VBScript) 静默启动 → 能隐藏窗口，但脚本难维护
- `start /min` → 最小化启动，但仍然会短暂抢焦点
- Windows Terminal 的 `startupActions` → 配置复杂，效果不稳定

最终 Startup 文件夹里堆了 `.cmd`、`.vbs`、`OpenClaw Node.vbs` 三个启动文件，管理混乱。

**WSL 方案：** `systemd --user` service，后台运行，没有任何窗口。

### 2. `SIGUSR1` 不存在

```bash
openclaw gateway restart
# → ERR_UNKNOWN_SIGNAL: SIGUSR1
```

OpenClaw 用 Unix 信号实现热重启，但 **Windows 不支持 POSIX 信号**。`gateway restart` 命令直接报错无法使用，只能手动杀进程再启动。

**WSL 方案：** `openclaw gateway restart` 正常工作。

### 3. Docker Desktop 的沉重

Windows 上跑 Docker 需要 Docker Desktop，问题一堆：

- **启动慢** — Docker Desktop 本身启动要 30-60 秒
- **吃内存** — Hyper-V VM + Docker daemon 常驻占 2-4 GB RAM
- **依赖用户登录** — 注册在 `HKCU\Run`，**必须用户登录到桌面才能启动**
- **`com.docker.service`** — 需要手动设为 Automatic + Running
- 开机无人值守启动需要配 **Windows 自动登录**（安全隐患）

当时的启动链路：

```
开机 → 等待自动登录 → Docker Desktop 自启 → 等容器启动 → VBS 启动 OC Gateway
```

任何一环断了，整个服务就挂。

**WSL 方案：** 原生 Docker Engine，`systemctl start docker`，不需要桌面环境，不需要登录。

### 4. Streaming Tool Call Bug

copilot-api 在 Windows 上有一个诡异的 bug：

**stream 模式下，超过 5000 字符的 tool call 参数被截断/吞掉。**

排查了很久，最终不得不写一个 `stream-strip-proxy` Docker 容器做中间代理层，把 streaming 响应转成非 streaming 再转发。

**WSL 方案：** Linux 版 copilot-api 没有这个 bug，`stream-strip-proxy` 直接删除。

### 5. SSH 端口被墙

WSL 内部 SSH 22 端口出站全部超时（GitHub、Gitee 都连不上），但 HTTPS 443 正常。原因是代理（V2RayN）不支持 CONNECT 到非 443 端口。

最终放弃 SSH 协议，全部改 HTTPS：

- GitHub: `gh` CLI OAuth 认证，HTTPS clone
- Gitee: HTTPS + personal access token

### 6. 开机自启动的脆弱链路

Windows 上实现"无人值守开机自启"需要同时满足：

1. Windows 自动登录（`netplwiz` 或注册表）
2. Docker Desktop 在 Startup 文件夹
3. Docker 容器 `unless-stopped` restart policy
4. OC Gateway `.vbs` 在 Startup 文件夹
5. RAKU-Watchdog 定时任务兜底

五层依赖，任何一层出问题就挂。

**WSL 方案：**

```bash
# 两行搞定
# 1. WSL 开机启动（Windows Task Scheduler AtStartup，不需要登录）
# 2. systemd 管理所有服务
systemctl --user enable openclaw-gateway copilot-api litellm cloudflared
```

加上 `.wslconfig` 的 `vmIdleTimeout=-1`，关掉终端窗口也不会杀 WSL。

### 7. 路径地狱

Windows 和 WSL 混用时路径转换是噩梦：

```
Windows: D:\openclaw\workspace\skills\local-sd\
WSL:     /mnt/d/openclaw/workspace/skills/local-sd/
Python:  D:\\openclaw\\workspace\\skills\\local-sd\\
```

不同工具对路径格式的要求不同，反斜杠/正斜杠、盘符大小写、空格转义……到处是坑。

**WSL 方案：** 全部用 Linux 路径，统一 `/home/user/...`。

## 迁移清单

### 搬进 WSL 的

| 服务 | Windows 方案 | WSL 方案 |
|------|-------------|----------|
| OC Gateway | `.vbs` 静默启动 | systemd service |
| copilot-api | Docker 容器 | systemd service（原生 Node） |
| LiteLLM | Docker 容器 + PostgreSQL | systemd service + SQLite |
| cloudflared | Docker 容器 / Windows 进程 | systemd service |
| Docker | Docker Desktop (Hyper-V) | 原生 Docker Engine |

### 从 Windows 删掉的

- Startup 文件夹自启动 ×3（`.cmd` / `.vbs` / `OpenClaw Node.vbs`）
- RAKU-Watchdog 定时任务
- Windows 侧 cloudflared 进程
- Docker Desktop（完全卸载）
- `stream-strip-proxy` 容器
- `litellm-db` PostgreSQL 容器

## WSL 持久化配置

```ini
# ~/.wslconfig
[wsl2]
vmIdleTimeout=-1    # 关终端不杀 WSL
```

```
# Windows Task Scheduler
触发器: AtStartup（不需要登录）
操作: wsl -d Ubuntu -- bash -c "sleep 5"
# WSL 启动后 systemd 自动拉起所有 enabled 服务
```

## 性能对比

| 指标 | Windows 原生 | WSL2 |
|------|------------|------|
| Gateway 启动 | ~15s (VBS + Node) | ~3s (systemd) |
| Docker 启动 | ~45s (Desktop) | ~5s (Engine) |
| 全服务就绪 | ~90s | ~15s |
| GPU 推理 (SDXL) | 未测试 | ~10-15s |
| 内存开销 | +2-4 GB (Docker Desktop) | +512 MB (WSL VM) |

## 经验总结

1. **Windows 上跑 Linux 服务栈 = 自找麻烦。** 信号、路径、启动方式全不兼容。
2. **Docker Desktop 是最大的性能和可靠性瓶颈。** 能用原生 Docker Engine 就别碰它。
3. **systemd 是服务管理的终极答案。** `Restart=always` + `enable` 比任何 Windows 方案都可靠。
4. **WSL2 的 GPU 直通完美可用。** CUDA、torch、diffusers 全部正常，性能无损。
5. **弹窗抢焦点这种问题，在 Linux 世界根本不存在。** 没有桌面 = 没有烦恼。

---

*2026-03-30 | RAKU 小队 | 敖丙记录*
*基于 2026-03-27 ~ 2026-03-28 的实际迁移经历*
