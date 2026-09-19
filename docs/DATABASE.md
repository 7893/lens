# 存储体系、数据契约与多维索引治理

更新日期：2026-09-19
状态：现行
适用范围：D1、R2、Vectorize、KV 异构存储架构、Schema 规范与索引治理

Lens 采用异构云原生存储架构，结合 Cloudflare D1（边缘关系数据库）、R2（对象存储）、Vectorize（高维向量数据库）以及 Workers KV（低延迟键值存储），针对规范资产模型、不可变媒体母本、密集向量与高频缓存进行职责分离与契约约束。

---

## 1. D1 关系型存储设计与规范体系

D1 基于 SQLite 引擎运行于边缘节点，作为图像规范资产聚合根、发件箱/收件箱、版本化搜索投影、运行时配置与审计的**唯一事实源**。系统遵循 Expand / Contract 演进原则，确保新老表平滑并行与零停机升级。

### 1.1 规范资产聚合模型 (`0003_v2_canonical_models.sql`)

为了支撑多数据源接入与长期资产自主权，系统确立以 `assets` 为核心的领域聚合结构：

#### 1.1.1 资产聚合根 (`assets`)

```sql
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  source_provider TEXT NOT NULL,
  source_external_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, ready, taken_down, archived
  search_ready INTEGER NOT NULL DEFAULT 0,
  active_representation_version TEXT,
  active_embedding_version TEXT,
  active_index_generation TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_source ON assets(source_provider, source_external_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status, search_ready);
CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);
```

#### 1.1.2 外部来源元数据与溯源 (`asset_sources`)

```sql
CREATE TABLE IF NOT EXISTS asset_sources (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  canonical_url TEXT,
  author_name TEXT,
  author_url TEXT,
  license TEXT NOT NULL DEFAULT 'Unsplash License',
  retention_policy TEXT NOT NULL DEFAULT 'standard',
  raw_json TEXT,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_sources_asset_id ON asset_sources(asset_id);
```

#### 1.1.3 不可变媒体变体 (`media_objects`)

记录存储于 R2 中的各类内容寻址文件及其物理特征：

```sql
CREATE TABLE IF NOT EXISTS media_objects (
  content_hash TEXT NOT NULL,
  variant_kind TEXT NOT NULL, -- master, display, thumbnail, derived
  r2_key TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  mime_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (content_hash, variant_kind)
);

CREATE INDEX IF NOT EXISTS idx_media_objects_r2_key ON media_objects(r2_key);
```

#### 1.1.4 多模态语义表征 (`representations`)

支持同资产在不同视觉大模型下的多版本标注与表征：

```sql
CREATE TABLE IF NOT EXISTS representations (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  representation_version TEXT NOT NULL,
  model_name TEXT NOT NULL,
  caption TEXT,
  tags_json TEXT,
  entities_json TEXT,
  quality_score REAL,
  embedding_version TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_representations_asset ON representations(asset_id, representation_version);
```

#### 1.1.5 流水线执行审计 (`processing_runs`)

```sql
CREATE TABLE IF NOT EXISTS processing_runs (
  run_id TEXT PRIMARY KEY, -- process:{assetId}:{pipelineVersion}
  asset_id TEXT NOT NULL REFERENCES assets(id),
  pipeline_version TEXT NOT NULL,
  status TEXT NOT NULL, -- running, completed, failed
  step_checkpoint TEXT,
  error_details TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_processing_runs_asset ON processing_runs(asset_id, started_at DESC);
```

#### 1.1.6 事务发件箱与收件箱 (`outbox_events` & `consumed_events`)

保障跨组件（D1 -> Queue -> Workflows / Vectorize）分布式异步调度的最终一致性，杜绝跨存储裸双写：

```sql
-- 事务发件箱 (Transactional Outbox)
CREATE TABLE IF NOT EXISTS outbox_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  payload_json TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  dispatched_at INTEGER -- NULL if pending dispatch
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(dispatched_at) WHERE dispatched_at IS NULL;

-- 消费幂等收件箱 (Idempotent Inbox Journal)
CREATE TABLE IF NOT EXISTS consumed_events (
  consumer TEXT NOT NULL,
  event_id TEXT NOT NULL,
  consumed_at INTEGER NOT NULL,
  PRIMARY KEY (consumer, event_id)
);
```

---

### 1.2 版本化搜索投影模型 (`0004_v2_indexing_projections.sql`)

检索层与主聚合根物理解耦，支持代际平滑切换与并行双写重索引：

```sql
-- 搜索文档投影 (Search Documents)
CREATE TABLE IF NOT EXISTS search_documents (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  representation_version TEXT NOT NULL,
  embedding_version TEXT NOT NULL,
  index_generation TEXT NOT NULL,
  vector_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, active, retired
  caption TEXT,
  tags_json TEXT,
  doc_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  activated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_search_docs_lookup ON search_documents(asset_id, index_generation);
CREATE INDEX IF NOT EXISTS idx_search_docs_status ON search_documents(status, index_generation);

-- 投影代际管理 (Projection State)
CREATE TABLE IF NOT EXISTS projection_state (
  projection_type TEXT NOT NULL, -- vectorize, fts
  index_generation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'building', -- building, active, retired
  document_count INTEGER NOT NULL DEFAULT 0,
  coverage_ratio REAL NOT NULL DEFAULT 0.0,
  created_at INTEGER NOT NULL,
  activated_at INTEGER,
  PRIMARY KEY (projection_type, index_generation)
);
```

---

### 1.3 运行时配置与运维操作审计 (`0005_v2_governance_and_audit.sql`)

提供管理面高风险操作与动态配置的强一致持久化支持：

```sql
CREATE TABLE IF NOT EXISTS runtime_config (
  key TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  value_json TEXT NOT NULL,
  description TEXT,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS operation_audit (
  id TEXT PRIMARY KEY,
  operator TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL, -- 'success' | 'failure'
  details_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operation_audit_target ON operation_audit(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_operation_audit_correlation ON operation_audit(correlation_id);
```

---

### 1.4 存量兼容易构表与倒排索引 (`0000` ~ `0002`)

在过渡期内，系统保留 `images` 实体表与 `images_fts` 虚拟表，以保证上层老接口与现有数据平滑兼容：

- **`images`**：单表聚合视图，用于向后兼容只读读取；
- **`images_fts`**：SQLite FTS5 全文搜索虚拟表，通过触发器（`images_fts_ai`, `images_fts_ad`, `images_fts_au`）实现主表同步；
- **`idx_images_latest_render`**：覆盖索引（Index-Only Scan），加速画廊首屏加载。

---

## 2. R2 对象存储资产规范与归档战略

Cloudflare R2 负责承载静态图像持久化存储，具备无出站流量费用（Zero Egress Fees）的成本优势。

### 2.1 规范 Master 长期归档战略 (Canonical Master)

为确保持续 5~10 年的视觉模型演进不受外部第三方服务限制，系统实施规范母本归档：

- **存储规约**：`media/{contentHash}/master.{ext}`；
- **流式 SHA-256 计算**：通过 Web Crypto API 执行单遍流式哈希计算，零内存全量缓冲；
- **40MB 内存防爆守卫**：检测超出 40MB 的超大文件并立即熔断中断，保护 128MB Workers 边缘运行时；
- **内容寻址去重**：同一哈希母本天然去重，避免重复存储与多余计费。

### 2.2 Web 展示切片 (Display Variant)

- **存储规约**：`display/{photoId}.jpg`；
- **资产规格**：Web 优化格式（约 200KB ~ 400KB）；
- **边缘缓存**：通过 `/image/display/:filename` 代理，返回 `Cache-Control: public, max-age=31536000, immutable` 与不可变 ETag。

---

## 3. Vectorize 高维向量索引与召回不变量

Cloudflare Vectorize 承载密集语义向量的近邻搜索（ANN）。

- **绑定标识**：`VECTORIZE`（索引名称：`lens-vectorize`）；
- **嵌入模型**：`@cf/baai/bge-m3`（Workers AI 原生运行）；
- **向量维度**：**1024 维** 密集浮点向量；
- **距离度量**：余弦相似度 (`cosine`)；
- **版本化 Vector ID**：`{assetId}#{representationId}#{modelTag}`；
- **回表水合绝对不变量**：Vectorize 仅作为粗排候选生成器（Candidate Source）。召回的候选向量必须回 D1 数据库执行水合校验，仅当 `assets.status = 'ready'` 且 `assets.search_ready = 1` 且属于当前激活代际时，方可在搜索接口中曝光。

---

## 4. Workers KV 动态配置与双层缓存

Workers KV (`SETTINGS`) 作为高读取、毫秒级响应的分布式只读缓存层：

| 键模式 (Key Pattern)    | 存活期 (TTL)           | 用途说明                                   |
| :---------------------- | :--------------------- | :----------------------------------------- |
| `cache:latest`          | 3,600 秒 (1 小时)      | 首页最新 100 张图片列表数据缓存            |
| `cache:detail:${id}`    | 86,400 秒 (24 小时)    | 单图详情与 EXIF 元数据缓存                 |
| `suggest:prefix:${pfx}` | 2,592,000 秒 (30 天)   | 2 字符前缀搜索补全词列表（每键上限 50 条） |
| `stats:summary`         | 60 秒 (1 分钟)         | 系统总量与 24 小时增量统计缓存             |
| `config:ingestion`      | 永久（手动或更新驱动） | 动态拉取速率与故障熔断快照                 |

---

## 5. 数据校验契约 (Zod Runtime Contract)

系统在边缘流水线解析外部图源响应与 Workers AI 视觉输出时，强制经过 Zod 严格校验，杜绝非法脏数据入库：

```typescript
export const VisionResponseSchema = z.object({
  caption: z.string().min(10).max(1000),
  quality: z.number().min(0).max(10),
  entities: z.array(z.string()),
  tags: z.array(z.string().toLowerCase()),
});
```

---

## 6. 数据库运维与迁移规程 (Migrations Runbook)

所有数据库 Schema 变更均通过声明式 SQL 脚本受控执行，目前已完成六步顺序迁移：

| 迁移脚本                           | 核心功能                                   | 引入阶段 |
| :--------------------------------- | :----------------------------------------- | :------- |
| `0000_init.sql`                    | 初始 `images` 单表结构与系统基础配置       | Lens 1.0 |
| `0001_fts5_search.sql`             | SQLite FTS5 虚拟全文检索表与数据同步触发器 | Lens 1.0 |
| `0002_performance_tuning.sql`      | 首页覆盖索引与未同步部分索引               | Lens 1.0 |
| `0003_v2_canonical_models.sql`     | 规范资产聚合根、发件箱/收件箱与多模态表征  | ADR-0006 |
| `0004_v2_indexing_projections.sql` | 搜索文档投影表与代际健康度状态机           | ADR-0006 |
| `0005_v2_governance_and_audit.sql` | 权威运行时配置持久化与运维操作审计日志     | ADR-0006 |

### 迁移执行命令

```bash
# 1. 本地沙箱执行迁移测试
pnpm --filter engine exec wrangler d1 migrations apply lens-d1 --local

# 2. 生产环境执行全量迁移（受控发布）
pnpm --filter engine exec wrangler d1 migrations apply lens-d1 --remote

# 3. 查看生产环境迁移版本历史
pnpm --filter engine exec wrangler d1 migrations list lens-d1 --remote
```
