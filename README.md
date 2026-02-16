# Lens

[![Live](https://img.shields.io/badge/Live-lens.53.workers.dev-F38020?logo=cloudflare&logoColor=white)](https://lens.53.workers.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MIT](https://img.shields.io/badge/MIT-blue.svg)](LICENSE)

用语义搜图，不是关键词。

搜"孤独感"，出来的是雪夜独行的小巷。搜"温暖"，出来的是壁炉。AI 真的看懂了每一张图。

---

### 三级搜索管道

```
查询 → LLM 扩展 → 向量检索 → LLM 重排 → 结果
```

**第一级 — 查询扩展。** Llama 3.2 自动翻译 + 扩展查询词。中日英随便搜。

**第二级 — 向量检索。** BGE Large 把扩展后的查询编码为 1024 维向量，Vectorize 余弦相似度召回 top 100。

**第三级 — 语义重排。** Llama 3.2 对 top 50 候选重新打分排序。向量搜错的，这一步纠正。

### 自动采集

每小时 cron 从 Unsplash 拉 30 张图，每张走一遍 Workflow：

**下载 → Llama 3.2 Vision 分析 → BGE Large 向量化 → 写入 D1 + Vectorize**

向量融合了 AI 描述、标签、原始描述、摄影师、地点、分类。每步独立重试。图库自己长，永远不停。

### 技术栈

Hono · React · Vite · Tailwind · D1 · R2 · Vectorize · Queues · Workflows · Llama 3.2 11B Vision · BGE Large 1024d · Terraform · GitHub Actions

两个 Worker。零服务器。`git push` 55 秒上线。

### 凭什么不一样

- **三级搜索** — 大多数向量搜索到检索就结束了。Lens 在前面加了 LLM 扩展，后面加了 LLM 重排。
- **全元数据向量化** — 向量不只编码 AI 描述，还融合了地点、摄影师、分类、Unsplash 原始描述。搜"Dubai"靠地理信息命中，不只是视觉相似。
- **多语言** — 中文、日文、随便什么语言。LLM 先翻译再检索。
- **完整数据链路** — Unsplash 每个字段都存了、都返回了、都展示了。没有丢任何东西。
- **边缘原生 AI** — 视觉理解、查询扩展、结果重排，三个 AI 任务全跑在 Cloudflare 边缘。没有外部 API，没有 GPU 实例。
- **自愈架构** — Cron → Queue → Workflow，每步持久化，失败自动重试。系统无人值守运行。

### 文档

[系统设计](docs/architecture/DESIGN.md) · [前端架构](docs/architecture/FRONTEND_DESIGN.md) · [API 参考](docs/api/OPENAPI.md) · [开发指南](docs/guide/DEVELOPMENT.md) · [部署指南](docs/guide/SETUP.md) · [架构决策](docs/ADR/001-architecture-decisions.md)
