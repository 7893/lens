# 🖼️ Pic - AI-Powered Image Collection System

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

An automated image collection and classification system built entirely on Cloudflare's serverless ecosystem. Fetches photos from Unsplash API, classifies them using AI, and stores them in R2 with metadata in D1 database.

## ✨ Features

- 🤖 **Automated Collection**: Fetches 60 photos every 10 minutes from Unsplash
- 🧠 **AI Classification**: Uses 2 Cloudflare AI models for intelligent categorization
- 📦 **Serverless Architecture**: 100% Cloudflare Workers, D1, R2, and Workflows
- 🔄 **Cursor-Based Sync**: Prevents duplicate photos with smart pagination
- 📊 **Real-time Stats**: Live dashboard with processing metrics
- 🎯 **Checkpoint System**: Fault-tolerant processing with automatic retry

## 🚀 Quick Start

### Prerequisites

- Node.js 22.19.0 (see `.nvmrc`)
- Cloudflare account with Workers, D1, R2, and AI enabled
- Unsplash API key

### Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd pic

# Install dependencies
npm install

# Set up environment variables
cp workers/pic-scheduler/.env.example workers/pic-scheduler/.env
# Edit .env and add your UNSPLASH_API_KEY
```

### Deployment

```bash
# Deploy all services
npm run deploy

# Or deploy individually
npm run deploy:scheduler
npm run deploy:frontend
```

## 📁 Project Structure

```
pic/
├── .github/
│   └── workflows/          # GitHub Actions CI/CD
├── docs/                   # Documentation
│   ├── DEPLOY.md          # Deployment guide
│   ├── STATUS.md          # System status
│   └── SUMMARY.md         # Project summary
├── scripts/               # Utility scripts
│   └── test.sh           # System test script
├── workers/
│   ├── pic-scheduler/    # Backend worker
│   │   ├── src/
│   │   │   ├── workflows/    # Download & Classify workflows
│   │   │   ├── tasks/        # Task implementations
│   │   │   ├── services/     # External services
│   │   │   └── utils/        # Utilities
│   │   ├── schema.sql        # D1 database schema
│   │   └── wrangler.toml     # Worker configuration
│   └── pic-frontend/     # Frontend worker
│       ├── src/
│       └── wrangler.toml
├── package.json          # Root workspace config
├── .nvmrc               # Node version lock
└── README.md
```

## 🏗️ Architecture

### Components

- **pic-scheduler**: Cron-triggered backend that orchestrates photo collection
- **pic-frontend**: Web UI for browsing photos and viewing stats
- **pic-download-wf**: Workflow for downloading photos to R2
- **pic-classify-wf**: Workflow for AI classification

### Tech Stack

| Component | Technology |
|-----------|-----------|
| Compute | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Storage | Cloudflare R2 |
| Orchestration | Cloudflare Workflows |
| AI | Cloudflare AI (Llama 3.2-3B, Mistral 7B) |
| Analytics | Analytics Engine |
| Image Source | Unsplash API |

### Data Flow

```
Cron (every 10 min)
  → EnqueuePhotosTask (fetch 60 photos via 2 API calls)
    → ProcessingQueue (pending)
      → DownloadWorkflow (download to R2)
        → ProcessingQueue (downloaded)
          → ClassifyWorkflow (AI classification)
            → Photos table (completed)
```

## 📊 Performance

- **Throughput**: 360 photos/hour (8,640/day)
- **API Usage**: 288 Unsplash API calls/day
- **AI Inference**: ~17,000 calls/day (2 models × 8,640 photos)
- **Success Rate**: 100% (with retry mechanism)

## 🛠️ Development

```bash
# Start local development
npm run dev:scheduler
npm run dev:frontend

# Run tests
npm test

# Check system status
./scripts/test.sh
```

## 📖 Documentation

- [Deployment Guide](docs/DEPLOY.md)
- [System Status](docs/STATUS.md)
- [Project Summary](docs/SUMMARY.md)

## 🔗 Live Demo

- **Frontend**: https://pic.53.workers.dev
- **Scheduler API**: https://pic-scheduler.53.workers.dev

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [Unsplash](https://unsplash.com/) for providing the photo API
- [Cloudflare](https://cloudflare.com/) for the serverless platform
