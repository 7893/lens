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
wrangler d1 create lens-db
wrangler d1 execute lens-db --remote --file=apps/processor/schema.sql

# R2
wrangler r2 bucket create lens-r2

# Vectorize (1024 dims = bge-large-en-v1.5)
wrangler vectorize create lens-vectors-v2 --dimensions=1024 --metric=cosine

# Queue
wrangler queues create lens-queue
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
2. Builds web frontend → copies to `apps/api/public`
3. Deploys `lens` Worker (API + frontend)
4. Deploys `lens-processor` Worker

Manual deploy:

```bash
npm run build --workspace=@lens/shared
npm run build --workspace=@lens/web
cp -r apps/web/dist apps/api/public
cd apps/api && npx wrangler deploy
cd ../processor && npx wrangler deploy
```

## Verify

1. Open: `https://lens.53.workers.dev/`
2. Health: `curl https://lens.53.workers.dev/health`
3. Search: `curl "https://lens.53.workers.dev/api/search?q=sunset&limit=3"`
