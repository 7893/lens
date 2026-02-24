# 开发规范、神仙级架构与极致工程实践指南 (05-DEVELOPMENT)

Lens 项目不仅仅是一堆代码的集合，它是一场关于**“如何在极端贫瘠的边缘计算环境下构建高智力系统”**的实验。作为开发者，你必须时刻保持对内存、CPU 时间片以及 AI 成本的敬畏。

---

## 1. 深度模块化架构：从内联到解耦的演进

我们彻底抛弃了单一 `index.ts` 处理一切的初级写法，转向了职责高度明确的结构：

### 1.1 核心目录职责定义

- **`src/handlers/` (流量分发层)**：
  这里的代码不应该包含任何业务逻辑。它们的唯一职责是解析触发信号（Cron、Queue 或 HTTP），创建 `TraceContext`，并将其转发给底层的 Service。
- **`src/services/` (逻辑原子层)**：
  - `ai.ts`：只管调模型和 Zod 校验。
  - `billing.ts`：只管算账和能力预测。
  - `evolution.ts`：只管业务上的“进化循环”。
- **`src/utils/` (工具协议层)**：
  处理外部协议的封装（如 Unsplash API 的翻页逻辑、R2 的流式管道对接）。

---

## 2. 基于 Zod 的确定性工程实践

在 AI 领域，最大的挑战是“不可预测性”。Lens 通过 **强契约校验** 将这种风险降至最低。

### 2.1 拒绝 Regex，拥抱 Schema

我们不再通过脆弱的正则表达式去盲抠 Caption。

1.  **指令端**：Prompt 强制要求返回 JSON。
2.  **验证端**：利用 `VisionResponseSchema.safeParse()`。
3.  **自愈逻辑**：
    - 如果 Zod 提示字段缺失 -> 记录 Trace 日志 -> 触发延迟重试。
    - 如果 Zod 提示长度超标 -> 自动执行分片截断。
    - **效果**：进入 D1 的数据永远是格式统一、类型安全的“确定性资产”。

---

## 3. 128MB 内存下的极限生存法则 (Edge Survival)

Cloudflare Workers 免费版只有 128MB 内存。一张 4K 图片展开后可能高达 50MB，足以让 Worker 崩溃。

### 3.1 流式处理 (Streaming First)

系统严禁使用 `Array.from()` 或 `buffer.toString()` 来加载整张图片。

- **牛逼代码示例**：
  ```typescript
  const img = await env.R2.get(key);
  // 直接将 body (ReadableStream) 传给分析函数
  return await analyzeImage(env.AI, img.body, logger);
  ```
- **底层原理**：数据像流水一样经过 Worker 的 CPU，而不是在 RAM 中停留。这保证了 Lens 即使在处理海量高频抓取时，内存占用曲线依然像一条直线一样稳定。

---

## 4. Tracing 协议的手工实现哲学

我们没有引入 OpenTelemetry 等笨重的第三方库（因为它们会增加包体积，拖慢冷启动时间）。

- **轻量化追踪**：我们手写了一个 20 行的 `Logger` 类。它在对象构造时就绑定了 `traceId`。
- **逻辑自洽**：通过将 `logger` 实例作为函数的第一参数向下传递，系统实现了零性能损耗的“全链路脉冲追踪”。

---

## 5. 开发者的自律清单

1.  **严禁 Anywhere Any**：所有的 D1 查询结果必须通过 `@lens/shared` 定义的接口进行类型断言。
2.  **注释即文档**：复杂的 SQL 聚合逻辑必须注明为何不使用多次简单查询（通常是为了规避 D1 的 RTT 延迟）。
3.  **幂等写入**：修改任何数据库操作时，优先考虑 `INSERT ... ON CONFLICT DO UPDATE`。
