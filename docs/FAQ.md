# 核心架构、技术权衡与常见问题解答 (FAQ)

更新日期：2026-09-19
状态：现行
适用范围：架构权衡依据、技术选型解答、流水线优化与常见问题

本文档汇总了 Lens 在系统设计、技术选型与工程实践中的核心权衡依据与高频技术问题。

---

## 1. 架构选型与系统边界

### Q1: 为什么采用 Single-Worker 架构，而不是将 Client、API Gateway、Queue 拆分为独立 Worker？

- **降低通信延迟与消除跨域**：通过 Cloudflare Workers Static Assets 机制，前端单页应用（SPA）与后端 API 同域运行，彻底消除了浏览器端对 `/api/*` 的 CORS 跨域协商（OPTIONS 预检请求）。
- **资源绑定与内存共享**：单 Worker 可以直接绑定同一套 D1、Vectorize、R2、KV 与 Queues，避免跨 Worker 服务绑定（Service Bindings）的额外配置开销与协议序列化耗时。
- **原子发布与版本一致性**：前端静态资产与后端 API 网关随单次 GitOps 部署同时生效，避免多服务独立发布时可能产生的前后端接口契约版本脱节。

### Q2: 为什么自研轻量级 Trace 协议，而不是引入完整 OpenTelemetry SDK？

- **边缘包体积敏感**：Cloudflare Workers 对脚本体积（经过压缩后通常需控制在几 MB 内）和冷启动时间极度敏感。标准 OpenTelemetry 依赖庞大的 Node.js 兼容垫片与追踪链树形结构，显著增加冷启动开销。
- **性能与开销平衡**：自研 `createTrace` 与 `Logger` 类代码仅数十行，零外部第三方依赖。上下文随函数调用显式下发，并通过 `executionCtx.waitUntil()` 将指标异步上报至 Cloudflare Analytics Engine，完全不阻塞主干请求。

---

## 2. 图像处理与异步编排流水线

### Q3: 新图入库 (`process-photo`) 与存量刷新 (`refresh-photo`) 为何在 Workflow 中独立分支？

- **I/O 边界与外部配额保护**：
  - `process-photo`（新摄取）：必须从外部 Unsplash 服务器下载图片流，执行 Web 规格优化后上传至 R2，并初始化数据库全量字段。
  - `refresh-photo`（模型升级）：仅针对存量旧模型标注记录进行原地重新分析，**禁止触发任何外部 HTTP 下载请求**。任务直接从本地 R2 `display/` 存储中读取流，节省外部 API 配额并将单图处理延迟降低 60% 以上。
- **原子服务共享**：两个分支在视觉分析（Llama-4 Scout）与嵌入向量生成（BGE-M3）层面完全共享底层的领域服务函数，确保不同阶段入库的数据具备统一的特征分布。

### Q4: 为什么 R2 存储取消了原图 (`raw/`)，仅保留 `display/` 规格？

- **成本与架构权衡**：
  - **存储成本削减 85%**：原图体积通常在 10MB ~ 25MB 之间，而经过优化的 `display/` 图像仅约 300KB。画廊展示与视觉推理模型在 1080p 分辨率下即可达到满分表征效果。
  - **规避 128MB 内存溢出**：Worker 在并发处理超大原始图像时极易突破边缘内存上限，仅保留 Web 展示图彻底消除了内存峰值隐患。

---

## 3. 搜索与排序算法机制

### Q5: 搜索管线中的“断崖检测 (Cliff Detection)”是如何工作的？

- **背景**：Vectorize 执行 ANN 检索召回候选集（如 Top-100）后，尾部候选往往存在大量语义相关度较低的噪声数据。若将 100 条全量送入 BGE-Reranker-Base，会导致不必要的推理算力与时间开销。
- **算法逻辑**：
  1. 遍历有序召回列表，计算相邻项得分比率：$\text{Ratio}_i = \frac{\text{Score}_i}{\text{Score}_{i-1}}$。
  2. 若检测到 $\text{Ratio}_i < 0.8$（相关性发生断崖式下跌）或绝对得分 $\text{Score}_i < 0.5$（进入语义不相关长尾），即在此处触发熔断截断。
- **工程收益**：将精排候选集动态收窄至 15~30 条的高质量子集，在保障首屏精度的同时显著压缩了 Rerank 阶段的耗时。

### Q6: 混合搜索 (Hybrid Search) 中 RRF 与 FTS5 是如何配合的？

- **互补性**：向量搜索擅长捕获“暮色下的赛博朋克城市”等抽象意境，但在“Sony A7M4”、“Eiffel Tower”等特定专有名词上容易发生漂移；SQLite FTS5 倒排索引则提供确定性的词法匹配。
- **RRF 融合**：系统对 FTS5 命中列表与 Vector 命中列表分别按照排名赋予倒数分数：
  $$\text{RRF Score}(d) = \sum_{m \in \{\text{FTS}, \text{Vector}\}} \frac{1}{k + r_m(d)} \quad (k=60)$$
  加权归一化后作为粗排依据，消除不同检索源绝对打分的量纲差异。

---

## 4. 运维、调度与计费控制

### Q7: 为什么财务审计调度严格锁定在 UTC 23:00？

- **账单聚合窗口**：Cloudflare 计量系统（GraphQL Analytics）按自然日提供用量聚合。UTC 23:00 临近自然日结算点，能够获取当天近乎完整的资源消耗总量。
- **请求频率控制**：系统在日间专注于搜索服务与常规入库，不发起高权重的 GraphQL 查账请求，日均仅调用 1 次官方审计，避免审计自身成为性能瓶颈。

### Q8: 如何在本地对涉及 D1、KV 和 Vectorize 的代码进行开发与测试？

- **Miniflare 沙箱模拟**：本地运行 `pnpm dev:backend` 时，Wrangler 会自动启动 Miniflare 运行时，在本地文件系统为 D1 生成 SQLite 数据库，并使用内存模拟 KV 与 Queues。
- **单元测试隔离**：Vitest 测试套件位于 `apps/engine/tests/`，通过在 `vitest.config.ts` 中将 `cloudflare:workers` 重定向至轻量 Mock 实现，无需依赖外部网络或远程 Cloudflare 凭证即可运行 62 项全量自动化测试。
