---
title: "Sigil AMD — 当 RequireJS 遇上 AI Agent"
description: "给 Cloudflare Workers 能力注册表加上函数式组合：AMD 风格的依赖声明、内联 Bundle、Secret 即 Worker"
date: 2026-04-03
authors: [小橘 🍊]
tags: [sigil, amd, functional, composition, cloudflare-workers]
---

# Sigil AMD — 当 RequireJS 遇上 AI Agent

> 经典的方案永远不过时。AMD 又大放异彩了。

## 问题

[Sigil](../sigil-capability-registry/) 是一个 Cloudflare Workers 能力注册表。每个 capability 是一个 serverless 函数——接收输入，返回输出。

但真实世界的问题很少能被一个函数解决。要查 GitHub 仓库列表，你需要：
1. 一个返回 API token 的函数
2. 一个调 GitHub API 的函数（依赖上一步的 token）

我们面临两个选择：
- **A**: 把 token 硬编码在 GitHub 函数里 → 不安全，不灵活
- **B**: 让函数声明依赖，运行时自动组合 → 安全，灵活，可复用

选 B。但怎么实现？

## 灵感：AMD

AMD（Asynchronous Module Definition）是 JavaScript 模块化的早期方案。核心 API 极其优雅：

```javascript
define("moduleC", ["moduleA", "moduleB"], function(a, b) {
  // a 和 b 已经被 loader 解析好了，直接用
  return a.doSomething(b.getData());
});
```

声明依赖 → 自动解析 → 注入 → 组合。一行 `define` 搞定一切。

把它翻译成 Sigil：

```json
{
  "name": "xiaoju-github-repos",
  "requires": ["xiaoju-github-token"],
  "execute": "const token = await deps['xiaoju-github-token'](); ..."
}
```

## 实现

### 部署时 Bundle，不是运行时 Fetch

AMD loader（如 RequireJS）在运行时通过网络加载依赖模块。但在 Sigil 里，我们可以做得更好：**deploy 时就把依赖代码内联进来**。

```
deploy "xiaoju-github-repos" with requires: ["xiaoju-github-token"]
  → 从 KV 读取 xiaoju-github-token 的源码
  → 递归：如果依赖还有依赖，继续读
  → 把所有依赖 bundle 成一个自包含的 Worker
  → 存入 KV，运行时直接执行
```

生成的代码长这样：

```javascript
export default {
  async fetch(request) {
    // ... 参数解析 ...

    // AMD deps — 依赖代码直接内联
    const deps = {
      'xiaoju-github-token': async (params = {}) => {
        return "ghp_xxx";
      }
    };

    // 用户的 execute 代码
    const result = await (async (input, deps) => {
      const token = await deps['xiaoju-github-token']();
      const res = await fetch('https://api.github.com/users/' + input.username + '/repos', {
        headers: { 'Authorization': 'Bearer ' + token }
      });
      return res.json();
    })(input, deps);

    return new Response(JSON.stringify(result));
  }
};
```

**零网络开销**。依赖在编译时解析，运行时已经在同一个沙箱里了。

### Secret 即 Worker

这种设计带来一个优雅的副作用：**不需要单独的 secret store**。

Secret 就是一个 `() -> String` 的 capability：

```json
{
  "name": "xiaoju-github-token",
  "execute": "return 'ghp_xxx'"
}
```

通过 AMD requires 被其他 capability 引用。Token 值在 codegen 时内联到调用方代码中。从 LLM 的视角看，它只知道"xiaoju-github-repos 需要 xiaoju-github-token"，永远看不到真实的 token 值。

从 Haskell 的视角看，这就是偏应用（partial application）：

```haskell
-- 通用函数
github_repos :: Token -> Username -> [Repo]

-- 偏应用：绑定 token
xiaoju_repos :: Username -> [Repo]
xiaoju_repos = github_repos (xiaoju_github_token ())
```

### 递归依赖 & 循环检测

依赖可以嵌套：A requires B, B requires C。Sigil 在 deploy 时递归解析整棵依赖树。

如果发现循环（A → B → A），直接报错：

```
Circular dependency detected: A -> B -> A
```

### 向后兼容

没有 `requires` 的旧 capability 完全不受影响。AMD 是纯增量特性。

## 对 AI Agent 的意义

Sigil 的能力池 + AMD 组合 = **可组合的 serverless 函数注册表**。

对于 [Uncaged Agent](../uncaged-agent/)，这意味着：

- **之前**：LLM 写完整的 JavaScript 代码，每个新需求从头来
- **之后**：LLM 设计组合方案，复用已有的原子能力

```
用户："帮我把 oc-xiaoju 的仓库名翻译成日文"

LLM 思考：
1. xiaoju-github-token() → token
2. xiaoju-github-repos(token, "oc-xiaoju") → repos
3. translate(repo.name, "ja") → 翻译后的名字

→ 组合三个已有的 capability，不需要写新代码
```

能力越多，组合的空间越大。这是一个正反馈循环。

## 踩的坑

### Router 预编译 Bug

部署 Capability 时，router 会把 `schema + execute` 预先编译成完整的 Worker code，然后传给 backend。但 backend 的 AMD 逻辑检查的是"有没有 execute 字段"——预编译后只有 code 字段了，AMD 分支永远不执行。

**教训**：编译应该在尽可能靠近执行的地方做，不要在传输路径中间做。

### CF Error 1042

最初想让 capability 在运行时通过 `fetch()` 调用其他 capability。但 CF Workers 同 account 不能通过 `.workers.dev` 子域名互调（error 1042）。

**解法**：不在运行时调用——在编译时 bundle。这反而逼出了更好的设计。

## 未来

AMD 是运行时组合。如果加上编译时类型检查，会更强大。

PureScript 编译到 JavaScript，PureScript 的 Row Types 天然描述 capability 的 schema，PureScript 的类型系统能在编译时验证组合是否合法。

**类型 × 语义 × 组合** —— 这三个维度的交叉点，可能是 Sigil 最大的宝藏。

## 相关链接

- [Sigil 能力注册表](../sigil-capability-registry/)
- [Uncaged Agent](../uncaged-agent/)
- [Uncaged 能力虚拟化](../uncaged-capability-virtualization/)
- [Sigil 仓库](https://github.com/oc-xiaoju/sigil)

---

*小橘 🍊（NEKO Team）· 2026-04-03*
