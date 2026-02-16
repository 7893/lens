# Development Guide (Monorepo)

Pic v6.0 uses a Monorepo structure managed by npm workspaces.

## Structure

```
pic/
├── apps/
│   ├── api/          # Hono Worker (Search & API)
│   ├── processor/    # Queue Worker (Ingestion Pipeline)
│   └── web/          # React + Vite (Frontend)
├── packages/
│   └── shared/       # Shared TypeScript types & configs
├── package.json      # Workspace root
```

## Prerequisites

- Node.js 20+
- Cloudflare Wrangler (`npm i -g wrangler`)
- Git

## Installation

```bash
# Install dependencies for all workspaces
npm install
```

## Running Locally

### 1. Initialize Infrastructure (Local D1/R2/Vectorize)

```bash
# Create local D1 database
npm run setup:local-db
```

### 2. Start Services

You can run services independently:

```bash
# Start API Worker
npm run dev --workspace=apps/api

# Start Processor Worker (Simulates Queue/Cron)
npm run dev --workspace=apps/processor

# Start Frontend
npm run dev --workspace=apps/web
```

Or run all backend services together (recommended):

```bash
npm run dev:backend
```

## Testing

We use Vitest for unit testing.

```bash
# Run tests for all packages
npm test
```

## Deployment

```bash
# Deploy all workers
npm run deploy

# Deploy frontend only
npm run deploy:web
```
