# Configuration Reference

## 1. Secrets

Set via `wrangler secret put <NAME>`:

| Name | Required | Description |
|------|----------|-------------|
| `UNSPLASH_API_KEY` | Yes | Unsplash Application Access Key |

## 2. Wrangler Config (`workers/pic-scheduler/wrangler.toml`)

### Core

```toml
name = "pic"
main = "src/index.ts"
compatibility_date = "2024-10-01"
compatibility_flags = ["nodejs_compat"]
```

### Bindings

| Binding | Type | Description |
|---------|------|-------------|
| `DB` | D1 Database | `pic-d1` — metadata storage |
| `R2` | R2 Bucket | `pic-r2` — image file storage |
| `AI` | Workers AI | Image classification models |
| `AE` | Analytics Engine | `pic-ae` — event logging |
| `PHOTO_WORKFLOW` | Workflow | `DataPipelineWorkflow` class |

### Cron Triggers

```toml
[triggers]
crons = ["0 * * * *"]
```

- `0 * * * *`: every hour at minute 0.
- Adjust: `0 */2 * * *` (every 2h), `0 0 * * *` (daily).
- Unsplash free tier: 50 requests/hour — hourly is safe.

### HTML Rules

```toml
[[rules]]
type = "Text"
globs = ["**/*.html"]
fallthrough = false
```

Allows importing `.html` files as text modules in TypeScript.

## 3. Runtime Config (`src/config.ts`)

Constants defined in code:

| Constant | Default | Description |
|----------|---------|-------------|
| `BATCH_SIZE` | 30 | Photos fetched per Unsplash API call |
| `MAX_PHOTOS_RETENTION` | 4000 | Max photos before cleanup triggers |

### State Table (D1)

Dynamic config stored in the `State` table:

```sql
-- View current config
SELECT * FROM State;

-- Adjust retention
UPDATE State SET value = '5000' WHERE key = 'max_photos';
UPDATE State SET value = '60' WHERE key = 'retention_days';
```

| Key | Default | Description |
|-----|---------|-------------|
| `last_page` | 1 | Unsplash pagination cursor |
| `last_cursor_time` | (empty) | Deduplication timestamp cursor |
| `last_cursor_id` | (empty) | Deduplication ID cursor |
| `retention_days` | 30 | Days to keep photos |
| `max_photos` | 4000 | Max photo count |
