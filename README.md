# Lens

**AI 语义图片搜索，跑在 Cloudflare 边缘网络上。**

> 你搜"孤独感"，它给你一条雪夜独行的小巷。
> 不是关键词匹配 — 是 AI 真的看懂了每一张图。

[![Live](https://img.shields.io/badge/Live-lens.53.workers.dev-F38020?logo=cloudflare&logoColor=white)](https://lens.53.workers.dev)
[![TypeScript](https://img.shields.io/badge/100%25-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

---

## 它做了什么

每小时自动从 Unsplash 采集新图，Llama 3.2 Vision 看懂图片内容，BGE Large 生成 1024 维语义向量。图库持续增长，永不停歇。

搜索时走三级管道：

1. **Query Expansion** — Llama 自动翻译 + 扩展查询词，中英文通吃
2. **Vector Search** — 1024 维余弦相似度检索，毫秒级召回
3. **LLM Re-ranking** — Llama 对候选结果语义重排，精度拉满

两个 Worker 撑起整个系统。没有服务器，没有容器，没有 GPU 实例。

## 技术栈

| 层 | 技术 |
|----|------|
| API + 前端 | Hono + React + Vite + Tailwind |
| 采集引擎 | Workflows + Queues + Cron |
| 图片存储 | R2 |
| 元数据 | D1 (SQLite at Edge) |
| 语义搜索 | Vectorize (1024d, cosine) |
| AI | Llama 3.2 11B Vision + BGE Large EN v1.5 |
| 基础设施 | Terraform |
| CI/CD | GitHub Actions (55s) |

## 前端

- 搜索框居中，输入后平滑上移
- BlurHash 模糊占位 + 图片渐显
- 骨架屏 + 无限滚动
- 点击查看完整详情：摄影师、EXIF、AI 描述、地点、统计、分类
- 缩略图卡片展示描述、地点、分类标签

## 工程亮点

- 三级搜索：Expansion → Vector → Re-ranking
- 中英文搜索，LLM 自动翻译
- 全元数据 embedding：caption + tags + 描述 + 地点 + 摄影师 + 分类
- Unsplash 全字段存储 → API 全字段返回 → 前端全字段展示
- `@lens/shared` 端到端类型安全
- Monorepo 原子提交，零版本漂移
- 幂等全链路，无限重试也安全
- 事件驱动自愈：Cron → Queue → Workflow
- 基础设施即代码，Terraform 管理
- `git push` 55 秒上线

## 文档

- [系统设计](docs/architecture/DESIGN.md)
- [前端架构](docs/architecture/FRONTEND_DESIGN.md)
- [API 参考](docs/api/OPENAPI.md)
- [开发指南](docs/guide/DEVELOPMENT.md)
- [部署指南](docs/guide/SETUP.md)
- [架构决策](docs/ADR/001-architecture-decisions.md)

## License

MIT
