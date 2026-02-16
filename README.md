# Pic - 智能语义图库

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

基于 Cloudflare Serverless 生态构建的 AI 图库系统，支持自然语言语义搜索。

## 特性

- **语义搜索**：用自然语言搜图，如"忧郁的雨天"、"赛博朋克城市"
- **双管道架构**：异步采集（下载 → AI 视觉分析 → 向量化 → 索引）+ 极速搜索 API
- **双流存储**：原始大图 + 优化展示图，均存储在 R2
- **全栈 AI**：LLaVA 理解图片内容，BGE 生成向量索引

## 架构

```mermaid
graph TD
    User((用户)) -->|搜索| API[Search API]
    API -->|向量搜索| Vectorize[(Vector DB)]
    API -->|元数据| D1[(D1 DB)]
    
    subgraph 采集管道
        Cron[定时触发] -->|获取任务| Queue[Queue]
        Queue -->|处理| Workflow[PicIngestWorkflow]
        Workflow -->|1. 下载| R2[(R2)]
        Workflow -->|2. AI 分析| AI_Vision[Vision Model]
        Workflow -->|3. 向量化| AI_Embed[Embedding Model]
        Workflow -->|4. 写入| D1
        Workflow -->|5. 索引| Vectorize
    end
```

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
