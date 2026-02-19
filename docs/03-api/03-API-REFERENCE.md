# 完整接口指南 (03-API-REFERENCE)

Lens 所有 API 接口均通过 `https://<your-worker-subdomain>.workers.dev/api` 暴露。

---

## 1. 语义搜图 (Search Images)

核心检索接口，整合了查询扩展、向量召回和 LLM 重排。

- **URL**: `GET /api/search`
- **认证**: 无 (受 IP 限流保护)
- **查询参数**:
  - `q` (string, 必传): 搜索词，支持自然语言（如 "下雨天的咖啡馆"）。
  - `limit` (number, 可选): 返回条数。默认 20，最大 100。

### 1.1 内部增强逻辑
- **LLM 查询扩展**: 4 词以内的短搜索词会自动扩充为视觉特征词。
- **自动翻译**: 非英文输入会自动转化为英文后进行向量化。
- **LLM 语义重排**: 利用 Llama 3.2 对 Top 50 结果进行深度相关性分析。

### 1.2 响应格式
```json
{
  "results": [
    {
      "id": "SLgCDEqHav4",
      "url": "/image/display/SLgCDEqHav4.jpg",
      "width": 3840,
      "height": 2160,
      "caption": "A high-contrast photo of a person sitting by a window during rain...",
      "tags": ["rain", "window", "portrait", "melancholy"],
      "score": 0.98,
      "photographer": "John Doe",
      "blurHash": "L6PZfS.AyE%M%~WBIUWB00WB_3Mx",
      "color": "#1a1a1a",
      "location": "Seattle, WA",
      "description": "Rainy afternoon in the cafe",
      "exif": {
        "camera": "Sony A7III",
        "aperture": "f/1.8",
        "exposure": "1/125s",
        "focalLength": "35mm",
        "iso": 800
      },
      "topics": ["nature", "urban"]
    }
  ],
  "total": 1,
  "took": 450
}
```

---

## 2. 画廊发现 (Latest Gallery)

按入库时间倒序获取最新图片，用于首页展示。

- **URL**: `GET /api/latest`
- **参数**:
  - `limit` (number, 可选): 默认 100。
- **说明**: 仅返回 `ai_caption` 已生成的有效记录。

---

## 3. 图片详情 (Get Image Details)

获取指定图片的完整原始元数据及 AI 分析结果。

- **URL**: `GET /api/images/:id`
- **响应内容**: 包含详细的摄影师资料、下载统计、位置坐标及 AI 解析。

---

## 4. 系统统计 (System Stats)

- **URL**: `GET /api/stats`
- **返回**:
  ```json
  {
    "total": 18035,
    "recent": 450,
    "last_at": 1771502728240
  }
  ```
  - `total`: 数据库中图片总数。
  - `recent`: 过去 1 小时内新增的图片数量。

---

## 5. 图片代理 (Image Proxy)

由于 R2 存储桶通常不公开，API 提供安全的图片出口。

- **URL**: `GET /image/:type/:filename`
- **参数**:
  - `type`: `raw` 或 `display`。
  - `filename`: `{id}.jpg`。
- **特性**: 
  - 自动注入 `ETag`。
  - 强制 CDN 长效缓存。

---

## 6. 错误代码与限流 (Rate Limiting)

- **429 Too Many Requests**: 每个 IP 地址每分钟限制发起 10 次语义搜索。
- **400 Bad Request**: 缺少 `q` 参数。
- **500 Internal Server Error**: AI 模型推理超时或 D1 数据库连接异常。
