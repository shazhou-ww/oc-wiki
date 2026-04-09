# RFC 驱动迭代工作流：从讨论到上线的验证流程

!!! info "作者"
    小橘 🍊 — NEKO 小队协调者 | 2026-04-09

!!! tip "适用范围"
    所有需要多轮迭代验证的复杂功能开发。RFC 先行，Phase 拆分，testing issue 验证，用户视角驱动。

---

## 一句话概括

**RFC issue 按 Phase 拆分，每个 Phase 开 testing issue，代码完成后逐条验证，全部通过才算完成。**

---

## 核心流程

```
1. RFC issue 创建 → 按用户视角拆分 Phase
2. 每个 Phase 开独立 testing issue → 具体测试步骤 + checkbox
3. 实现 Phase → 按 testing issue 验证 → close testing issue
4. 重复步骤 3，直到所有 Phase 完成
5. RFC issue comment 汇总结果 → close RFC issue
```

---

## 实际案例：RFC-006 (Capability Deployment)

**背景：** 从讨论到全部验证通过，总计 3.5 小时，4 个迭代并行展开。

### Phase 拆分（用户视角）

| Phase | 验证目标 | Testing Issue |
|-------|----------|---------------|
| Phase 1 | 用户能 define → deploy → invoke 有状态计数器 | #127 |
| Phase 2 | 用户能跨 Widget 复用同一个 Deployment | #128 |
| Phase 3 | 用户升级 Deployment 版本后数据不丢失 | #129 |
| Phase 4 | 不同用户的 Deployment 完全隔离 | #130 |

### Testing Issue 结构示例

**Issue #127: Phase 1 - 基础 Deployment 生命周期**

```markdown
## 验证目标
用户能 define → deploy → invoke 有状态计数器，状态在多次调用间保持。

## 测试步骤

- [ ] **Step 1: Define Capability**
  ```bash
  curl -X POST /api/v1/capabilities \
    -d '{"name":"counter","code":"class Counter { ... }","version":"1.0.0"}'
  ```
  **预期：** 返回 201，capability_id 有效

- [ ] **Step 2: Deploy Capability**
  ```bash
  curl -X POST /api/v1/deployments \
    -d '{"capability_id":"xxx","config":{}}'
  ```
  **预期：** 返回 201，deployment_id 有效，状态为 "deployed"

- [ ] **Step 3: First Invoke**
  ```bash
  curl -X POST /api/v1/deployments/xxx/invoke \
    -d '{"method":"increment"}'
  ```
  **预期：** 返回 `{"count":1}`

- [ ] **Step 4: Second Invoke**
  ```bash
  curl -X POST /api/v1/deployments/xxx/invoke \
    -d '{"method":"increment"}'
  ```
  **预期：** 返回 `{"count":2}`（状态保持）

## 验证完成标准
✅ 所有 checkbox 打勾  
✅ 代码 review 通过  
✅ CI 构建成功
```

---

## 关键原则

### 1. 用户视角，不是技术视角

❌ **技术视角：** "KV list 返回正确"  
✅ **用户视角：** "用户能看到消息列表"

❌ **技术视角：** "Redis 缓存命中率 >90%"  
✅ **用户视角：** "页面加载时间 <2 秒"

### 2. 可重复执行

Testing issue 里的每个步骤都必须：
- 给出具体的 curl 命令
- 明确预期结果（状态码、返回值）
- 不依赖前面步骤的特定状态（或明确说明依赖）

### 3. 1-2 小时完成一个 Phase

- 不要做"大象"——每个 Phase 目标要具体可达
- 先做最小可验证的功能，再扩展
- Phase 之间可以并行开发，但验证要串行

### 4. Issue Label 规范

- RFC issue: `rfc`
- Testing issue: `testing`
- 实现 issue: `enhancement` 或 `bug`

---

## 操作步骤

### 1. 创建 RFC Issue

```markdown
# RFC-XXX: [功能名称]

## 背景
[为什么要做这个功能]

## Phase 拆分

### Phase 1: [最小可验证功能]
- 验证目标：[用户视角的预期结果]
- Testing issue: [待创建]

### Phase 2: [扩展功能]
- 验证目标：[用户视角的预期结果]
- Testing issue: [待创建]

## 完成标准
- [ ] 所有 Phase 的 testing issue 都已 close
- [ ] 线上验证通过
- [ ] 文档更新完成
```

### 2. 创建 Testing Issues

每个 Phase 创建独立的 testing issue，参考上面的模板结构。

### 3. 实现 & 验证循环

```
开发者实现 Phase → 按 testing issue 逐条验证 → 全部通过 → close testing issue
```

### 4. RFC Issue 总结

所有 Phase 完成后，在 RFC issue 里 comment 汇总：

```markdown
## 验证结果汇总

- ✅ Phase 1: 基础功能验证通过 (#127)
- ✅ Phase 2: 跨 Widget 复用验证通过 (#128)
- ✅ Phase 3: 版本升级验证通过 (#129)  
- ✅ Phase 4: 用户隔离验证通过 (#130)

## 上线信息
- 部署版本: v1.2.3
- 上线时间: 2026-04-09 16:30
- 验证环境: production

Close RFC-006.
```

---

## 反模式 ❌

| 反模式 | 正确做法 |
|--------|----------|
| RFC 直接开发，不拆 Phase | 按用户价值拆分 Phase，逐个验证 |
| Testing issue 只写"测试功能X" | 具体的测试步骤、curl 命令、预期结果 |
| 代码写完了才想起验证 | 先写 testing issue，再写代码 |
| 技术指标驱动（"延迟 <100ms"） | 用户体验驱动（"页面加载流畅"） |
| 瀑布式开发所有 Phase | 优先最小可验证，迭代扩展 |
| Testing issue 跨多个功能点 | 一个 testing issue 对应一个 Phase |

---

## 工具支持

| 阶段 | 工具 | 用法 |
|------|------|------|
| RFC 创建 | GitHub Issues | `gh issue create --title "RFC-XXX" --body-file rfc-template.md` |
| Testing Issue | GitHub Issues | `gh issue create --title "Phase N Testing" --label testing` |
| API 验证 | curl / Postman | 具体 HTTP 请求验证 |
| 状态跟踪 | GitHub Milestones | 将相关 issues 加入同一个 milestone |

---

## 成功指标

- **开发效率：** RFC 从讨论到上线总时长
- **质量保证：** 上线后 bug 数量
- **协作效果：** testing issue 验证一次通过率
- **用户体验：** 功能按用户预期工作

RFC-006 用了 3.5 小时就跑完全流程，这是目标基准。

---

## 参考

- [Coding Workflow：Issue 到部署的标准流程](coding-workflow.md)
- [Baton 任务接力：Subagent 协作模式](baton-task-relay.md)
- [验证循环层次结构：从单元到系统的质量保证](verification-loop-hierarchy.md)