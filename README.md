# Lens: 边缘原生视觉智能引擎 (Edge-Native Visual Intelligence Engine)

> **"这是一个懂得审美、能够识别实体、并在零成本边际下实现数据自我进化的视觉知识系统。"**

[![Live Demo](https://img.shields.io/badge/Live-lens.53.workers.dev-F38020?logo=cloudflare&logoColor=white)](https://lens.53.workers.dev)
[![Architecture](https://img.shields.io/badge/架构-单Worker全栈闭环-blueviolet)](docs/ARCHITECTURE.md)
[![Model](https://img.shields.io/badge/核心大脑-Llama%204%20Scout%2017B-blue)](https://developers.cloudflare.com/workers-ai/)
[![License](https://img.shields.io/badge/许可证-MIT-green)](LICENSE)

Lens 不仅仅是一个图片搜索工具，它是运行在 Cloudflare 边缘节点上的 **全自动视觉智能系统**。通过集成最新的 **Llama 4 Scout (17B)** MoE 架构模型与自研的 **“线性对撞 (Linear Boundary)”** 采集算法，Lens 在维持工业级语义检索精度的同时，将运行成本死死压在了 Serverless 的免费配额之内。

---

## 🌟 为什么 Lens 截然不同？

### 1. 策展人级的感知力 (Curator-Level Perception)

传统 AI 搜索只看“物体”（如：一只猫，一辆车）。Lens 能够理解**叙事与审美**：

- **审美自动打分**：AI 对每一张图片的构图、光影、清晰度进行 0-10 分的深度评测。你可以搜“电影感的大片”，而不仅仅是相关结果。
- **硬核实体提取**：精准识别地标（如：新宿站）、品牌（如：Nike）及生物品种，实现基于“实体”的精准召回。
- **混合搜索架构**：结合 SQLite FTS5 与 Vectorize，兼顾关键词精确度与语义深度。

### 2. 自我进化引擎 (The Self-Evolution Engine)

Lens 是一个“活”的系统。它不仅在摄取数据，还在**打磨数据**：

- **UTC 23:00 爆发策略**：每天 UTC 23:00（配额重置前 1 小时），系统会自动清算今日剩余的免费 AI 神经元 (Neurons)。
- **零成本质量升级**：系统会自动重刷那些使用旧模型处理的存量数据，将其升级为 Llama 4 旗舰版描述。
- **成果**：你的数据库每天都在变聪明，而你无需为此多付一分钱。

### 3. 极致成本工程 (Extreme Cost Engineering)

- **线性对撞算法**：一种“撞墙即停”的抓取逻辑，确保 0% 的 Unsplash API 配额浪费。
- **边缘优先架构**：单 Worker 承载 API、Workflow、Queue 与定时任务，极致降低运维复杂度。

---

## Architecture

```
+------------------------------------------------------------------------------------+
|                                CLOUDFLARE EDGE                                     |
|                                                                                    |
|  +-------------+    +-----------------------------------------------------------+  |
|  |             |    |                  INGESTION PIPELINE                       |  |
|  |   ENGINE    |    |                                                           |  |
|  |    WORKER   |    |  +-------------+    +----------+    +------------------+  |  |
|  |             |    |  | IngestionSvc|--->|   Queue  |--->|     Workflow     |  |  |
|  |  /search    |    |  | (Scheduled) |    |  (batch) |    |   (per image)    |  |  |
|  |  /images    |    |  +-------------+    +----------+    +---------+--------+  |  |
|  |  /stats     |    |                                            |              |  |
|  |             |    |       +------------------------------------+              |  |
|  +------+------+    |       v                                                   |  |
|         |           |  +----------+  +----------+  +----------+  +----------+   |  |
|         |           |  | Downloader|->| Vision   |->| Embedding|->| Persist  |   |  |
|         |           |  | (R2)     |  | Llama 4  |  |  BGE-M3  |  | D1 + R2  |   |  |
|         |           |  +----------+  +----------+  +----------+  +----------+   |  |
|         |           +-----------------------------------------------------------+  |
|         |                                                                          |
|         |  +--------------------------------------------------------------------+  |
|         |  |                        SEARCH FLOW                                 |  |
|         |  |                                                                    |  |
|         +--+--->  Query ---> Hybrid Search (FTS5 + Vectorize) ---> Result JSON  |  |
|            |      Expand      (Parallel Retrieval) (RRF Ranking)                |  |
|            +--------------------------------------------------------------------+  |
|                                                                                    |
|  +------------------------------------------------------------------------------+  |
|  |                             STORAGE                                          |  |
|  |   +-------------+     +-------------+     +--------------------------+       |  |
|  |   |      D1     |     |      R2     |     |        Vectorize         |       |  |
|  |   | FTS5 Index  |     |    images   |     |    20k x 1024-dim        |       |  |
|  |   | metadata    |     |   display/  |     |       embeddings         |       |  |
|  |   +-------------+     +-------------+     +--------------------------+       |  |
|  +------------------------------------------------------------------------------+  |
|                                                                                    |
+------------------------------------------------------------------------------------+
```

---

## 📂 Project Structure

- **`apps/client`**: React Frontend (Vite + Tailwind).
- **`apps/engine`**: Cloudflare Worker (API, Workflow, Queue, Cron).
- **`packages/shared`**: Common types, schemas, and logic.
- **`apps/engine/migrations`**: Versioned D1 database schemas.

---

## Technical Highlights

| 特性           | 实现方案                       | 核心优势                              |
| :------------- | :----------------------------- | :------------------------------------ |
| **混合搜索**   | **FTS5 + Vectorize (RRF)**     | 兼顾关键词精确度与语义深度理解。      |
| **全链路追踪** | **基于 Trace-ID 的可观测性**   | 毫秒级定位分布式故障，日志流纯净。    |
| **数据进化**   | 23:00 UTC 余额压榨算法         | 零额外成本自动升级存量索引智力。      |
| **架构内聚**   | **单 Worker 全栈驱动**         | 极简部署，逻辑高度自洽。              |
| **成本控制**   | GraphQL 实时审计 + 5% 安全边际 | 极致精算，彻底告别“房子没了”的焦虑。  |
| **GitOps**     | Wrangler Migrations            | 数据库表结构演进全程版本化、自动化。  |

---

## ⚡ 技术栈与性能规格

| 组件           | 技术选型              | 职责                                           |
| :------------- | :-------------------- | :--------------------------------------------- |
| **视觉大脑**   | **Llama 4 Scout 17B** | 多模态推理、审美打分与实体识别。               |
| **查询扩展**   | **Llama 3.2 3B**      | 轻量快速的搜索词语义扩展。                     |
| **向量底座**   | **BGE-M3**            | 1024 维高密度向量，支持多语言跨模态对齐。      |
| **混合搜索**   | **SQLite FTS5**       | 倒排索引，处理硬核关键词匹配。                 |
| **持久化大脑** | **Cloudflare D1**     | 存储旗舰版元数据、审美分与实体 JSON。          |
| **资产存储**   | **Cloudflare R2**     | 存储 display 展示图，处理完成后不保留原图。    |
| **任务编排**   | **Workflows**         | 管理具备自动重试能力的复杂、多阶段采集流水线。 |

---

## 📚 文档中心 (Documentation)

- [**01. 架构与算法**](docs/ARCHITECTURE.md) - 深入剖析线性对撞与自进化逻辑。
- [**02. 存储与数据模型**](docs/DATABASE.md) - 详解 D1 (FTS5) 表结构设计与 R2 战略。
- [**03. 完整接口指南**](docs/API.md) - REST API 规范。
- [**04. 全栈部署手册**](docs/DEPLOYMENT.md) - 15 分钟内拉起全栈生产环境。

---

## 许可证 (License)

MIT © 2026 Lens 贡献者.
