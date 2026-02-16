# Development Guide

Pic v6.0 uses npm workspaces monorepo.

## Structure

```
pic/
├── apps/
│   ├── api/          # Hono Worker (search, image proxy)
│   ├── processor/    # Queue/Workflow Worker (ingestion)
│   └── web/          # React + Vite + Tailwind (Pages)
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
# API Worker
npm run dev --workspace=apps/api

# Processor Worker
npm run dev --workspace=apps/processor

# Frontend
npm run dev --workspace=apps/web
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
