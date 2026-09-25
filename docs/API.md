# API 接口契约与网关规范

更新日期：2026-09-19
状态：现行
适用范围：API 网关接口契约、输入输出规范、流式通信与错误模型

Lens API 网关基于 Hono 框架构建，运行于 Cloudflare Workers 边缘运行时。网关集成了 IP 滑动窗口限流、双层缓存（L1 Edge Cache + L2 KV）、SSE 流式传输以及完整的 OpenTelemetry 追踪生命周期。

---

## 1. 全局配置与中间件契约

### 1.1 跨域资源共享 (CORS)

- **允许 Origin**：`https://lens.53.workers.dev`、`http://localhost:5173`
- **允许 HTTP 方法**：`GET`, `POST`
- **预检请求响应头**：标准 CORS 协商响应头

### 1.2 限流策略 (Rate Limiting)

- **作用范围**：`/api/search`
- **窗口与配额**：基于客户端 IP 的滑动窗口计数，限制为 60 次/分钟。
- **超限响应**：HTTP 429 Too Many Requests，响应体 `{ "error": "Too Many Requests" }`。

### 1.3 链路追踪头 (Telemetry Headers)

所有请求进入网关时均初始化全局 Trace 上下文：

- 每个搜索请求生成唯一 `traceId`（格式：`SEARCH-<uuid>`）。
- 关键链路阶段（Query 扩展、向量召回、FTS5 检索、断崖截断、Rerank）的耗时与元数据自动记录至 `TELEMETRY` Analytics Engine。

---

## 2. 核心接口规范

### 2.1 语义混合搜索：`GET /api/search`

提供多模态文本到图像的语义检索服务，支持标准 JSON 响应与 Server-Sent Events (SSE) 流式传输。

#### 2.1.1 请求定义

- **Query 参数**：
  | 参数名        | 类型     | 必填 | 默认值    | 说明                                                    |
  | :------------ | :------- | :--- | :-------- | :------------------------------------------------------ |
  | `q`           | `string` | 是   | 无        | 搜索关键词或自然语言描述（非空）                        |
  | `stream`      | `string` | 否   | `"false"` | 传 `"true"` 时启用 SSE 流式分阶段响应                   |
  | `limit`       | `number` | 否   | `30`      | 结果返回数量上限（默认 30，最大 100）                   |
  | `cursor`      | `string` | 否   | 无        | 深度分页游标（Base64 编码不透明 Token）                 |
  | `color`       | `string` | 否   | 无        | 主色调过滤（如 `"teal"`, `"yellow"`, 或 Hex 代码）      |
  | `orientation` | `string` | 否   | 无        | 画幅朝向过滤（`"landscape"`, `"portrait"`, `"square"`） |
  | `tag`         | `string` | 否   | 无        | 指定标签精准过滤                                        |
- **Headers 参数**：
  - `Accept: text/event-stream`（可选，等效于 `?stream=true`）

#### 2.1.2 响应模式 A：标准 JSON 响应 (`stream=false`)

- **HTTP 状态码**：`200 OK`
- **缓存策略**：`Cache-Control: public, max-age=600`（边缘缓存 10 分钟）
- **响应体 Schema**：

```typescript
interface SearchResponse {
  results: ImageResult[];
  query: string;
  expandedQuery?: string;
  latencyMs: number;
  totalHits: number;
  nextCursor?: string | null;
  telemetry?: {
    resultsBeforeCliff: number;
    resultsAfterCliff: number;
    highestScore: number;
    lowestScore: number;
    fts5Hits: number;
    vectorHits: number;
  };
}

interface ImageResult {
  id: string;
  url: string;
  displayUrl: string;
  width: number;
  height: number;
  ai_caption: string;
  photographer: string;
  score: number;
  blur_hash?: string;
  color?: string;
  tags?: string[];
  ai_quality_score?: number;
}
```

#### 2.1.3 响应模式 B：SSE 流式传输 (`stream=true`)

- **Content-Type**：`text/event-stream`
- **事件流水线**：
  1. `event: stage`：
     - `data: {"stage": "expanding", "message": "Expanding query via Llama..."}`
  2. `event: stage`：
     - `data: {"stage": "retrieving", "expandedQuery": "..."}`
  3. `event: stage`：
     - `data: {"stage": "ranking", "count": 30}`
  4. `event: stage`：
     - `data: {"stage": "complete", "results": ImageResult[], "telemetry": { ... }}`
  5. `event: done`：
     - `data: {}`

---

### 2.2 搜索建议与前缀补全：`GET /api/suggest`

提供低延迟前缀补全词推荐，数据由用户高频有效搜索在后台异步聚合沉淀于 KV。

#### 2.2.1 请求定义

- **Query 参数**：
  | 参数名 | 类型     | 必填 | 说明                          |
  | :----- | :------- | :--- | :---------------------------- |
  | `q`    | `string` | 是   | 搜索前缀，长度须 $\ge 2$ 字符 |

#### 2.2.2 响应体 Schema

- **HTTP 状态码**：`200 OK`
- **响应体**：

```json
{
  "suggestions": ["cyberpunk city night", "cyberpunk neon lights"]
}
```

---

### 2.3 最新入库画廊：`GET /api/images/latest`

获取最新入库且已完成 AI 多模态结构化标注的图片列表。

#### 2.3.1 响应定义

- **HTTP 状态码**：`200 OK`
- **缓存策略**：KV 缓存 3600 秒 (`cache:latest`)
- **响应体**：

```json
{
  "results": [/* ImageResult[] */],
  "total": 100
}
```

---

### 2.4 图片详情查询：`GET /api/images/:id`

获取单张图片的结构化全量元数据，包括 EXIF 摄影参数、AI 标注信息、色调以及分类标签。

#### 2.4.1 请求定义

- **路径参数**：`id`（图片唯一标识字符串）

#### 2.4.2 响应定义

- **HTTP 状态码**：`200 OK`（若不存在返回 `404 Not Found`）
- **缓存策略**：KV 缓存 86400 秒（24 小时）
- **响应体 Schema**：

```typescript
interface ImageDetail extends ImageResult {
  exif?: {
    camera?: string;
    lens?: string;
    focalLength?: string;
    aperture?: string;
    exposure?: string;
    iso?: number;
  };
  location?: {
    city?: string;
    country?: string;
    coordinates?: [number, number];
  };
  entities?: string[];
  composition?: string;
  sourceUrl?: string;
  downloadUrl?: string;
}
```

---

### 2.5 图片资产边缘代理：`GET /image/*`

直接从 Cloudflare R2 对象存储流式代理图片数据，结合 Cloudflare 边缘节点提供就近缓存与 MD5 ETag 协商。

#### 2.5.1 请求定义与路由规则

- **按月归档原始图片直读**：`GET /image/:yearmonth/:filename`（例如 `/image/202609/abc.jpg`）
  - `:yearmonth`：6 位数字月份目录（正则：`^\d{6}$`，如 `202609`）；
  - `:filename`：正则约束 `^[a-zA-Z0-9_-]+\.jpg$`；
  - 映射 R2 路径：`${yearmonth}/${filename}`（若未命中自动回退历史 `raw/${filename}`）。
- **按月归档 Web 展示缩略图**：`GET /image/display/:yearmonth/:filename`（例如 `/image/display/202609/abc.jpg`）
  - 映射 R2 路径：`display/${yearmonth}/${filename}`（若未命中自动回退 `display/${filename}`）。
- **存量平铺缩略图兼容代理**：`GET /image/display/:filename`（例如 `/image/display/abc.jpg`）
  - 优先读取 `display/${filename}`；
  - 若历史图片已被整理迁移至按月文件夹，自动回查 D1 `display_key` 并透明重定向/流式读取对应按月对象，写入 Edge 缓存，保证历史全量 URL 100% 长期可用。
- **别名路由**：`/api/images/*` 与 `/image/*` 完全等效。

#### 2.5.2 响应头与缓存控制

- `Content-Type`: `image/jpeg`
- `ETag`: R2 对象的 HTTP ETag
- `Cache-Control`: `public, max-age=31536000, immutable`（边缘节点与客户端强缓存 1 年）

---

### 2.6 运行指标与交互统计：`/api/stats`

#### 2.6.1 概览统计：`GET /api/stats`

- **说明**：获取系统存储总量、近 24 小时增量以及 Llama-4 处理进度的统计摘要。
- **缓存策略**：KV 缓存 60 秒 (`stats:summary`)。
- **响应体**：

```json
{
  "total": 5240,
  "recent": 128,
  "evolved": 5240
}
```

#### 2.6.2 埋点上报：`POST /api/stats/track`

- **说明**：接收前端用户交互事件（点击、曝光、首词耗时），异步写入 Analytics Engine。
- **请求体 Schema**：

```typescript
interface TrackPayload {
  sessionId: string;
  action: 'click' | 'view' | 'dwell';
  query?: string;
  photoId?: string;
  timeToClickMs?: number;
}
```

- **响应体**：`{ "ok": true }`

---

### 2.7 运维补偿接口：`POST /api/admin/compensate`

#### 2.7.1 请求定义

- **说明**：针对特定遗漏或未完成异步流水线处理的图片 ID 进行手动补偿投递，直接入列 `PHOTO_QUEUE`。
- **请求体**：

```json
{
  "photoIds": ["photo_id_1", "photo_id_2"]
}
```

- **响应体**：

```json
{
  "enqueued": 2,
  "errors": []
}
```

---

### 2.8 基础健康检查：`GET /health`

- **HTTP 状态码**：`200 OK`
- **响应体**：

```json
{
  "status": "healthy",
  "name": "lens"
}
```

---

### 2.9 内部管理与治理面接口：`/internal/*`

内部接口专供集群治理、运维巡检与故障恢复使用。`/internal/*` 与 `/api/admin/*`
均要求经验证的 `Authorization: Bearer <internal_token>`。

#### 2.9.1 鉴权规范

通过 Wrangler secret 配置至少 32 字符的随机 `INTERNAL_API_SECRET`，开发环境同样要求。
缺少配置返回 503，无效令牌返回 401；Access 身份邮箱头本身不构成凭据。
`ADMIN_RATE_LIMITER` 为管理请求提供每个 Cloudflare 位置每分钟 10 次的共享预算，
缺少绑定或限流服务故障返回 503，超额返回 429。这不是跨位置的全局费用上限。
补偿接口每次最多接受 20 个合法图片 ID，请求体上限为 8 KiB。

#### 2.9.2 系统依赖深层诊断：`GET /internal/health`

- **说明**：对 D1、R2、KV 以及活跃索引代际 (`activeGeneration`) 执行深层诊断探针。
- **响应体 Schema**：

```json
{
  "status": "healthy",
  "environment": "production",
  "activeGeneration": "gen-001",
  "dependencies": {
    "d1": "healthy",
    "r2": "healthy",
    "kv": "healthy"
  },
  "latencyMs": 12,
  "timestamp": "2026-09-19T13:00:00.000Z"
}
```

#### 2.9.3 对账与延迟报告：`GET /internal/reconciliation`

- **说明**：审计事务发件箱（Outbox）待派发积压量、各投影（Vectorize / FTS5）文档覆盖率与代际健康度。
- **响应体 Schema**：

```json
{
  "outbox": {
    "pendingCount": 0,
    "oldestPendingAgeSeconds": 0
  },
  "projections": {
    "vectorize": {
      "activeGeneration": "gen-001",
      "coverageRatio": 1.0,
      "documentCount": 5240
    },
    "fts": {
      "activeGeneration": "gen-001",
      "coverageRatio": 1.0,
      "documentCount": 5240
    }
  },
  "status": "healthy",
  "checkedAt": "2026-09-19T13:00:00.000Z"
}
```

#### 2.9.4 触发审计对账：`POST /internal/reconciliation/run`

- **说明**：强制触发即时对账检查，并将执行结果作为不可变记录持久化至 `operation_audit`。
- **响应体**：`{ "correlationId": "uuid", "report": { ... } }`

#### 2.9.5 读取权威配置：`GET /internal/config/:key`

- **说明**：从 D1 `runtime_config` 表读取权威运行时配置及版本元数据。
- **响应体**：

```json
{
  "key": "ingestion_policy",
  "version": "v1.2",
  "value": {
    "batchSize": 5,
    "maxPages": 3
  },
  "description": "Unsplash batch ingestion config",
  "updatedBy": "admin@lens.internal",
  "updatedAt": 1773571200000
}
```

#### 2.9.6 更新权威配置：`POST /internal/config`

- **说明**：更新运行时配置，强制要求携带变更原因（`reason`），自动记录 `operation_audit` 审计日志。
- **请求体**：

```json
{
  "key": "ingestion_policy",
  "version": "v1.3",
  "value": {
    "batchSize": 5,
    "maxPages": 5
  },
  "description": "Increased maxPages for weekend ingest",
  "reason": "OPS-1024: scheduled catch-up"
}
```

- **响应体**：`{ "status": "updated", "key": "...", "version": "...", "correlationId": "..." }`

#### 2.9.7 手动触发发件箱中继：`POST /internal/outbox/relay`

- **说明**：手动扫描并批量将待派发 (`dispatched_at IS NULL`) 的 Outbox 事件投递至 Cloudflare Queue，写入操作审计。
- **响应体**：

```json
{
  "correlationId": "uuid",
  "result": {
    "polled": 15,
    "relayed": 15,
    "errors": []
  }
}
```

#### 2.9.8 查看存储归档重组进度：`GET /internal/storage/reorganize`

- **说明**：获取 R2 与 D1 历史图片按月目录重组进度与待处理统计。
- **响应体**：

```json
{
  "total": 25319,
  "reorganized": 24819,
  "pending": 500,
  "percentage": 98.03
}
```

#### 2.9.9 触发批量存储归档重组：`POST /internal/storage/reorganize`

- **说明**：批量将存量平铺图片安全复制迁移至按月文件夹（`{YYYYMM}/${id}.jpg` 与 `display/{YYYYMM}/${id}.jpg`），同步更新 D1 索引与操作审计。
- **请求体**：

```json
{
  "limit": 50,
  "deleteOld": false
}
```

- **响应体**：

```json
{
  "correlationId": "uuid",
  "result": {
    "processed": 50,
    "migrated": 50,
    "skipped": 0,
    "failed": 0,
    "remaining": 450
  }
}
```

---

## 3. 错误模型与 HTTP 状态码规范

网关遵循标准 RESTful HTTP 状态码体系，所有错误响应均返回标准 JSON 结构：

```json
{
  "error": "明确的错误原因说明"
}
```

| HTTP 状态码                   | 触发条件                                              | 处理方式与客户端对策                               |
| :---------------------------- | :---------------------------------------------------- | :------------------------------------------------- |
| **200 OK**                    | 请求成功处理并返回预期数据                            | 正常解析响应体                                     |
| **400 Bad Request**           | 缺少必填参数（如 `q` 为空）、非法路径或非法 JSON 结构 | 校验客户端请求参数格式与合法性                     |
| **404 Not Found**             | 请求的图片记录或 R2 静态资源不存在                    | 确认资源 ID 存在性，避免死链轮询                   |
| **429 Too Many Requests**     | 触发 IP 频率限制（>60 次/分钟）                       | 指数退避重试，并展示等待提示                       |
| **500 Internal Server Error** | 边缘运行时内部未捕获异常或数据库异常                  | 记录 traceId，触发报警排查日志                     |
| **504 Gateway Timeout**       | 外部上游 API（Unsplash / Workers AI）超时             | 检查上游连通性，依赖异步队列重试机制保障最终一致性 |
