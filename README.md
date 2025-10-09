# Pic Project

完全基于 Cloudflare Serverless 生态的图片采集、处理和展示系统。

## 架构

- **pic-scheduler**: 后端调度器（Cron + Workflow）
- **pic-frontend**: 前端（Web界面 + API）

## 项目结构

```
pic/
├── README.md
├── .gitignore
└── workers/
    ├── pic-frontend/          (Worker名: pic)
    │   ├── src/index.js
    │   ├── package.json
    │   └── wrangler.toml
    └── pic-scheduler/         (Worker名: pic-scheduler)
        ├── src/
        ├── package.json
        └── wrangler.toml
```

## 开发

```bash
# 开发前端
cd workers/pic-frontend
npm run dev

# 开发后端
cd workers/pic-scheduler
npm run dev
```

## 部署（从项目根目录执行）

```bash
# 部署前端 (https://pic.53.workers.dev)
npx wrangler deploy --config workers/pic-frontend/wrangler.toml

# 部署后端 (https://pic-scheduler.53.workers.dev)
npx wrangler deploy --config workers/pic-scheduler/wrangler.toml
```

## Workers

- **pic**: https://pic.53.workers.dev (前端)
- **pic-scheduler**: https://pic-scheduler.53.workers.dev (后端)

## 资源

- **pic-r2**: R2 存储桶（共享）
- **pic-d1**: D1 数据库（共享）
- **pic-wf**: Workflow
- **AI**: Cloudflare AI（4个模型）
