# 完整接口指南 (03-API-REFERENCE)

Lens 所有 API 遵循 RESTful 规范，基础端点为 `/api`。

---

## 1. 语义图片搜索 (Semantic Search)

这是系统的核心接口，集成了三级 AI 搜索增强逻辑。

- **Endpoint**: `GET /api/search`
- **参数**:
  - `q` (Required): 搜索关键词或自然语言描述（如 "雨后的东京街头"）。
  - `limit` (Optional): 返回结果数，默认 20，最大 100。

### 1.1 搜索全链路拆解

1.  **Level 1 Cache**: 检查 `caches.default`。命中则直接返回。
2.  **Level 2 Cache (KV)**: 检查 KV 语义缓存。
    - 若命中，跳过查询扩展 AI 调用。
    - 若未命中，调用 `llama-3.2-3b` 执行查询扩展，并将结果异步存入 KV。
3.  **Vector Retrieval**: 调用 `bge-large-en-v1.5` 生成向量，在 `Vectorize` 中检索 Top 100。
4.  **LLM Re-ranking**: 调用 `llama-3.2-3b` 对 Top 50 候选记录进行深度语义匹配打分。
5.  **Final Response**: 按得分排序并注入 D1 元数据。

### 1.2 响应示例 (JSON)

```json
{
  "results": [
    {
      "id": "abc-123",
      "url": "/image/display/abc-123.jpg",
      "width": 3840,
      "height": 2160,
      "caption": "A moody scene of Tokyo street...",
      "tags": ["tokyo", "rain", "neon"],
      "score": 0.98,
      "photographer": "Kento Nomura",
      "blurHash": "L6PZfS.AyE%M%~WBIUWB00WB_3Mx",
      "color": "#1a1a1a",
      "location": "Shinjuku, Tokyo",
      "exif": {
        "camera": "Sony A7RIV",
        "aperture": "f/1.4",
        "exposure": "1/100s"
      }
    }
  ],
  "total": 1,
  "took": 450
}
```

---

## 2. 发现接口 (Discovery)

### 2.1 获取最新图片

- **Endpoint**: `GET /api/latest`
- **返回**: 数据库中最新入库的 100 张图片元数据。
- **用途**: 首页瀑布流初始加载。

### 2.2 图片详情

- **Endpoint**: `GET /api/images/:id`
- **返回**: 包含完整的 Unsplash 元数据、AI 分析详情及下载统计。

---

## 3. 图片资源代理 (Image Proxy)

由于 R2 属于私有存储，系统提供安全的文件出口。

- **Endpoint**: `GET /image/:type/:filename`
- **参数**:
  - `type`: `raw` (原图) 或 `display` (优化图)。
  - `filename`: `{photoId}.jpg`。
- **缓存策略**: 返回 `immutable` 缓存头，由 Cloudflare 边缘节点提供 1 年期的长效缓存。

---

## 4. 统计接口 (Monitoring)

- **Endpoint**: `GET /api/stats`
- **返回**:

  ```json
  {
    "total": 18812,
    "recent": 51,
    "last_at": 1771581712737
  }
  ```

  - `total`: 库中总图片数。
  - `recent`: 过去 1 小时内新增成功的图片数。

---

## 5. 错误处理与限流

| 状态码  | 含义              | 原因                                       |
| :------ | :---------------- | :----------------------------------------- |
| **429** | Too Many Requests | 单 IP 每分钟搜索超过 10 次。               |
| **400** | Bad Request       | 缺少必填参数 `q`。                         |
| **500** | Internal Error    | 通常是 AI Gateway 调用超时或 D1 响应过慢。 |
