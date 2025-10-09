# Pic Project

完全基于 Cloudflare Serverless 生态的图片采集、处理和展示系统。

## 架构

- **pic-scheduler**: 后端调度器（Cron + Workflow）
- **pic**: 前端（Web界面 + API）

## 开发

```bash
# 开发前端
cd workers/pic
npm run dev

# 开发后端
cd workers/pic-scheduler
npm run dev
```

## 部署

```bash
# 部署前端
npx wrangler deploy --config workers/pic/wrangler.toml

# 部署后端
npx wrangler deploy --config workers/pic-scheduler/wrangler.toml
```

## 资源

- **pic-r2**: R2 存储桶（共享）
- **pic-d1**: D1 数据库（共享）
- **pic-wf**: Workflow
- **AI**: Cloudflare AI（4个模型）
