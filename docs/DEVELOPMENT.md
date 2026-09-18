# 模块架构、开发规范与边缘工程实践指南

更新日期：2026-09-19
状态：现行
适用范围：Monorepo 工程分层、边缘运行时开发规范、类型安全与质量保障

本项目遵循严谨的边缘原生（Edge-Native）架构设计规范。所有模块代码均针对 Cloudflare Workers 边缘运行时的内存容量、执行时间片限制与冷启动延迟进行了工程优化。

---

## 1. Monorepo 代码分层与架构边界

项目采用 pnpm workspace 进行多包管理，各模块遵循单向依赖原则：

```
lens/
├── apps/
│   ├── engine/       # Cloudflare Workers 后端网关、定时任务与异步流水线
│   └── client/       # React + Vite 前端单页应用（部署于 Workers Static Assets）
├── packages/
│   └── shared/       # 共享数据契约、TypeScript 类型、Zod Schema 与基础工具类
├── scripts/          # 文档治理、安全审计与自动化运维脚本
└── docs/             # 架构决策记录 (ADR) 与现行技术规范文档
```

### 1.1 依赖关系约束

- `apps/engine` 依赖 `packages/shared`。
- `apps/client` 依赖 `packages/shared`。
- `packages/shared` 为纯 TypeScript 库，不得依赖任何应用层代码或平台专有非标准全局变量。
- 严禁模块间出现循环引用。

### 1.2 `apps/engine` 内部目录职责

- **`src/routes/`**：Hono 路由定义，处理 HTTP 请求参数校验与响应组装，不包含核心业务编排。
- **`src/services/`**：业务领域服务实现，包括 `SearchService`、`WorkflowProcessor` 与 `ai.ts` 模型调度。
- **`src/handlers/`**：平台事件适配层，承接 `scheduled` (Cron)、`queue` (Queue Consumer) 与 `workflow` (Workflows Entry)。
- **`src/middleware/`**：网关级切面逻辑，包含速率限制与统一错误拦截。
- **`src/utils/`**：数据转换与通用辅助函数。

---

## 2. 边缘运行时极限生存规范 (Edge Constraints)

Cloudflare Workers 运行时具备极高的水平伸缩能力，但对单一实例的资源有着严格的硬性配额：

### 2.1 内存上限控制 (128MB Limit)

- **流式处理优先 (Streaming First)**：严禁在内存中以 `ArrayBuffer` 或 `string` 形式全量缓冲完整大尺寸图像文件。
- **管道直通原则**：从外部或 R2 读取媒体数据时，必须直接传递 `ReadableStream`，或在需要分块计算时使用固定尺寸的微缓冲。
  ```typescript
  // 正确：流式直通
  const object = await env.R2.get(key);
  return new Response(object.body, { headers });

  // 严禁：全量读入内存
  // const buffer = await object.arrayBuffer(); // 可能导致 OOM
  ```

### 2.2 CPU 时间片与异步卸载 (CPU Time Slice)

- Workers 免费与标准套餐对每次请求的同步 CPU 时间片限制为 50ms。
- 任何超过 50ms 的 CPU 密集型任务（如大图像缩放计算、高并发模型推理调度、长批次数据重平衡）必须拆分并通过 **Cloudflare Workflows** 或 **Queues** 进行异步卸载。

### 2.3 依赖包体积控制 (Zero-Bloat Policy)

- 禁止引入未经 Tree-shaking 优化的重型 NPM 依赖。
- 优先采用 Web 标准 API（`fetch`, `Request`, `Response`, `Headers`, `crypto`, `ReadableStream`）。

---

## 3. 类型安全与数据契约规范

### 3.1 强契约与运行时校验

- 外部输入（Unsplash API 响应、用户请求体、Workers AI 模型返回）被视为不可信数据源。
- 必须通过 Zod Schema 进行结构校验：
  ```typescript
  export const VisionResponseSchema = z.object({
    caption: z.string().min(10).max(1000),
    quality: z.number().min(0).max(10),
    entities: z.array(z.string()),
    tags: z.array(z.string().toLowerCase()),
  });

  const parsed = VisionResponseSchema.safeParse(rawOutput);
  if (!parsed.success) {
    logger.warn('AI Output validation failed, applying fallback policy');
    // 降级策略处理
  }
  ```

### 3.2 严格 TypeScript 规范

- 根级别与子包均启用 `strict: true`。
- 严禁使用裸 `any`。对于未知结构使用 `unknown` 并通过类型收窄或 Type Guard 进行判定。
- 数据库查询结果必须使用 `@lens/shared` 中定义的接口（如 `DBImage`）进行强类型绑定。

---

## 4. 轻量级全链路追踪规范 (Trace Architecture)

为了在不增加冷启动开销与包体积的前提下实现可观测性，项目实现了自研的轻量化追踪协议：

### 4.1 TraceContext 生命周期

- 每次触发（HTTP 搜索、定时任务、异步队列）首先调用 `createTrace(prefix)` 生成上下文。
- 实例化的 `Logger` 对象携带全局唯一的 `traceId`，在调用链中显式传递。

### 4.2 结构化遥测上报

- 关键链路的耗时与关键业务指标通过 `Logger.trackSearch` 或 `Logger.metric` 批量投递至 Cloudflare Analytics Engine (`TELEMETRY`)。
- 打点操作全部包裹在 `executionCtx.waitUntil()` 中执行，不阻塞用户主干响应。

---

## 5. 本地开发、测试与提交规程

### 5.1 本地环境变量与凭据配置

本地开发采用双轨制环境变量管理，严禁向版本库提交真实明文凭据：

1. **模板规范**：根目录提供 `.env.example`，`apps/engine/` 提供 `.dev.vars.example` 作为依赖契约；
2. **本地环境准备**：
   ```bash
   # 拷贝本地模拟变量文件（已被 .gitignore 忽略）
   cp apps/engine/.dev.vars.example apps/engine/.dev.vars
   ```
3. **填入开发凭据**：
   - `UNSPLASH_API_KEY`：Unsplash 开发者 Access Key；
   - `CLOUDFLARE_ACCOUNT_ID`：Cloudflare 账号 ID；
   - `CLOUDFLARE_API_TOKEN`：具备 AI Gateway 读取权限的 API Token。
4. **生产部署密钥**：生产环境严禁通过文件传递密钥，必须通过命令行安全写入边缘 KMS：
   ```bash
   wrangler secret put UNSPLASH_API_KEY
   wrangler secret put CLOUDFLARE_API_TOKEN
   ```

### 5.2 本地测试命令集

在提交代码前，必须确保本地全量校验通过：

```bash
# 1. 语法检查与代码风格修复
pnpm run lint

# 2. 文档合规性检查（元数据、失效链接与目录索引）
pnpm run check:docs

# 3. 执行全量单元测试与覆盖率统计
pnpm test

# 4. 执行后端 Worker 预编译演练
pnpm --filter engine exec wrangler deploy --dry-run
```

### 5.3 Git 提交规范

- 提交信息必须使用英文，遵循 Conventional Commits 规范。
- 格式规范：`<type>: <description>`（总长度建议不超过 7 个英文单词）。
  - `feat`: 新增特性
  - `fix`: 缺陷修复
  - `docs`: 文档变更
  - `refactor`: 重构且无行为变更
  - `perf`: 性能优化
  - `test`: 测试用例补充
- **安全约束**：所有 Commit 必须进行 GPG 签名（`git commit -S`）。
