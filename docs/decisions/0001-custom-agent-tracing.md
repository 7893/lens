# ADR-0001: 自研轻量 OpenTelemetry 兼容分布式追踪方案

更新日期：2026-09-18
状态：采纳
责任人：@lens-team
适用范围：`@lens/engine` 核心链路、API 路由、Workflow 及可观测性体系

---

## 背景 (Context)

Cloudflare 官方提供了 Agents SDK 及相关的分布式追踪支持，但在评估将其引入 Lens 项目时发现：

1. **冷启动与打包体积开销**：官方重型 Agent 框架依赖较多的运行时垫片与类体系，对于边缘微秒级响应的极速搜索而言，过大的包体积会直接拉高边缘冷启动耗时；
2. **多状态分裂风险**：重型 Agent 内部自带的状态持久化模型与 Lens 现有的 Workflows + D1 事务流转模型存在职责重叠；
3. **可观测性核心诉求**：Lens 最核心的追踪需求是清晰刻画用户搜索（`SEARCH-xxxx`）、定时采集对撞（`CRON-xxxx`）和工作流（`WF-xxxx`）的耗时与阶段状态，并支持标准 W3C `traceparent` 协议透传。

## 决策 (Decision)

我们决定**不引入外部重型 Agent 框架**，而是自研一套**轻量级、零外部依赖、100% 兼容 OpenTelemetry W3C TraceContext** 的追踪 Harness：

1. 在 `apps/engine/src/utils/tracing.ts` 实现 `TraceContext`、`Span` 与结构化事件分发；
2. 在 Hono 中间件中统一解析与注入 `traceparent`，在 API 响应头中回显 `x-trace-id`；
3. 提供 `/api/trace/:id` 查询接口，支持实时调用链回溯。

## 理由与考量 (Rationale)

- **极致性能**：零第三方 npm 运行时依赖，单次 Span 开销仅为内存对象分配，耗时 < 0.01ms；
- **标准化兼容**：严格遵循 W3C Trace Context 规范（`00-${traceId}-${spanId}-${flags}`），未来可无缝接入 Datadog、Honeycomb 等 OpenTelemetry 收集器；
- **与业务逻辑天然贴合**：无需改造现有的 Workflows 与 Service 接口，通过可选参数或显式传递即可完成链路染色。

## 影响与后果 (Consequences)

- **正面收益**：搜索请求延迟降低，端到端可观测性清晰，62 个单测完整覆盖 Tracing 功能；
- **权衡**：需要自行维护追踪上下文的数据结构与边缘导出逻辑，但由于逻辑精炼（~100 行），维护负担极低。
