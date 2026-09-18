# Lens 当前系统状态

更新日期：2026-09-19
状态：现行事实入口
适用范围：当前运行拓扑、资源绑定、数据状态、测试基线与质量事实

本文是 Lens 系统的**最高事实入口**。所有关于当前线上运行环境、资源绑定和测试基准的事实均以此为准。

---

## 1. 现行架构拓扑

```text
客户端 (React 19 + Vite + TailwindCSS) -> Cloudflare Edge -> @lens/engine (单 Worker 全栈闭环)
                                                              ├── GET /api/search (混合检索: D1 FTS5 + Vectorize + RRF)
                                                              ├── GET /api/stats (系统指标与互动埋点)
                                                              ├── GET /api/images/:id (图片详情与 EXIF)
                                                              ├── GET /image/display/:filename (R2 边缘强缓存代理)
                                                              ├── Cron 触发器 (每小时定时拉取与存量审计)
                                                              ├── Queue 消费者 (lens-queue 削峰缓冲)
                                                              └── Workflow 状态机 (lens-workflow 幂等摄取与推理)
```

- **单 Worker 全栈集成**：前端静态资源通过 Workers Static Assets 托管，与基于 Hono 的后端网关、定时调度（Cron）、异步队列消费者和 Workflow 状态机完全收敛于 `@lens/engine`，避免跨 Worker RPC 的延迟损耗与跨域协商开销；
- **混合检索模型**：L1 HTTP 边缘缓存 -> L2 KV 语义缓存 -> D1 FTS5 关键词匹配 + Vectorize (BGE-M3, 1024 维) 向量相似度双路召回 -> 断崖检测动态截断 -> BGE-Reranker-Base 精排；
- **生产发布环境**：`https://lens.53.workers.dev`。

---

## 2. 资源绑定（Cloudflare Bindings 事实）

| 绑定名称         | 类型             | 物理标识                   | 用途与关键策略                                                                |
| :--------------- | :--------------- | :------------------------- | :---------------------------------------------------------------------------- |
| `DB`             | D1 Database      | `lens-d1` (`af9a1e43-...`) | 关系型主库与 FTS5 全文索引；写操作必须通过版本化迁移（0000~0002）             |
| `VECTORIZE`      | Vectorize        | `lens-vectorize`           | 1024 维 BGE-M3 密集向量索引库；余弦相似度召回，结合断崖检测动态截断           |
| `SETTINGS`       | KV Namespace     | `22886c458d...`            | L2 查询缓存、前缀搜索建议、统计缓存与动态摄取配置                             |
| `R2`             | R2 Bucket        | `lens-r2`                  | 持久化存储 Web 优化尺寸图片（`display/` 规格）；原图不落盘 (ADR-0003)         |
| `AI`             | Workers AI       | Gateway: `lens-gateway`    | 文本向量化 (`@cf/baai/bge-m3`)、视觉理解与精排 (`@cf/baai/bge-reranker-base`) |
| `PHOTO_WORKFLOW` | Workflows        | `lens-workflow`            | 分布式可重试摄取状态机；保障图片生命周期原子化流转与步骤重试                  |
| `PHOTO_QUEUE`    | Queues           | `lens-queue`               | 异步削峰消息队列，平滑驱动后台推理流水线                                      |
| `TELEMETRY`      | Analytics Engine | `lens-ae`                  | 边缘轻量链路追踪与指标遥测数据集                                              |
| `RATE_LIMITER`   | Rate Limiting    | Namespace: `1001`          | 搜索网关滑动窗口限流（60 次/分钟）                                            |

---

## 3. 全链路可观测性基线（Tracing Baseline）

- **追踪协议**：遵循自研轻量级追踪协议，支持跨边界上下文传递（见 [ADR-0001](decisions/0001-custom-agent-tracing.md)）；
- **追踪粒度**：覆盖用户搜索请求（`SEARCH-xxxx`）、定时采集批次（`CRON-xxxx`）、异步入库任务（`WORKFLOW-xxxx`）与用户互动埋点（`TRACK-xxxx`）；
- **集成形式**：零外部重型依赖，结合 Cloudflare Analytics Engine 异步批处理上报，无冷启动性能拖累。

---

## 4. 质量与测试基准（已验证事实）

- **单元与集成测试**：62 个 Vitest 测试用例全部通过（涵盖搜索服务、采集服务、断崖检测、RRF 排序、API 路由、Tracing 上下文等）；
- **类型系统**：TypeScript 严格模式全仓通过（`pnpm -r run typecheck` 0 错误）；
- **代码规范**：ESLint + Prettier 格式化检查全部通过；
- **安全审计**：`pnpm audit` 0 已知安全漏洞，Dependabot PR 全部解决；
- **本地工程化图谱**：
  - **CodeGraph**：AST 符号索引已建库（`.codegraph/codegraph.db`），支持符号拓扑跳转；
  - **Graphify**：系统依赖知识图谱已提取（`graphify-out/`），支持架构语义问答；
  - **Pi / Local Harness**：覆盖全部 6 个工程领域（engine, client, shared, docs, infra, tooling）。
