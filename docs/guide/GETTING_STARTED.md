# 🚀 Getting Started

Deploy the Pic AI photo gallery on Cloudflare.

## Prerequisites

1. **Cloudflare account** with Workers, D1, R2, Workers AI, and Workflows enabled.
2. **Unsplash developer account** — create an app at [Unsplash Developers](https://unsplash.com/developers) and get the Access Key. Free tier: 50 requests/hour.
3. **Node.js** >= 22 and npm >= 11 (see `.nvmrc` and `package.json` engines).
4. **Wrangler CLI**: `npm install -g wrangler && wrangler login`

## Deployment

### 1. Clone & install

```bash
git clone https://github.com/your-username/pic.git
cd pic
npm install
```

### 2. Create resources

```bash
# Create D1 database
wrangler d1 create pic-d1
# ⚠️ Copy the database_id into workers/pic-scheduler/wrangler.toml

# Initialize schema
wrangler d1 execute pic-d1 --remote --file=workers/pic-scheduler/schema.sql

# Create R2 bucket
wrangler r2 bucket create pic-r2
```

### 3. Set secrets

```bash
wrangler secret put UNSPLASH_API_KEY
```

### 4. Deploy

```bash
npm run deploy
```

Or via CI: push to `main` triggers GitHub Actions deployment automatically.

## Verification

After deployment you get a URL like `https://pic.<subdomain>.workers.dev`.

```bash
# Health check
curl https://pic.<subdomain>.workers.dev/health

# System stats
curl https://pic.<subdomain>.workers.dev/api/stats

# Manual trigger (first run)
curl -X POST https://pic.<subdomain>.workers.dev/api/trigger
```

Wait 1-2 minutes for workflows to process, then visit the homepage to see photos.

## Next Steps

- [Configuration Reference](../reference/CONFIGURATION.md)
- [Development Guide](DEVELOPMENT.md)
- [FAQ & Troubleshooting](../troubleshooting/FAQ.md)
