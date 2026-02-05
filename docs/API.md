# API 文档

## 后端 API (pic-scheduler)

Base URL: `https://pic-scheduler.53.workers.dev`

### 健康检查

```http
GET /health
```

**响应：**
```json
{
  "status": "healthy",
  "timestamp": "2026-02-05T09:00:00.000Z"
}
```

### 获取统计信息

```http
GET /api/stats
```

**响应：**
```json
{
  "total": 100,
  "queue": [
    { "status": "pending", "count": 10 },
    { "status": "downloading", "count": 5 }
  ],
  "cached": true,
  "cacheAge": 15000
}
```

**缓存：** 30 秒

### 手动触发处理

```http
POST /api/trigger
```

**响应：**
```json
{
  "success": true,
  "downloadWorkflowId": "dl-1234567890",
  "classifyWorkflowId": "cl-1234567890",
  "enqueued": 45,
  "skipped": 15,
  "pages": 2,
  "cursor": "2026-02-05T08:00:00.000Z",
  "message": "Photos enqueued and workflows triggered"
}
```

---

## 前端 API (pic-frontend)

Base URL: `https://pic.53.workers.dev`

### 获取照片列表

```http
GET /api/photos?page=1&limit=30&category=landscape
```

**参数：**
- `page` (可选): 页码，默认 1
- `limit` (可选): 每页数量，默认 30
- `category` (可选): 分类过滤

**响应：**
```json
{
  "photos": [
    {
      "unsplash_id": "abc123",
      "r2_key": "landscape/abc123.jpg",
      "ai_category": "landscape",
      "ai_confidence": 0.95,
      "description": "Beautiful mountain view",
      "width": 4000,
      "height": 3000,
      "color": "#2C5F2D",
      "likes": 150,
      "photographer_name": "John Doe",
      "downloaded_at": "2026-02-05T08:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 30
}
```

### 获取详细统计

```http
GET /api/stats
```

**响应：**
```json
{
  "global": {
    "total_photos": 1000,
    "total_categories": 25,
    "total_storage_bytes": 5368709120,
    "total_workflows": 50,
    "successful_workflows": 48,
    "failed_workflows": 2,
    "total_downloads": 1000,
    "successful_downloads": 980,
    "skipped_downloads": 20
  },
  "apiQuota": [
    {
      "api_name": "unsplash",
      "calls_used": 150,
      "quota_limit": 5000,
      "next_reset_at": "2026-02-06T00:00:00.000Z"
    }
  ],
  "categories": [
    {
      "category": "landscape",
      "photo_count": 250
    }
  ],
  "recentWorkflows": [
    {
      "workflow_id": "wf-123",
      "status": "success",
      "page": 1,
      "photos_success": 30,
      "photos_failed": 0,
      "photos_skipped": 0,
      "started_at": "2026-02-05T08:00:00.000Z"
    }
  ]
}
```

### 获取图片

```http
GET /image/{category}/{photo_id}.jpg
```

**示例：**
```
GET /image/landscape/abc123.jpg
```

**响应：**
- Content-Type: `image/jpeg`
- Cache-Control: `public, max-age=31536000`

---

## 错误响应

所有 API 错误遵循统一格式：

```json
{
  "success": false,
  "error": "Error message here"
}
```

**HTTP 状态码：**
- `200` - 成功
- `404` - 资源不存在
- `500` - 服务器错误
