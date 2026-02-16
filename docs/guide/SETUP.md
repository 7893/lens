# Setup Guide (Production)

This guide will walk you through setting up Pic v6.0 on Cloudflare.

## Prerequisites

- **Cloudflare Account**: Workers (Standard), D1, R2, Vectorize, Queues, AI.
- **Unsplash API Key**: [Apply Here](https://unsplash.com/developers).
- **Wrangler CLI**: `npm install -g wrangler` (or `pnpm`).

## Infrastructure Provisioning

We use Wrangler to manage Cloudflare resources.

### 1. Database (D1)

Create the main metadata database:

```bash
wrangler d1 create pic-v6-db
```
*   **Important**: Copy the `database_id` and paste it into `apps/api/wrangler.toml` and `apps/processor/wrangler.toml`.

Apply the schema:
```bash
wrangler d1 execute pic-v6-db --remote --file=apps/processor/schema.sql
```

### 2. Object Storage (R2)

Create the bucket for image assets:

```bash
wrangler r2 bucket create pic-v6-assets
```
*   (Optional) Configure public access or a custom domain in Cloudflare Dashboard if you want direct access without worker proxy.

### 3. Vector Database (Vectorize)

Create the semantic index:

```bash
wrangler vectorize create pic-v6-vectors --dimensions=768 --metric=cosine
```
*   **Note**: `768` dimensions match the `bge-base-en-v1.5` model output size.

### 4. Message Queue (Queues)

Create the ingestion task queue:

```bash
wrangler queues create pic-v6-ingestion
```

## Configuration (Secrets)

Set the Unsplash API Key for the **Processor Worker** (Ingestion Pipeline):

```bash
cd apps/processor
wrangler secret put UNSPLASH_API_KEY
# Enter your key when prompted
```

## Deployment

Deploy both workers:

```bash
# Deploy Backend API (Search Pipeline)
cd apps/api
npm run deploy

# Deploy Processor (Ingestion Pipeline)
cd ../processor
npm run deploy
```

Deploy Frontend:

```bash
cd ../../apps/web
npm run build
npm run deploy  # Or connect GitHub repo to Cloudflare Pages
```

## Verification

1.  **Check API**: Visit `https://api.<your-worker>.workers.dev/health`.
2.  **Trigger Ingestion**: Manually trigger a cron run via Cloudflare Dashboard or `curl -X POST ...`.
3.  **Search**: Visit your frontend URL and try searching "sunset".
