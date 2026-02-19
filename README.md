# Lens

**AI-Powered Semantic Image Search on Cloudflare Edge**

> 你搜"孤独感"，它给你一条雪夜独行的小巷。你搜"温暖"，它给你壁炉旁的猫。
> 不是关键词匹配 — 是 AI 真的看懂了每一张图。

[![TypeScript](https://img.shields.io/badge/100%25-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 项目理念

Lens 是一个**全自动、语义驱动**的 AI 图片搜索引擎，它完全运行在边缘网络上，无需人工运维。通过深度理解图像的意境与语义，它让搜索从简单的关键词匹配进化到了情感与内容的共鸣。

---

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
        Workflow -->|2.视觉理解| AI_Vision[Vision Model]
        Workflow -->|3.向量化| AI_Embed[BGE Large]
        Workflow -->|4.持久化元数据| D1[(D1 Database)]
    end
```

---

## 🌟 核心亮点

- **⚡ 语义重排搜索**: 结合向量匹配与大语言模型二次重排，让搜索结果更加贴合人类直觉。
- **🦖 智能采集算法**: “双向贪婪”模式，自动追赶新发布内容的同时，稳步挖掘历史库，确保数据始终鲜活。
- **💾 极致存档**: 自动存储原始画质大图，并针对展示流进行极致优化。
- **🛠️ 极致工程化**: 核心逻辑完全解耦，采集引擎独立于搜索流量，互不干扰。

---

## 📚 文档中心

- [**系统设计 (System Design)**](docs/architecture/DESIGN.md): 详细解析双管道架构与核心算法原理。
- [**API 参考 (API Reference)**](docs/api/OPENAPI.md): 了解查询扩展与搜索接口细节。
- [**部署指南 (Setup Guide)**](docs/guide/SETUP.md): 了解从零构建基础设施的详细流程。

---

## License

MIT
