# Lens: 边缘原生多模态混合检索系统 (Edge-Native Multimodal Hybrid Search Engine)

[![Live Demo](https://img.shields.io/badge/Production-lens.53.workers.dev-F38020?logo=cloudflare&logoColor=white)](https://lens.53.workers.dev)
[![Architecture](https://img.shields.io/badge/Architecture-Modular%20Monolith-blueviolet)](docs/decisions/0006-single-worker-cloudflare-native-refactor.md)
[![Tests](https://img.shields.io/badge/Tests-124%20passed-brightgreen)](apps/engine/tests)
[![Embeddings](https://img.shields.io/badge/Embedding-BGE--M3--1024d-blue)](docs/DATABASE.md)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

Lens 是运行在 Cloudflare 边缘环境上的高性能视觉知识索引与多模态混合检索系统。系统严格基于 **[ADR-0006](docs/decisions/0006-single-worker-cloudflare-native-refactor.md)** 确立的**单 Worker Cloudflare 原生模块化单体（Modular Monolith）**基线演进，彻底规避跨 Worker RPC 损耗与第三方服务器基础设施，在严苛的边缘计算资源约束下实现毫秒级双路混合召回、事务发件箱最终一致性、规范 Master 媒体长期归档与全生命周期版本化数据治理。

---

## 核心技术特性

### 1. 内核化双路混合检索与纯策略重排 (Retrieval Kernel & RRF)

- **候选召回抽象 (CandidateSources)**：将 SQLite FTS5 关键词倒排匹配与 Vectorize (BGE-M3, 1024 维) 语义向量召回完全解耦为独立候选源，任一路超时或限流均可静默降级为单路，绝不阻塞用户检索；
- **纯函数互惠排名融合 (Pure RRF)**：通过倒数排名融合算法（Reciprocal Rank Fusion, $k=60$）将词法排名与语义相似度科学归一；
- **断崖截断算法 (Dynamic Cliff Cutoff)**：纯策略函数根据得分阶跃比率与绝对/相对底线动态切除长尾低相关性噪声；
- **D1 活动版本水合闸门 (Active Version Gate)**：所有外部向量候选必须回表经 D1 校验存在性与激活代际，确保未激活或草稿资产绝对不对外曝光；
- **不透明稳定游标分页 (Opaque Cursor Pagination)**：基于 URL 安全编码生成 `cursor` 与 `nextCursor`，杜绝传统 offset 在动态召回列表中的数据飘移与漏读。

### 2. 规范 Master 长期归档与供应商防腐层 (Asset & Media Preservation)

- **供应商防腐层 (Provider ACL)**：建立标准化 `DiscoveredAsset` 输入契约，隔离第三方图源（如 Unsplash）异构数据对业务模型的侵入；
- **R2 内容寻址规范 Master**：采用 Web Crypto SHA-256 流式计算指纹并存储规范母本（`media/{contentHash}/master.{ext}`），内建 40MB 尺寸安全守卫与内容寻址幂等去重，确保未来 5~6 年可全量重新计算视觉特征与向量表征。

### 3. 可靠事件与最终一致性边界 (Transactional Outbox & Inbox)

- **事务性发件箱 (Transactional Outbox)**：业务状态变动与 Outbox 事件在 D1 同一事务批次中原子提交，杜绝双写不一致；
- **消费者幂等凭据 (Consumer Inbox)**：通过 `consumed_events` 吸收队列重投递与乱序消息，保证单资产长流程状态机（Workflows）的精确一次语义。

### 4. 运行时配置权威与不可变操作审计 (Governance & Control Plane)

- **内部运维面隔离 (`/internal/*`)**：受 Cloudflare Access 身份鉴权保护，提供全依赖深层健康诊断 (`/internal/health`)、Outbox 堆积与索引覆盖率对账 (`/internal/reconciliation`) 以及强制中继派发 (`/internal/outbox/relay`)；
- **配置权威与审计日志**：D1 `runtime_config` 与 `operation_audit` 记录不可变操作轨迹（操作者、原因、correlation ID），KV 仅作为快照读取。

---

## 模块化系统架构拓扑

```text
                                  @lens/engine 单 Worker 拓扑

  HTTP 请求 (/api/*, /internal/*)      异步队列 (Queues)         定时调度 (Cron)       编排状态机 (Workflows)
              │                             │                         │                      │
  ┌───────────┴─────────────────────────────┴─────────────────────────┴──────────────────────┴──────────┐
  │ 1. 统一触发器入口 (entrypoints/)                                                                    │
  │    ├── http.ts (Hono 路由网关)        ├── queue.ts (消息消费)                                      │
  │    ├── scheduled.ts (定时对账调度)    └── workflow.ts (Workflows 单资产流程编排)                   │
  ├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ 2. 核心领域自治模块 (modules/)                                                                      │
  │    ├── catalog        (资产聚合根、生命周期、外部映射与可见性)                                      │
  │    ├── ingestion      (供应商防腐层 ACL、流式下载与内容寻址去重)                                    │
  │    ├── representation (视觉 Caption 分析、多模态 Embedding、展示切片派生)                           │
  │    ├── indexing       (版本化 search_documents、代际激活闸门与回退)                                 │
  │    ├── retrieval      (CandidateSources、纯 RRF 融合、断崖截断、D1 水合与游标分页)                  │
  │    └── operations     (权威配置治理、操作审计追踪、对账自愈与内部控制面)                            │
  ├──────────────────────────────────────────────────────────────────────────────────────────────────────┤
  │ 3. 领域内核与平台适配 (kernel/ & platform/)                                                         │
  │    ├── kernel: errors (统一异常) | events (Outbox/Inbox 事务) | ids (稳定ID) | observability (链路追踪) │
  │    └── platform: cloudflare/ai.ts (Workers AI) | cloudflare/storage.ts (R2 Master Writer)           │
  └───────────────────────────────────┬──────────────────────────────────────────────────────────────────┘
                                      │
  ┌───────────────────────────────────┴──────────────────────────────────────────────────────────────────┐
  │ Cloudflare 原生无状态与存储原语                                                                      │
  │   D1 (权威业务事实源)   R2 (规范Master归档)   Vectorize (1024d可重建索引)   KV (快照)   Workers AI   │
  └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 仓库结构 (Repository Structure)

```text
lens/
├── apps/
│   ├── client/               # 前端展示应用 (React 19 + Vite + Tailwind CSS)
│   └── engine/               # 边缘核心服务 (Cloudflare Workers 原生模块化单体)
│       ├── migrations/       # D1 关系型数据库版本化迁移脚本 (0000 ~ 0005)
│       └── src/
│           ├── entrypoints/  # HTTP、Queue、Scheduled、Workflow 运行时分派入口
│           ├── modules/      # 六大领域自治业务模块 (catalog, ingestion, retrieval...)
│           ├── kernel/       # 跨切面领域内核 (errors, events, ids, observability)
│           ├── platform/     # Cloudflare 平台原生能力适配 (ai, storage)
│           └── routes/       # Hono 网关路由分层 (/api/*, /internal/*, /image/*)
├── packages/
│   └── shared/               # 跨端公共契约库 (TypeScript 契约、Schemas、Logger、Tracer)
├── docs/                     # 项目规范、系统设计、ADR 与运维文档
│   ├── INDEX.md              # 现行文档全景导航入口
│   ├── CURRENT-STATE.md      # 当前系统运行状态最高事实入口
│   └── decisions/            # 架构决策记录库 (ADR-0000 ~ ADR-0006)
└── scripts/                  # 本地工程化与自动化文档治理校验工具
```

---

## 技术栈选型

| 领域          | 组件/工具                 | 选型定位与职责                                                                |
| :------------ | :------------------------ | :---------------------------------------------------------------------------- |
| **边缘计算**  | Cloudflare Workers        | 单 Worker 驱动 HTTP 路由、Workflows 编排、Queue 消费、Cron 调度与前端静态托管 |
| **网关框架**  | Hono v4                   | 轻量化路由中间件、参数校验、CORS 与 Cloudflare Access 鉴权                    |
| **前端交互**  | React 19 + Vite           | 瀑布流自适应布局、主题切换与响应式搜索交互                                    |
| **权威存储**  | Cloudflare D1 (SQLite)    | 资产事实源、关系实体、版本化搜索文档、事务 Outbox/Inbox、配置与审计日志       |
| **全文索引**  | SQLite FTS5               | 针对品牌、型号、摄影师与特定实体的精准词法倒排检索                            |
| **向量检索**  | Cloudflare Vectorize      | 1024 维 BGE-M3 密集向量余弦检索库（版本化 Vector ID，返回需 D1 强校验）       |
| **多模态 AI** | Cloudflare Workers AI     | BGE-M3 文本向量嵌入与视觉场景理解                                             |
| **对象存储**  | Cloudflare R2             | 规范 Master 长期归档 (`media/{hash}/master`) 与 Web 展示切片持久化存储        |
| **工程工具**  | CodeGraph + Graphify + Pi | 本地 AST 符号引用、全景知识图谱与 Local Harness 领域治理                      |

---

## 快速上手与本地开发

### 1. 环境准备

确保本地安装 Node.js 26.10.0 以及 pnpm 12.6.0：

```bash
node -v   # v26.10.0
pnpm -v   # v12.6.0
```

### 2. 依赖安装

```bash
pnpm install
```

从仓库根目录配置本地环境；根目录 `.env.example` 是配置变量的权威模板：

```bash
cp .env.example apps/engine/.dev.vars
# 用 openssl rand -hex 32 生成自己的值，填入 .dev.vars 的 INTERNAL_API_SECRET。
pnpm --filter=@lens/shared run build
pnpm run setup:local-db
```

只启用需要的图源和云功能，并填写自己的凭据。D1 本地迁移不会连接生产数据库；
AI、Vectorize 等云能力不代表完全离线运行。自建资源与绑定步骤见
[部署指南](docs/DEPLOYMENT.md)，图片使用边界见 [资产权限说明](docs/ASSET-RIGHTS.md)。
`.dev.vars` 不得提交。Fork 后的 push/PR 只运行检查，不会自动部署；部署必须在 Actions
中手动运行 CI 并显式选中 `deploy`，使用部署者自己的 Cloudflare 账号。

### 3. 执行自动化验证门禁

```bash
# 1. 运行文档治理校验（链接有效性、元数据、索引覆盖率）
pnpm run check:docs

# 2. 全仓 TypeScript 严格类型检查
pnpm -r run typecheck

# 3. 运行全仓代码规范与 Prettier 格式校验
pnpm run lint

# 4. 执行全量单元/集成测试与覆盖率报告 (124 tests, 100% pass)
pnpm test

# 5. Cloudflare Worker 部署演练预检
pnpm --filter @lens/engine exec wrangler deploy --dry-run
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

所有关于架构决策、存储规范、API 交互与运维流程的现行活文档，请参阅：

- [**docs/INDEX.md**](docs/INDEX.md)：现行文档全景导航与活/死文档索引
- [**docs/CURRENT-STATE.md**](docs/CURRENT-STATE.md)：当前系统运行状态最高事实入口
- [**docs/ARCHITECTURE.md**](docs/ARCHITECTURE.md)：单 Worker 模块化单体与双路混合检索拓扑
- [**docs/API.md**](docs/API.md)：公共业务 API、内部运维控制面与流式通信契约
- [**docs/DATABASE.md**](docs/DATABASE.md)：D1 关系表 (0000~0005)、规范 Master 存储与多维索引治理
- [**docs/decisions/**](docs/decisions/)：架构决策记录库（ADR-0000 ~ ADR-0006）
- [**AGENTS.md**](AGENTS.md)：AI Coding Agent 行为红线与交互约束

---

## 许可证 (License)

本项目采用 [MIT 许可证](LICENSE)。
