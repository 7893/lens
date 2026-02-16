# API Reference

所有 API 均通过 `pic` Worker 提供。

Base URL: `https://<your-worker-subdomain>.workers.dev`

## 1. Public API (Frontend)

面向用户和浏览器客户端。

### Get Photos

获取图片列表，支持分页和分类筛选。

- **Endpoint**: `GET /api/photos`
- **Query Parameters**:
  - `page` (int, default: 1): 页码。
  - `limit` (int, default: 30): 每页数量。
  - `category` (string, optional): 按 AI 分类筛选（例如 "landscape", "portrait"）。
- **Response**:
```json
{
  "photos": [
    {
      "unsplash_id": "abc12345",
      "r2_key": "landscape/abc12345.jpg",
      "ai_category": "landscape",
      "ai_confidence": 0.98,
      "width": 1920,
      "height": 1080,
      "color": "#F5F5F5",
      "likes": 120,
      "photographer_name": "John Doe",
      "downloaded_at": "2024-02-15T12:00:00Z"
    }
  ],
  "page": 1,
  "limit": 30
}
```

### Get System Stats

获取系统运行状态统计信息。

- **Endpoint**: `GET /api/stats`
- **Response**:
```json
{
  "global": {
    "total_photos": 3500,
    "total_workflows": 150,
    "last_updated": "2024-02-15T12:00:00Z"
  },
  "apiQuota": [
    {
      "api_name": "unsplash",
      "calls_used": 150,
      "quota_limit": 5000,
      "next_reset_at": "2024-02-16T00:00:00Z"
    }
  ],
  "categories": [
    {
      "category": "landscape",
      "photo_count": 1200
    },
    {
      "category": "portrait",
      "photo_count": 800
    }
  ],
  "recentWorkflows": [
    {
      "workflow_id": "wf-123456",
      "status": "success",
      "started_at": "2024-02-15T11:00:00Z",
      "photos_processed": 30
    }
  ]
}
```

### Get Image (Proxy)

获取单张图片的原始内容。

- **Endpoint**: `GET /image/{category}/{photo_id}.jpg`
- **Example**: `/image/landscape/abc12345.jpg`
- **Response Headers**:
  - `Content-Type`: `image/jpeg`
  - `Cache-Control`: `public, max-age=31536000`

---

## 2. Management API (Internal)

主要用于系统监控和手动触发，通常建议在 Worker 路由配置中限制访问（例如通过 header 鉴权，目前实现为公开但隐蔽）。

### Health Check

检查 Worker 服务状态。

- **Endpoint**: `GET /health`
- **Response**:
```json
{
  "status": "healthy",
  "timestamp": "2024-02-15T12:34:56Z"
}
```

### Manual Trigger

手动触发一次图片抓取流程（等同于 Cron 触发）。

- **Endpoint**: `POST /api/trigger`
- **Response**:
```json
{
  "success": true,
  "workflowId": "wf-789012",
  "enqueued": 30,
  "skipped": 5,
  "message": "Photos enqueued and workflow triggered"
}
```
- **Error Response**:
```json
{
  "success": false,
  "error": "Failed to trigger workflow: <error_details>"
}
```

## 3. Error Handling

所有 API 在发生错误时返回统一格式：

- **Status Code**: `4xx` (Client Error) or `5xx` (Server Error)
- **Body**:
```json
{
  "success": false,
  "error": "Description of the error"
}
```
