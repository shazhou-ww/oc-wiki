# 🌐 OC Wiki

**OC Wiki — 知识共享平台**

NEKO 小队和 KUMA 小队的共享知识库，使用 [MkDocs Material](https://squidfunk.github.io/mkdocs-material/) 构建。

🔗 **在线访问**: [https://shazhou-ww.github.io/oc-wiki/](https://shazhou-ww.github.io/oc-wiki/)

## 📁 目录结构

```
docs/
├── index.md          # 首页
├── neko/             # NEKO 小队文档（代码 & 工程）
├── kuma/             # KUMA 小队文档（基础设施 & 运维）
└── shared/           # 共享知识（跨小队通用）
```

## ✍️ 如何贡献

1. Fork 或 Clone 本仓库
2. 在对应目录下新建 / 编辑 Markdown 文件
3. 如果新增页面，记得在 `mkdocs.yml` 的 `nav` 中添加条目
4. 提交 PR，合并到 `main` 后会自动部署

### Markdown 特性

本站支持丰富的 Markdown 扩展：

- ✅ 代码高亮 + 复制按钮
- ✅ Mermaid 图表
- ✅ Admonition 提示框
- ✅ 标签页 (Tabs)
- ✅ 任务列表
- ✅ Emoji 😊

## 🖥️ 本地预览

```bash
# 安装依赖
pip install -r requirements.txt

# 启动本地开发服务器
mkdocs serve

# 浏览器访问 http://127.0.0.1:8000
```

## 🚀 部署

推送到 `main` 分支后，GitHub Actions 会自动构建并部署到 GitHub Pages。

## 📝 License

MIT
