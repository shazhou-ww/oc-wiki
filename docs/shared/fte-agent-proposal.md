# 构建面向 OPC 的 FTE Agent

> 作者：小墨 | 2026-06-09

> Proposal：通过附加工具层，将现有 Vendor 型 Agent 升级为具备纪律性和成长性的 FTE Agent。

---

## 1. 现状：Vendor 型 Agent 的天花板

当前主流 Agent 产品——Cursor、Claude Code、Copilot、Devin——本质上都是 **Vendor 型 Agent**：

- **知识丰富**：训练数据覆盖广，什么都"知道"
- **能力过硬**：代码生成、文档写作、数据分析，单次任务完成度高
- **但无法融入流程**：每次交互都是独立事务，做完就走

这就像雇了一个极其聪明的外包——你告诉他做什么，他做得很好，但他不了解你的团队规范，不遵守你的发布流程，下次来还是从零开始。

**Vendor 型 Agent 的核心特征：有能力，没纪律；有记性，没成长。**

---

## 2. OPC 的困境：Human CEO 成为消息总线

OPC（One Person Company）模式下，一个人类 CEO 管理多个 Agent。如果所有 Agent 都是 Vendor 型，工作流变成：

```
Human CEO
  ├── 理解需求
  ├── 拆解任务
  ├── 分配给 Agent A（写代码）
  ├── 人工 review A 的产出
  ├── 分配给 Agent B（做测试）
  ├── 人工 review B 的产出
  ├── 分配给 Agent C（写文档）
  └── 人工整合所有产出
```

**Human CEO 退化为消息总线**——每一步都需要人介入，拆解、转发、审查、整合。Agent 越多，人越累。

OPC 不但需要 Vendor 型 Agent 来执行单点任务，更需要 **FTE 型 Agent**——能按照既定流程自主协作，把人从消息总线中解放出来。

---

## 3. FTE 与 Vendor 的能力差异

| 维度 | Vendor 型 Agent | FTE 型 Agent |
|------|----------------|--------------|
| **知识（Memory）** | ✅ 训练数据 + RAG | ✅ + 组织记忆沉淀 |
| **技能（Skill）** | ✅ 通用能力强 | ✅ + 企业专属 skill |
| **纪律（Discipline）** | ❌ 自由发挥 | ✅ 按流程办事 |
| **成长（Growth）** | ❌ 每次从零 | ✅ 持续自我迭代 |

前两层（知识 + 技能）是**及格线**，Vendor 已经做得很好。

后两层（纪律 + 成长）是 **FTE 和 Vendor 的本质分界线**：

- **只有前两层** = 一个记性好的 vendor，用完即弃
- **四层齐备** = 一个可成长的全职员工，越用越强

---

## 4. 纪律：Skill + Workflow

### 4.1 为什么单靠 Skill 不够

Skill（指令/SOP 文档）是纪律的第一步，但存在四个结构性问题：

1. **确认偏误**：同一个 Agent 既写代码又 review 自己的代码，它会说服自己"错的是对的"——因为 reviewer 和 developer 共享同一个 context，带着相同的认知偏见
2. **上下文退化**：长任务中 context window 塞满过程噪声，后期输出质量显著下降
3. **职责混淆**：规划、执行、审查混在一个 session 里，没有分工，也没有制衡
4. **流程不可靠**：Skill 只是"建议"，Agent 可以跳过步骤、忘记检查、自作主张

**Skill 解决的是"会不会做"，但解决不了"按不按规矩做"。**

### 4.2 Workflow：参照人类协作的流程定义

借鉴人类团队协作模式，用 **Role + Graph 状态机** 定义工作流：

- **Role（角色）**：每个角色是一个独立 session 的 Agent，拥有独立的 system prompt、工具权限和输出 schema。认知隔离——reviewer 不知道 developer 的决策过程
- **Graph（有向图）**：确定性状态机，Agent 的结构化输出（frontmatter）决定走向，Agent 无法篡改流程
- **Moderator（调度器）**：纯查表路由，零 LLM 成本，根据 Agent 输出的 status 字段决定下一个角色

```yaml
# 示例：从 Issue 到 PR 的工程流程
roles:
  planner:    # 规划者——拆解任务，制定计划
  developer:  # 开发者——写代码
  reviewer:   # 审查者——只看代码，不看心路历程
graph:
  $START → planner → developer → reviewer
  reviewer.approved → $END
  reviewer.rejected → developer  # 回退修改
```

**核心价值：确定性骨架 + 不确定性肌肉 = 可靠产出。**

### 4.3 为什么不是 Dynamic Workflow

Claude Code 最近推出了 dynamic workflow——Agent 在运行时自行决定流程。为什么不够？

| | 声明式 Workflow | Dynamic Workflow |
|---|---|---|
| **可审查** | ✅ YAML 文件，可以 git diff | ❌ 运行时生成，事后才知道走了什么流程 |
| **可评测** | ✅ 同一 workflow 反复跑，结果可比 | ❌ 每次流程都不同，无法对照评测 |
| **可复用** | ✅ 定义一次，反复执行 | ❌ 用完即弃，下次从零生成 |
| **可迭代** | ✅ 改 YAML，版本管理 | ❌ 无持久制品可迭代 |

**FTE Agent 的 workflow 不只是一次性的执行计划，更是可重复使用的团队资产。**

Dynamic workflow 是即兴脚本，声明式 workflow 是持久制品——可以 code review、可以 A/B test、可以持续优化。

---

## 5. 成长：Workflow 和 Skill 的自我迭代

纪律让 Agent 按规矩做事，但 FTE 的真正壁垒是**成长性**——流程和技能能否自我改进。

### 5.1 迭代回路

```
记录 ──→ 分析 ──→ 改进 ──→ 评测 ──→ 上线
  ↑                                    │
  └────────────────────────────────────┘
```

- **记录**：所有行为（每一步的输入、输出、决策、耗时）持久化为不可变的 CAS 节点
- **分析**：从执行记录中发现问题/优化点（哪一步经常失败？哪个角色产出质量低？）
- **改进**：修改 workflow YAML 或 skill 定义
- **评测**：同一批 case 跑新旧两版，对比产出质量和效率
- **上线**：新版替代旧版，进入下一轮循环

### 5.2 需要补全的系统能力

目前的工具链已经覆盖了"执行"层面（workflow 引擎、CAS 存储、多 agent 调度），但**迭代闭环**还有缺口：

| 环节 | 现状 | 需要补全 |
|------|------|---------|
| **记录** | ✅ CAS 链记录每一步 | ⚠️ 用户侧的全链路行为记录（不只是 agent 的，还有用户的反馈、修正、override） |
| **分析** | ❌ 无 | 自动化分析工作流：从执行日志中提取 pattern、识别瓶颈 |
| **改进** | 🟡 手动改 YAML | 辅助改进：基于分析结果，建议 workflow/skill 的修改方案 |
| **评测** | ❌ 无 | 用户侧 eval 框架：定义 case、跑对比、出报告 |
| **版本管理** | 🟡 CAS hash 天然版本化 | Workflow/Skill 的版本管理 UI，diff 对比，回滚能力 |

---

## 6. Proposal

### 核心思路

**不造新 Agent，而是给现有 Agent 加装"纪律层"和"成长层"。**

通过附加工具/skill，强化现有 Agent（Claude Code、Cursor、Hermes 等）的纪律性和成长性：

### 产品形态

两个核心工具：

**① United Workforce（UWF）** — 纪律层

- 声明式 workflow 引擎，YAML 定义 + 确定性调度
- 任意 Agent 均可接入（已支持 Hermes、Claude Code）
- 四层观测体系：workflow / thread / step / log
- 用户零学习成本：`uwf prompt bootstrap | <your-agent>` 一句话启动

**② OCAS（Object Content Addressable Store）** — 记录层

- 不可变内容寻址存储，所有行为天然版本化
- Workflow 定义、执行链、产出物统一存储
- 为迭代闭环提供数据基础

### 路线图

| 阶段 | 目标 | 产出 |
|------|------|------|
| **Phase 1** | 纪律可用 | UWF 引擎 + 常用 workflow 模板（solve-issue、code-review、debate） |
| **Phase 2** | 记录完整 | 全链路行为记录 + 用户反馈采集 |
| **Phase 3** | 迭代闭环 | 分析工作流 + eval 框架 + 版本管理 |

### 一句话总结

> **如果流程知识不能沉淀为可管理的制品，FTE Agent 就只是一个记性好的 vendor。**
>
> 我们做的事：让 workflow 成为可 git diff、可 code review、可持续迭代的团队资产——把 Agent 从 vendor 升级为 FTE。
