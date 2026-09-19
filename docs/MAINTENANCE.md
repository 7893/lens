# 系统运维、配额审计与全生命周期监控手册

更新日期：2026-09-19
状态：现行
适用范围：系统健康度巡检、配额消耗审计、故障诊断排查与灾难恢复

本文档规范了 Lens 生产环境的监控指标、成本配额控制、常见故障排查路径与存量资产升级操作流程。

---

## 1. 系统可观测性与监控指标 (Observability)

Lens 的可观测性体系基于 Cloudflare Analytics Engine (`lens-ae`) 与轻量化 `TraceContext` 构建，涵盖核心链路的健康度与性能表现。

### 1.1 关键性能指标 (KPIs)

- **搜索端到端延迟 (P95 / P99)**：
  - 缓存命中：$< 50\text{ms}$
  - 动态检索全链路（Query 扩展 + 召回 + 断崖截断 + Rerank）：$< 800\text{ms}$
- **缓存命中率 (Edge & KV Cache Hit Rate)**：
  - 首页静态资源与最新列表：$> 95\%$
  - 高频检索词：$> 60\%$
- **断崖检测截断率**：
  - 统计 Vectorize Top-100 召回集在断崖检测后进入精排的样本平均数（基线：15 ~ 30 条）。

### 1.2 实时日志排查

通过 Wrangler Tail 工具实时监听指定环境的日志流与链路事件：

```bash
# 监听后端运行时生产日志流
pnpm --filter=@lens/engine exec wrangler tail

# 过滤特定追踪链路 (示例: 追踪 SEARCH 事件)
pnpm --filter=@lens/engine exec wrangler tail --search "SEARCH-"
```

---

## 2. 算力成本控制与配额审计 (FinOps & Quota Audit)

为了防止 Workers AI 算力与存储写入超出预算限额，系统建立了基于 GraphQL 的配额审计机制。

### 2.1 计费隔离机制

- **审计范围聚焦**：系统调用 Cloudflare AI Gateway GraphQL 接口对账时，针对后台图像批处理所消耗的高算力模型（`@cf/meta/llama-4-scout-17b-16e-instruct`）执行定向聚合。
- **公共服务隔离**：终端用户在线搜索所触发的轻量 Reranker 与 Fast-Text 模型不占用后台存量刷新的每日预算配额。

### 2.2 权威运行时配置治理 (`runtime_config` & `/internal/config`)

系统支持基于 D1 `runtime_config` 表持久化权威配置，并通过 Workers KV 同步低延迟镜像。变更配置无需重新部署 Worker，且强制留存操作审计记录：

```json
{
  "backfill_enabled": false,
  "backfill_max_pages": 1,
  "daily_evolution_limit_usd": 1.0,
  "evolution_trigger_utc": "23:00"
}
```

| 参数项                      | 类型      | 默认值    | 作用说明                                            |
| :-------------------------- | :-------- | :-------- | :-------------------------------------------------- |
| `backfill_enabled`          | `boolean` | `false`   | 全量历史补录任务紧急开关                            |
| `backfill_max_pages`        | `number`  | `1`       | 单次拉取的最大分页深度                              |
| `daily_evolution_limit_usd` | `number`  | `1.0`     | 存量模型升级的单日预算上限（美元），置 0 则挂起刷新 |
| `evolution_trigger_utc`     | `string`  | `"23:00"` | 存量审计与任务派发的每日触发时隙（UTC 时间）        |

#### 配置查询与受控修改指令：

```bash
# 1. 查询权威运行时配置
curl -H "cf-access-authenticated-user-email: admin@lens.internal" \
  https://lens.53.workers.dev/internal/config/ingestion_policy

# 2. 提交带审计原因的配置变更
curl -X POST https://lens.53.workers.dev/internal/config \
  -H "cf-access-authenticated-user-email: admin@lens.internal" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "ingestion_policy",
    "version": "v1.3",
    "value": { "backfill_enabled": false, "backfill_max_pages": 2, "daily_evolution_limit_usd": 1.5 },
    "description": "Adjusted evolution limit for model upgrade",
    "reason": "OPS-2048: Increase evolution budget for weekend run"
  }'
```

---

## 3. 故障排查与恢复应急预案 (Runbooks)

### 3.1 故障场景 A：摄取引擎游标卡滞 (Anchor Stalemate)

- **现象**：外部 Unsplash 持续更新图片，但 D1 中 `images` 表记录数未增长。
- **根因**：`system_config` 中的 `last_seen_id` 对应的记录在外部可能被删除或属于异常赞助图，导致游标比对未能命中。
- **排查步骤**：
  ```bash
  # 1. 查询当前游标记录
  npx wrangler d1 execute lens-d1 --remote --command="SELECT value, updated_at FROM system_config WHERE key = 'last_seen_id';"
  ```
- **修复指令**：手动将游标重置为当前数据库中真实入库的最新图片 ID：
  ```bash
  npx wrangler d1 execute lens-d1 --remote --command="UPDATE system_config SET value = (SELECT id FROM images ORDER BY created_at DESC LIMIT 1), updated_at = unixepoch()*1000 WHERE key = 'last_seen_id';"
  ```

### 3.2 故障场景 B：AI 模型输出契约冲突 (Schema Violation)

- **现象**：Workflows 频繁告警或抛出 `Contract Violation`，任务进入重试。
- **根因**：AI 视觉模型输出格式发生偏移，未满足 Zod Schema 强类型约束（如缺失关键字段或字符超长）。
- **排查步骤**：
  1. 检查 `TELEMETRY` 或 Tail 日志中抓取的原始 JSON 字符串。
  2. 确认是否包含 Markdown 代码块标记（如 ` ```json `）未被清洗层剥离。
- **处置方案**：在 `packages/shared/src/schemas.ts` 中微调校验规则，或在 `apps/engine/src/services/ai.ts` 中完善清洗提取逻辑后发布热修复。

### 3.3 故障场景 C：向量索引未同步堆积

- **现象**：D1 中存在大量 `vectorize_synced = 0` 的记录，前端搜索无法检索到新入库的图片。
- **根因**：Vectorize 在并发写入时触发频率上限或出现临时网络波动。
- **排查与补偿**：
  ```bash
  # 1. 统计待同步记录数量
  npx wrangler d1 execute lens-d1 --remote --command="SELECT COUNT(*) AS stuck_count FROM images WHERE vectorize_synced = 0;"

  # 2. 调用后台运维补偿接口触发重试
  curl -X POST https://lens.53.workers.dev/api/admin/compensate \
    -H "Content-Type: application/json" \
    -d '{"photoIds": ["<stuck_id_1>", "<stuck_id_2>"]}'
  ```

### 3.4 故障场景 D：事务发件箱事件堆积 (Outbox Relay Backlog)

- **现象**：`outbox_events` 表中未派发事件大量积压，导致下游搜索投影未能实时更新。
- **诊断**：调用内部对账接口获取积压量与最长等待时延：
  ```bash
  curl -H "cf-access-authenticated-user-email: admin@lens.internal" \
    https://lens.53.workers.dev/internal/reconciliation
  ```
- **修复与应急中继**：调用中继接口强制触发批次派发至 Queue：
  ```bash
  curl -X POST https://lens.53.workers.dev/internal/outbox/relay \
    -H "cf-access-authenticated-user-email: admin@lens.internal"
  ```

---

## 4. 成本核算与容量基准 (Cost & Capacity Model)

基于生产环境运行基准数据统计的单图处理与存储开销模型：

| 资源单元                   | 单次操作消耗                                    | 成本预估                       |
| :------------------------- | :---------------------------------------------- | :----------------------------- |
| **Llama-4 Scout 视觉推理** | 1 次推理 (~1k input tokens, ~150 output tokens) | ~ $0.00020 / 张                |
| **BGE-M3 向量嵌入**        | 1 次文本 Embedding (1024 维)                    | ~ $0.00002 / 张                |
| **D1 写入事务**            | 1 次写入 + 1 次 FTS5 触发器同步                 | 计入基础 Workers D1 配额       |
| **R2 存储 (规范 Master)**  | 规范母本 (~2MB) + Web 展示切片 (~300KB)         | $0.015 / GB-月（无出站流量费） |
| **综合单图处理成本**       | 全流程入库                                      | **~ $0.00030 / 张**            |

> **容量换算参考**：$1.00 美元预算可支撑约 3,300 ~ 3,500 张图片的完整母本归档、视觉解析与高维向量入库。

---

## 5. 存量模型升级与版本化重索引指南 (Re-indexing Runbook)

当系统引入更强大的新版视觉或嵌入模型时，依托 ADR-0006 的版本化搜索投影机制，遵循以下无停机维护流程：

1. **开辟新代际空间**：
   在 `projection_state` 中注册新的索引代际（如 `gen-002`），初始状态为 `building`：

   ```bash
   npx wrangler d1 execute lens-d1 --remote --command="INSERT INTO projection_state (projection_type, index_generation, status, document_count, coverage_ratio, created_at) VALUES ('vectorize', 'gen-002', 'building', 0, 0.0, unixepoch()*1000);"
   ```

2. **从规范 Master 渐进式重算**：
   利用 R2 归档的规范母本（`media/{contentHash}/master.{ext}`），无需重新请求外部外部源，直接调度 Workers 进行新模型推理，将生成的投影写入 `search_documents`（标记 `status = 'pending'`, `index_generation = 'gen-002'`）。

3. **对账与覆盖率验证**：
   调用对账接口确认新代际覆盖率达到 100%：

   ```bash
   curl -X POST https://lens.53.workers.dev/internal/reconciliation/run \
     -H "cf-access-authenticated-user-email: admin@lens.internal"
   ```

4. **原子代际切换 (Zero-Downtime Cutover)**：
   在 D1 中原子更新活跃代际指针，瞬间完成全局检索切换，旧代际标记为 `retired` 备查：
   ```bash
   npx wrangler d1 execute lens-d1 --remote --command="UPDATE projection_state SET status = 'retired' WHERE projection_type = 'vectorize' AND status = 'active'; UPDATE projection_state SET status = 'active', activated_at = unixepoch()*1000 WHERE projection_type = 'vectorize' AND index_generation = 'gen-002';"
   ```
