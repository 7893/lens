# 全栈部署、IaC 配置与自动化运维 (04-DEPLOYMENT-GUIDE)

Lens 的部署哲学是“云端原生 (Cloudflare Native)”。系统所有的组件都通过代码定义，通过 CLI 或 CI/CD 进行生命周期管理。本指南将带你从零开始，在 15 分钟内构建出一套完整的 Lens 生产环境。

---

## 1. 核心资源创建：从命令行开始

虽然可以使用 Terraform 进行声明式管理，但对于快速迭代，我们推荐使用 Wrangler CLI 手动初始化核心存储。

### 1.1 D1 数据库初始化

D1 是 Lens 的持久化大脑。创建后，你需要将返回的 UUID 填入 `wrangler.toml`。

```bash
npx wrangler d1 create lens-d1
# 必须执行 Schema 初始化，否则采集引擎会因为找不到 images 表而崩溃
npx wrangler d1 execute lens-d1 --remote --file=lens/apps/processor/schema.sql
```

### 1.2 R2 存储桶与 Vectorize 索引

Vectorize 的维度必须严格对齐 BGE-M3 模型的输出（1024 维），否则会触发写入失败。

```bash
npx wrangler r2 bucket create lens-r2
npx wrangler vectorize create lens-vectors --dimensions=1024 --metric=cosine
```

---

## 2. 密钥注入与环境隔离

Lens 依赖外部 Unsplash API 和 Cloudflare 自身的 API Token 来实现 AI Gateway 的透明调用。

### 2.1 生产 Secrets 清单

在发布 Worker 之前，必须在 `processor` 目录下注入以下密钥：

- `UNSPLASH_API_KEY`：你的 Unsplash 开发者 Key。
- `CLOUDFLARE_API_TOKEN`：必须具备 `Workers AI: Read/Write` 权限。

### 2.2 环境绑定原理

在 `wrangler.toml` 中，我们使用了 `[[d1_databases]]`、`[[r2_buckets]]` 和 `[[vectorize]]` 的绑定。

- **为何必须绑定？** Cloudflare 并不是通过网络请求访问这些资源，而是将这些资源的句柄直接挂载到 Worker 的运行环境 `env` 中。这实现了极低延迟的资源访问。

---

## 3. GitHub Actions：工业级持续交付 (CI/CD)

Lens 采用 Monorepo 结构，其构建顺序至关重要。

### 3.1 自动化工作流流程

每次推送至 `main` 分支时，`.github/workflows/deploy.yml` 会被触发：

1.  **Shared Build**：首先编译 `@lens/shared`。因为 `api` 和 `processor` 都引用了它的类型和常量。
2.  **Web Assets Sync**：编译 React 前端，并将其静态产物同步到 `apps/api/public`。
3.  **Atomic Deployment**：并行发布 API Worker 和 Processor Worker。

### 3.2 环境变量同步

确保在 GitHub 仓库设置中配置了 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。

---

## 4. 部署后验证：黄金 10 分钟

系统上线后的前 10 分钟是观测健康的黄金期：

1.  **健康检查 (Instant)**：
    访问 `https://lens.53.workers.dev/health`。如果返回 `{"status": "healthy"}`，说明 Hono 路由已拉起。
2.  **监控 AI 脉冲 (3 min)**：
    触发一次搜索请求，观察 Cloudflare AI Gateway 仪表盘。你应该看到一条代表 Llama 4 或 BGE-M3 调用的紫色曲线。
3.  **验证采集流动性 (10 min)**：
    等待第一个 Cron 周期触发。通过 SQL `SELECT COUNT(*) FROM images;` 确认数字是否开始跳动。如果数字没变，请立即运行 `wrangler tail lens-processor` 检查 Unsplash API 的返回码。

---

## 5. 系统回滚与扩容

- **快速回滚**：利用 GitHub Actions 的历史任务，可以一键重新发布上一个 Stable 版本。
- **Vectorize 扩容**：目前的 `lens-vectors` 索引采用标准版。如果图片量突破 100 万，需要在配置文件中调整索引的扩容策略。
