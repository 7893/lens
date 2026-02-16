# Setup Guide

## Prerequisites

- Node.js 20+
- Cloudflare account with Workers Standard plan (D1, R2, Vectorize, Queues, Workers AI)
- Unsplash API Key: https://unsplash.com/developers
- Wrangler CLI: `npm install -g wrangler`
- (Optional) Terraform CLI for IaC

## Infrastructure

### Option A: Terraform

```bash
cd terraform
cp terraform.tfvars.example terraform.tfvars  # fill in account_id, api_token
terraform init
terraform apply
```

### Option B: Wrangler CLI

```bash
# D1
wrangler d1 create pic-v6-prod-db
wrangler d1 execute pic-v6-prod-db --remote --file=apps/processor/schema.sql

# R2
wrangler r2 bucket create pic-v6-prod-assets

# Vectorize (768 dims = bge-base-en-v1.5)
wrangler vectorize create pic-v6-prod-vectors --dimensions=768 --metric=cosine

# Queue
wrangler queues create pic-v6-prod-ingestion
```

Update resource IDs in `apps/api/wrangler.toml` and `apps/processor/wrangler.toml`.

## Secrets

```bash
cd apps/processor
wrangler secret put UNSPLASH_API_KEY
```

## Deploy

CI/CD via GitHub Actions (`.github/workflows/`). On push to `main`:

1. Builds shared package
2. Deploys API Worker (`pic-api`)
3. Deploys Processor Worker (`pic-processor`)
4. Builds and deploys Web to Cloudflare Pages (`pic-v6-prod-web`)

Manual deploy:
```bash
npm run build --workspace=@pic/shared
npm run deploy --workspace=apps/api
npm run deploy --workspace=apps/processor
npm run build --workspace=@pic/web && npx wrangler pages deploy apps/web/dist --project-name=pic-v6-prod-web
```

## Verify

1. Health: `curl https://pic-api.53.workers.dev/health`
2. Wait for cron (hourly) or trigger manually in Cloudflare Dashboard
3. Search: `curl "https://pic-api.53.workers.dev/api/search?q=sunset&limit=3"`
