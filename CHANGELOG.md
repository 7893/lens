# Changelog

All notable changes to this project will be documented in this file.

## [2026-09-21] - Monthly Storage Reorganization & Raw Image Preservation (方案一)

### Added

- **原始图片按月长期归档** - R2 根目录按月组织存储原始高清母本：`{YYYYMM}/${photoId}.jpg`（例如 `202609/abc.jpg`），永久保留母本资产，移除 Workflow 历史 `cleanup-raw` 清理步骤。
- **Web 缩略图按月镜像归档** - R2 `display/` 目录下同步按月组织存储 Web 优化切片：`display/{YYYYMM}/${photoId}.jpg`。
- **双向无缝兼容边缘路由** - 更新 `routes/images.ts`：
  - 支持 3 段路由 `/image/display/:yearmonth/:filename`（自动回退至存量 flat 路径）；
  - 支持 2 段路由 `/image/:yearmonth/:filename`（直读根目录按月原始图片）；
  - 存量平铺链接 `/image/display/:filename` 保持 100% 长期可用，未命中平铺时透明回查 D1 `display_key` 索引并填充 Edge Cache。
- **存量历史图片重组服务 (StorageReorganizationService)** - 提供存量 25,319 张平铺图片幂等安全批处理迁移（`runBatch`）与进度统计（`getStatus`），并挂载管理端点 `GET/POST /internal/storage/reorganize`。
- **充血领域模型动态解析** - 更新 `@lens/shared` 中 `ImageEntity`，使 `displayUrl` 与 `rawUrl` 基于 `display_key` 与 `raw_key` 动态投影。
- **自动化测试套件扩展** - 新增 `storage-reorganization.test.ts` 并扩充 `images.test.ts` 与 `transform.test.ts`，测试集扩展至 **20 个测试文件、167 个单元与集成测试用例 100% 绿灯通过**。

---

## [2026-09-21] - Full Known Issues Resolution (KI-001, KI-002, KI-005, KI-006, KI-007)

### Fixed

- **Unsplash API 额度熔断与动态回退自愈 (KI-001)** - 在 `utils/unsplash.ts` 与 `IngestionService` 引入基于 KV 的 Circuit Breaker 熔断器机制，捕获 429/403 并解析 `X-Ratelimit-Reset` 自动打开熔断窗口；在 `scheduled.ts` 中无缝接管算力触发 `EvolutionService.triggerFallbackEvolution` 对存量资产执行进化分析。
- **前端弱网主题切换白屏闪烁 (KI-002)** - 在 `apps/client/index.html` 的 `<head>` 注入自执行主题初始化脚本，读取 `localStorage` 或系统媒体查询，在首屏 DOM 绘制前为 `<html>` 注入 `.dark` class；Tailwind 显式开启 `darkMode: 'class'`。
- **定时对账与发件箱自愈 Cron (KI-007)** - 在 `apps/engine/src/handlers/scheduled.ts` 中增设 TASK D 定时巡检任务（`*/15 * * * *`），自动执行 `runReconciliationCheck` 监控 Outbox 滞留与索引代际覆盖，并调用 `relayOutboxEvents` 触发自愈补偿重发。

### Added

- **规范资产与投影数据幂等回填服务 (KI-005)** - 引入 `BackfillService`，以原子化批处理（`INSERT OR IGNORE`）将旧 `images` 记录平滑迁移映射至 `assets`、`asset_sources`、`representations` 与 `search_documents`；并在内部管理端点新增 `GET /internal/backfill` 与带操作审计的 `POST /internal/backfill`。
- **检索质量离线金标评测集与自动化 Harness (KI-006)** - 构建 60 条涵盖六大维度的典型 Query 金标评测集（`dataset.ts` / `dataset.json`），实现标准 IR 指标计算引擎（nDCG@5/10、Recall@10、Precision@10、MRR、零结果率），并提供 CLI 工具 `pnpm run eval:retrieval` 与质量门禁验证。
- **自动化测试套件扩充** - 新增 `scheduled.test.ts`、`backfill.test.ts`、`ingestion-circuit-breaker.test.ts` 与 `retrieval-benchmark.test.ts`，测试集扩展至 **19 个测试文件、151 个单元与集成测试用例 100% 绿灯通过**。

---

## [2026-09-19] - ADR-0006: Single Worker Cloudflare Native Modular Monolith

### Added

- **单 Worker 模块化单体重构** - 全面落地 [ADR-0006](docs/decisions/0006-single-worker-cloudflare-native-refactor.md)，划分 `entrypoints/`, `kernel/`, `modules/`, `platform/`, `routes/` 单向依赖分层，彻底消除跨 Worker RPC 复杂性与冷启动开销。
- **规范资产与媒体模型** - 新增 `assets`（聚合根）、`asset_sources`（溯源归属）、`media_objects`（不可变媒体）、`representations`（多模态表征）与 `processing_runs`（流水线审计），由数据库迁移 `0003_v2_canonical_models.sql` 支持。
- **R2 规范 Master 长期归档战略** - 母本规约 `media/{contentHash}/master.{ext}`，内建 40MB 内存防爆守卫与 Web Crypto 流式单遍 SHA-256 幂等去重，确保未来 5~10 年视觉表征与向量模型全量可复算。
- **事务发件箱与幂等收件箱** - `outbox_events` 与业务变更在 D1 同一事务内原子提交，`consumed_events` 吸收队列重投递与乱序，消除跨存储裸双写。
- **版本化搜索投影与平滑代际切换** - 新增 `search_documents` 与 `projection_state`（迁移 `0004_v2_indexing_projections.sql`），支持新索引代际后台全量构建、对账校验与 D1 原子激活。
- **解耦检索内核 (Retrieval Kernel)** - `CandidateSource` 抽象隔离 FTS5 与 Vectorize (1024-d BGE-M3)，引入纯策略互惠排名融合 (Pure RRF)、动态断崖截断、多样性下沉、D1 活动版本水合闸门与不透明稳定游标深度分页 (`cursor` / `nextCursor`)。
- **权威运行时配置与不可变操作审计** - 新增 `runtime_config` 与 `operation_audit`（迁移 `0005_v2_governance_and_audit.sql`），提供 Cloudflare Access 保护的 `/internal/*` 控制面路由（`/internal/health`, `/internal/reconciliation`, `/internal/config`, `/internal/outbox/relay`）。
- **质量门禁与测试套件扩展** - 自动化测试套件扩展至 **15 个测试文件、124 个单元/集成测试用例 100% 绿灯通过**，核心领域模块覆盖率达 85%~100%。

### Changed

- **检索接口增强** - `GET /api/search` 支持 `limit`, `cursor`, `color`, `orientation`, `tag` 过滤及流式 SSE 兼容，响应增加 `nextCursor`。
- **部署后验证** - 部署后巡检清单新增 `/internal/health` 深层依赖探针。

### Deprecated & Superseded

- **废弃多 Worker RPC 拆分蓝图** - 废弃并取代 [ADR-0005](docs/decisions/0005-lens-v2-architecture-blueprint.md)，回归单 Worker 模块化单体基线。
- **演进原图策略** - 由单纯 `display/` 规格（[ADR-0003](docs/decisions/0003-d1-readonly-protection.md)）演进为流式守卫的规范母本 Canonical Master 长期归档。

---

## [2026-09-18] - ADR-0001 ~ ADR-0004: Engineering Framework & Tooling

### Added

- **轻量分布式追踪** - [ADR-0001](docs/decisions/0001-custom-agent-tracing.md)：实现轻量化自研 `TraceContext` 与 `Logger`，替代重型 OpenTelemetry SDK。
- **本地工程知识图谱** - [ADR-0002](docs/decisions/0002-codegraph-graphify-pi-tooling.md)：引入 CodeGraph、Graphify 与 Pi 本地 Harness，隔离衍生数据于版本库外。
- **生产 D1 数据库防护** - [ADR-0003](docs/decisions/0003-d1-readonly-protection.md)：建立只读与版本化迁移防线，严禁破坏性清表与未受控 DDL。
- **AI 协同研发工程范式** - [ADR-0004](docs/decisions/0004-ai-driven-engineering-framework.md)：确立双层图谱导航、活死文档分离与 `scripts/check_docs.mjs` 自动化门禁。

---

## [2026-02-23] - Architecture Upgrade

### Added

- **Analytics Engine (lens-ae)** - 全链路遥测系统，收集搜索延迟、错误率、进化效率
- **Trace ID 机制** - 每个请求/任务分配唯一 ID，支持跨组件日志追踪
- **Zod Schema 校验** - AI 输出强制契约验证，拒绝非结构化响应
- **D1 Migrations** - 数据库表结构版本化管理 (`migrations/0001_init_flagship.sql`)
- **Logger.metric()** - 统一的指标写入接口，自动关联 Trace ID
- **并发 Evolution** - 自进化改为 chunk=3 并发处理，提升效率
- **Stats KV 缓存** - 首页统计数据 60 秒缓存，减少 D1 压力
- **单元测试** - 新增 schemas、logger、ai、billing 测试，覆盖率从 8 提升到 32

### Changed

- **Vectorize 索引** - `lens-vectors` → `lens-vectorize`（产品名规范）
- **AI 输出格式** - 从正则解析改为 JSON + Zod 校验
- **Billing 日志** - 全面接入 Logger，支持 Trace ID

### Removed

- **schema.sql** - 改用 migrations 管理，删除冗余文件
- **lens-vectors** - 旧索引已迁移并删除

### Migration

- 20,610 条向量从 `lens-vectors` 迁移到 `lens-vectorize`

---

## [2026-02-22] - AI Gateway Billing API

### Added

- **billing.ts** - 基于 GraphQL 的官方计费 API 客户端
- **USD 预算控制** - 替代手动 Neuron 计数，实时审计实付金额

### Removed

- **quota.ts** - 手动 Neuron 追踪逻辑

---

## [2026-02-21] - Initial Release

### Added

- Lens 语义图片搜索引擎上线
- Unsplash 自动采集管道
- Llama 4 Scout 图片分析
- BGE-M3 向量嵌入
- BGE Reranker 结果重排
- Cloudflare Workers + D1 + R2 + Vectorize 全栈
