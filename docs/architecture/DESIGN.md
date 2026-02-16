# Pic v6.0 系统架构设计 (System Design Document)

本文档详细描述了 Pic v6.0 的双管道架构设计、数据模型、存储策略和技术选型。

## 1. 架构目标 (Goals)

1.  **AI 驱动**: 不再依赖简单的标签匹配，完全由 AI 理解图片内容。
2.  **极速体验**: 毫秒级搜索响应，全静态前端 (Cloudflare Pages)。
3.  **稳健采集**: 通过队列和 Workflow 解耦 Unsplash 大图下载，避免超时。
4.  **低成本运维**: 全 Serverless 架构 (Workers + D1 + R2 + Vectorize)。

## 2. 系统组件 (Components)

### 2.1 写入管道 (Ingestion Pipeline)

负责数据的采集、清洗、处理和入库。

1.  **Scheduler (Worker)**:
    *   **职责**: 定时任务 (Cron)。
    *   **流程**:
        *   检查 D1 配置 (API Quota, Last Run)。
        *   调用 Unsplash API 获取最新/热门图片列表。
        *   去重 (Bloom Filter 或 D1 SET)。
        *   将图片 URL 推送至 **Cloudflare Queue**。

2.  **Processor (Worker)**:
    *   **职责**: 消费队列消息，启动 Workflow。
    *   **流程**:
        *   监听 Queue 消息。
        *   启动 `PicIngestWorkflow` 实例。

3.  **Workflow (Durable Workflow)**:
    *   **职责**: 编排长任务。
    *   **步骤**:
        *   **Step 1: Download**: 并行下载 Raw 图 (50MB+) 和 Display 图 (500KB)。
        *   **Step 2: Store**: 存入 R2 (`raw/{id}.jpg`, `display/{id}.jpg`)。
        *   **Step 3: Vision Analysis**: 调用 `llava-1.5-7b-hf` 生成图片描述 (Caption) 和标签 (Tags)。
        *   **Step 4: Embedding**: 调用 `bge-base-en-v1.5` 将 Caption 转为向量 (Vector)。
        *   **Step 5: Persist**:
            *   写入 D1 `images` 表 (Metadata)。
            *   写入 Vectorize `image_vectors` 索引 (Vector)。

### 2.2 读取管道 (Search Pipeline)

负责响应前端用户的语义搜索请求。

1.  **Search API (Hono Worker)**:
    *   **职责**: 提供 RESTful 接口。
    *   **流程**:
        *   接收用户查询 (`q="sad rainy day"`).
        *   调用 `bge-base-en-v1.5` 生成查询向量。
        *   查询 Vectorize 索引，获取 Top-K 图片 ID。
        *   根据 ID 查询 D1 获取图片详情 (R2 Display Key, Width, Height)。
        *   返回 JSON 结果。

2.  **Frontend (Pages)**:
    *   **技术栈**: React + Vite + TailwindCSS。
    *   **功能**:
        *   瀑布流展示 (Infinite Scroll)。
        *   语义搜索框。
        *   图片详情页 (查看 Raw 图链接)。

## 3. 数据模型 (Data Models)

### 3.1 D1 Schema

```sql
-- 系统配置
CREATE TABLE system_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER
);

-- 图片元数据
CREATE TABLE images (
    id TEXT PRIMARY KEY,
    width INTEGER,
    height INTEGER,
    color TEXT,
    
    -- 存储路径
    raw_key TEXT,      -- "raw/xyz.jpg"
    display_key TEXT,  -- "display/xyz.jpg"
    
    -- Unsplash 原始数据 (JSON)
    meta_json TEXT,
    
    -- AI 生成数据
    ai_tags TEXT,      -- ["city", "night", "rain"]
    ai_caption TEXT,   -- "A futuristic city street at night with neon lights..."
    
    created_at INTEGER
);

CREATE INDEX idx_created_at ON images(created_at);
```

### 3.2 Vectorize Index

*   **Name**: `pic-vectors`
*   **Dimensions**: 768 (对应 `bge-base-en-v1.5`)
*   **Metric**: `cosine` (余弦相似度)

### 3.3 R2 Structure

```
/
├── raw/
│   └── {id}.jpg      (Original Quality)
└── display/
    └── {id}.jpg      (Optimized WebP/JPG)
```

## 4. 技术选型 (Technology Stack)

| 组件 | 技术 | 理由 |
| --- | --- | --- |
| **Backend API** | Hono (Cloudflare Workers) | 轻量、类型安全、路由清晰。 |
| **Database** | D1 (SQLite) | 关系型查询、事务支持、成本低。 |
| **Vector Search** | Vectorize | 原生集成、无缝扩容。 |
| **Object Storage** | R2 | 无出口流量费 (Egress Fee)。 |
| **Task Queue** | Cloudflare Queues | 削峰填谷，解耦采集与处理。 |
| **Orchestration** | Workflows | 处理长时任务 (AI, Download)，支持重试。 |
| **Frontend** | React + Vite (Pages) | 现代前端标准，自动构建。 |
| **AI Model (Vision)** | `@cf/llava-hf/llava-1.5-7b-hf` | 强大的图文理解能力。 |
| **AI Model (Text)** | `@cf/baai/bge-base-en-v1.5` | 通用文本向量化，支持语义搜索。 |
