# 存储体系、数据契约与多维索引治理

更新日期：2026-09-19
状态：现行
适用范围：D1、R2、Vectorize、KV 异构存储架构、Schema 规范与索引治理

Lens 采用异构云原生存储架构，结合 Cloudflare D1（边缘关系数据库）、R2（对象存储）、Vectorize（高维向量数据库）以及 Workers KV（低延迟键值存储），针对图像元数据、静态媒体、密集向量与高频缓存进行职责分离与契约约束。

---

## 1. D1 关系型存储设计与 Schema 规范

D1 基于 SQLite 引擎运行于边缘节点，作为图像结构化元数据、配置项和日志的主要持久化中枢。

### 1.1 `images` 主表

存储图像物理属性、AI 视觉标注、向量同步状态及元数据快照。

```sql
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  color TEXT,
  raw_key TEXT NOT NULL,
  display_key TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  ai_tags TEXT,
  ai_caption TEXT,
  ai_embedding TEXT,
  ai_model TEXT,
  ai_quality_score REAL,
  entities_json TEXT,
  created_at INTEGER NOT NULL,
  vectorize_synced INTEGER DEFAULT 0
);
```

#### 关键字段契约与工程考量

- **`width`, `height`**：图片原生像素尺寸。前端通过计算固定 `aspect-ratio` 预留渲染容器空间，防止瀑布流动态加载时的累积布局偏移（Cumulative Layout Shift, CLS）。
- **`color`**：Unsplash 提供的 HEX 主色调代码。用于在图片流加载完成前渲染渐变占位背景。
- **`display_key`**：R2 中优化后的展示图存储路径（规范：`display/{id}.jpg`）。
- **`meta_json`**：Unsplash 原始元数据 JSON 字符串，包含摄影器材 EXIF、地理位置坐标与摄影师信息。
- **`ai_model`**：生成视觉标注的 AI 模型版本标示（如 `@cf/meta/llama-4-scout-17b-16e-instruct`），用于版本审计与存量数据升级。
- **`ai_quality_score`**：AI 评估的画质与美学综合得分（区间 0.0 ~ 10.0），支持精排与推荐加权。
- **`vectorize_synced`**：向量同步标记。`0` 表示待同步，`1` 表示已成功写入 Vectorize 索引。

### 1.2 索引优化策略 (0002_performance_tuning.sql)

针对核心读写路径构建了覆盖索引与部分索引，确保高并发下的低 I/O 消耗：

1. **首页覆盖索引 (`idx_images_latest_render`)**：

   ```sql
   CREATE INDEX IF NOT EXISTS idx_images_latest_render
   ON images (created_at DESC, id, display_key, color, width, height, ai_quality_score);
   ```

   _作用_：包含首页最新列表所需的全量字段，实现 Index-Only Scan，避免回表查询。

2. **模型审计索引 (`idx_images_evolution_audit`)**：

   ```sql
   CREATE INDEX IF NOT EXISTS idx_images_evolution_audit
   ON images (ai_model, created_at DESC)
   WHERE ai_model IS NOT NULL;
   ```

   _作用_：加速定时审计任务对低版本模型标注记录的聚类检索。

3. **同步故障部分索引 (`idx_images_stuck_sync`)**：
   ```sql
   CREATE INDEX IF NOT EXISTS idx_images_stuck_sync
   ON images (vectorize_synced)
   WHERE vectorize_synced = 0;
   ```
   _作用_：仅对未同步的稀疏记录建索引，极小化索引体积，保障补偿任务的高效查询。

### 1.3 `system_config` 与 `search_logs`

- **`system_config`**：记录定时拉取的游标状态（如 `last_seen_id`）与系统运行配置。
- **`search_logs`**：记录检索词、命中数与耗时，提供离线性能分析与链路审计。

---

## 2. FTS5 全文搜索虚拟表 (0001_fts5_search.sql)

为了解决高维语义向量在精准词（摄影器材型号、具体地名、摄影师名、专有名词）检索中的召回漂移问题，系统引入 SQLite FTS5 全文检索模块。

### 2.1 虚拟表结构

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS images_fts USING fts5(
    id,
    caption,
    tags,
    photographer,
    location
);
```

### 2.2 触发器自动同步机制

通过数据库级触发器实现主表与虚拟表的数据强一致性同步，无需上层业务代码二次写入：

- **`images_fts_ai`**：`AFTER INSERT ON images` 触发，提取 `meta_json` 中的作者名和地点与 AI 描述共同写入。
- **`images_fts_ad`**：`AFTER DELETE ON images` 触发，级联删除索引行。
- **`images_fts_au`**：`AFTER UPDATE ON images` 触发，执行旧记录删除与新数据重索引。

---

## 3. R2 对象存储资产规范

Cloudflare R2 负责承载静态图像文件存储，具备无出站流量费用（Zero Egress Fees）的成本优势。

### 3.1 资产分层与路径规约

- **存储路径**：`display/${photoId}.jpg`
- **资产规格**：Web 优化格式（尺寸缩放，体积约 200KB - 400KB）。
- **原图策略 (ADR-0003)**：不再对原始超大图片（5MB~25MB）执行持久化落盘，流水线在下载原图流后直接由 Workers 完成视觉推理与缩放转换，仅保留 `display/` 规格，大幅降低存储容量开销。

### 3.2 边缘缓存与协商

- 通过 `/image/display/:filename` 代理接口对外暴露访问。
- 自动写入 HTTP 响应头：`Cache-Control: public, max-age=31536000, immutable` 与对象 `ETag`。
- 首层命中 Cloudflare Edge CDN 缓存，未命中时回源 R2 获取流式 Body。

---

## 4. Vectorize 高维向量索引

Cloudflare Vectorize 承载密集语义向量的近邻搜索（ANN）。

- **绑定标识**：`VECTORIZE`（索引名称：`lens-vectorize`）。
- **嵌入模型**：`@cf/baai/bge-m3`（Workers AI 原生运行）。
- **向量维度**：1024 维密集浮点向量。
- **距离度量**：余弦相似度 (`cosine`)。
- **元数据负载**：Vector 向量记录中冗余存储 `url` 与 `caption`，供检索召回阶段执行轻量化元数据初筛。

---

## 5. Workers KV 动态配置与双层缓存

Workers KV (`SETTINGS`) 作为高读取、毫秒级响应的分布式缓存层：

| 键模式 (Key Pattern)    | 存活期 (TTL)           | 用途说明                                   |
| :---------------------- | :--------------------- | :----------------------------------------- |
| `cache:latest`          | 3,600 秒 (1 小时)      | 首页最新 100 张图片列表数据缓存            |
| `cache:detail:${id}`    | 86,400 秒 (24 小时)    | 单图详情与 EXIF 元数据缓存                 |
| `suggest:prefix:${pfx}` | 2,592,000 秒 (30 天)   | 2 字符前缀搜索补全词列表（每键上限 50 条） |
| `stats:summary`         | 60 秒 (1 分钟)         | 系统总量与 24 小时增量统计缓存             |
| `config:ingestion`      | 永久（手动或更新驱动） | 动态拉取速率与故障熔断开关                 |

---

## 6. 数据校验契约 (Zod Runtime Contract)

系统在边缘流水线解析外部 Unsplash 响应与 Workers AI 视觉输出时，强制经过 Zod 严格校验，杜绝非法脏数据入库：

```typescript
export const VisionResponseSchema = z.object({
  caption: z.string().min(10).max(1000),
  quality: z.number().min(0).max(10),
  entities: z.array(z.string()),
  tags: z.array(z.string().toLowerCase()),
});
```

---

## 7. 数据库运维与迁移规程 (Migrations Runbook)

所有数据库 Schema 变更均通过声明式 SQL 脚本受控执行：

```bash
# 1. 本地沙箱执行迁移测试
pnpm --filter engine exec wrangler d1 migrations apply lens-d1 --local

# 2. 生产环境执行迁移（受控发布）
pnpm --filter engine exec wrangler d1 migrations apply lens-d1 --remote

# 3. 查看生产环境迁移历史记录
pnpm --filter engine exec wrangler d1 migrations list lens-d1 --remote
```
