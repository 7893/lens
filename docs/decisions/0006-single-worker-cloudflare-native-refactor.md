# ADR-0006: Lens 长期架构基线——单 Worker、Cloudflare 原生模块化单体

更新日期：2026-09-19
状态：采纳
责任人：@lens-team
适用范围：Lens 未来 5–6 年的部署拓扑、领域边界、数据架构、异步处理、检索演进、安全与运维治理

---

## 背景 (Context)

Lens 是一个运行于 Cloudflare 边缘平台的图片资产摄取、语义表征与混合检索应用。系统需要同时处理两类性质不同的负载：

1. 面向用户的低延迟搜索、图片读取和静态资源请求；
2. 面向后台的图片发现、下载、推理、索引、重建和周期对账。

当前系统已经采用单 Worker，并使用 D1、R2、Vectorize、KV、Queues、Workflows、Workers AI、Analytics Engine、Cache API 和 Rate Limiting。问题不在于 Cloudflare 产品数量不足，而在于业务边界、数据所有权、跨存储一致性和版本治理尚未形成可长期约束实现的统一架构。

本 ADR 不是当前实现说明。[CURRENT-STATE.md](../CURRENT-STATE.md) 仍是现行事实的唯一入口。本 ADR 定义目标架构和长期不变量，只有真正上线的部分才能进入现行文档。

本 ADR 是 Lens 的一次架构重新基线。若被采纳，它将成为后续架构工作的总纲，并取代 [ADR-0005](0005-lens-v2-architecture-blueprint.md) 中双 Worker、Workers RPC 和其他与本 ADR 冲突的拓扑方向。此前 ADR 中与实际代码不一致的可观测性、数据保护和工程治理表述，不自动成为本架构的已实现事实。

## 决策 (Decision)

Lens 采用 **单 Worker 部署的事件驱动模块化单体**：

- 每个环境只有一个 Lens 业务 Worker；
- 计算、持久化、消息、工作流、推理、缓存、遥测和安全能力均使用 Cloudflare 产品；
- 外部图片供应商只是业务输入，不属于 Lens 的核心基础设施；
- Worker 内部按稳定业务能力分成模块，单 Worker 不等于无边界巨石；
- D1 是唯一业务事实源，R2 保存不可变媒体，FTS5 和 Vectorize 是可重建搜索投影；
- Queue 负责投递和背压，Workflow 负责长流程恢复，二者都不拥有最终业务状态；
- 所有媒体处理、语义表征、Embedding、索引和检索策略都必须显式版本化；
- 系统默认接受最终一致，但不允许半成品、错误版本或不可解释状态对用户可见；
- 架构以可重建、可验证、可切换和可回滚为长期演进原则。

## 1. 硬约束与非目标

### 1.1 单 Worker 的精确定义

单 Worker 指 **每个运行环境只有一个业务 Worker 部署单元**：

```text
development  -> 一个 Lens Worker + 一组开发资源
staging      -> 一个 Lens Worker + 一组隔离资源
production   -> 一个 Lens Worker + 一组生产资源
```

staging 和 production 必须使用隔离的 D1、R2、KV、Vectorize、Queue、Workflow 和遥测资源。环境隔离不属于微服务拆分，也不违反单 Worker 约束。

生产环境不得引入第二个业务 Worker、内部 Service Binding 或 Workers RPC。HTTP、Static Assets、Cron、Queue consumer 和 Workflow class 均由同一 Worker 脚本承载。

### 1.2 Cloudflare-only 的精确定义

Lens 的核心运行基础设施不得依赖 Cloudflare 之外的数据库、对象存储、队列、工作流、向量数据库、推理平台、缓存或遥测服务。

Unsplash、Pexels 或其他内容来源可以作为外部业务输入，但其不可用不得破坏已经入库资产的搜索与展示。供应商 API 响应不得成为 Lens 的长期事实源。

### 1.3 明确不做的事情

- 不为了组织代码而拆分 Worker；
- 不建立与当前规模不匹配的微服务体系；
- 不实现跨云可移植层；
- 不使用 KV 保存权威状态、任务状态或锁；
- 不把 Vectorize 元数据直接作为用户响应；
- 不在 HTTP 或 Cron 请求中执行长耗时摄取和重建；
- 不预先引入 Durable Objects；只有出现同一实体高争用串行化或实时连接协调需求时，才通过新 ADR 评估；
- 不把 SSE 设为默认搜索协议，除非数据证明其用户收益高于连接、缓存和恢复复杂度。

## 2. 目标拓扑

```text
                               Cloudflare Edge
                                      │
             ┌────────────────────────┼────────────────────────┐
             │                        │                        │
      HTTP / Static Assets           Cron                 Queue delivery
             │                        │                        │
             └────────────────────────┼────────────────────────┘
                                      ▼
                         ┌────────────────────────┐
                         │ Lens Worker（每环境唯一）│
                         │                        │
                         │ Entrypoints            │
                         │      ↓                 │
                         │ Application Use Cases  │
                         │      ↓                 │
                         │ Domain Modules         │
                         │      ↓                 │
                         │ Cloudflare Adapters    │
                         └────────────┬───────────┘
                                      │
          ┌───────────┬───────────┬───┴────┬──────────┬──────────────┐
          ▼           ▼           ▼        ▼          ▼              ▼
         D1           R2      Vectorize     KV    Workers AI   Analytics Engine
    权威状态/事务   不可变媒体   搜索投影   可丢缓存    推理能力        遥测
          │
          └── Outbox ──> Queues ──> Workflows ──> 候选投影 ──> D1 激活
```

单 Worker 仍然共享代码版本、Bindings、发布和故障域。本架构不声称获得进程级隔离，而是通过触发器分离、纯净在线路径、Queue 背压、Workflow 步骤、超时预算和降级策略控制相互影响。

## 3. 内部结构与依赖方向

目标结构按业务职责组织，而不是按 Cloudflare 产品组织：

```text
apps/engine/src/
├── index.ts
├── entrypoints/
│   ├── http.ts
│   ├── scheduled.ts
│   ├── queue.ts
│   └── workflow.ts
├── modules/
│   ├── catalog/
│   ├── ingestion/
│   ├── representation/
│   ├── indexing/
│   ├── retrieval/
│   └── operations/
├── kernel/
│   ├── events/
│   ├── errors/
│   ├── ids/
│   └── observability/
└── platform/
    └── cloudflare/
```

依赖只能沿以下方向流动：

```text
entrypoints -> application use cases -> domain ports
                                      <- cloudflare adapters
```

强制规则：

1. `index.ts` 只负责装配、路由和触发器注册，不包含业务规则；
2. 领域模块不得接收完整 `Env`；
3. Cloudflare Binding、Hono Context、WorkflowStep 等平台类型只能出现在入口或平台适配层；
4. 模块只能通过公开用例、只读查询契约或领域事件协作；
5. 模块不得直接读写其他模块拥有的表；
6. 请求级可变状态不得保存在模块全局变量中；
7. `Env` 类型由 Wrangler 配置生成，不手写一份可能漂移的绑定接口；
8. 平台端口用于 Cloudflare 产品内部演进和测试，不承担多云兼容目标。

## 4. 领域模块

| 模块           | 拥有的业务概念                                     | 主要职责                       | 明确不负责           |
| :------------- | :------------------------------------------------- | :----------------------------- | :------------------- |
| Catalog        | Asset、AssetSource、许可、可见性、生命周期         | 稳定资产身份和来源关系         | AI 推理和搜索排名    |
| Ingestion      | Provider、Cursor、DiscoveryBatch、Deduplication    | 发现、标准化、去重和登记       | 直接写搜索索引       |
| Representation | MediaMaster、MediaVariant、Caption、Tag、Embedding | 媒体和语义表征生成             | 决定对外可见性       |
| Indexing       | SearchDocument、Projection、IndexGeneration        | 构建、校验、激活和修复搜索投影 | 理解用户查询         |
| Retrieval      | SearchSpec、Candidate、RankingPolicy               | 召回、融合、重排、过滤和水合   | 修改资产和摄取状态   |
| Operations     | RuntimeConfig、Audit、EvaluationSet、RepairJob     | 配置、审计、评测、对账和恢复   | 绕过模块直接修改状态 |

### 4.1 供应商防腐层

外部来源必须先转换为稳定的规范输入：

```ts
interface DiscoveredAsset {
  source: {
    provider: string;
    externalId: string;
    canonicalUrl?: string;
  };
  media: {
    downloadUrl: string;
    width?: number;
    height?: number;
    mimeType?: string;
  };
  attribution: {
    authorName?: string;
    authorUrl?: string;
    license?: string;
    retentionPolicy?: string;
  };
  observedAt: string;
  rawRef?: string;
}
```

Provider Adapter 只负责外部契约翻译、配额信息和错误归一化。资产身份、去重、媒体下载、推理、索引和生命周期不得依赖供应商原始 JSON。

## 5. Cloudflare 产品职责

| Cloudflare 能力         | 唯一首要职责                                       | 禁止承担的职责               |
| :---------------------- | :------------------------------------------------- | :--------------------------- |
| Workers + Static Assets | 唯一计算、发布和 HTTP/触发器入口                   | 保存业务状态                 |
| D1                      | 权威业务状态、事务、Outbox/Inbox、FTS5、配置和审计 | 保存大媒体和高容量遥测       |
| R2                      | 规范 Master、派生媒体和可复算中间产物              | 判断资产是否可见             |
| Vectorize               | 可重建的向量搜索投影                               | 判断资产是否存在或活动       |
| KV                      | 查询缓存、建议词缓存、配置快照                     | 权威配置、任务状态和分布式锁 |
| Queues                  | 至少一次投递、背压、重试和 DLQ                     | 业务状态机和严格全局顺序     |
| Workflows               | 单资产长流程的步骤持久化和恢复                     | 最终资产状态和搜索可见性     |
| Workers AI              | 视觉分析、Embedding、查询扩展和可选重排            | 保存业务状态和模型版本真相   |
| Analytics Engine        | 高容量指标、延迟和质量遥测                         | 审计日志和业务事实           |
| Cache API               | 匿名公共 GET 的边缘响应缓存                        | 个性化或强一致数据           |
| Rate Limiting           | 公共入口滥用保护                                   | 身份认证和权限控制           |
| Access                  | `/internal/*` 人员和机器身份保护                   | 业务授权模型                 |

增加新的 Cloudflare 产品必须有明确问题和退出标准。留在同一生态不等于无条件增加平台原语。

## 6. 权威数据模型与核心不变量

目标逻辑模型至少包含：

| 表                     | 用途                                | 关键不变量                          |
| :--------------------- | :---------------------------------- | :---------------------------------- |
| `assets`               | 资产聚合根、状态、可见性、活动版本  | `id` 永久稳定                       |
| `asset_sources`        | 外部来源映射和许可                  | `(provider, external_id)` 唯一      |
| `media_objects`        | R2 对象、哈希、尺寸、类型和保留策略 | `(content_hash, variant_kind)` 唯一 |
| `representations`      | Caption、Tag、Embedding 元信息      | 资产、类型、模型和流水线版本唯一    |
| `processing_runs`      | Workflow 执行、步骤和错误分类       | Workflow instance ID 唯一           |
| `search_documents`     | 候选和活动搜索文档                  | 资产、表征版本和索引代际唯一        |
| `search_documents_fts` | FTS5 派生投影                       | 可由搜索文档重建                    |
| `projection_state`     | 投影代际、覆盖率、校验和活动状态    | 同类投影只有一个活动代际            |
| `outbox_events`        | 待投递领域事件                      | `event_id` 唯一且带 schema version  |
| `consumed_events`      | 消费者幂等凭证                      | `(consumer, event_id)` 唯一         |
| `runtime_config`       | 权威运行配置和活动版本              | 配置变更可审计                      |
| `operation_audit`      | 高风险运维操作记录                  | 操作者、原因、目标和结果完整        |

系统必须始终满足：

1. D1 是资产存在性、生命周期、可见性和活动版本的唯一裁决者；
2. 只有 `ready` 且活动投影完整的资产才能被搜索；
3. Vectorize 返回的候选必须回到 D1 做活动版本过滤和水合；
4. KV、Cache API、Vectorize 和 FTS5 中的数据丢失后可以重建；
5. 重建不得覆盖当前活动代际；
6. 外部供应商不可用不得影响已入库资产；
7. 对用户可见的状态切换必须在 D1 中原子完成；
8. 所有跨边界事件、配置和模型结果都有显式版本。

## 7. 媒体长期保存策略

为了保证未来 5–6 年可以更换视觉模型、Embedding 和图片处理策略，R2 必须保留一份可复算的规范 Master，而不是只保留当前展示尺寸。

推荐 key：

```text
media/{contentHash}/master.{ext}
media/{contentHash}/display/{variantVersion}.{ext}
media/{contentHash}/derived/{pipelineVersion}/{artifact}
```

规则：

1. Master 和派生对象使用内容寻址，默认不可变；
2. 下载和转换必须流式处理，不得无界缓冲完整大对象；
3. D1 记录内容哈希、R2 key、校验结果、来源、许可和保留策略；
4. 展示图、缩略图、Caption 和 Embedding 都是可重算派生物；
5. 若来源许可禁止长期保存，必须显式记录 retention policy，并为重新获取失败定义资产降级状态；
6. 删除对象必须先证明没有活动引用，并通过可审计的生命周期任务执行；
7. R2 对账周期检查缺失引用、孤儿对象和校验不一致。

## 8. 可靠事件与最终一致性

任何需要触发 D1 之外副作用的业务变更，必须在同一个 D1 事务批次中同时写业务状态和 Outbox：

```text
D1 transaction
  ├── mutate aggregate
  └── append outbox event
```

事件信封至少包含：

```ts
interface DomainEvent<T> {
  eventId: string;
  type: string;
  schemaVersion: number;
  occurredAt: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  causationId?: string;
  payload: T;
}
```

Outbox relay 固定采用“发送 Queue，成功后标记已发送”。发送成功而标记失败只会产生重复，不会造成事件丢失。消费者通过 `consumed_events`、业务唯一键和聚合版本吸收重复与乱序。

消费者必须满足：

- 重复消息产生相同最终状态；
- 旧聚合版本不得覆盖新状态；
- 副作用使用稳定幂等键；
- 先提交结果和幂等凭证，再确认消息；
- 确定性坏数据记录原因后停止无意义重试；
- 暂时性错误按策略重试；
- 超过上限进入 DLQ；
- DLQ 有查询、诊断、修复和重放路径；
- 周期对账是最终兜底，不是日常主写路径。

## 9. Queue 与 Workflow

同一个 Worker 消费两条逻辑 Queue：

1. `INGEST_QUEUE`：资产登记、摄取请求和 Workflow 启动；
2. `INDEX_QUEUE`：FTS/Vectorize 投影、索引重建和激活检查。

两条 Queue 使用独立的 batch、并发、重试和 DLQ 配置。它们是背压边界，不是新的服务边界。

`queue()` 入口只负责反序列化、schema 校验、trace 恢复、路由和确认策略，不执行长流程。

单资产 Workflow 使用确定性实例 ID：

```text
process:{assetId}:{pipelineVersion}
```

建议步骤：

1. `resolve-source`：读取规范来源和许可；
2. `download-master`：流式下载、校验、哈希和 R2 幂等写；
3. `create-display-variant`：生成展示派生物；
4. `analyze-media`：生成结构化语义表征；
5. `generate-embedding`：生成带模型版本的向量；
6. `commit-representation`：提交候选表征并追加投影事件；
7. `request-indexing`：交给 `INDEX_QUEUE`；
8. `finalize-run`：记录流程结果，不直接绕过投影闸门宣布可搜索。

每个 Workflow step 的输入和输出必须可序列化；外部副作用必须可重试和幂等。决定业务结果所需的时间、随机值和 ID 必须在进入步骤前固定，不得在重试时重新生成。

## 10. 搜索投影与激活协议

D1、FTS5 和 Vectorize 不存在跨产品原子事务，因此采用候选投影和 D1 激活闸门：

```text
1. D1 创建 pending search_document
2. 使用版本化 vector ID 幂等 upsert 到 Vectorize
3. Vectorize 接受写入后，在 D1 事务中：
   - upsert FTS 文档
   - 记录向量 mutation 和投影状态
   - 激活 representation 和 index generation
   - 设置 asset.search_ready
4. 查询只接纳与 D1 活动版本完全一致的候选
5. 后台对账并重放缺失、陈旧或孤儿投影
```

Vector ID 必须包含不可变版本：

```text
asset:{assetId}:repr:{representationVersion}:embed:{embeddingVersion}:gen:{indexGeneration}
```

Vectorize 写入接受到查询可见之间允许存在传播延迟。系统选择“新资产短暂缺席”，不选择“半成品或旧版本错误曝光”。

全量重建必须写入新 `index_generation`。只有覆盖率、校验和质量评测通过后，才能在 D1 原子切换活动代际。旧代际经过观察窗口后再回收。

## 11. 检索内核

同步搜索由稳定阶段组成：

```text
HTTP query
  -> Normalize / Parse SearchSpec
  -> Query Understanding（可降级）
  -> FTS CandidateSource ─────┐
  -> Vector CandidateSource ──┼-> RRF Fusion
                              -> Optional Reranker
                              -> Filters / Diversity / Cutoff
                              -> D1 active-version hydration
                              -> JSON + cursor
```

设计规则：

1. FTS 和 Vectorize 并发召回；
2. 任一路失败时可以按错误类型降级为单路结果；
3. 查询扩展和 Reranker 有独立超时预算，失败不得破坏基础召回；
4. RRF、过滤、多样性和截断策略实现为可单测纯策略；
5. 分页使用稳定 cursor，不使用依赖易变排名的裸 offset；
6. 默认响应为普通 JSON；SSE 仅作为经过指标验证的可选协议；
7. 公共响应缓存键必须包含规范化查询、过滤器、语言、`retrieval_version` 和 `index_generation`；
8. 排名变化必须通过固定评测集验证，而不是只依赖人工观感。

质量指标至少包含：

- Recall@K；
- nDCG@K；
- MRR；
- 零结果率；
- 重复结果率；
- 新旧检索版本的候选重合率和排序差异；
- 质量、延迟和 Workers AI 成本的联合变化。

## 12. 版本与配置治理

至少显式管理：

- `pipeline_version`；
- `media_variant_version`；
- `representation_version`；
- `embedding_version`；
- `retrieval_version`；
- `event_schema_version`；
- `index_generation`。

模型名称、维度、距离度量、Prompt schema、RRF 参数、重排阈值、过滤和截断策略都属于版本化配置，不得散落为无归属常量。

D1 保存权威配置和活动版本，KV 只保存带版本的只读快照。任何缓存键都必须包含足以阻止跨版本污染的信息。

所有版本切换遵循：

```text
create candidate
  -> build or shadow
  -> validate
  -> atomic activate in D1
  -> observe
  -> retire old version
```

Embedding 维度或距离度量改变时创建新的 Vectorize 索引和代际，不在不兼容索引上原地覆盖。

## 13. API、安全与管理面

路由按暴露面分离：

- `/api/*`：公共业务 API，统一 schema 验证、限流、trace、错误信封和兼容策略；
- `/image/*`：R2 媒体读取，严格 key 校验、ETag、Content-Type 和缓存控制；
- `/internal/*`：重放、对账、版本切换、评测和诊断，只允许 Cloudflare Access 保护的人员或机器身份；
- Static Assets：由同一 Worker 托管，在业务路由未命中后回退。

安全规则：

1. 内部接口不得依赖难猜 URL 或普通共享 Header；
2. 密钥只存放在 Cloudflare Secrets 或 Secrets Store；
3. 生产 D1 迁移使用独立权限和受控流程，不提供自动确认的普通开发脚本；
4. 高风险操作记录操作者、原因、correlation ID、目标版本和结果；
5. 外部 URL 下载执行协议、域名、重定向、大小和内容类型限制；
6. 如果未来开放用户上传，必须另行定义身份、配额、Turnstile、内容隔离和删除策略；
7. 日志不得记录密钥、完整外部响应和敏感原始内容。

## 14. 五至六年运行治理

### 14.1 环境与发布

- development、staging、production 使用独立 Bindings 和资源；
- 同一代码库生成各环境的单 Worker 部署；
- 生产变更先经过 staging 的真实 Cloudflare 绑定验证；
- compatibility date 定期、小步升级，不连续多年冻结后一次跨越；
- 使用 Wrangler 生成绑定类型；
- 发布优先使用版本化和渐进流量；
- 每次发布都有代码回滚方案和数据前向修复方案；
- 架构不假设 Worker 代码回滚会同时回滚 D1、R2、KV 或 Vectorize。

### 14.2 数据迁移

D1 schema 采用 expand/contract：

```text
增加兼容结构
  -> 发布兼容新旧结构的代码
  -> 后台回填和对账
  -> 切换读取与写入
  -> 稳定观察
  -> 后续版本删除旧结构
```

破坏性迁移不得与依赖新结构的 Worker 代码在同一步完成。迁移必须可重复检查、可审计，并明确旧 Worker 版本是否仍可运行。

### 14.3 恢复与重建

- 定期验证 D1 Time Travel 和恢复流程；
- 演练误迁移、误删、索引损坏、Queue 积压和供应商中断；
- FTS5 和 Vectorize 必须能从 D1 权威状态及 R2 Master 重建；
- R2 Master 无法恢复时，资产进入显式降级状态；
- 恢复步骤、预期时间和责任人必须形成可执行 runbook；
- 恢复能力必须通过演练证明，不能只在文档中声明存在。

### 14.4 可观测性

采用 Cloudflare Workers 原生 traces/custom spans、结构化日志和 Analytics Engine，不自建一套声称完整兼容 OpenTelemetry 的伪实现。

统一 `correlationId` 必须贯穿 HTTP、Outbox、Queue、Workflow 和投影事件。

至少观测：

- 在线：总延迟和 normalize、embedding、FTS、vector、fusion、rerank、hydration 分段延迟；
- 可用性：错误率、降级率、零结果率和缓存命中率；
- 异步：Queue backlog、重试、DLQ、Workflow 步骤失败和处理吞吐；
- 一致性：Outbox 滞留、pending 投影年龄、FTS/Vectorize 缺口和 R2 对账差异；
- 质量：固定评测集指标和新旧检索版本差异；
- 成本：Workers AI 调用、向量写入、媒体存储和重建成本。

Analytics Engine 保存高容量遥测；D1 只保存影响业务判断、配置和审计的数据。

### 14.5 容量与架构升级触发器

不以代码行数或主观复杂度为理由引入新平台原语。只有出现可测量问题时才升级架构：

- D1 热点或事务冲突持续影响 SLO；
- 同一实体需要强一致串行化；
- Queue 积压超过恢复目标；
- Worker bundle 或冷启动显著影响用户延迟；
- 搜索索引重建无法在规定窗口完成；
- 业务出现私有资产、多租户隔离或实时协作需求。

升级必须通过新 ADR 说明问题、指标、候选方案、迁移和退出策略。默认仍保持单 Worker。

## 15. 理由与权衡 (Rationale)

| 决策点   | 采纳方案                        | 未采纳方案         | 主要权衡                             |
| :------- | :------------------------------ | :----------------- | :----------------------------------- |
| 部署     | 每环境单 Worker                 | 双 Worker + RPC    | 简化发布和配置；接受共享发布与故障域 |
| 组织     | 模块化单体                      | 无边界服务类集合   | 增加端口和映射代码，换取长期边界     |
| 平台     | Cloudflare-only                 | 多云抽象           | 接受平台绑定，换取低运维和原生能力   |
| 事实源   | D1                              | 多存储共同裁决     | 查询必须回表，换取一致可解释状态     |
| 媒体     | R2 不可变 Master                | 仅保存展示图       | 增加存储与许可治理，换取长期可复算   |
| 一致性   | Outbox + 幂等 + 激活闸门 + 对账 | 顺序裸写或 2PC     | 接受最终一致窗口，换取可恢复性       |
| 长任务   | Queue + Workflow                | HTTP/Cron 直接处理 | 增加异步状态，换取背压和步骤恢复     |
| 搜索升级 | 新代际构建、验证和激活          | 原地覆盖           | 增加临时资源成本，换取无中断回滚     |
| 缓存     | KV/Cache API 可丢弃             | 缓存兼任事实源     | 失效时需要回源，换取简单一致性       |
| 实时传输 | JSON + cursor 默认              | 默认 SSE           | 放弃表面渐进感，换取缓存和恢复简单   |

该设计不追求理论上的最低文件数，而追求未来多年内稳定的数据所有权、失败语义和版本切换能力。对 Lens 而言，需要隔离的是业务职责、同步与异步负载、数据生命周期和变化速度，而不是 Worker 数量。

## 16. 影响与后果 (Consequences)

### 正面收益

- 保留单 Worker 的低运维和统一发布优势；
- 业务规则不再被 Cloudflare Binding 和供应商 JSON 贯穿；
- 重复投递、Workflow 重试和跨存储部分失败成为可恢复状态；
- 媒体、表征、模型和索引可以重新计算；
- 检索升级可以影子验证、原子切换和快速回退；
- 数据迁移、代码回滚和平台升级有长期一致的方法；
- 搜索质量、延迟和成本能够共同评估。

### 接受的代价

- 单 Worker 没有独立 Worker 级故障和发布隔离；
- Outbox、Inbox、投影状态和对账增加数据结构与运维工作；
- 保存 Master 和新旧索引代际会增加临时或长期存储成本；
- 最终一致允许新资产短暂不可搜索；
- 模块端口、事件 schema 和版本配置需要持续维护；
- 严格 expand/contract 会使数据迁移分成多个发布阶段。

## 17. 渐进迁移规划

迁移采用绞杀式演进，不允许一次性大爆炸替换。

### Phase 0：基线与契约

- 固定现有 API、关键搜索结果、延迟、错误率和异步吞吐基线；
- 建立黄金查询集和摄取 fixture；
- 定义错误分类、ID、事件和版本命名规则；
- 不改变生产行为。

### Phase 1：模块化骨架

- 建立 `entrypoints/modules/kernel/platform`；
- 先移动和包裹现有逻辑，不同时改变算法；
- 将完整 `Env` 收敛到装配和平台适配层；
- 明确路由、表和用例所有权。

### Phase 2：资产与媒体模型

- 引入 Asset、AssetSource、MediaObject、Representation 和 ProcessingRun；
- 影子写入新模型并对账；
- 新媒体采用内容寻址和规范 Master；
- 旧 R2 key 保持读取兼容。

### Phase 3：可靠事件和异步边界

- 引入 Outbox、Inbox、relay、DLQ 和重放；
- 拆分 `INGEST_QUEUE` 与 `INDEX_QUEUE`；
- Workflow 使用确定性 ID 和幂等步骤；
- 验证重复、乱序、超时和部分失败。

### Phase 4：版本化搜索投影

- 引入 SearchDocument、ProjectionState 和版本化 vector ID；
- 建立候选投影、活动闸门和周期对账；
- 新代际未通过验证前继续读取旧代际；
- 证明索引可以全量重建和回退。

### Phase 5：检索内核

- 将 FTS 和 Vectorize 封装为 CandidateSource；
- 独立 RRF、重排、过滤、多样性和截断策略；
- 影子执行新旧检索版本；
- 达到批准的质量、延迟和成本阈值后切换。

### Phase 6：运行治理与收口

- 建立 staging、渐进发布、恢复演练和兼容日期升级节奏；
- 保护 `/internal/*` 和生产迁移流程；
- 停止旧模型、旧 key、旧事件和旧索引写入；
- 证明无读取者后再删除遗留结构；
- 最后更新现行架构、数据库、API、部署和运维文档。

## 18. 采纳与完成标准

### 18.1 本 ADR 的采纳条件

采纳本 ADR 表示团队同意以下长期方向，而不表示实现已经完成：

1. 每环境单 Worker；
2. Cloudflare-only；
3. 模块化单体；
4. D1 单一事实源；
5. R2 规范 Master；
6. Outbox、幂等和投影激活；
7. Queue 与 Workflow 分工；
8. 表征、索引和检索版本化；
9. expand/contract 数据迁移；
10. 可重建、可恢复和可观测的长期运行模型。

### 18.2 架构重构完成条件

1. production 仍只有一个 Lens Worker，且不存在内部 Worker RPC；
2. staging 与 production 资源完全隔离；
3. `index.ts` 无业务逻辑，所有触发器通过明确入口分派；
4. 领域和应用模块不接收完整 `Env`；
5. 需要异步副作用的 D1 变更与 Outbox 在同一事务批次提交；
6. Queue 重复、乱序、DLQ 和 Workflow 重启都有明确恢复路径；
7. R2 Master 足以重新生成当前活动表征和搜索投影；
8. 所有搜索结果经过 D1 活动版本过滤和水合；
9. 新索引和检索版本可以影子验证、原子激活和回退；
10. FTS5、Vectorize 和缓存可以从权威状态重建；
11. D1 恢复、索引重建和供应商中断经过演练；
12. 公共 API 保持兼容，性能和质量不低于批准基线；
13. 现行文档只记录已经上线并验证的事实。

## 平台依据

- [Cloudflare Workers Best Practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
- [Cloudflare Queues Delivery Guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [How Cloudflare Queues Works](https://developers.cloudflare.com/queues/reference/how-queues-works/)
- [Cloudflare Workflows Rules](https://developers.cloudflare.com/workflows/build/rules-of-workflows/)
- [Cloudflare D1 Database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)
- [Cloudflare Vectorize API](https://developers.cloudflare.com/vectorize/reference/client-api/)
- [Cloudflare Workers Gradual Deployments](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/)
- [Cloudflare Workers Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
