# Pic Project

AI-powered image collection system built entirely on Cloudflare Serverless ecosystem.

## 🚀 Quick Start

```bash
# View live site
open https://pic.53.workers.dev

# Trigger workflow manually
curl -X POST https://pic-scheduler.53.workers.dev/api/trigger

# Run automated test
./test.sh
```

## 📊 Status

- **Frontend**: https://pic.53.workers.dev
- **Scheduler**: https://pic-scheduler.53.workers.dev
- **Cron**: Every 5 minutes
- **Processing**: 2 photos per workflow (testing mode)

See [STATUS.md](STATUS.md) for detailed status.

## 🏗️ Architecture

- **pic-scheduler**: Cron + Workflow orchestration
- **pic-frontend**: Web UI + API endpoints

**Tech Stack:**
- Cloudflare Workers (compute)
- Cloudflare D1 (SQLite database)
- Cloudflare R2 (object storage)
- Cloudflare Workflows (orchestration)
- Cloudflare AI (4 models for classification)
- Unsplash API (image source)

## 📁 Project Structure

```
pic/
├── README.md
├── STATUS.md              # Current deployment status
├── DEPLOY.md              # Deployment guide
├── test.sh                # Automated test script
├── package.json           # Root workspace config
├── .nvmrc                 # Node version (22.19.0)
└── workers/
    ├── pic-frontend/      (Worker: pic)
    │   ├── src/index.js
    │   ├── package.json
    │   └── wrangler.toml
    └── pic-scheduler/     (Worker: pic-scheduler)
        ├── src/
        │   ├── index.js
        │   ├── config.js
        │   ├── workflows/
        │   │   └── data-pipeline.js
        │   ├── tasks/
        │   │   ├── fetch-photos.js
        │   │   ├── process-photo.js
        │   │   ├── classify-with-model.js
        │   │   ├── extract-exif.js
        │   │   └── save-metadata.js
        │   └── services/
        ├── schema.sql
        ├── package.json
        └── wrangler.toml
```

## 🛠️ Development

```bash
# Install dependencies
npm install

# Develop scheduler
npm run dev:scheduler

# Develop frontend
npm run dev:frontend

# Deploy
npm run deploy:all
```

## 📖 Documentation

- [DEPLOY.md](DEPLOY.md) - Deployment instructions
- [STATUS.md](STATUS.md) - Current system status

## 🔗 Resources

- **pic-r2**: R2 bucket (shared)
- **pic-d1**: D1 database (shared)
- **pic-wf**: Workflow engine
- **AI**: 4 Cloudflare AI models

## 📝 License

MIT
