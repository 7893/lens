# 全栈部署与 IaC (04-DEPLOYMENT-GUIDE)

Lens 是一个完全基于 Cloudflare Edge 栈的项目。部署分为三个阶段：基础设施创建、代码构建和 GitHub Actions 自动化。

---

## 1. 基础设施初始化 (IaC)

您可以选择通过 Terraform (推荐) 或 Wrangler CLI 手动创建资源。

### 1.1 使用 Terraform (声明式)

进入 `lens/infra/terraform` 目录并配置变量：
```bash
cp terraform.tfvars.example terraform.tfvars
# 填写 CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
terraform init
terraform apply
```

### 1.2 使用 Wrangler CLI (手动式)

在 `lens/` 根目录下运行以下命令：

1.  **D1 数据库**:
    ```bash
    npx wrangler d1 create lens-d1
    # 记录下返回的 UUID，更新到 apps/api 和 apps/processor 的 wrangler.toml
    npx wrangler d1 execute lens-d1 --remote --file=lens/apps/processor/schema.sql
    ```

2.  **R2 存储桶**:
    ```bash
    npx wrangler r2 bucket create lens-r2
    ```

3.  **Vectorize 索引**:
    ```bash
    npx wrangler vectorize create lens-vectors --dimensions=1024 --metric=cosine
    ```

4.  **Queue 队列**:
    ```bash
    npx wrangler queues create lens-queue
    ```

---

## 2. 密钥配置 (Secrets)

部署前必须在 `processor` 应用中配置 Unsplash API Key：

```bash
cd lens/apps/processor
npx wrangler secret put UNSPLASH_API_KEY
```

此外，在 GitHub 仓库中配置以下 Secrets 用于 Actions：
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

---

## 3. 构建与部署 (CI/CD)

Lens 采用了 Monorepo 结构，各组件之间存在构建依赖。

### 3.1 自动化部署 (GitHub Actions)
每次推送至 `main` 分支时，`.github/workflows/deploy.yml` 会自动执行以下步骤：
1. 构建 `@lens/shared` 包。
2. 构建 `@lens/web` 前端。
3. 将前端静态产物拷贝至 `apps/api/public`。
4. 部署 `lens` (API + Frontend) Worker。
5. 部署 `lens-processor` Worker。

### 3.2 手动部署流程
如果需要手动全栈发布，请在根目录下按序执行：
```bash
# 1. 构建共享包
pnpm build --filter "@lens/shared"

# 2. 构建前端
pnpm build --filter "@lens/web"

# 3. 同步前端产物到 API Worker
cp -r lens/apps/web/dist lens/apps/api/public

# 4. 发布应用
cd lens/apps/api && npx wrangler deploy
cd ../processor && npx wrangler deploy
```

---

## 4. 验证部署

1.  **健康检查**: `curl https://lens.53.workers.dev/health`
2.  **触发采集**: 您可以手动触发一次定时任务来测试采集是否正常：
    `npx wrangler dev lens/apps/processor/src/index.ts --test-scheduled`
3.  **监控面板**: 访问 Cloudflare Dashboard 查看 AI Gateway 的 Neurons 消耗。
