# Development Guide

Pic uses npm workspaces monorepo.

## Structure

```
pic/
├── apps/
│   ├── api/          # Hono Worker (API + static frontend)
│   ├── processor/    # Queue/Workflow Worker (ingestion)
│   └── web/          # React + Vite + Tailwind (source)
├── packages/
│   └── shared/       # Shared TypeScript types
├── terraform/        # IaC (optional)
└── docs/
```

## Install

```bash
npm install
```

## Local Dev

```bash
# Build web and copy to api
npm run build --workspace=@pic/web
cp -r apps/web/dist apps/api/public

# Start main Worker (API + frontend)
npm run dev --workspace=apps/api

# Start Processor Worker
npm run dev --workspace=apps/processor
```

## Type Check

```bash
cd apps/api && npx tsc --noEmit
cd apps/processor && npx tsc --noEmit
cd apps/web && npx tsc --noEmit
cd packages/shared && npx tsc --noEmit
```

## Deploy

Push to `main` triggers GitHub Actions CI/CD. See `.github/workflows/` for details.
