# Lens 核心架构与算法深度解析 (01-ARCHITECTURE)

Lens 是一个运行在 Cloudflare 边缘计算栈之上的高度集成的 AI 视觉搜索引擎。本系统旨在解决海量非结构化图片数据的自动化采集、深度语义分析及亚秒级检索挑战。

---

## 1. 宏观系统架构

系统采用 **双管道解耦架构 (Dual-Pipeline Decoupled Architecture)**，通过事件驱动和异步队列确保搜索响应速度与数据采集能力互不干扰。

### 1.1 搜索管道 (Search Pipeline) - 同步链路

- **入口**: Hono 驱动的 API 网关。
- **二级缓存层**:
  - **Edge Cache**: 浏览器与数据中心级的 HTTP 响应缓存。
  - **Semantic Cache (KV)**: 针对查询扩展结果的全球语义缓存。
- **AI 增强**:
  1.  **Llama 4 Scout 17B**: 执行多语言翻译与视觉语义扩展。
  2.  **BGE-M3**: 生成 1024 维密集向量。
  3.  **Vectorize**: 执行余弦相似度检索。
  4.  **BGE Reranker Base**: 对召回结果进行二次精排。

### 1.2 采集管道 (Ingestion Pipeline) - 异步链路

- **调度**: 每 10 分钟触发的 Cron 定时任务（配额不足时自动跳过）。
- **缓冲**: Cloudflare Queues 实现任务削峰。
- **执行**: Cloudflare Workflows 提供持久化状态机保障。
- **节点**:
  1.  **D1 幂等检查**: 预防重复。
  2.  **R2 流式下载**: 降低内存占用。
  3.  **Llama 3.2 11B Vision**: 深度视觉理解。
  4.  **原子写入**: 同步索引至数据库与向量库。

---

## 2. 核心算法：线性对撞采集模型 (Linear Boundary Ingestion)

这是 Lens 能够在极低 API 配额（Unsplash 50次/小时）下实现产出最大化的核心算法。

### 2.1 算法逻辑拆解

系统将抓取过程视为在一条有序的时间轴上寻找“已知”与“未知”的交界点。

#### **第一阶段：正向追新 (Forward Catch-up)**

- **目标**: 捕捉自上次运行以来的所有新发布图片。
- **机制**: **首个重合点即熔断 (`hitExisting`)**。
- **过程**:
  1.  一页一页串行探测。
  2.  对每一页图片，在入库前批量比对 D1 数据库。
  3.  **熔断点**: 只要在当前页发现**任一** ID 已存在于 D1，系统立即判定“新图区已终结”。
  4.  处理完该 ID 之前的纯新图后，瞬间关闭正向逻辑。
- **效率**: 通常只需 1 次 API 调用即可完成新图捕捉。

#### **第二阶段：反向无缝回填 (Backward Backfill)**

- **目标**: 挖掘并填平历史库存中的空洞点。
- **机制**: **无缝进度接龙**。
- **过程**:
  1.  读取 D1 存储的 `backfill_next_page` 游标。
  2.  将剩余的（约 48-49 次）API 配额全部投入历史挖掘。
  3.  **节流控制**: 严格遵守 KV 配置中的 `backfill_max_pages` 上限。
  4.  **状态持久化**: 每完成一页，立即在 D1 中更新存档点。

---

## 3. AI 选型与性能权衡

系统针对不同场景采用了“大模型重逻辑、小模型重效率”的阶梯策略：

| 任务类型                | 模型                   | 理由                                       |
| :---------------------- | :--------------------- | :----------------------------------------- |
| **图片描述 (Vision)**   | `Llama 3.2 11B Vision` | 强力视觉感知，能识别色彩、构图及深层情感。 |
| **查询扩展 (LLM)**      | `Llama 4 Scout 17B`    | 多语言支持强，场景描述更具象化。           |
| **结果重排 (Reranker)** | `BGE Reranker Base`    | 专用重排模型，精度高，速度快。             |
| **向量化 (Embedding)**  | `BGE-M3`               | 1024 维多语言模型，兼顾精度与检索性能。    |

---

## 4. 多级缓存与成本优化策略

Lens 采用 **三级缓存架构** 实现 AI 调用成本的极致压缩：

### 4.1 缓存层级

| 层级                  | 技术                  | TTL     | 命中效果                   |
| :-------------------- | :-------------------- | :------ | :------------------------- |
| **L1 Edge Cache**     | Cloudflare HTTP Cache | 10 分钟 | 跳过全部 AI 调用，直接返回 |
| **L2 Semantic Cache** | Workers KV            | 7 天    | 跳过 LLM 查询扩展          |
| **L3 AI Gateway**     | Gateway 内置缓存      | 关闭    | 保留用于未来扩展           |

### 4.2 搜索请求成本分析

单次搜索最多触发 3 次 AI 调用：

```text
┌─────────────────────────────────────────────────────────┐
│  搜索请求: "sunset beach"                                │
├─────────────────────────────────────────────────────────┤
│  1. Query Expansion (Llama 3B)  →  ~2,000 Neurons       │
│  2. Embedding (BGE Large)       →  ~1,000 Neurons       │
│  3. Re-ranking (Llama 3B)       →  ~2,000 Neurons       │
├─────────────────────────────────────────────────────────┤
│  总计: ~5,000 Neurons/搜索                               │
└─────────────────────────────────────────────────────────┘
```

### 4.3 缓存命中后的成本

| 缓存命中     | AI 调用 | Neurons 消耗 | 节省比例 |
| :----------- | :------ | :----------- | :------- |
| 无命中       | 3 次    | ~5,000       | 0%       |
| L2 KV 命中   | 2 次    | ~3,000       | **40%**  |
| L1 HTTP 命中 | 0 次    | 0            | **100%** |

### 4.4 实现细节

**L2 Semantic Cache (KV)**:

```typescript
// Key 格式: semantic:cache:{normalized_query}
const cacheKey = `semantic:cache:${query.toLowerCase().trim()}`;
let expandedQuery = await env.SETTINGS.get(cacheKey);

if (!expandedQuery) {
  // Cache miss: 调用 LLM 扩展
  expandedQuery = await ai.run('@cf/meta/llama-3.2-3b-instruct', {...});
  // 异步写入缓存，TTL 7 天
  ctx.waitUntil(env.SETTINGS.put(cacheKey, expandedQuery, { expirationTtl: 604800 }));
}
```

**L1 Edge Cache**:

```typescript
// 相同查询 10 分钟内直接返回缓存响应
const cacheKey = new Request(`https://lens-cache/search?q=${encodeURIComponent(q)}`);
const cached = await caches.default.match(cacheKey);
if (cached) return cached;
```

### 4.5 月度成本估算

基于 Workers Paid ($5/月) 的免费额度：

| 指标               | 值                     |
| :----------------- | :--------------------- |
| 免费 Neurons       | 300,000/月             |
| 单次搜索 (无缓存)  | ~5,000 Neurons         |
| 单次搜索 (KV 命中) | ~3,000 Neurons         |
| 单张图片处理       | ~10,000 Neurons        |
| **预估免费搜索量** | 60-100 次/月 (无缓存)  |
| **预估免费搜索量** | 100-150 次/月 (有缓存) |

> 💡 **设计哲学**: 通过 KV 缓存将高频重复查询的成本降至最低，同时保留 AI Gateway 作为未来扩展点（如添加外部 LLM fallback）。

---

## 5. 系统架构图 (ASCII)

```text
       用户 (User)
          │
          ▼ [Hono API]
┌─────────────────────────────────────────┐
│           Search Pipeline               │
│                                         │
│  Query Expansion (3B) ──> Cache (KV)    │
│          │                              │
│  Embedding (BGE) ──> Vectorize Search   │
│          │                              │
│  Re-ranking (3B) ──> Final Results      │
└─────────────────────────────────────────┘
          │           │           │
          ▼           ▼           ▼
      D1 Database  Vectorize   R2 Bucket
      (元数据)      (向量库)    (图片存储)
          ▲           ▲           ▲
          │           │           │
┌─────────────────────────────────────────┐
│        Ingestion Pipeline (Workflow)    │
│                                         │
│  Check D1 ──> Download ──> Vision (11B) │
│          │                              │
│  Generate Vector ──> Atomically Save    │
└─────────────────────────────────────────┘
          ▲           ▲           ▲
          │           │           │
      Cloudflare    Cron任务    KV管理面板
        Queue      (每小时)    (节流开关)
```
