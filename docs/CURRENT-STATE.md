# Lens 当前系统状态

更新日期：2026-09-19
状态：现行事实入口
适用范围：当前运行拓扑、资源绑定、数据状态、测试基线与质量事实

本文是 Lens 系统的**最高事实入口**。所有关于当前线上运行环境、资源绑定和测试基准的事实均以此为准。

---

## 1. 现行架构拓扑

```text
客户端 (Vue 3 + Vite) -> Cloudflare Edge -> @lens/engine (单 Worker 全栈闭环)
                                             ├── GET /api/search (混合检索: D1 FTS5 + Vectorize + RRF)
                                             ├── GET /api/stats (系统健康与图片统计)
                                             ├── GET /api/trace/:id (分布式调用追踪查询)
                                             ├── Cron 触发器 (每小时线性抓取与对撞探测)
                                             └── Workflow 状态机 (图片下载、AI 分析、向量入库)
```

- **单 Worker 全栈集成**：API 服务、定时抓取调度（Cron）、异步队列消费者和 Workflow 状态机完全收敛于 `@lens/engine`，避免跨 Worker RPC 的延迟损耗与配额开销；
- **混合检索模型**：L1 HTTP 缓存 -> L2 KV 语义缓存 -> D1 FTS5 关键词匹配 + Vectorize (BGE-M3) 向量相似度双路召回 -> RRF (Reciprocal Rank Fusion) 智能融合重排；
- **生产发布环境**：`https://lens.53.workers.dev`。

---

## 2. 资源绑定（Cloudflare Bindings 事实）

| 绑定名称          | 类型         | 用途                         | 关键策略                                                            |
| :---------------- | :----------- | :--------------------------- | :------------------------------------------------------------------ |
| `DB`              | D1 Database  | 关系型主库与 FTS5 全文索引   | 生产禁止 DDL 物理删除与批量截断；写操作必须通过版本化迁移           |
| `VECTORIZE_INDEX` | Vectorize    | 768维 BGE-M3 密集向量索引库  | 余弦相似度召回，TopK=100 结合断崖检测算法                           |
| `CACHE`           | KV Namespace | L2 查询缓存与语义联想字典    | 动态 TTL 缓存，规避重复 AI 扩展调用                                 |
| `BUCKET`          | R2 Storage   | 原图及 WebP 变焦图持久化存储 | 抓取后双画质转码压缩存储，防止外部图床防盗链失效                    |
| `AI`              | Workers AI   | 文本向量化与视觉理解推理     | 向量化使用 `@cf/baai/bge-m3`；查询意图扩展与图片理解使用 Llama 系列 |
| `INGEST_WORKFLOW` | Workflows    | 分布式可重试采集状态机       | 保证图片生命周期原子化流转，支持步骤级重试与故障隔离                |

---

## 3. 全链路可观测性基线（Tracing Baseline）

- **追踪协议**：遵循 W3C `traceparent` 标准，支持跨边界上下文传递；
- **追踪粒度**：覆盖用户搜索请求（`SEARCH-xxxx`）、定时采集批次（`CRON-xxxx`）与工作流实例（`WF-xxxx`）；
- **集成形式**：采用轻量级自定义 OpenTelemetry 兼容 Harness（见 [ADR-0001](decisions/0001-custom-agent-tracing.md)），微秒级开销，无额外外部依赖。

---

## 4. 质量与测试基准（已验证事实）

- **单元与集成测试**：62 个 Vitest 测试用例全部通过（涵盖搜索服务、采集服务、对撞模型、RRF 排序、API 路由、Tracing 上下文等）；
- **类型系统**：TypeScript 严格模式全仓通过（`pnpm -r run typecheck` 0 错误）；
- **代码规范**：ESLint + Prettier 格式化检查全部通过；
- **本地工程化图谱**：
  - **CodeGraph**：AST 符号索引已建库（`.codegraph/codegraph.db`），支持符号拓扑跳转；
  - **Graphify**：系统依赖知识图谱已提取（`graphify-out/`），支持架构语义问答；
  - **Pi / Local Harness**：覆盖全部 6 个工程领域（engine, client, shared, docs, infra, tooling）。
