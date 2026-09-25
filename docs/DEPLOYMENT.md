# 构建编排、持续交付与云原生部署指南

更新日期：2026-09-26
状态：现行
适用范围：Monorepo 构建流程、D1 迁移管线、Cloudflare 边缘部署与 CI/CD 规范

Lens 采用全栈边缘集成架构，将 React 前端单页应用通过 Cloudflare Workers Static Assets 机制与基于 Hono 的后端网关、Workflows 状态机及 Queues 队列统一打包，部署于同一 Cloudflare Worker (`lens`) 中，消除跨域协商与多边缘服务冷启动开销。

---

## 1. 部署架构与拓扑关系

```
[GitHub Repo: main]
       │
       ▼ (GitHub Actions CI/CD)
┌────────────────────────────────────────────────────────┐
│ 1. 共享包编译: pnpm --filter=@lens/shared build       │
│ 2. 前端应用打包: pnpm --filter=@lens/client build       │
│ 3. 产物复制: cp apps/client/dist -> apps/engine/public │
│ 4. 边缘网关部署: wrangler deploy (apps/engine)         │
└────────────────────────────────────────────────────────┘
       │
       ▼ (Cloudflare Edge Network)
┌────────────────────────────────────────────────────────┐
│ Worker: lens                                          │
│  ├── [Assets] 前端静态资源 (SPA Fallback)              │
│  ├── [Hono] API 网关 (/api/*, /image/*)               │
│  ├── [Cron] 定时触发器 (0 * * * *)                     │
│  ├── [Queues] 异步任务消费者 (lens-queue)              │
│  └── [Workflows] 幂等摄取流水线 (lens-workflow)        │
└────────────────────────────────────────────────────────┘
```

---

## 2. 依赖构建与打包流水线

本地或 CI 节点执行全量发布前，必须按照单向依赖拓扑依次构建各模块：

### 2.1 阶段一：编译共享契约库

```bash
# 生成 packages/shared/dist/*.d.ts 与编译产物
pnpm --filter=@lens/shared run build
```

### 2.2 阶段二：打包前端客户端

```bash
# 生成 apps/client/dist
pnpm --filter=@lens/client run build
```

### 2.3 阶段三：同步静态资产至后端

```bash
# 将前端静态产物植入 engine public 资产目录
mkdir -p apps/engine/public
rm -rf apps/engine/public/*
cp -r apps/client/dist/* apps/engine/public/
```

### 2.4 阶段四：验证与部署 Worker

```bash
# 预检 Dry-Run
pnpm --filter=@lens/engine exec wrangler deploy --dry-run

# 执行正式部署
pnpm --filter=@lens/engine exec wrangler deploy
```

---

## 3. 基础设施资源初始化 (Infra Provisioning)

在新环境或初始部署时，需通过 Wrangler CLI 完成异构云资源的开辟与绑定配置：

### 3.1 关系型数据库 (Cloudflare D1)

```bash
# 1. 创建 D1 数据库实例
npx wrangler d1 create lens-d1

# 2. 将返回的 database_id 填入 apps/engine/wrangler.toml 中的 [[d1_databases]]

# 3. 应用全量数据库迁移 (按 0000 -> 0005 顺序，覆盖初始表、FTS5、性能索引、规范模型、搜索投影与治理审计)
pnpm --filter=@lens/engine run migrate:remote
```

### 3.2 向量索引 (Cloudflare Vectorize)

```bash
# 创建 1024 维余弦距离向量索引
npx wrangler vectorize create lens-vectorize --dimensions=1024 --metric=cosine
```

### 3.3 对象存储 (Cloudflare R2)

```bash
# 创建图像文件持久化存储桶
npx wrangler r2 bucket create lens-r2
```

### 3.4 键值存储 (Workers KV)

```bash
# 创建系统配置与缓存命名空间
npx wrangler kv:namespace create SETTINGS
# 将返回的 id 填入 wrangler.toml
```

### 3.5 消息队列 (Cloudflare Queues)

```bash
# 创建异步摄取队列
npx wrangler queues create lens-queue
```

---

## 4. 环境变量与凭证安全管理 (Secrets)

系统严禁将敏感凭证硬编码或提交至版本控制系统中，所有机密均通过 Cloudflare Secrets 安全注入：

| 变量名                  | 作用与权限要求                                      | 配置命令                                        |
| :---------------------- | :-------------------------------------------------- | :---------------------------------------------- |
| `UNSPLASH_API_KEY`      | Unsplash 开发者平台 Access Key，用于定时摄取图片    | `npx wrangler secret put UNSPLASH_API_KEY`      |
| `CLOUDFLARE_API_TOKEN`  | 具备 Cloudflare D1/AI/Analytics 读取权限的 API 令牌 | `npx wrangler secret put CLOUDFLARE_API_TOKEN`  |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID，用于标识资源物理归属            | `npx wrangler secret put CLOUDFLARE_ACCOUNT_ID` |
| `INTERNAL_API_SECRET`   | 管理接口密钥，本地与线上均需配置，使用自生成随机值  | `npx wrangler secret put INTERNAL_API_SECRET`   |

---

## 5. 持续集成与持续交付 (CI/CD Pipeline)

项目使用 GitHub Actions（`.github/workflows/ci.yml`）自动化全流程交付。

### 5.1 门禁校验流水线 (Pull Request & Push)

- **setup**：拉取代码，按 `.tool-versions` 与包清单约定使用 Node.js 26.10.0、pnpm 12.6.0，安装依赖并编译 `@lens/shared`，缓存 `node_modules`。
- **lint**：执行 ESLint 静态代码分析与 Prettier 风格格式校验。
- **test**：在沙箱环境中执行 Vitest 全量单元测试（含 Mocked Cloudflare Workers 绑定），并要求覆盖率门禁通过。
- **typecheck**：对各子包执行 `tsc --noEmit` 进行全量 TypeScript 严格类型检查。

### 5.2 主分支自动发布 (Deploy Job)

恢复原有 workflow：Pull Request 只运行检查；推送 `main` 后，上述检查全部通过才进入部署作业。
在仓库 Actions Secrets 配置 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_ACCOUNT_ID`。
Fork 部署应使用自己的 Cloudflare 凭据与资源配置。

- 重新构建 `@lens/client` 并复制至 `apps/engine/public/`。
- 通过 `cloudflare/wrangler-action@v3` 使用注入的 GitHub Actions Secrets 完成生产环境原子发布。

---

## 6. 部署后验证与运维巡检 (Post-Deployment Verification)

每次发布后，执行以下标准验证清单：

1. **基础健康检查**：
   ```bash
   curl -i https://lens.53.workers.dev/health
   # 预期: HTTP 200, {"status":"healthy","name":"lens"}
   ```
2. **检索网关校验**：
   ```bash
   curl -i "https://lens.53.workers.dev/api/search?q=cyberpunk"
   # 预期: HTTP 200, 返回包含 results 数组与 telemetry 统计的 JSON
   ```
3. **内部依赖与代际诊断**：
   ```bash
   curl -i https://lens.53.workers.dev/internal/health
   # 预期: HTTP 200, status="healthy", dependencies={d1: "healthy", r2: "healthy", kv: "healthy"}
   ```
4. **实时日志跟踪**：
   ```bash
   pnpm --filter=@lens/engine exec wrangler tail
   # 观察实时请求 TraceID、耗时与无未捕获异常抛出
   ```

---

## 7. 容灾重试与版本回滚策略

- **即时回滚**：若新版本 Worker 发生非预期异常，可通过 Cloudflare 控制台或 Wrangler 快速切回上一个稳定部署版本：
  ```bash
  pnpm --filter=@lens/engine exec wrangler rollback
  ```
- **数据与队列幂等**：
  - 队列消费任务基于 `IngestionTask` 驱动，失败自动退回重试（`max_retries: 3`），超限后隔离至死信队列。
  - Workflows 执行各步骤均为幂等操作（`INSERT ... ON CONFLICT DO UPDATE`），重试不会导致重复创建或脏数据。
