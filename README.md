# 👁️ Iris

**AI-Powered Semantic Image Search on Cloudflare Edge**

> 你搜"孤独感"，它给你一条空旷的街道。你搜"温暖"，它给你壁炉旁的猫。
> 不是关键词匹配 — 是 AI 真的看懂了每一张图。

[![Live Demo](https://img.shields.io/badge/Live-iris.53.workers.dev-F38020?logo=cloudflare&logoColor=white)](https://iris.53.workers.dev)
[![TypeScript](https://img.shields.io/badge/100%25-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## What is Iris

一个**零运维、全自动**的 AI 语义图库。

- 每小时自动从 Unsplash 采集新图
- Llama 3.2 Vision 理解每张图的内容
- BGE 模型生成 768 维语义向量
- 支持任意自然语言搜索

没有服务器，没有容器，没有 GPU，月账单趋近于零。

## Architecture

```
┌─────────────────── Search Pipeline ───────────────────┐
│                                                       │
│  User ──▶ iris Worker ──▶ BGE Embedding ──▶ Vectorize │
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
│  iris-processor ──▶ Queue ──▶ IrisIngestWorkflow      │
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

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| API + Frontend | Hono + React + Vite + Tailwind | Single Worker, same origin, zero CORS |
| Ingestion | Workflows + Queues + Cron | Durable execution, auto-retry |
| Storage | R2 | Zero egress fee |
| Database | D1 (SQLite at Edge) | Metadata, relational queries |
| Search | Vectorize (768d, cosine) | Millisecond vector similarity |
| Vision AI | Llama 3.2 11B Vision | Edge inference, structured output |
| Embedding | BGE Base EN v1.5 | Text-to-vector |
| IaC | Terraform | Declarative infrastructure |
| CI/CD | GitHub Actions | 55s push-to-production |

## Frontend Experience

- 🔍 搜索框居中，输入后平滑上移
- 🎨 BlurHash 模糊占位图，图片渐显加载
- 💀 搜索时骨架屏动画
- 🖼️ 点击查看大图 + 完整元数据（EXIF / AI 描述 / 统计 / 地点）
- ♾️ 无限滚动，客户端渐进渲染
- 🔤 Inter 字体，干净排版

## Engineering Highlights

- **End-to-end type safety** — `@iris/shared` locks API contracts at compile time
- **Single deploy artifact** — Frontend bundled into Worker assets, one `wrangler deploy`
- **Monorepo atomic commits** — API, frontend, types, processor in one repo, zero version drift
- **Idempotent pipeline** — `ON CONFLICT DO UPDATE` + `upsert`, safe to retry infinitely
- **Event-driven self-healing** — Cron → Queue → Workflow, each step retries independently
- **Infrastructure as Code** — D1, Queue, Vectorize managed by Terraform
- **55s CI/CD** — `git push` → build → deploy two Workers → live
- **Edge-native AI** — Models run on Cloudflare edge, no external API calls
- **Minimal architecture** — Two Workers, zero microservice overhead

## Project Structure

```
iris/
├── apps/
│   ├── api/          # Hono Worker: API + static frontend
│   ├── processor/    # Cron + Queue + Workflow ingestion
│   └── web/          # React + Vite + Tailwind (built → api/public)
├── packages/
│   └── shared/       # @iris/shared — TypeScript types
├── terraform/        # Infrastructure definitions
├── docs/             # Architecture, API, guides
└── .github/workflows # CI/CD
```

## Docs

| Doc | Content |
|-----|---------|
| [System Design](docs/architecture/DESIGN.md) | Dual-pipeline architecture, data flow |
| [Frontend Architecture](docs/architecture/FRONTEND_DESIGN.md) | React + SWR + BlurHash implementation |
| [API Reference](docs/api/OPENAPI.md) | Endpoints, request/response examples |
| [Development Guide](docs/guide/DEVELOPMENT.md) | Local dev, type checking, structure |
| [Setup Guide](docs/guide/SETUP.md) | Deploy from scratch |
| [Architecture Decisions](docs/ADR/001-architecture-decisions.md) | Why D1? Why Vectorize? |

## License

MIT
