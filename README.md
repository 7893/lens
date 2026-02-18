# Lens

**AI-Powered Semantic Image Search on Cloudflare Edge**

> 你搜"孤独感"，它给你一条雪夜独行的小巷。你搜"温暖"，它给你壁炉旁的猫。
> 不是关键词匹配 — 是 AI 真的看懂了每一张图。

[![Live Demo](https://img.shields.io/badge/Live-lens.53.workers.dev-F38020?logo=cloudflare&logoColor=white)](https://lens.53.workers.dev)
[![TypeScript](https://img.shields.io/badge/100%25-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 项目简介

Lens 是一个**零运维、全自动**的 AI 语义图片搜索引擎，完全运行在 Cloudflare Edge 上。

**核心能力**：

- 每小时自动从 Unsplash 采集最新图片，同时持续补充历史图片
- Llama 3.2 Vision 分析每张图片，生成描述和标签
- BGE Large 生成 1024 维语义向量，融合图片全部元数据
- 三级搜索管道：LLM 查询扩展 → 向量检索 → LLM 语义重排
- 支持中英日等多语言自然语言搜索

**无需管理**：没有服务器，没有容器，没有 GPU 实例，没有数据库运维。

---

## 系统架构

### 双管道设计

系统由两条完全解耦的管道组成：

**搜索管道（同步，毫秒级响应）**

1. 用户输入搜索词
2. LLM 扩展查询（短查询自动补充相关词汇，非英文自动翻译）
3. BGE 模型生成查询向量
4. Vectorize 执行向量相似度搜索，返回 Top 50 候选
5. LLM 对候选结果进行语义重排
6. 从 D1 获取完整元数据，从 R2 返回图片

**采集管道（异步，持久化执行）**

1. Cron 每小时触发 `lens-processor` Worker
2. Phase 1：从 Unsplash API 获取最新图片（高水位线策略）
3. Phase 2：用剩余 API 配额补充历史图片（Backfill）
4. 新图片通过 Queue 发送到 Workflow
5. Workflow 执行：下载图片 → AI 分析 → 生成向量 → 存储到 D1
6. Cron 同时将 D1 中的向量同步到 Vectorize

两条管道完全独立。搜索永远快速响应，采集在后台慢慢进行。

### 采集算法

**Phase 1 - 新图采集**：

- 从 `order_by=latest` 的 page 1 开始
- 使用 `last_seen_id` 作为高水位线锚点
- 遇到锚点即停止，只采集锚点之前的新图
- 立即更新锚点，确保不漏不重

**Phase 2 - 历史补充**：

- 使用剩余 API 配额（每小时 50 次）
- 从 `backfill_next_page` 开始往后翻页
- 盲入队所有图片，由 Workflow 层去重
- 每页处理后保存进度，支持断点续传

**Workflow 去重**：

- 每个 Workflow 第一步检查图片是否已存在于 D1
- 已存在则直接返回，不执行下载和 AI 分析
- 确保不会重复处理，节省资源

---

## 技术栈

### 运行时

| 组件     | 技术                      | 说明                             |
| -------- | ------------------------- | -------------------------------- |
| API 服务 | Cloudflare Workers + Hono | 边缘部署，全球低延迟             |
| 前端     | React + Vite + Tailwind   | 与 API 同 Worker 部署，零跨域    |
| 采集引擎 | Workers + Workflows       | 持久化执行，自动重试，最多 10 次 |
| 任务队列 | Cloudflare Queues         | 解耦采集触发和处理               |
| 定时任务 | Cron Triggers             | 每小时整点触发                   |

### 存储

| 组件     | 技术                   | 说明                  |
| -------- | ---------------------- | --------------------- |
| 图片存储 | Cloudflare R2          | S3 兼容，零出口流量费 |
| 元数据   | Cloudflare D1 (SQLite) | 边缘数据库，就近访问  |
| 向量索引 | Cloudflare Vectorize   | 1024 维，余弦相似度   |

### AI 模型

| 模型                          | 用途                         |
| ----------------------------- | ---------------------------- |
| Llama 3.2 11B Vision Instruct | 图片分析、查询扩展、结果重排 |
| BGE Large EN v1.5             | 文本向量化（1024 维）        |

### 开发工具

| 工具              | 用途                      |
| ----------------- | ------------------------- |
| TypeScript        | 全栈类型安全              |
| pnpm + Monorepo   | 依赖管理，原子提交        |
| Wrangler          | Cloudflare 本地开发和部署 |
| Terraform         | 基础设施即代码            |
| GitHub Actions    | CI/CD，推送即部署         |
| ESLint + Prettier | 代码质量和格式            |

---

## 项目结构

```
lens/
├── apps/
│   ├── api/          # API + 前端 Worker（Hono + React）
│   ├── processor/    # 采集引擎 Worker（Cron + Queue + Workflow）
│   └── web/          # 前端源码（React + Tailwind）
├── packages/
│   └── shared/       # 共享类型定义（API 契约）
├── infra/
│   └── terraform/    # 基础设施定义（D1, Queue, Vectorize）
├── docs/             # 项目文档
└── .github/
    └── workflows/    # CI/CD 配置
```

---

## 数据模型

### images 表

| 字段         | 类型    | 说明                        |
| ------------ | ------- | --------------------------- |
| id           | TEXT PK | Unsplash 图片 ID            |
| width        | INTEGER | 图片宽度                    |
| height       | INTEGER | 图片高度                    |
| color        | TEXT    | 主色调（HEX）               |
| raw_key      | TEXT    | R2 原图路径                 |
| display_key  | TEXT    | R2 展示图路径               |
| meta_json    | TEXT    | Unsplash 完整元数据（JSON） |
| ai_tags      | TEXT    | AI 生成的标签（JSON 数组）  |
| ai_caption   | TEXT    | AI 生成的描述               |
| ai_embedding | TEXT    | 1024 维向量（JSON 数组）    |
| created_at   | INTEGER | 入库时间戳                  |

### system_config 表

| 字段       | 类型    | 说明       |
| ---------- | ------- | ---------- |
| key        | TEXT PK | 配置键     |
| value      | TEXT    | 配置值     |
| updated_at | INTEGER | 更新时间戳 |

当前配置项：

- `last_seen_id`：新图采集的高水位线锚点
- `backfill_next_page`：历史补充的当前页码
- `vectorize_last_sync`：向量同步的时间戳

---

## API 接口

### GET /api/search

语义搜索图片。

**参数**：

- `q`（必填）：搜索词，支持中英日等多语言
- `limit`（可选）：返回数量，默认 20

**响应**：

```json
{
  "results": [
    {
      "id": "abc123",
      "url": "https://lens.53.workers.dev/image/display/abc123.jpg",
      "width": 1920,
      "height": 1080,
      "caption": "A cat sleeping by the fireplace",
      "score": 0.89
    }
  ],
  "total": 100,
  "query": "温暖",
  "expanded_query": "warm cozy fireplace comfort home"
}
```

### GET /api/latest

获取最新图片（默认画廊）。

**参数**：

- `limit`（可选）：返回数量，默认 20
- `offset`（可选）：分页偏移

### GET /api/images/:id

获取图片详情。

**响应**：包含完整的 Unsplash 元数据、AI 分析结果、摄影师信息、EXIF、地点、统计数据等。

### GET /api/stats

获取系统统计。

**响应**：

```json
{
  "total": 12000,
  "recent": 50
}
```

---

## 前端特性

- 搜索框居中设计，输入后平滑上移
- BlurHash 模糊占位图，图片渐显加载
- 搜索时骨架屏动画
- 点击图片查看完整详情
- 瀑布流布局，无限滚动
- 响应式设计，移动端适配
- Inter 字体，简洁排版

---

## 本地开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器（API + 前端）
pnpm dev

# 类型检查
pnpm typecheck

# 代码检查
pnpm lint

# 运行测试
pnpm test
```

---

## 部署

### 前置条件

- Cloudflare 账号
- Unsplash API Key
- pnpm 安装

### 部署步骤

1. Fork 本仓库
2. 在 Cloudflare Dashboard 创建 D1 数据库、R2 Bucket、Vectorize 索引
3. 配置 GitHub Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`
4. 推送代码，GitHub Actions 自动部署

详细步骤参见 [部署指南](docs/guide/SETUP.md)。

---

## 资源消耗

### Unsplash API

- 免费版：50 次/小时
- 每次采集约消耗全部配额
- 每小时新增约 300-400 张图片（含 backfill）

### Cloudflare 免费额度

| 资源      | 免费额度      | 当前使用 |
| --------- | ------------- | -------- |
| Workers   | 10 万次/天    | 远低于   |
| D1        | 500 万行读/天 | 远低于   |
| R2        | 10 GB 存储    | ~2 GB    |
| Vectorize | 20 万向量     | ~1.2 万  |
| AI        | 按需计费      | 极低     |

---

## 文档索引

| 文档                                             | 内容           |
| ------------------------------------------------ | -------------- |
| [系统设计](docs/architecture/DESIGN.md)          | 双管道架构详解 |
| [前端架构](docs/architecture/FRONTEND_DESIGN.md) | React 实现细节 |
| [API 参考](docs/api/OPENAPI.md)                  | 完整接口定义   |
| [开发指南](docs/guide/DEVELOPMENT.md)            | 本地开发环境   |
| [部署指南](docs/guide/SETUP.md)                  | 从零部署       |

---

## License

MIT
