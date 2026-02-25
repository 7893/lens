# 全栈构建、GitOps 运维与生产级部署手册 (04-DEPLOYMENT)

Lens 的部署流程不仅仅是代码的上传，它是一次**“基础设施的基因序列重组”**。通过将 D1 Schema 版本化、将编译链条 Monorepo 化，我们实现了在 Cloudflare 任何区域一键克隆出一套完全相同的生产环境的能力。

---

## 1. 核心存储层：基于 Wrangler Migrations 的 GitOps 实践

我们彻底废弃了手敲 SQL 的时代。现在，D1 的每一个字段变更都必须通过 **Migration 脚本** 进行记录。

### 1.1 初始化 D1 旗舰版表结构

在 `apps/processor` 目录下，系统维护了一个 `migrations/` 文件夹。

1.  **创建 D1 实例**：
    ```bash
    npx wrangler d1 create lens-d1
    ```
2.  **应用序列化迁移**：
    ```bash
    # 该命令会自动按顺序执行 0001_xxx.sql
    npx wrangler d1 migrations apply lens-d1 --remote
    ```

- **牛逼点**：这种方式保证了数据库的“幂等性”。无论你在哪个环境部署，运行同样的 Migration 都能得到完全一致的数据库骨架。

---

## 2. 编译链路：Monorepo 的依赖拓扑

Lens 采用 pnpm workspaces 驱动。由于 `api` 和 `processor` 都严重依赖于 `@lens/shared`，必须遵循以下构建顺序：

1.  **Shared 构建 (The Foundation)**：

    ```bash
    cd packages/shared && npm run build
    ```

    - 此步骤生成 `dist/` 目录，将 TypeScript 定义和 Zod Schema 转换为运行时可引用的二进制产物。

2.  **Web 资源同步 (The Frontend)**：

    ```bash
    cd apps/web && pnpm build
    cp -r dist/* ../api/public/
    ```

    - **架构内涵**：将 React 前端产物作为静态资源内嵌入 API Worker 中，实现 **“API + Frontend 一站式边缘部署”**。

---

## 3. 生产机密管理：建立凭证孤岛

为了实现 GraphQL 的费用审计和 AI Gateway 的透明调用，你需要手动在 Cloudflare 侧建立 Secrets。

### 3.1 核心 Secrets 清单 (必填)

| 键名                    | 来源                     | 用途描述                                  |
| :---------------------- | :----------------------- | :---------------------------------------- |
| `UNSPLASH_API_KEY`      | Unsplash Dev Portal      | 控制图片的入库源。                        |
| `CLOUDFLARE_API_TOKEN`  | CF Dashboard (Analytics) | 用于 `billing.ts` 请求 GraphQL 获取账单。 |
| `CLOUDFLARE_ACCOUNT_ID` | CF Dashboard URL         | 定位费用查询的物理归属。                  |

### 3.2 注入指令

```bash
npx wrangler secret put CLOUDFLARE_API_TOKEN
# 粘贴具有 GraphQL 读权限的令牌
```

---

## 4. 全链路“冒烟测试”：上线后的关键 10 分钟

部署完成后，Lens 具备一套自我体检流程：

1.  **逻辑连通性 (The Hello Call)**：
    访问 `/health`。如果返回 200，说明 Hono 核心已拉起。
2.  **全链路 Trace 验证 (The First Search)**：
    发起一次搜索，然后立即运行 `npx wrangler tail lens`。
    - **观察点**：是否出现了 `[SEARCH-xxxx]` 标记的日志流？如果没有，说明 `logger.ts` 的注入出现了偏移。
3.  **财务审计闭环 (The Pulse Check)**：
    观察日志中是否出现 `Auditing daily system spend`。
    - **关键点**：如果出现 401 错误，说明 `CLOUDFLARE_API_TOKEN` 权限范围不足。

---

## 5. 系统灾备与快速回滚

由于采用了 **Workflows 状态机** 架构，即使你在部署过程中因为 Bug 导致了数据解析异常：

- **操作**：利用 GitHub Actions 的历史 Artifacts 重新发布。
- **韧性**：正在队列中排队的图片任务不会丢失，它们会等待新版本的代码部署后，利用自动重试机制重新尝试入库。
