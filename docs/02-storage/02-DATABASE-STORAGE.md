# 存储与数据模型 (02-DATABASE-STORAGE)

Lens 采用了“三位一体”的存储架构，确保元数据（D1）、资产文件（R2）和语义向量（Vectorize）在边缘侧的高度一致与高性能。

---

## 1. D1 数据库 (元数据存储)

D1 是基于 SQLite 的分布式数据库。我们通过两个核心表来驱动系统。

### 1.1 `images` 表
存储图片的完整元数据及 AI 处理结果。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| **id** | TEXT (PK) | Unsplash 图片 ID (如 `SLgCDEqHav4`) |
| **width** | INTEGER | 图片像素宽度 |
| **height** | INTEGER | 图片像素高度 |
| **color** | TEXT | Unsplash 计算的主色调 (HEX) |
| **raw_key** | TEXT | R2 原始图路径 (格式: `raw/{id}.jpg`) |
| **display_key** | TEXT | R2 展示图路径 (格式: `display/{id}.jpg`) |
| **meta_json** | TEXT | Unsplash 原始 JSON 响应的字符串化存储 |
| **ai_tags** | TEXT | AI 分析生成的标签数组 (JSON) |
| **ai_caption** | TEXT | AI 生成的详细场景描述 |
| **ai_embedding**| TEXT | 1024 维 BGE 向量 (JSON 数组) |
| **created_at** | INTEGER | 入库 Unix 时间戳 (用于排序和同步) |

**关键索引**:
- `idx_created_at` (DESC): 用于 `/api/latest` 接口的高性能翻页。

### 1.2 `system_config` 表
维护采集引擎的运行状态，实现断点续传。

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| **key** | TEXT (PK) | 配置项名称 |
| **value** | TEXT | 配置值 |
| **updated_at** | INTEGER | 最后更新时间 |

**核心键值**:
- `last_seen_id`: 增量抓取的高水位线。
- `backfill_next_page`: 历史回填的下一页码。
- `vectorize_last_sync`: 增量向量同步的时间戳标记。

---

## 2. R2 存储 (资产存储)

R2 用于存储从 Unsplash 抓取的图片资产。

### 2.1 目录结构
```text
lens-r2/
├── raw/       # 原始画质 (Original RAW) - 用于存档
└── display/   # 展示画质 (Regular 1080p) - 用于 AI 分析和前端加载
```

### 2.2 优化策略
- **流式写入**: 采用 `Body.getReader()` 流式读取响应并直接管道式写入 R2，避免将整个图片加载进 Worker 内存（128MB 限制）。
- **缓存策略**: 所有 R2 代理接口均返回 `Cache-Control: public, max-age=31536000, immutable`，强制浏览器和边缘 CDN 长期缓存。

---

## 3. Vectorize (向量索引)

用于支持语义搜索的核心引擎。

### 3.1 配置细节
- **维度 (Dimensions)**: 1024 (匹配 `bge-large-en-v1.5`)。
- **度量 (Metric)**: `cosine` (余弦相似度)，最适合文本与图像语义对齐。

### 3.2 Metadata 注入
为了减少 D1 查询压力，我们在 Vectorize 索引中冗余了以下字段：
- `url`: 直接指向 `/image/display/{id}.jpg`。
- `caption`: 存储 AI 生成的简短描述。

---

## 4. 数据一致性保证 (Consistency)

在一个异步并发环境下，确保 D1/R2/Vectorize 步调一致至关重要：

1.  **Workflow 编排**: 将处理过程分解为原子步骤（Step）。
2.  **写前检查**: Workflow 开始前先查询 D1 是否存在该 ID，如果存在则直接 `Finish`。这在“回填”模式下极其重要。
3.  **最终一致性兜底**: 定时任务 `runVectorSync` 会定期对比 D1 与 Vectorize 的最新时间戳，自动补全任何由于 Workflow 中途崩毁导致的索引缺失。
