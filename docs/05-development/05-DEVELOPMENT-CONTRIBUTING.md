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

## 2. 深度提示词工程 (Prompt Engineering)

在 Lens 中，提示词不仅是文字，更是**控制数据流向的指令**。

### 2.1 针对 Llama 4 Scout 的调优逻辑

在 `apps/processor/src/services/ai.ts` 中，我们并没有使用通用的问答 Prompt，而是采用了 **“结构化约束 Prompt”**：

1.  **角色暗示**：通过 `Act as a world-class curator` 强制模型切换到更专业的语义词库。
2.  **负向约束**：严禁使用 `beautiful` 等主观修饰词，保证搜索索引的客观性。
3.  **正则锚点**：强制输出 `CAPTION:` 和 `TAGS:`，为后端的正则表达式提供 100% 可预测的切片标记。

---

## 3. 防御性边缘编程准则

边缘环境（Cloudflare Workers）资源极度稀缺，开发者必须遵循以下“戒律”：

### 3.1 内存红线 (Memory Limit)

- **禁止操作大数组**：严禁将 `Uint8Array` 使用 `Array.from()` 展开。这会将内存占用瞬间翻倍。
- **流式处理**：处理来自 R2 或 Unsplash 的图片数据时，必须始终优先使用 `ReadableStream` 进行管道式传输。

### 3.2 异步与重试 (Idempotency)

- **Workflow 原子性**：在编写新的 Workflow Step 时，必须假设该 Step 可能会在中途崩溃。
- **幂等写入**：所有的数据库写入必须使用 `ON CONFLICT DO UPDATE`。这保证了即使系统重试一百次，最终数据也只有一份最新的。

---

## 4. 全栈一致性与类型安全

我们利用 TypeScript 的 **Workspaces** 特性实现了全链路类型对齐。

- **单一事实来源**：当你在 D1 中增加一个字段时，必须首先在 `packages/shared/src/index.ts` 的 `DBImage` 接口中声明。
- **自动传导**：修改 `shared` 后，运行 `pnpm build`，前端 React 应用和后端 Worker 将立即感知到字段的变化，并在编译阶段拦截所有潜在的空指针错误。

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

> 💡 **专家提示**：利用 `wrangler dev --remote` 可以让你在本地调试时，直接连接云端的真实 D1 数据库，这对排查复杂的 SQL 性能问题非常有帮助。
