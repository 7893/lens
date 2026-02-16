# 🛠️ 开发指南 (Development Guide)

欢迎加入 Pic 项目的开发！本指南将帮助你搭建本地开发环境，并介绍如何高效地进行代码贡献。

## 开发环境搭建 (Local Setup)

### 1. 克隆代码

```bash
git clone https://github.com/your-username/pic.git
cd pic
```

### 2. 安装依赖

推荐使用 `npm` 或 `pnpm`。

```bash
npm install
```

### 3. 本地配置 (wrangler.toml)

项目依赖本地 D1 数据库和 R2 存储桶。`wrangler` 会自动为你处理大部分模拟工作。

你可能需要在 `workers/pic-scheduler/wrangler.toml` 中取消部分注释，以便在本地连接远程资源（**如果需要的话**），但通常我们建议完全使用本地模拟。

**本地数据库初始化：**

```bash
# 本地执行 Schema 文件
wrangler d1 execute pic-d1 --local --file=workers/pic-scheduler/schema.sql
```

**本地存储桶创建：**

`wrangler dev` 启动时会自动创建本地 R2 bucket。

---

## 运行与调试 (Running & Debugging)

### 启动开发服务器

```bash
npm run dev
```
这将启动 `wrangler dev`，默认监听 `http://localhost:8787`。

### 模拟触发 (Simulating Triggers)

由于 Cron Trigger 仅在生产环境自动运行，我们需要手动模拟：

**方式 1: 使用 curl (推荐)**

```bash
curl -X POST http://localhost:8787/api/trigger
```
这将触发 `DataPipelineWorkflow`。你可以在终端看到详细的日志输出。

**方式 2: 使用 wrangler cli**

```bash
wrangler d1 execute pic-d1 --local --command "SELECT * FROM Photos"
```
这将检查你的本地数据库状态。

### 调试 Workflows

Cloudflare Workflows 在本地运行时，实际上是直接执行步骤逻辑（没有真正的分布式状态机）。

**注意点：**
- `step.do` 中的逻辑会立即执行。
- `step.sleep` 在本地可能会直接跳过或快速等待。
- 如果遇到 `Error: Workflow execution failed`，通常是代码逻辑错误，请检查控制台输出的堆栈信息。

---

## 代码风格与规范 (Style & Standards)

### 1. 目录结构

所有核心逻辑都位于 `workers/pic-scheduler/src/` 下：
- `index.js`: 入口文件 (Router & Cron Handler)。
- `workflows/`: 工作流定义 (DataPipeline)。
- `tasks/`: 独立任务逻辑 (Unsplash Fetch, Cleanup)。
- `utils/`: 通用工具 (Date, String, AI Helper)。

### 2. Linting

项目集成了 ESLint 和 Prettier。

```bash
# 检查代码风格
npm run lint

# 自动修复
npm run lint:fix
```
在提交代码前，请务必运行一次 lint 检查。

### 3. 提交规范 (Commit Message)

建议遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：
- `feat: Add support for Unsplash search`
- `fix: Resolve R2 upload timeout issue`
- `docs: Update DEVELOPMENT.md`
- `chore: Update dependencies`

---

## 测试 (Testing)

目前项目主要依赖手动测试和集成测试。我们计划引入 `vitest` 进行单元测试。

如果你贡献了新功能，请确保：
1.  本地运行 `npm run dev` 无报错。
2.  手动触发一次 API (`curl -X POST ...`) 并验证流程完整性。
3.  如果涉及数据库变更，请提供 SQL 迁移脚本。

## 常见问题

- **Q: 本地开发时 Unsplash API 报错 403？**
  - **A:** 检查你的环境变量 `UNSPLASH_API_KEY` 是否正确设置。你可以创建一个 `.dev.vars` 文件在本地存储密钥（但在生产环境使用 `wrangler secret put`）。

- **Q: AI 功能本地可用吗？**
  - **A:** `wrangler dev` 默认会连接到 Cloudflare 的远程 AI 服务（需要登录）。请确保你已通过 `wrangler login` 登录且账号有 AI 权限。
