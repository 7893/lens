# 🖼️ Lens v6.0 - 极致 AI 图片画廊

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Lens** 是一个基于 Cloudflare Serverless 生态构建的现代化智能图库系统。它能够全自动采集 Unsplash 高画质原图，利用大模型进行视觉理解，并提供极具工业感的语义搜索体验。

## 🌟 核心亮点 (Why Lens?)

- **⚡ 语义重排搜索**: 结合向量匹配与 LLM (Llama 3.2) 二次重排，搜索“悲伤的猫”不仅仅是搜标签，而是理解画面意境。
- **🦖 霸道采集算法**: 采用“双向贪婪”模式，每小时自动榨干 Unsplash API 配额，追赶新发布的同时，稳步挖掘历史库存。
- **💾 RAW 级存档**: 自动存储 50MB+ 的原始画质大图到 R2，同时生成优化的展示流。
- **🛠️ 极致工程化**: 全栈 Monorepo 结构，基础设施即代码 (Terraform)，双管道解耦设计。

## 📐 系统架构 (Architecture)

```mermaid
graph TD
    User((用户)) -->|搜索/浏览| API[Search API (Hono)]
    API -->|1.查询扩展| AI_LLM[Llama 3.2]
    API -->|2.向量检索| Vectorize[(Vectorize DB)]
    API -->|3.结果重排| AI_LLM

    subgraph Ingestion [Ingestion Pipeline Async]
        Cron[⏰ 每小时触发] -->|新图+回填| Processor[Processor Worker]
        Processor -->|任务缓冲| Queue[Cloudflare Queue]
        Queue -->|执行任务| Workflow[LensIngestWorkflow]

        Workflow -->|1.并行流下载| R2[(R2 Bucket)]
        Workflow -->|2.视觉理解| AI_Vision[LLaVA 1.5]
        Workflow -->|3.向量化| AI_Embed[BGE Large]
        Workflow -->|4.持久化| D1[(D1 DB)]
    end
```

## 📚 文档中心

- [**系统设计 (System Design)**](docs/architecture/DESIGN.md): 详细解析双向贪婪算法与偏移修正原理。
- [**API 参考 (API Reference)**](docs/api/OPENAPI.md): 了解查询扩展与重排接口协议。
- [**部署指南 (Setup Guide)**](docs/guide/SETUP.md): 从 Terraform 资源创建到代码部署。

## 🚀 快速启动

```bash
# 1. 初始化基础设施 (D1, R2, Vectorize, Queues)
cd terraform && terraform apply

# 2. 部署采集与 API 服务
npm run deploy

# 3. 部署前端画廊
cd apps/web && npm run deploy
```

## 📝 许可证

MIT License
