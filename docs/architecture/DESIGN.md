# Pic System Design

## Architecture

Two pipelines: **Ingestion** (write) and **Search** (read).

```mermaid
graph TD
    User((用户)) -->|搜索/浏览| Worker[pic Worker]
    Worker -->|向量搜索| Vectorize[(Vector DB)]
    Worker -->|元数据| D1[(D1 DB)]
    Worker -->|图片| R2[(R2)]
    
    subgraph 采集管道
        Cron[定时触发] -->|获取任务| Queue[Queue]
        Queue -->|处理| Workflow[PicIngestWorkflow]
        Workflow -->|1. 下载| R2
        Workflow -->|2. AI 分析| AI_Vision[Vision Model]
        Workflow -->|3. 向量化| AI_Embed[Embedding Model]
        Workflow -->|4. 写入| D1
    end
    
    Cron -->|同步向量| Vectorize
```

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
  → Cron also syncs all D1 embeddings → Vectorize (idempotent upsert)
```

### Search Pipeline

```
User query → pic Worker (Hono)
  → BGE embedding of query text
  → Vectorize.query(vector, topK)
  → D1 lookup by matched IDs
  → return results with scores
```

Frontend is bundled as static assets in the same Worker.

## Components

| Component | Tech | Name |
|-----------|------|------|
| Main Worker | Hono (API + static frontend) | `pic` |
| Processor Worker | Queue/Workflow | `pic-processor` |
| Database | D1 (SQLite) | `pic-db` |
| Object Storage | R2 | `pic-r2` |
| Vector Index | Vectorize (768d, cosine) | `pic-vectors` |
| Task Queue | Queues | `pic-ingestion` |
| Vision AI | `@cf/meta/llama-3.2-11b-vision-instruct` | — |
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
