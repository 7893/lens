# Lens 当前系统状态

更新日期：2026-09-21
状态：现行事实入口
适用范围：当前运行拓扑、资源绑定、数据状态、测试基线与质量事实

本文是 Lens 系统的**最高事实入口**。所有关于当前线上运行环境、资源绑定和测试基准的事实均以此为准。

---

## 1. 现行架构拓扑

```text
客户端 (React 19 + Vite + TailwindCSS) -> Cloudflare Edge -> @lens/engine (单 Worker Cloudflare 原生模块化单体 - ADR-0006)
                                                              ├── 公共业务 API (/api/*)
                                                              │   ├── GET /api/search (内核化混合检索: CandidateSources + RRF + D1 水合 + 游标分页)
                                                              │   ├── GET /api/stats (系统指标与互动埋点)
                                                              │   ├── GET /api/images/:id (图片详情与 EXIF)
                                                              │   ├── GET /api/suggest (前缀联想词)
                                                              │   └── POST /api/admin/compensate (数据补偿)
                                                              ├── 媒体直读代理 (/image/*)
                                                              │   └── GET /image/display/:filename (R2 边缘强缓存代理)
                                                              ├── 内部管理与治理面 (/internal/* - Cloudflare Access 保护)
                                                              │   ├── GET /internal/health (全依赖深层诊断与版本状态)
                                                              │   ├── GET /internal/reconciliation (Outbox 延迟与投影覆盖率审计)
                                                              │   ├── POST /internal/reconciliation/run (强制对账并写审计日志)
                                                              │   ├── GET/POST /internal/config (权威运行时配置与不可变审计)
                                                              │   ├── POST /internal/outbox/relay (手动触发 Outbox 派发)
                                                              │   └── GET/POST /internal/backfill (存量旧数据规范模型回填与进度)
                                                              ├── Cron 调度入口 (每小时定时拉取、对账与存量审计)
                                                              ├── Queue 异步消费者 (削峰消费与 Outbox 投递)
                                                              └── Workflow 状态机 (单资产长流程幂等执行与恢复)
```

- **单 Worker 模块化单体架构**：确立为 Lens 长期架构基线（[ADR-0006](decisions/0006-single-worker-cloudflare-native-refactor.md)）。所有触发器收敛于 `entrypoints/`，业务能力下沉至六大自治模块（`catalog`, `ingestion`, `representation`, `indexing`, `retrieval`, `operations`），跨切面治理收敛于 `kernel/`（`errors`, `events`, `ids`, `observability`），平台产品适配收敛于 `platform/cloudflare/`；
- **权威数据模型与媒体归档**：D1 为生命周期与可见性唯一事实源，支持 expand/contract 渐进演进（0000~0005 迁移）；R2 留存内容寻址规范 Master（`media/{contentHash}/master.{ext}`），支持未来模型全量可复算；
- **可靠事件与异步背压**：事务性 Outbox（D1 批次原子写入业务变更与事件）配合 Consumer Inbox 幂等校验与周期对账重放；
- **版本化检索内核**：`CandidateSource` 抽象隔离 FTS5 与 Vectorize，纯函数 RRF 融合与动态截断，D1 活动版本闸门水合，不透明稳定游标分页 (`cursor`)；
- **生产发布环境**：`https://lens.53.workers.dev`。

---

## 2. 资源绑定（Cloudflare Bindings 事实）

| 绑定名称         | 类型             | 物理标识                   | 用途与关键策略                                                                   |
| :--------------- | :--------------- | :------------------------- | :------------------------------------------------------------------------------- |
| `DB`             | D1 Database      | `lens-d1` (`af9a1e43-...`) | 权威主库、Outbox/Inbox、版本化投影、运行时配置与审计；写操作严格受控于版本化迁移 |
| `VECTORIZE`      | Vectorize        | `lens-vectorize`           | 1024 维密集向量索引库；版本化 Vector ID，返回候选必须回 D1 做活动版本过滤与水合  |
| `SETTINGS`       | KV Namespace     | `22886c458d...`            | 查询语义缓存、前缀搜索建议与运行时配置只读快照                                   |
| `R2`             | R2 Bucket        | `lens-r2`                  | 规范 Master 长期归档与 Web 展示切片；流式尺寸守卫与内容寻址 SHA-256 幂等去重     |
| `AI`             | Workers AI       | Gateway: `lens-gateway`    | 文本向量化 (`@cf/baai/bge-m3`)、视觉理解与场景扩展                               |
| `PHOTO_WORKFLOW` | Workflows        | `lens-workflow`            | 单资产长流程步骤持久化与恢复；确定性实例 ID 与幂等可重试步骤                     |
| `PHOTO_QUEUE`    | Queues           | `lens-queue`               | 异步削峰消息队列与事务 Outbox 中继背压边界                                       |
| `TELEMETRY`      | Analytics Engine | `lens-ae`                  | 边缘轻量链路追踪与指标遥测数据集                                                 |
| `RATE_LIMITER`   | Rate Limiting    | Namespace: `1001`          | 公共搜索网关滑动窗口限流（60 次/分钟）                                           |

---

## 3. 全链路可观测性基线（Tracing Baseline）

- **追踪协议**：遵循自研轻量级追踪协议，支持跨边界上下文传递（见 [ADR-0001](decisions/0001-custom-agent-tracing.md)）；
- **追踪粒度**：覆盖用户搜索请求（`SEARCH-xxxx`）、定时采集批次（`CRON-xxxx`）、异步入库任务（`WORKFLOW-xxxx`）、管理审计（`INTERNAL-xxxx`）与用户互动埋点（`TRACK-xxxx`）；
- **集成形式**：零外部重型依赖，结合 Cloudflare Analytics Engine 异步批处理上报，无冷启动性能拖累。

---

## 4. 质量与测试基准（已验证事实）

- **单元与集成测试**：**134 个 Vitest 测试用例全部通过（17 个测试套件 100% 绿灯，核心模块覆盖率达 85%~100%）**；
- **类型系统**：TypeScript 严格模式全仓通过（`pnpm -r run typecheck` 0 错误）；
- **代码规范**：ESLint + Prettier 格式化检查全部通过（0 错误，0 警告）；
- **安全审计**：`pnpm audit` 0 已知安全漏洞；
- **内部治理闸门**：Cloudflare Access 严格保护管理面与高风险操作，全生命周期记录操作者、原因与 correlation ID；
- **本地工程化图谱**：
  - **CodeGraph**：AST 符号索引已建库（`.codegraph/codegraph.db`），支持符号拓扑跳转；
  - **Graphify**：系统依赖知识图谱已提取（`graphify-out/`），支持架构语义问答；
  - **Pi / Local Harness**：覆盖全部 6 个工程领域（engine, client, shared, docs, infra, tooling）。
