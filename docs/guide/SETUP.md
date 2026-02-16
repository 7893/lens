# 部署指南 (Setup Guide)

本文档将指导你在 Cloudflare 平台上从零部署 Pic v6.0 系统。

## 前置要求 (Prerequisites)

- **Cloudflare 账号**: 必须开通 Workers (Standard 付费版), D1, R2, Vectorize, Queues, Workers AI。
- **Unsplash API Key**: [申请免费 API Key](https://unsplash.com/developers)。
- **Wrangler CLI**: `npm install -g wrangler` (推荐使用 pnpm)。

## 基础设施配置 (Infrastructure)

我们使用 Wrangler CLI 来管理 Cloudflare 资源。

### 1. 数据库 (D1 Database)

创建主元数据数据库：

```bash
wrangler d1 create pic-v6-db
```
*   **⚠️ 重要**: 复制命令输出的 `database_id`，并将其粘贴到 `apps/api/wrangler.toml` 和 `apps/processor/wrangler.toml` 文件的 `[[d1_databases]]` 配置段中。

初始化数据库表结构：
```bash
wrangler d1 execute pic-v6-db --remote --file=apps/processor/schema.sql
```

### 2. 对象存储 (R2 Storage)

创建用于存储图片的存储桶：

```bash
wrangler r2 bucket create pic-v6-assets
```
*   (可选) 在 Cloudflare Dashboard 中配置公开访问或绑定自定义域名，以便无需通过 Worker 代理即可直接访问图片。

### 3. 向量数据库 (Vectorize)

创建用于语义搜索的向量索引：

```bash
wrangler vectorize create pic-v6-vectors --dimensions=768 --metric=cosine
```
*   **注意**: `768` 维度必须与我们使用的 Embedding 模型 (`bge-base-en-v1.5`) 输出一致。

### 4. 消息队列 (Queues)

创建采集任务队列：

```bash
wrangler queues create pic-v6-ingestion
```

## 环境变量 (Secrets)

为 **Processor Worker** (采集流水线) 设置 Unsplash API Key：

```bash
cd apps/processor
wrangler secret put UNSPLASH_API_KEY
# 按提示输入你的 API Key
```

## 部署应用 (Deployment)

按顺序部署所有 Worker：

```bash
# 1. 部署后端 API (搜索管道)
cd apps/api
npm run deploy

# 2. 部署处理服务 (采集管道)
cd ../processor
npm run deploy
```

部署前端应用 (Cloudflare Pages)：

```bash
cd ../../apps/web
npm run build
npm run deploy  # 或者将 GitHub 仓库连接到 Cloudflare Pages 实现自动部署
```

## 验证 (Verification)

1.  **检查 API 健康状态**: 访问 `https://api.<your-worker>.workers.dev/health`，应返回 200 OK。
2.  **手动触发采集**: 在 Cloudflare Dashboard 中手动运行一次 Cron Trigger，或使用 `curl -X POST ...`。
3.  **测试搜索**: 访问前端 URL，尝试搜索 "sunset" 或 "cyberpunk city"。
