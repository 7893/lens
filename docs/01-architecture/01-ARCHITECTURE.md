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

#### 1.1.1 动态相关性截断算法 (Dynamic Relevance Cutoff)

为避免返回大量低相关结果，系统采用**断崖检测 + 最低阈值**的双重过滤策略：

1. **断崖检测**: 遍历按分数排序的结果，当相邻两个分数下降超过 20% 时，判定后续结果不相关，立即截断。
2. **最低阈值**: 无论是否检测到断崖，分数低于 0.5 的结果一律过滤。

```typescript
for (let i = 1; i < scores.length; i++) {
  if (scores[i] < scores[i - 1] * 0.8 || scores[i] < 0.5) {
    cutoffIndex = i;
    break;
  }
}
```

**效果示例**:

| 查询              | 返回数量 | 说明                   |
| :---------------- | :------- | :--------------------- |
| "cat"             | 100      | 常见主题，大量高相关图 |
| "lonely"          | 40       | 抽象概念，中等相关     |
| "purple elephant" | 20       | 罕见组合，快速断崖     |

### 1.2 采集管道 (Ingestion Pipeline) - 异步链路

- **调度**: 每 10 分钟触发的 Cron 定时任务。
- **缓冲**: Cloudflare Queues 实现任务削峰。
- **执行**: Cloudflare Workflows 提供持久化状态机保障。
- **节点**:
  1.  **D1 幂等检查**: 预防重复。
  2.  **R2 流式下载**: 降低内存占用。
  3.  **Llama 4 Scout 17B**: 深度视觉理解、审美打分及实体识别。
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
  3.  **节流控制**: 严格遵守 KV 配置中的 `backfill_max_pages` 上限。4. **状态持久化**: 每完成一页，立即在 D1 中更新存档点。

  ### 2.2 自我进化循环 (Self-Evolution Logic)

  这是一个基于 **“Neuron 余额捡漏”** 思想的异步升级机制。
  - **逻辑**: 每小时任务末尾，系统会计算今日已用的 Neurons 消耗。
  - **动作**: 如果今日剩余免费配额充足（扣除新图预留后），系统会自动从 D1 挑选 `ai_model = 'llama-3.2'` 的老图。
  - **执行**: 直接从 R2 读取图片流（不消耗 API 配额），使用 **Llama 4 Scout** 进行重刷，补全审美分和实体标签。
  - **收益**: 实现了全库数据在零成本前提下的自动版本迭代。

  ***

## 3. AI 选型与性能权衡

系统针对不同场景采用了“旗舰模型重逻辑、专用模型重效率”的策略：

| 任务类型                | 模型                | 理由                                                  |
| :---------------------- | :------------------ | :---------------------------------------------------- |
| **视觉理解 (Vision)**   | `Llama 4 Scout 17B` | 原生多模态，支持 16 专家 MoE 架构，具备逻辑推理能力。 |
| **查询扩展 (LLM)**      | `Llama 4 Scout 17B` | 极强的语言理解，能扩展出更精准的视觉关联词。          |
| **结果重排 (Reranker)** | `BGE Reranker Base` | 专业重排模型，比通用 LLM 更快、更准。                 |
| **向量化 (Embedding)**  | `BGE-M3`            | 支持多语言，1024 维高密度表示。                       |

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
│  1. Query Expansion (Llama 4 Scout)  →  ~2,000 Neurons  │
│  2. Embedding (BGE-M3)               →  ~1,000 Neurons  │
│  3. Re-ranking (BGE Reranker)        →  ~2,000 Neurons  │
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
  expandedQuery = await ai.run('@cf/meta/llama-4-scout-17b-16e-instruct', {...});
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
│  Query Expansion (Llama 4) ──> Cache (KV)│
│          │                              │
│  Embedding (BGE-M3) ──> Vectorize Search │
│          │                              │
│  Re-ranking (BGE) ──> Final Results     │
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
│  Check D1 ──> Download ──> Vision (Llama 4)│
│          │                              │
│  Generate Vector ──> Atomically Save    │
└─────────────────────────────────────────┘
          ▲           ▲           ▲
          │           │           │
      Cloudflare    Cron任务    KV管理面板
        Queue      (每小时)    (节流开关)
```
