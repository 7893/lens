# Lens 系统架构设计 (System Design Document)

本文档详细描述了 Lens 的双管道架构设计、采集算法、多层搜索增强策略及存储方案。

## 1. 核心架构

系统被划分为两个独立的管道，通过 **Cloudflare Queue** 实现削峰填谷。

### 资源清单

| 类型       | 名称            | 用途         |
| ---------- | --------------- | ------------ |
| D1         | `lens-d1`       | 元数据存储   |
| R2         | `lens-r2`       | 图片存储     |
| Vectorize  | `lens-vectors`  | 向量索引     |
| Queue      | `lens-queue`    | 任务队列     |
| KV         | `lens-kv`       | 配置存储     |
| Workflow   | `lens-workflow` | 图片处理流程 |
| AI Gateway | `lens-gateway`  | AI 调用网关  |

### 架构图

```
用户 --> Search API (Hono)
           |
           +--> 1. 查询扩展 (Llama 3.2)
           +--> 2. 向量检索 (Vectorize)
           +--> 3. 结果重排 (Llama 3.2)
           +--> 4. 元数据读取 (D1)

采集管道:
  Cron (每小时) --> Processor Worker --> Queue --> Workflow
                                                      |
                                                      +--> 1. 幂等检查 (D1)
                                                      +--> 2. 下载图片 (R2)
                                                      +--> 3. 视觉理解 (Llama 3.2 Vision)
                                                      +--> 4. 向量化 (BGE Large)
                                                      +--> 5. 写入 (D1 + Vectorize)
```

## 2. 采集算法：高水位线模型 (High Water Mark Ingestion)

这是本项目的核心算法，旨在 Unsplash 每小时 50 次配额限制下，实现最大化吞吐量。

### Phase 1: 向前追赶 (Forward Catch-up)

- **目标**: 确保系统始终拥有最新的图片。
- **逻辑**: 从第 1 页开始抓取，直到遇到数据库中存储的 `last_seen_id`（高水位线）。
- **立即更新**: 只要第 1 页成功获取，立即更新 `last_seen_id`，确保不漏不重。

### Phase 2: 向后回填 (Backward Backfill)

- **目标**: 利用剩余配额挖掘历史数据。
- **盲入队策略**: 直接入队所有图片，由 Workflow 层去重。
- **断点续传**: 每页处理后保存 `backfill_next_page`，支持断点续传。
- **配额耗尽策略**: 持续抓取，直到 API 剩余配额为 1。

### Workflow 去重

- 每个 Workflow 第一步检查图片是否已存在于 D1。
- 已存在则直接返回，不执行下载和 AI 分析，节省资源。

## 3. 搜索算法：多层智能增强

系统不只是简单的向量匹配，而是采用了工业级的搜索漏斗：

1. **查询扩展 (Query Expansion)**: 使用 Llama 3.2 对 4 词以内的短搜索词进行增强，自动翻译为英文并增加视觉关联词。
2. **初筛 (Vector Retrieval)**: 通过 BGE Large 1024 维向量在 Vectorize 中进行初筛，获取 Top 100 候选。
3. **重排 (LLM Re-ranking)**: 将 Top 50 的 AI 描述和元数据传给 Llama 3.2，根据用户查询词进行相关性排序。
4. **混合评分 (Hybrid Scoring)**: 重排后的前 20 名获得位置权重分，其余保留原始向量相似度分。

## 4. 数据一致性与防护

- **Workflow 守门员**: Workflow 的第一个 Step 是 `check-exists`。这确保了在回填模式下，如果任务重复，会瞬间跳过昂贵的 AI 推理。
- **流式 R2 写入**: 下载大图时，直接使用 `response.body` 对接到 `R2.put`，确保 Worker 不会 OOM。
- **Unsplash 合规**: 自动触发 Unsplash 下载跟踪端点，符合其 API 使用政策。

## 5. 存储策略

| 路径                | 格式            | 用途               | 缓存策略         |
| ------------------- | --------------- | ------------------ | ---------------- |
| `/raw/{id}.jpg`     | 原图 (RAW)      | 存档与高质量下载   | 1 年 (Immutable) |
| `/display/{id}.jpg` | 1080p (Regular) | 前端展示与 AI 分析 | 1 年 (Immutable) |

## 6. AI 模型

| 模型                          | 用途                         |
| ----------------------------- | ---------------------------- |
| Llama 3.2 11B Vision Instruct | 图片分析、查询扩展、结果重排 |
| BGE Large EN v1.5             | 文本向量化（1024 维）        |
