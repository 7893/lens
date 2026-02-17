# Lens System Design

## Architecture

Two pipelines: **Ingestion** (write) and **Search** (read).

```mermaid
graph TD
    User((用户)) -->|搜索/浏览| Worker[lens Worker]
    Worker -->|向量搜索| Vectorize[(Vector DB)]
    Worker -->|元数据| D1[(D1 DB)]
    Worker -->|图片| R2[(R2)]
    
    subgraph 采集管道
        Cron[定时触发] -->|获取任务| Queue[Queue]
        Queue -->|处理| Workflow[LensIngestWorkflow]
        Workflow -->|1. 下载| R2
        Workflow -->|2. AI 分析| AI_Vision[Vision Model]
        Workflow -->|3. 向量化| AI_Embed[Embedding Model]
        Workflow -->|4. 写入| D1
        Workflow -->|5. 同步| Vectorize
    end
    
    Cron -->|兜底同步| Vectorize
```

### Ingestion Pipeline

```
Cron (hourly) → Processor scheduled handler
  → read high watermark (latest Unsplash created_at) from system_config
  → fetch latest Unsplash photos page by page (order_by=latest)
  → stop when photo.created_at < watermark (dedup same-second by ID)
  → send new photos to Queue (process-photo messages)
  → update high watermark in system_config
  → backfill: use remaining API quota to scan deeper pages for gaps
  → Queue consumer creates LensIngestWorkflow per photo
  → Workflow steps:
      1. download-and-store: raw + display images → R2
      2. analyze-vision: Llama 3.2 Vision generates caption + tags
      3. generate-embedding: BGE Large generates 1024-dim vector
      4. persist-d1: metadata + embedding → D1
      5. sync-vectorize: upsert vector → Vectorize (real-time)
  → Cron catch-up sync: fallback upsert for any records missed by Workflow
```

### Search Pipeline

```
User query → lens Worker (Hono)
  → Llama 3.2 expands short queries (query expansion)
  → BGE Large embedding of expanded query text
  → Vectorize.query(vector, topK)
  → D1 lookup by matched IDs
  → return results with scores + full metadata
```

Frontend is bundled as static assets in the same Worker.

## Components

| Component | Tech | Name |
|-----------|------|------|
| Main Worker | Hono (API + static frontend) | `lens` |
| Processor Worker | Queue/Workflow | `lens-processor` |
| Database | D1 (SQLite) | `lens-db` |
| Object Storage | R2 | `lens-r2` |
| Vector Index | Vectorize (1024d, cosine) | `lens-vectors-v2` |
| Task Queue | Queues | `lens-queue` |
| Vision AI | `@cf/meta/llama-3.2-11b-vision-instruct` | — |
| Embedding AI | `@cf/baai/bge-large-en-v1.5` | — |

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

CREATE TABLE system_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
);
```

## R2 Layout

```
raw/{id}.jpg       # original quality
display/{id}.jpg   # optimized for web
```
