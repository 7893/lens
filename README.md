# Lens

**AI-Powered Semantic Image Search on Cloudflare Edge**

> 你搜"孤独感"，它给你一条空旷的街道。你搜"温暖"，它给你壁炉旁的猫。
> 不是关键词匹配 — 是 AI 真的看懂了每一张图。

[![Live Demo](https://img.shields.io/badge/Live-lens.53.workers.dev-F38020?logo=cloudflare&logoColor=white)](https://lens.53.workers.dev)
[![TypeScript](https://img.shields.io/badge/100%25-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Lens 是什么

一个**零运维、全自动**的 AI 语义图库。

- 每小时自动从 Unsplash 采集新图
- Llama 3.2 Vision 理解每张图的内容
- BGE 模型生成 768 维语义向量
- 支持任意自然语言搜索

没有服务器，没有容器，没有 GPU，月账单趋近于零。

## 架构

```
┌─────────────────── Search Pipeline ───────────────────┐
│                                                       │
│  User ──▶ lens Worker ──▶ BGE Embedding ──▶ Vectorize │
│               │                                │      │
│               │◀──── D1 (metadata) ◀───────────┘      │
│               │                                       │
│               ▼                                       │
│           R2 (images) ──▶ User                        │
└───────────────────────────────────────────────────────┘

┌─────────────────── Ingestion Pipeline ────────────────┐
│                                                       │
│  Cron (hourly)                                        │
│    │                                                  │
│    ▼                                                  │
│  lens-processor ──▶ Queue ──▶ LensIngestWorkflow      │
│                                  │                    │
│                                  ├─ Download → R2     │
│                                  ├─ Llama Vision → AI │
│                                  ├─ BGE → Embedding   │
│                                  └─ Persist → D1      │
│                                                       │
│  Cron also syncs D1 embeddings → Vectorize (upsert)   │
└───────────────────────────────────────────────────────┘
```

两条管道完全解耦。搜索永远快，采集慢慢来。每一步独立重试，自动自愈。

## 技术栈

| 层 | 技术 | 用途 |
|----|------|------|
| API + 前端 | Hono + React + Vite + Tailwind | 单 Worker 同源部署，零跨域 |
| 采集引擎 | Workflows + Queues + Cron | 持久化执行，自动重试 |
| 图片存储 | R2 | 零出口流量费 |
| 元数据 | D1 (SQLite at Edge) | 关系查询，边缘就近访问 |
| 语义搜索 | Vectorize (768d, cosine) | 毫秒级向量相似度 |
| 视觉 AI | Llama 3.2 11B Vision | 边缘推理，结构化输出 |
| 向量化 | BGE Base EN v1.5 | 文本转向量 |
| 基础设施 | Terraform | 声明式资源管理 |
| CI/CD | GitHub Actions | 55 秒推送到生产 |

## 前端体验

- 🔍 搜索框居中，输入后平滑上移
- 🎨 BlurHash 模糊占位图，图片渐显加载
- 💀 搜索时骨架屏动画
- 🖼️ 点击查看大图 + 完整元数据（EXIF / AI 描述 / 统计 / 地点）
- ♾️ 无限滚动，客户端渐进渲染
- 🔤 Inter 字体，干净排版

## 工程亮点

- **端到端类型安全** — `@lens/shared` 在编译期锁定 API 契约
- **单一部署产物** — 前端打包进 Worker assets，一次 `wrangler deploy` 搞定
- **Monorepo 原子提交** — API、前端、类型、采集引擎同仓库，零版本漂移
- **幂等全链路** — `ON CONFLICT DO UPDATE` + `upsert`，无限重试也安全
- **事件驱动自愈** — Cron → Queue → Workflow，每步独立重试
- **基础设施即代码** — D1、Queue、Vectorize 由 Terraform 管理
- **55 秒 CI/CD** — `git push` → 构建 → 部署两个 Worker → 上线
- **边缘原生 AI** — 模型跑在 Cloudflare 边缘节点，无外部 API 调用
- **极简架构** — 两个 Worker 撑起整个系统，零微服务开销

## 项目结构

```
lens/
├── apps/
│   ├── api/          # Hono Worker：API + 静态前端
│   ├── processor/    # Cron + Queue + Workflow 采集引擎
│   └── web/          # React + Vite + Tailwind（构建后复制到 api/public）
├── packages/
│   └── shared/       # @lens/shared — TypeScript 类型定义
├── terraform/        # 基础设施定义
├── docs/             # 架构、API、开发指南
└── .github/workflows # CI/CD
```

## 文档

| 文档 | 内容 |
|------|------|
| [系统设计](docs/architecture/DESIGN.md) | 双管道架构、数据流 |
| [前端架构](docs/architecture/FRONTEND_DESIGN.md) | React + SWR + BlurHash 实现 |
| [API 参考](docs/api/OPENAPI.md) | 接口定义、请求响应示例 |
| [开发指南](docs/guide/DEVELOPMENT.md) | 本地开发、类型检查 |
| [部署指南](docs/guide/SETUP.md) | 从零部署完整系统 |
| [架构决策](docs/ADR/001-architecture-decisions.md) | 为什么选 D1？为什么要 Vectorize？ |

## License

MIT
