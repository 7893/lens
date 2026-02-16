# Pic - 智能语义图库

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

基于 Cloudflare Serverless 生态构建的 AI 图库系统，支持自然语言语义搜索。

## 为什么这个项目很酷

🧠 **真正的语义理解** — 不是关键词匹配，是 AI 真的"看懂"了图片。搜"孤独感"能找到空旷的街道，搜"温暖"能找到壁炉旁的猫。背后是 LLaVA 视觉模型 + BGE 向量嵌入的组合拳。

⚡ **纯边缘计算，零服务器** — 没有 EC2，没有 ECS，没有 K8s。整个系统跑在 Cloudflare 的全球边缘网络上：Workers 处理请求、D1 存元数据、R2 存图片、Vectorize 做向量检索、Queues 做异步任务、Workflows 编排长流程。全球 300+ 节点，冷启动 0ms。

🔄 **全自动采集管道** — Cron 定时触发 → Queue 削峰 → Workflow 编排 5 步流水线（下载 → AI 视觉分析 → 向量化 → 持久化 → 索引）。每一步独立重试，单步失败不影响整体。你睡觉的时候它在自动扩充图库。

🏗️ **现代工程实践** — TypeScript 全栈 strict mode、Monorepo（npm workspaces）、Terraform IaC 管理基础设施、GitHub Actions CI/CD 自动部署。推一次代码，三个组件同时上线。

💰 **极致成本控制** — R2 零出口流量费、D1 免费额度覆盖日常使用、Workers AI 按调用计费。整套系统月成本趋近于零。

📦 **纯 TypeScript 项目** — 不只是代码用 TypeScript，连项目配置都是。共享类型包确保前后端接口契约一致，编译期就能发现问题。

## 架构一览

```
  用户搜索 "sunset over ocean"
       │
       ▼
  ┌─────────┐  embedding   ┌───────────┐  top-K   ┌────┐
  │ pic-api │ ──────────▶  │ Vectorize │ ───────▶ │ D1 │ ──▶ 返回结果
  └─────────┘              └───────────┘          └────┘
       │
       │ 图片代理
       ▼
  ┌────┐
  │ R2 │
  └────┘

  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

  每小时自动采集
       │
       ▼
  ┌───────────────┐      ┌───────┐      ┌──────────────────────────┐
  │ pic-processor │ ───▶ │ Queue │ ───▶ │     PicIngestWorkflow    │
  │  (cron)       │      └───────┘      │                          │
  └───────────────┘                     │  1. 下载原图+展示图 → R2 │
                                        │  2. LLaVA 视觉分析       │
                                        │  3. BGE 向量化           │
                                        │  4. 元数据写入 D1        │
                                        │  5. 向量索引 Vectorize   │
                                        └──────────────────────────┘
```

详细架构设计见 [系统设计文档](docs/architecture/DESIGN.md)。

## 技术栈

| 层 | 技术 | 用途 |
|---|------|------|
| 搜索 API | Hono + Workers | 类型安全的轻量路由 |
| 采集引擎 | Workflows + Queues | 可重试的异步编排 |
| 前端 | React + Vite + Tailwind | 静态部署到 Pages |
| 数据库 | D1 (SQLite) | 图片元数据 |
| 向量检索 | Vectorize (768d, cosine) | 语义搜索 |
| 存储 | R2 | 原始图 + 展示图 |
| AI 视觉 | LLaVA 1.5 7B | 图片内容理解 |
| AI 嵌入 | BGE Base EN v1.5 | 文本向量化 |
| IaC | Terraform | 基础设施声明式管理 |
| CI/CD | GitHub Actions | 推送即部署 |

## 快速开始

```bash
git clone https://github.com/7893/pic.git
cd pic
npm install
npm run dev
```

完整部署指南见 [Setup Guide](docs/guide/SETUP.md)。

## 文档

- [系统设计](docs/architecture/DESIGN.md)
- [前端架构](docs/architecture/FRONTEND_DESIGN.md)
- [API 参考](docs/api/OPENAPI.md)
- [开发指南](docs/guide/DEVELOPMENT.md)
- [架构决策记录](docs/ADR/001-architecture-decisions.md)

## 许可证

MIT
