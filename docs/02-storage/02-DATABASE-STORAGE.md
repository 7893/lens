# 存储体系与数据模型详解 (02-DATABASE-STORAGE)

Lens 的存储架构设计遵循 **“职责分离、多级缓存、最终一致性”** 的原则，利用 Cloudflare D1、R2、Vectorize 和 KV 构建了一个完整的分布式存储矩阵。

---

## 1. D1 数据库：关系型元数据核心

D1 (SQLite) 是系统的“大脑”，负责存储结构化数据和状态游标。

### 1.1 `images` 表结构

该表存储每张图片的指纹、AI 理解结果及索引关键信息。

| 字段               | 类型      | 说明                                                  |
| :----------------- | :-------- | :---------------------------------------------------- |
| **id**             | TEXT (PK) | Unsplash 原始 ID，具有全球唯一性。                    |
| **width / height** | INTEGER   | 图片分辨率，用于前端瀑布流布局计算。                  |
| **color**          | TEXT      | 图片主色调 HEX 值，用于占位符渲染。                   |
| **raw_key**        | TEXT      | 对应 R2 中 `raw/` 目录的原始文件路径。                |
| **display_key**    | TEXT      | 对应 R2 中 `display/` 目录的优化图路径。              |
| **meta_json**      | TEXT      | 包含 Unsplash 提供的摄影师、位置、EXIF 等原始 JSON。  |
| **ai_tags**        | TEXT      | 序列化后的标签数组，用于关键词检索补偿。              |
| **ai_caption**     | TEXT      | Llama 3.2 Vision 生成的深度语义描述（核心搜索文本）。 |
| **ai_embedding**   | TEXT      | 1024 维 BGE-M3 向量数组（JSON 形式存储备份）。        |
| **created_at**     | INTEGER   | 入库 Unix 时间戳，建立 B-Tree 索引以支持快速排序。    |

### 1.2 `system_config` 表结构

系统级游标表，驱动“线性对撞”算法的持久化。

| 键 (`key`)            | 用途描述                                       | 更新频率    |
| :-------------------- | :--------------------------------------------- | :---------- |
| `last_seen_id`        | 记录采集的最前端锚点，用于增量抓取。           | 每小时 1 次 |
| `backfill_base_page`  | 记录历史回填进度，实现断点续传。               | 每批次 1 次 |
| `vectorize_last_sync` | 记录 D1 到 Vectorize 同步的时间戳 checkpoint。 | 增量同步时  |

---

## 2. KV (SETTINGS)：动态管理与语义缓存

KV 承担了两项关键任务：**系统节流阀** 和 **全球语义缓存**。

### 2.1 动态管理面板 (`config:ingestion`)

无需重新部署代码即可实时控制系统行为。

- `backfill_enabled` (boolean): 历史回填功能总开关。
- `backfill_max_pages` (number): **每小时生产配额**。例如设为 2，则每小时最多回填 60 张图。

### 2.2 搜索语义缓存 (`semantic:cache:<query>`)

- **Key**: 用户原始查询词的标准化格式（Lowercase/Trim）。
- **Value**: Llama 3.2 生成的视觉扩展文本。
- **TTL**: 7 天（可根据词频自动刷新）。
- **收益**: 将热门搜索的 AI 延迟从 1500ms 降至 50ms。

---

## 3. R2 存储：资产分层策略

R2 采用 **“一次写入、多地代理”** 的流式架构。

### 3.1 路径划分

- `raw/`: 原始高保真大图（通常 5-15MB），用于存档及高质量下载。
- `display/`: 压缩优化版（通常 300KB），用于前端极速加载及 AI Vision 模型分析。

### 3.2 R2 代理 (Image Proxy)

由于 R2 存储桶不公开，系统通过 API 提供代理。代理层自动计算 `ETag`，并注入 `Cache-Control: immutable` 头部，强制边缘 CDN 实现永久缓存，极大节省了 R2 的 Class B 操作配额。

---

## 4. Vectorize：原生向量检索

- **配置**: 1024 维，`cosine` 余弦相似度。
- **同步机制**: Workflow 实时写入为主，`runVectorSync` 定时兜底为辅。
- **Metadata**: 索引条目中包含 `url` 和 `caption` 冗余，实现检索后无需回表即可渲染缩略图。
