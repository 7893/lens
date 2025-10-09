# Deployment Guide

## Prerequisites

- Node.js >= 22.19.0
- npm >= 11.6.1
- wrangler 4.42.1
- Cloudflare account with Workers, D1, R2, AI enabled

## Initial Setup

### 1. Database Schema

```bash
npx wrangler d1 execute pic-d1 --remote --file workers/pic-scheduler/schema.sql
```

### 2. Verify Tables

```bash
npx wrangler d1 execute pic-d1 --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

Expected tables:
- State
- Photos
- GlobalStats
- CategoryStats
- WorkflowRuns
- ApiQuota

### 3. Deploy Workers

```bash
# Deploy scheduler (backend)
npm run deploy:scheduler

# Deploy frontend
npm run deploy:frontend

# Or deploy both
npm run deploy:all
```

## Verify Deployment

### Check Scheduler Health

```bash
curl https://pic-scheduler.53.workers.dev/health
```

### Check Frontend

```bash
curl https://pic.53.workers.dev/api/stats
```

### Trigger Manual Workflow

```bash
curl -X POST https://pic-scheduler.53.workers.dev/api/trigger
```

## Monitoring

### View Logs

```bash
# Scheduler logs
npx wrangler tail pic-scheduler

# Frontend logs
npx wrangler tail pic
```

### Check Database

```bash
# Count photos
npx wrangler d1 execute pic-d1 --remote --command "SELECT COUNT(*) as total FROM Photos"

# View stats
npx wrangler d1 execute pic-d1 --remote --command "SELECT * FROM GlobalStats"

# View categories
npx wrangler d1 execute pic-d1 --remote --command "SELECT * FROM CategoryStats ORDER BY photo_count DESC"
```

## Cron Schedule

The scheduler runs every 5 minutes automatically via Cloudflare Cron Triggers.

To modify the schedule, edit `workers/pic-scheduler/wrangler.toml`:

```toml
[triggers]
crons = ["*/5 * * * *"]  # Every 5 minutes
```

## Troubleshooting

### Reset Database

```bash
npx wrangler d1 execute pic-d1 --remote --command "DELETE FROM Photos"
npx wrangler d1 execute pic-d1 --remote --command "UPDATE State SET value='0' WHERE key='last_page'"
npx wrangler d1 execute pic-d1 --remote --command "UPDATE GlobalStats SET total_photos=0, total_workflows=0 WHERE id=1"
```

### Check R2 Storage

```bash
npx wrangler r2 object list pic-r2 --limit 10
```
