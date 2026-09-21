# Lens 已知问题与技术债务登记册

更新日期：2026-09-21
状态：现行
适用范围：已发现但尚未完全关闭的业务、算法、可观测性与工程优化问题

本文统一记录 Lens 项目的技术债务、已知缺陷与待办改进，替代外部 Issue 追踪，实现仓内闭环管理。
条目状态严格限定为：`OPEN`（待处理）、`IN-PROGRESS`（处理中）、`DONE`（已完成）。

---

## 活跃问题（OPEN / IN-PROGRESS）

_当前暂无活跃技术债务或开放缺陷（所有已登记问题均已全量修复并通过自动化门禁闭环）。_

---

## 已关闭问题（DONE）

| 编号   | 标题                                     | 状态 | 优先级 | 影响范围               | 归档说明                                                                                                                                                                                                                                                    |
| :----- | :--------------------------------------- | :--- | :----- | :--------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KI-000 | 建立项目本地 AI 知识图谱与 Harness 契约  | DONE | P1     | Project Root           | 完成 CodeGraph、Graphify 与 Pi 本地工程化接入，见 [ADR-0002](decisions/0002-codegraph-graphify-pi-tooling.md)                                                                                                                                               |
| KI-001 | Unsplash API 额度熔断与动态回退自愈      | DONE | P2     | IngestionService       | 在 `utils/unsplash.ts` 与 `IngestionService` 中落地 Circuit Breaker 熔断器，解析 `X-Ratelimit-Reset` 并于 KV 中维护熔断窗口避免无效外网消耗；在 `scheduled.ts` 中无缝调度 `EvolutionService.triggerFallbackEvolution` 接管存量资产升级算力，100% 覆盖测试。 |
| KI-002 | 前端主题切换在弱网下的极瞬闪烁           | DONE | P3     | Client App             | 在 `apps/client/index.html` 的 `<head>` 中注入内联阻塞式主题探测脚本，优先读取 `localStorage('theme')` 与系统 `prefers-color-scheme`，在 DOM 渲染前直接为 `<html>` 添加 `.dark` class；Tailwind 显式启用 `darkMode: 'class'`，彻底消除 FOUC 闪烁。          |
| KI-003 | 引入自动化文档治理门禁与死链校验         | DONE | P2     | Tooling / Docs         | 编写 `scripts/check_docs.mjs` 校验链接有效性、INDEX 覆盖率并集成至 CI/Harness                                                                                                                                                                               |
| KI-004 | 消除多 Worker RPC 通信与状态分散架构债务 | DONE | P0     | Architecture / Engine  | 废弃多 Worker RPC 解耦（ADR-0005），落地单 Worker 模块化单体 [ADR-0006](decisions/0006-single-worker-cloudflare-native-refactor.md)，六阶段完成，全部测试通过                                                                                               |
| KI-005 | 存量历史数据向规范资产与投影回填迁移     | DONE | P1     | Catalog / Indexing     | 实现 `BackfillService`，提供原子化幂等批处理（`INSERT OR IGNORE` 写入 `assets`、`asset_sources`、`representations`、`search_documents`），并在 `routes/internal.ts` 暴露 `GET /internal/backfill` 与带操作审计的 `POST /internal/backfill`，100% 覆盖测试。 |
| KI-006 | 检索质量离线金标评测集与自动化 Harness   | DONE | P2     | Retrieval Module       | 建立包含 60 个典型 Query 的六维金标测试集（`benchmark/dataset.ts` / `dataset.json`），实现标准 IR 评估引擎（计算 nDCG@5/10、Recall@10、Precision@10、MRR、零结果率），提供 CLI 工具 `pnpm run eval:retrieval` 与自动化质量门禁验证。                        |
| KI-007 | 自动化对账与发件箱自愈巡检 Cron 任务     | DONE | P2     | Operations / Scheduled | 在 `handlers/scheduled.ts` 中实现 TASK D 定时任务（`*/15 * * * *`），调用 `runReconciliationCheck` 巡检滞留与代际健康度，并通过 `relayOutboxEvents` 自动重试补发未投递与超期发件箱事件，新增集成测试验证。                                                  |
