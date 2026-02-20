# 全栈部署与 IaC 运维指南 (04-DEPLOYMENT-GUIDE)

Lens 的部署完全基于基础设施即代码 (IaC) 的理念，确保环境的可复现性与配置的标准化。

---

## 1. 基础设施初始化

### 1.1 准备工作

- 安装 [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-cli/)。
- 申请 [Unsplash API Access Key](https://unsplash.com/developers)。

### 1.2 手动资源创建 (Wrangler)

请按序执行以下命令以创建云端资源：

1.  **D1 数据库**:

    ```bash
    npx wrangler d1 create lens-d1
    # 运行初始化脚本 (务必注意路径)
    npx wrangler d1 execute lens-d1 --remote --file=lens/apps/processor/schema.sql
    ```

2.  **R2 存储桶**:

    ```bash
    npx wrangler r2 bucket create lens-r2
    ```

3.  **Vectorize 向量索引**:

    ```bash
    # 维度必须设为 1024 以匹配 BGE Large 模型
    npx wrangler vectorize create lens-vectors --dimensions=1024 --metric=cosine
    ```

4.  **Queue 任务队列**:

    ```bash
    npx wrangler queues create lens-queue
    ```

5.  **KV 命名空间**:
    ```bash
    npx wrangler kv namespace create lens-kv
    ```

---

## 2. 密钥与配置 (Secrets)

### 2.1 Worker 内部机密

为了确保 AI 监控透明化，系统强制通过 HTTPS 网关调用 AI 服务，因此必须在 Worker 侧注入 API 令牌：

```bash
# 进入 processor 目录
cd lens/apps/processor
npx wrangler secret put UNSPLASH_API_KEY
npx wrangler secret put CLOUDFLARE_API_TOKEN

# 进入 api 目录
cd ../api
npx wrangler secret put CLOUDFLARE_API_TOKEN
```

### 2.2 KV 初始设置

部署后，请立即初始化采集节流阀：

```bash
npx wrangler kv key put --namespace-id <LENS_KV_ID> "config:ingestion" '{"backfill_enabled": true, "backfill_max_pages": 2}' --remote
```

---

## 3. 持续集成与交付 (CI/CD)

Lens 使用 GitHub Actions 执行自动化全栈发布。

### 3.1 GitHub Secrets 清单

在 GitHub 仓库设置中配置以下变量：

- `CLOUDFLARE_API_TOKEN`: 具备 Workers, D1, R2, AI 编辑权限的令牌。
- `CLOUDFLARE_ACCOUNT_ID`: 您的 Cloudflare 账户 ID。

### 3.2 自动化流水线

每次推送至 `main` 分支时：

1.  **Shared 构建**: 编译共享类型包。
2.  **Web 构建**: 编译 React 前端，产物自动拷贝至 `apps/api/public`。
3.  **Wrangler 部署**: 自动同步 `wrangler.toml` 配置并热发布至边缘节点。

---

## 4. 故障验证

部署完成后，建议执行以下“冒烟测试”：

1.  **API 连通性**: `curl https://lens.53.workers.dev/health`
2.  **AI 网关路径**: 搜索一次并检查 Cloudflare AI Gateway 页面是否产生紫色波峰。
3.  **采集自检**: 手动触发 Cron 测试抓取效率：
    `npx wrangler dev lens/apps/processor/src/index.ts --test-scheduled`
