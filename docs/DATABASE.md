# 存储体系、数据契约与多维索引治理 (02-DATABASE-STORAGE)

Lens 的存储系统是一个由 **D1, R2, Vectorize, KV** 四个组件构成的“异构存储矩阵”。我们没有简单地把数据塞进一个库，而是基于数据访问的频率、体积和计算需求，设计了一套复杂的数据流转与契约校验机制。

---

## 1. D1：分布式关系型大脑 (The Relational Hub)

D1 不仅存储元数据，它还承载了系统的**认知状态 (Cognitive State)**。

### 1.1 `images` 表：旗舰级数据模型深度解构

这个表的设计充分考虑了 AI 进化和前端性能的平衡：

- **物理指纹 (`id`, `width`, `height`, `color`)**：
  - `width` 和 `height` 的存在是为了实现前端的 **“零抖动”渲染**。通过在图片下载前预设 `aspect-ratio` 容器，我们解决了瀑布流页面最头疼的布局重排问题。
  - `color` 字段用于渲染主色调占位图（Placeholder），在 4G/5G 弱网环境下，用户依然能感受到图片的“轮廓感”。
- **智力版本标记 (`ai_model`)**：
  这是实现 **“存量数据自我进化”** 的核心。它不仅记录了版本，还充当了 `Self-Evolution` 引擎的任务筛选器。所有标记为 `llama-3.2` 的记录，都是系统未来会被自动清洗、升级的“潜在资产”。
- **高阶语义字段 (`ai_quality_score`, `entities_json`)**：
  - `ai_quality_score`：由 Llama 4 基于摄影美学打出的分数。这让 Lens 具备了“审美倾向”，可以将艺术性更高的作品推向首页。
  - `entities_json`：这是一个存储结构化实体的 TEXT 列。它打破了模糊搜索的局限，让系统具备了“地标/品牌/物种”的精确点对点召回能力。

---

## 2. R2：分层资产与代理缓存策略

R2 并非一个死板的文件存储桶，我们为其设计了一套**“冷热分层”**的访问架构。

### 2.1 存储分层 (Asset Tiering)

- **`raw/` 存档层**：
  存储 Unsplash 的最高分辨率原图（5MB-20MB）。这部分资产主要用于详情页的“原图查看”和“高保真下载”。由于其体积巨大，系统**禁止** AI 模型直接读取此路径，以防撑爆边缘 Worker 128MB 的内存上限。
- **`display/` 生产层**：
  存储经过 Web 优化的 Regular 画质图（~300KB）。这是系统的“热数据”：
  1.  它是 Llama 4 Vision 进行视觉分析的输入源。
  2.  它是前端瀑布流展示的默认输出源。

### 2.2 Immutable 代理逻辑

API 并不直接暴露 R2 的原始链接，而是通过一个 `/image/:type/:filename` 端点进行中转。

- **缓存注入**：中转层自动注入 `Cache-Control: public, max-age=31536000, immutable`。
- **流量套利**：一旦图片被 Cloudflare 边缘节点缓存，后续的百万次请求将产生 **0 次** R2 Class B 操作费。这是 Lens 能够保持极低运营成本的关键技术细节。

---

## 3. Vectorize：1024 维语义空间管理

Vectorize 是 Lens 搜索的“物理引擎”，它通过 BGE-M3 模型将文字描述映射到了 1024 维的高维流形空间。

- **冗余 Metadata 策略**：我们在向量索引中冗余存储了 `url` 和 `caption`。
  - **理由**：在某些快速预览场景下，API 无需查询 D1，仅靠 Vectorize 的返回结果就能拼装出包含缩略图和描述的响应，极大降低了 D1 的 IOPS 压力。
- **余弦相似度度量**：选用 `cosine` 作为度量标准，这最符合文本与图像在语义空间中的方向对齐特性。

---

## 4. Zod：强契约层的引入 (The Deterministic Guard)

在处理 Llama 4 Scout 的输出时，最大的风险是其“概率性”。为了防止数据库被 AI 生成的脏数据（Markdown 代码块、乱码或多余的解释）污染，我们引入了 Zod。

### 4.1 `VisionResponseSchema` 的约束力

```typescript
export const VisionResponseSchema = z.object({
  caption: z.string().min(10).max(1000), // 确保描述具备足够的语义密度
  quality: z.number().min(0).max(10), // 强制审美分数落地
  entities: z.array(z.string()), // 确保实体是清晰的字符串数组
  tags: z.array(z.string().lowercase()), // 强制标签小写化以对齐索引
});
```

- **意义**：所有的 AI 响应在入库前必须通过 Zod 的严苛扫描。如果校验失败，系统会触发 Workflow 的指数退避重试或优雅降级，从而保证了数据库中 **“每一条记录都是符合预期的旗舰版资产”**。

---

## 5. KV：动态配置与实时账单

KV 充当了系统的“全局神经元”，负责那些高频变动且需要跨区域同步的状态。

- **`config:ingestion` (热更新面板)**：
  支持无需重新部署代码的“热切换”：
  - `backfill_enabled`: 系统整体采集的紧急熔断器。
  - `daily_evolution_limit_usd`: 动态调节“自进化”系统的生产马力。
- **`semantic:cache` (词义缓存)**：
  存储了搜索词的 AI 扩展结果。这不仅仅是为了加速，更是为了**“去重开销”**。对于同一个词，我们只向 Llama 4 支付一次查询扩展的费用。
