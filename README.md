# Pic - Semantic Image Gallery

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Pic** is an AI-powered photo gallery built on Cloudflare's serverless ecosystem, featuring semantic search via Vectorize and automated ingestion via Workflows.

## Features

- **Semantic Search**: search with natural language like "sad rainy day" or "cyberpunk city"
- **Dual Pipeline**: async ingestion (download → AI vision → embedding → index) + fast search API
- **Dual Storage**: raw originals + optimized display images on R2
- **Full AI**: LLaVA for image understanding, BGE for vector embeddings

## Architecture

```mermaid
graph TD
    User((User)) -->|Search Query| API[Search API]
    API -->|Vector Search| Vectorize[(Vector DB)]
    API -->|Metadata| D1[(D1 DB)]
    
    subgraph IngestionPipeline [Ingestion Pipeline Async]
        Cron[Cron Trigger] -->|Fetch Tasks| Queue[Cloudflare Queue]
        Queue -->|Process| Workflow[PicIngestWorkflow]
        
        Workflow -->|1. Download| R2[(R2 Bucket)]
        Workflow -->|2. Analyze| AI_Vision[Vision Model]
        Workflow -->|3. Embed| AI_Embed[Embedding Model]
        Workflow -->|4. Persist| D1
        Workflow -->|5. Index| Vectorize
    end
```

## Quick Start

```bash
git clone https://github.com/7893/pic.git
cd pic
npm install
npm run dev
```

See [Setup Guide](docs/guide/SETUP.md) for full deployment instructions.

## Docs

- [System Design](docs/architecture/DESIGN.md)
- [Frontend Architecture](docs/architecture/FRONTEND_DESIGN.md)
- [API Reference](docs/api/OPENAPI.md)
- [Development Guide](docs/guide/DEVELOPMENT.md)
- [Architecture Decisions](docs/ADR/001-architecture-decisions.md)

## License

MIT
