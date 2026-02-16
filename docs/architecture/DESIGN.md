# Pic System Design

## Architecture

Two pipelines: **Ingestion** (write) and **Search** (read).

### Ingestion Pipeline

```
Cron (hourly) → Processor scheduled handler
  → fetch 30 random Unsplash photos
  → send to Queue (process-photo messages)
  → Queue consumer creates PicIngestWorkflow per photo
  → Workflow steps:
      1. download-and-store: raw + display images → R2
      2. analyze-vision: LLaVA generates caption
      3. generate-embedding: BGE generates 768-dim vector
      4. persist-d1: metadata + embedding → D1
      5. enqueue-vector-index: send index-vector message → Queue
  → Queue consumer receives index-vector → VECTORIZE.upsert()
```

Vector indexing is done in the queue handler (not in Workflow) because Workflow steps don't have access to the Vectorize binding.

### Search Pipeline

```
User query → API Worker
  → BGE embedding of query text
  → Vectorize.query(vector, topK)
  → D1 lookup by matched IDs
  → return results with scores
```

## Components

| Component | Tech | Binding Name |
|-----------|------|-------------|
| API Worker | Hono | `pic-api` |
| Processor Worker | Queue/Workflow | `pic-processor` |
| Frontend | React + Vite (Pages) | `pic` |
| Database | D1 (SQLite) | `pic-db` |
| Object Storage | R2 | `pic-r2` |
| Vector Index | Vectorize (768d, cosine) | `pic-vectors` |
| Task Queue | Queues | `pic-ingestion` |
| Vision AI | `@cf/llava-hf/llava-1.5-7b-hf` | — |
| Embedding AI | `@cf/baai/bge-base-en-v1.5` | — |

## D1 Schema

```sql
CREATE TABLE images (
    id TEXT PRIMARY KEY,
    width INTEGER,
    height INTEGER,
    color TEXT,
    raw_key TEXT,
    display_key TEXT,
    meta_json TEXT,
    ai_tags TEXT,
    ai_caption TEXT,
    ai_embedding TEXT,
    created_at INTEGER
);
```

## R2 Layout

```
raw/{id}.jpg       # original quality
display/{id}.jpg   # optimized for web
```
