# 开发指南 (Monorepo Development)

Pic v6.0 采用基于 npm workspaces 管理的 Monorepo 结构。

## 项目结构 (Structure)

```
pic/
├── apps/
│   ├── api/          # Hono Worker (搜索与API后端)
│   ├── processor/    # Queue Worker (采集与处理流水线)
│   └── web/          # React + Vite (前端展示)
├── packages/
│   └── shared/       # 共享的 TypeScript 类型定义与配置
├── package.json      # 工作区根配置
```

## 前置要求 (Prerequisites)

- Node.js 20+
- Cloudflare Wrangler CLI (`npm i -g wrangler`)
- Git

## 安装依赖 (Installation)

```bash
# 在根目录安装所有工作区的依赖
npm install
```

## 本地运行 (Running Locally)

### 1. 初始化基础设施 (Setup Local DB/R2)

```bash
# 创建本地 D1 数据库模拟
npm run setup:local-db
```

### 2. 启动服务 (Start Services)

你可以单独启动某个服务：

```bash
# 启动 API Worker
npm run dev --workspace=apps/api

# 启动 Processor Worker (模拟 Queue/Cron)
npm run dev --workspace=apps/processor

# 启动前端 (Frontend)
npm run dev --workspace=apps/web
```

或者（推荐）同时启动所有后端服务：

```bash
npm run dev:backend
```

## 测试 (Testing)

我们使用 Vitest 进行单元测试。

```bash
# 运行所有包的测试
npm test
```

## 部署 (Deployment)

```bash
# 部署所有 Workers
npm run deploy

# 仅部署前端到 Pages
npm run deploy:web
```
