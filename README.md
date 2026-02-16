# Lens

[![Live](https://img.shields.io/badge/Live-lens.53.workers.dev-F38020?logo=cloudflare&logoColor=white)](https://lens.53.workers.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MIT](https://img.shields.io/badge/MIT-blue.svg)](LICENSE)

Search images by meaning, not keywords.

Type "loneliness" and get a figure walking through a snowy alley at night. Type "warmth" and get a fireplace. The AI actually understands what's in every photo.

---

### Three-Stage Search Pipeline

```
Query → LLM Expansion → Vector Retrieval → LLM Re-ranking → Results
```

**Stage 1 — Query Expansion.** Llama 3.2 translates and enriches the query. Supports any language.

**Stage 2 — Vector Retrieval.** BGE Large encodes the expanded query into a 1024-dim vector. Vectorize returns the top 100 candidates by cosine similarity.

**Stage 3 — LLM Re-ranking.** Llama 3.2 re-scores the top 50 candidates by semantic relevance. Fixes what vector search gets wrong.

### Autonomous Ingestion

Every hour, a cron job pulls 30 random photos from Unsplash. Each one goes through a Workflow pipeline:

**Download → Llama 3.2 Vision → BGE Large Embedding → D1 + Vectorize**

The embedding fuses AI caption, tags, alt description, photographer, location, and topic metadata. Every step retries independently. The gallery grows on its own, forever.

### Stack

Hono · React · Vite · Tailwind · D1 · R2 · Vectorize · Queues · Workflows · Llama 3.2 11B Vision · BGE Large 1024d · Terraform · GitHub Actions

Two Workers. Zero servers. 55-second deploys.

### What Makes This Different

- **Three-stage search** — most vector search apps stop at retrieval. Lens adds LLM expansion before and LLM re-ranking after.
- **Full metadata embedding** — vectors encode not just AI captions, but location, photographer, topics, and Unsplash descriptions. Search "Dubai" and it matches by geography, not just visual similarity.
- **Multilingual** — query in Chinese, Japanese, or any language. The LLM translates before embedding.
- **Complete data pipeline** — every Unsplash field is stored, served via API, and rendered in the frontend. Nothing is thrown away.
- **Edge-native AI** — three AI tasks (vision, expansion, re-ranking) all run on Cloudflare's edge. No external API calls. No GPU instances.
- **Self-healing** — Cron → Queue → Workflow. Each step is durable and retries on failure. The system runs unattended.

### Docs

[System Design](docs/architecture/DESIGN.md) · [Frontend](docs/architecture/FRONTEND_DESIGN.md) · [API Reference](docs/api/OPENAPI.md) · [Development](docs/guide/DEVELOPMENT.md) · [Deployment](docs/guide/SETUP.md) · [ADR](docs/ADR/001-architecture-decisions.md)
