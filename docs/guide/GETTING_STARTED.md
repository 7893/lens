# 🚀 快速上手 (Getting Started)

本指南将带领你从零开始，在 Cloudflare 上部署完整的 **Pic** 智能相册系统。

## 前置准备 (Prerequisites)

在开始之前，请确保你已经准备好以下环境和账号：

1.  **Cloudflare 账号**：
    - 必须开通 Workers (Standard 或 Paid 用于 AI/Workflows)。
    - 必须开通 D1 (Database)。
    - 必须开通 R2 (Storage)。
    - 必须开通 Workers AI (用于图片分类)。
    - *注意：部分功能（如 Workflows）可能处于 Beta 阶段，请留意 Cloudflare 公告。*

2.  **Unsplash 开发者账号**：
    - 访问 [Unsplash Developers](https://unsplash.com/developers)。
    - 创建一个新应用 (Application)。
    - 获取 **Access Key** (用于 API 调用)。
    - *注意：免费版 Demo 应用限制为每小时 50 次请求，这对本项目足够。*

3.  **本地开发环境**：
    - Node.js: 建议版本 v20 或更高 (参考项目根目录 `.nvmrc`)。
    - npm 或 pnpm。
    - Git。

4.  **Wrangler CLI**：
    - Cloudflare 的官方命令行工具。
    - 安装命令：`npm install -g wrangler`。
    - 登录账号：`wrangler login`。

---

## 部署步骤 (Deployment Steps)

### 1. 获取代码

```bash
git clone https://github.com/your-username/pic.git
cd pic
npm install
```

### 2. 创建后端资源

我们需要在 Cloudflare 上创建数据库和存储桶。

**创建 D1 数据库：**
```bash
wrangler d1 create pic-d1
```
> **⚠️ 关键步骤**：
> 命令执行后，终端会输出一个 `database_id` (如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`)。
> 请务必复制这个 ID，并更新到 `workers/pic-scheduler/wrangler.toml` 文件中的 `[[d1_databases]]` 部分。

**初始化数据库表结构：**
```bash
wrangler d1 execute pic-d1 --remote --file=workers/pic-scheduler/schema.sql
```

**创建 R2 存储桶：**
```bash
# 如果你的 wrangler.toml 中配置的 bucket_name 是 pic-r2（默认值）
wrangler r2 bucket create pic-r2
```

### 3. 配置环境变量 (Secrets)

为了安全起见，API Key 不应直接写在代码中，而是存储在 Cloudflare Secrets 中。

```bash
# 设置 Unsplash API Key
wrangler secret put UNSPLASH_API_KEY
# (按提示输入你的 Unsplash Access Key)
```

### 4. 部署 Worker

现在，所有的准备工作都已就绪，可以发布你的 Worker 了。

```bash
npm run deploy
```
或者手动进入目录部署：
```bash
cd workers/pic-scheduler
wrangler deploy
```

---

## 验证部署 (Verification)

部署完成后，你会获得一个 Worker URL (例如 `https://pic.<your-subdomain>.workers.dev`)。

1.  **访问首页**：
    - 打开浏览器访问 Worker URL。
    - 此时页面可能为空，因为还没有抓取到图片。

2.  **手动触发抓取** (First Run)：
    - 为了立即看到效果，你可以手动触发一次后台任务：
    ```bash
    curl -X POST https://<your-worker-url>/api/trigger
    ```
    - 等待约 1-2 分钟（Workflows 需要时间下载、分类和处理）。

3.  **查看状态**：
    - 访问 `https://<your-worker-url>/api/stats`。
    - 你应该能看到 `total_photos` 从 0 变为 30（默认每批抓取数量）。

4.  **再次访问首页**：
    - 刷新首页，你应该能看到精美的图片瀑布流了！

---

## 下一步 (Next Steps)

- **自定义配置**：查看 [配置指南](../reference/CONFIGURATION.md) 了解如何调整抓取频率或保留图片数量。
- **本地开发**：查看 [开发指南](DEVELOPMENT.md) 学习如何在本地运行和调试。
- **故障排查**：遇到问题？请查阅 [常见问题](../troubleshooting/FAQ.md)。
