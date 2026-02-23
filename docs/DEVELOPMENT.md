# 开发规范、工程架构与技术演进指南 (05-DEVELOPMENT-CONTRIBUTING)

Lens 是一个追求极致性能与长期可维护性的 AI 项目。为了让这个分布式的边缘系统能够被多人协同维护，我们制定了严苛的工程规范。

---

## 1. 工程化架构设计

系统弃用了单一文件的简单写法，全面转向模块化架构。

### 1.1 模块职责地图 (Responsibility Map)

- **`apps/processor/src/handlers/`**：系统的“门卫”。负责解析触发信号（Queue 或 Cron）并转发给逻辑核心。
- **`apps/processor/src/services/`**：系统的“逻辑核心”。这里是 AI 调用、余额计算、自进化算法的所在地。
- **`apps/api/src/routes/`**：系统的“对外窗口”。基于 Hono 的路由拆分，确保每个端点的代码逻辑不超过 200 行。
- **`packages/shared/`**：系统的“契约中心”。定义了全库通用的模型 ID、计费权重、以及数据库表结构映射。

---

## 2. 工程化代码架构

为了应对日益复杂的 AI 业务逻辑，系统采用了高度模块化的目录结构：

### 2.1 Processor (采集端) 职责划分

- **`src/handlers/`**: 包含定时任务 (`scheduled.ts`)、队列消费 (`queue.ts`) 和核心状态机 (`workflow.ts`)。
- **`src/services/`**: 原子化服务层。包含 AI 接口封装、USD 计费审计 (`billing.ts`) 及自进化逻辑 (`evolution.ts`)。
- **`src/utils/`**: 工具类。负责 Unsplash 协议对接、R2 流处理等。

### 2.2 API (服务端) 职责划分

- **`src/routes/`**: 基于 Hono 的路由拆分（Search, Stats, Images）。
- **`src/middleware/`**: 包含全局限流器、CORS 策略等。
- **`src/utils/transform.ts`**: 负责将 D1 原始记录映射为旗舰版 API 响应格式。

---

## 3. 深度提示词工程 (Prompt Engineering)

在 Lens 中，提示词不仅是文字，更是**控制数据流向的指令**。

### 3.1 针对 Llama 4 Scout 的调优逻辑

在 `apps/processor/src/services/ai.ts` 中，我们采用了 **“JSON 强约束 Prompt”**：

1.  **角色暗示**：通过 `Act as a world-class curator` 强制模型切换到更专业的语义词库。
2.  **JSON 声明**：明确要求输出 `{ "caption": "...", ... }` 格式，并利用 Llama 4 极强的 Schema 遵循能力。

---

## 4. 防御性边缘编程准则

边缘环境（Cloudflare Workers）资源极度稀缺，开发者必须遵循以下“戒律”：

### 4.1 内存红线 (Memory Limit)

- **禁止操作大数组**：严禁将 `Uint8Array` 使用 `Array.from()` 展开。
- **流式处理**：始终优先使用 `ReadableStream` 进行管道式传输。

### 4.2 异步与重试 (Idempotency)

- **Workflow 原子性**：每一个 Step 必须是幂等的。
- **幂等写入**：所有的数据库写入必须使用 `ON CONFLICT DO UPDATE`。

---

## 5. 本地开发流 (Local Workflow)

```bash
# 1. 启动本地 API 仿真
cd apps/api && npx wrangler dev --remote --persist

# 2. 启动前端实时热更新
cd apps/web && pnpm dev

# 3. 执行强制质量门禁
pnpm lint && pnpm typecheck
```

---

## 6. 基于 Zod 的确定性工程实践 (Deterministic AI)

在处理 LLM 输出时，最大的挑战在于其“概率性”产生的非结构化文本。Lens 通过 Zod 强契约层解决了这一问题。

### 6.1 强制模式校验 (Contract Enforcement)

我们定义了 `VisionResponseSchema`，它规定了 AI 必须返回包含 `caption`, `quality`, `entities`, `tags` 的 JSON。如果 Llama 4 返回了 Markdown 或乱码，Zod 会在解析阶段立即抛出异常。

### 6.2 异常自愈与降级

配合 Workflow 的重试机制，当 Zod 校验失败时，系统会触发自动重试或执行优雅降级（逻辑位于 `ai.ts`）。这种“守门员”式的设计，确保了进入数据库的每一条数据都是符合业务逻辑的“确定性”资产。
