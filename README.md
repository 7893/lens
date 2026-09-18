# Lens: 边缘原生多模态混合检索系统 (Edge-Native Multimodal Hybrid Search Engine)

[![Live Demo](https://img.shields.io/badge/Production-lens.53.workers.dev-F38020?logo=cloudflare&logoColor=white)](https://lens.53.workers.dev)
[![Architecture](https://img.shields.io/badge/Architecture-Single--Worker%20Fullstack-blueviolet)](docs/ARCHITECTURE.md)
[![Embeddings](<https://img.shields.io/badge/Embedding-BGE--M3%20(768d)-blue>)](docs/DATABASE.md)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

Lens 是运行在 Cloudflare 边缘计算环境上的高性能视觉知识索引与多模态混合检索系统。系统通过将语义向量检索（Vectorize）、全文倒排索引（SQLite FTS5）、分布式工作流编排（Workflows）与实时调用链路追踪（Tracing）高度内聚于单 Worker，在严苛的边缘计算资源约束下实现毫秒级召回与全生命周期自动化数据治理。

---

## 核心技术特性

### 1. 双路混合检索与相关性重排 (Hybrid Retrieval & RRF)

- **多路召回**：并发执行 SQLite FTS5 关键词倒排匹配与 Vectorize (BGE-M3) 语义稠密向量检索；
- **重排融合**：通过倒数排名融合算法（Reciprocal Rank Fusion, RRF）将词法命中与语义命中科学归一；
- **断崖截断算法 (Cliff Detection)**：计算相邻召回分数的变化率阶跃比，动态截除长尾低相关性噪声，避免返回低质结果；
- **渐进式流式响应**：支持 Server-Sent Events (SSE)，优先推送毫秒级命中结果，随后平滑流式推送精排内容。

### 2. 边缘受限资源下的增量对撞采集 (Boundary Collision Ingestion)

- **线性边界对撞**：在 Unsplash API 额度受限的前提下，采集器按时间轴倒序扫描；一旦撞击 D1 已记录的边界 ID 即刻终止翻页，规避重复拉取；
- **事务化进度锚定**：仅在图片下载、缩略图转码与元数据持久化确认入队后推高边界指针，根治并发环境下的漏采与重复问题；
- **双重图层持久化**：抓取后在 R2 中存储 WebP 展示流，防止外部源站防盗链失效与高延迟。

### 3. 全链路分布式追踪与可观测性 (W3C Tracing)

- **标准协议兼容**：全面兼容 OpenTelemetry W3C `traceparent` 标准，支持跨边界调用链染色与跟踪；
- **细粒度上下文**：区分用户检索链路（`SEARCH-xxxx`）、定时采集对撞（`CRON-xxxx`）与工作流作业（`WF-xxxx`）；
- **微秒级性能开销**：自研轻量级追踪内核，零额外第三方庞大运行时依赖，契合边缘计算微秒级启动诉求。

### 4. 现代 AI-Native 工程体系 (AI-Native Engineering)

- **双层认知图谱**：集成 CodeGraph（微观 AST 符号调用关系库）与 Graphify（宏观跨模块架构拓扑）；
- **严格领域隔离**：借助 Local Harness（`.pi/harness.json`）对 6 大领域实施单测与构建约束；
- **自动化机器闸门**：`check_docs.mjs` 自动校验文档坏链、元数据与 INDEX 覆盖率，杜绝技术债务与文档掉队。

---

## 系统架构拓扑

```text
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
|  |  /trace     |    |       +------------------------------------+              |  |
|  +------+------+    |       |                                                   |  |
|         |           |       v                                                   |  |
|         |           |  +--------------+  +--------------+  +--------------+  +--------------+  |
|         |           |  | Downloader   |->| Vision AI    |->| Embedding    |->| Persist      |  |
|         |           |  | (R2)         |  | Llama Vision |  | BGE-M3       |  | D1 + Vector  |  |
|         |           |  +--------------+  +--------------+  +--------------+  +--------------+  |
|         |           +-----------------------------------------------------------+  |
|         |                                                                          |
|         |  +-------------------------------------------------------------------------+ |
|         |  |                        SEARCH FLOW                                      | |
|         |  |                                                                         | |
|         +--+--->  L1 Cache ---> L2 KV Cache ---> Parallel Retrieval ---> RRF Fusion  | |
|            |      (HTTP)        (Semantic)       (FTS5 + Vectorize)      & Cliff     | |
|            +-------------------------------------------------------------------------+ |
|                                                                                    |
|  +------------------------------------------------------------------------------+  |
|  |                             STORAGE MATRIX                                   |  |
|  |   +-------------+     +-------------+     +--------------------------+       |  |
|  |   |      D1     |     |      R2     |     |        Vectorize         |       |  |
|  |   | FTS5 Index  |     |    images   |     |    25k+ x 768-dim        |       |  |
|  |   | metadata    |     |   display/  |     |       embeddings         |       |  |
|  |   +-------------+     +-------------+     +--------------------------+       |  |
|  +------------------------------------------------------------------------------+  |
|                                                                                    |
+------------------------------------------------------------------------------------+
```

---

## 仓库结构 (Repository Structure)

```text
lens/
├── apps/
│   ├── client/               # 前端展示应用 (React 19 + Vite + Tailwind CSS)
│   └── engine/               # 边缘核心服务 (Cloudflare Workers, Hono, Workflows)
│       └── migrations/       # D1 关系型数据库版本化迁移脚本
├── packages/
│   └── shared/               # 跨端公共模块 (TypeScript 契约、Schemas、Logger、Tracer)
├── docs/                     # 项目规范、系统设计、ADR 与运维文档
│   ├── INDEX.md              # 现行文档全景导航入口
│   ├── CURRENT-STATE.md      # 当前系统运行事实唯一源
│   └── decisions/            # 架构决策记录 (ADR 体系)
└── scripts/                  # 本地工程化与自动化治理校验工具
```

---

## 技术栈选型

| 领域          | 组件/工具                 | 选型定位与职责                                                   |
| :------------ | :------------------------ | :--------------------------------------------------------------- |
| **边缘计算**  | Cloudflare Workers        | 单 Worker 驱动 HTTP 路由、Workflows 编排、Queue 消费与 Cron 调度 |
| **网关框架**  | Hono v4                   | 轻量化路由中间件、参数校验与上下文染色                           |
| **前端交互**  | React 19 + Vite           | 瀑布流自适应布局、主题切换与搜索交互                             |
| **关系存储**  | Cloudflare D1 (SQLite)    | 图片元数据存储、物理尺寸、色彩指纹与 FTS5 倒排索引               |
| **向量检索**  | Cloudflare Vectorize      | 768 维稠密向量余弦距离检索 (TopK 召回)                           |
| **多模态 AI** | Cloudflare Workers AI     | BGE-M3 文本向量嵌入与多模态视觉属性推理                          |
| **对象存储**  | Cloudflare R2             | 原始图片归档与 WebP 变焦流持久化存储                             |
| **工程工具**  | CodeGraph + Graphify + Pi | 本地 AST 符号引用、全景知识图谱与 Local Harness 领域治理         |

---

## 快速上手与本地开发

### 1. 环境准备

确保本地安装 Node.js >= 24 以及 pnpm >= 11：

```bash
node -v   # v24+
pnpm -v   # v11+
```

### 2. 依赖安装

```bash
pnpm install
```

### 3. 执行验证检查

```bash
# 1. 运行文档治理校验（链接有效性、元数据、索引覆盖率）
pnpm run check:docs

# 2. 全仓 TypeScript 严格类型检查
pnpm -r run typecheck

# 3. 运行代码规范与 Prettier 格式校验
pnpm run lint

# 4. 执行全量单元测试与覆盖率报告 (62 tests)
pnpm test

# 5. Cloudflare Worker 部署演练
pnpm --filter engine exec wrangler deploy --dry-run
```

### 4. 本地服务启动

```bash
# 启动前端开发服务器
pnpm --filter @lens/client dev

# 启动后端边缘调试运行时
pnpm --filter @lens/engine dev
```

---

## 完整技术文档索引

所有关于架构决策、存储规范、API 交互与运维流程的文档，请参阅：

- [**docs/INDEX.md**](docs/INDEX.md)：现行文档全景导航与活/死文档索引
- [**docs/CURRENT-STATE.md**](docs/CURRENT-STATE.md)：当前系统运行状态最高事实入口
- [**docs/decisions/**](docs/decisions/)：架构决策记录库（ADR-0000 ~ ADR-0004）
- [**AGENTS.md**](AGENTS.md)：AI Coding Agent 行为红线与交互约束

---

## 许可证 (License)

本项目采用 [MIT 许可证](LICENSE)。
