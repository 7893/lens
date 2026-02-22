# 完整接口指南与交互规范 (03-API-REFERENCE)

Lens 的 API 设计遵循“极简输入，极丰输出”的原则。系统通过 Hono 框架将 Cloudflare 的底层存储能力封装为标准的 RESTful 端点，并内置了针对 AI 负载的保护机制。

---

## 1. 核心搜索接口：`GET /api/search`

这是 Lens 系统中最重、也是技术含量最高的一个接口。它集成了查询扩展、多维检索、相关性精排和动态截断四项核心技术。

### 1.1 请求参数深度解析

- **`q` (必填, string)**：用户的原始查询词。支持自然语言（如：“那种让人感到忧伤的雨中伦敦街头”）。
- **`limit` (可选, number)**：召回数量。建议范围 10-100。

### 1.2 搜索生命周期 (The Search Lifecycle)

1.  **L1 Cache Match**：首先在 `caches.default` 中寻找完全相同的 URL 签名。如果命中（通常是 10 分钟内的重复请求），系统会在 10ms 内直接返回。
2.  **Rate Limit Check**：基于 IP 的滑动窗口限流。由于 AI 重排极其消耗 Neurons 资源，单个用户被限制为每分钟 10 次搜索。
3.  **Semantic Enrichment**：检查 KV 缓存。如果没有该词的扩展，则启动 Llama 4 Scout 将其“视觉化”。
4.  **Vector Retrieval**：BGE-M3 生成 1024 维向量，在 Vectorize 中进行高速空间检索。
5.  **Dynamic Cutoff**：执行断崖截断算法，过滤掉语义漂移的干扰项。
6.  **Contextual Re-ranking**：将剩余的前 20 张图连同其 Caption 丢给 BGE Reranker 进行交叉注意力打分。
7.  **Data Hydration**：从 D1 捞取最新的审美分和实体信息，完成最终 JSON 组装。

### 1.3 响应结构示例与业务含义

```json
{
  "results": [
    {
      "id": "Tm0XygW6gN8",
      "url": "/image/display/Tm0XygW6gN8.jpg",
      "width": 3840,
      "height": 2160,
      "caption": "A high-contrast cinematic shot of a rainy street in London...",
      "ai_quality_score": 9.2,
      "entities": ["London Eye", "Big Ben"],
      "score": 0.985,
      "photographer": "John Doe",
      "color": "#1a1a1a"
    }
  ],
  "total": 42,
  "took": 450
}
```

- **`ai_quality_score`**：前端可利用此字段进行“美学排序”切换。
- **`entities`**：支持前端渲染为可点击的标签，实现相关实体联想。
- **`took`**：包含所有 AI 调用在内的全链路延迟，用于监控系统性能。

---

## 2. 系统统计接口：`GET /api/stats`

为监控面板提供实时数据支持。它直接从 D1 的索引中快速聚合数据。

- **`total`**：库中已完成 AI 处理的图片总量。
- **`recent`**：过去一小时内新入库成功的图片数。该指标是判断采集引擎是否存活的关键信号。
- **`last_at`**：数据库最新一条记录的时间戳。

---

## 3. 图片资源代理规范：`GET /image/:type/:filename`

由于 R2 处于私有网络，系统通过此端点提供安全的图片出口。

### 3.1 类型说明

- **`raw`**：返回原始最高清大图。主要用于“下载”或“详情页放大”。
- **`display`**：返回经过 Web 优化的 Regular 画质图。用于瀑布流展示和列表预览。

### 3.2 性能保证

接口强制注入 `Cache-Control: immutable`。这意味着一旦图片被用户的浏览器或 Cloudflare 边缘节点缓存，在文件过期前，都不会再向我们的 Workers 发起任何请求，实现了 Class B 操作的零支出。

---

## 4. 故障状态码诊断

| 状态码  | 业务含义        | 运维建议                                                  |
| :------ | :-------------- | :-------------------------------------------------------- |
| **429** | 触发 IP 级限流  | 检查是否有爬虫在恶意刷搜索接口。                          |
| **400** | 缺少必填参数    | 核实前端传递的 `q` 字段是否被正确编码。                   |
| **504** | AI Gateway 超时 | 通常是 Llama 4 在边缘节点的高峰排队导致，系统会自动重试。 |
| **500** | 内部逻辑崩溃    | 请检查 D1 数据库是否达到存储配额限制。                    |
