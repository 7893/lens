# 🛠️ Development Guide

## Local Setup

```bash
git clone https://github.com/your-username/pic.git
cd pic
npm install
```

## TypeScript

The project is fully written in TypeScript with `strict: true`.

- Compiler: `typescript`
- Type definitions: `@cloudflare/workers-types`
- Type check: `npm run lint` (runs `tsc --noEmit`)

Wrangler natively resolves `.ts` files — no manual compilation needed.

## Running & Debugging

### Dev server

```bash
npm run dev
```

### Simulate triggers

```bash
# Trigger the data pipeline manually
curl -X POST http://localhost:8787/api/trigger

# Check local D1
wrangler d1 execute pic-d1 --local --command "SELECT * FROM Photos"
```

### Workflow notes

- `step.do` executes immediately in local dev.
- `step.sleep` may skip or resolve quickly.
- Check console output for stack traces on errors.

## Project Structure

All source code is in `workers/pic-scheduler/src/`:

```
src/
├── index.ts              # Entry: fetch router + scheduled handler
├── config.ts             # Runtime constants
├── env.d.ts              # Env interface & module declarations
├── types.ts              # Data model interfaces
├── services/
│   ├── ai-classifier.ts  # AI model invocation
│   ├── downloader.ts     # Image download from Unsplash
│   └── unsplash.ts       # Unsplash API client
├── tasks/
│   ├── enqueue-photos.ts # Fetch & deduplicate new photos
│   ├── fetch-photos.ts   # Photo list fetching
│   ├── process-photo.ts  # Single photo processing
│   ├── classify-with-model.ts
│   ├── extract-exif.ts
│   └── save-metadata.ts
├── workflows/
│   ├── data-pipeline.ts      # Main orchestration workflow
│   ├── download-workflow.ts   # Batch download workflow
│   └── classify-workflow.ts   # Batch classification workflow
└── utils/
    └── analytics.ts      # Analytics Engine helpers
```

## Code Style

- Lint: `npm run lint` (runs `tsc --noEmit`)
- Format: `npm run format` (Prettier, targets `*.ts`, `*.json`, `*.md`)
- Pre-commit hook: husky + lint-staged runs Prettier on staged `.ts` files

### Commit messages

English, single line, concise. Follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat: add category filter endpoint`
- `fix: resolve R2 upload timeout`
- `docs: update architecture diagram`

## Local Secrets

Create `.dev.vars` in `workers/pic-scheduler/` for local development:

```
UNSPLASH_API_KEY=your_key_here
```

For production, use `wrangler secret put UNSPLASH_API_KEY`.

## AI

`wrangler dev` connects to remote Cloudflare AI (requires `wrangler login` with AI-enabled account).
