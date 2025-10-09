# API 文档

Pic 项目的完整 API 接口文档。

## 基础信息

- **基础 URL**: `https://your-worker.workers.dev`
- **认证方式**: 管理接口需要 `X-Admin-Token` 请求头
- **响应格式**: JSON

## 公开端点

### GET /

首页，返回 HTML 页面。

### GET /api/categories

获取所有图片分类列表。

**查询参数：**
- `page` (可选): 页码，默认 1
- `limit` (可选): 每页数量，默认 20

**响应示例：**
```json
{
  "categories": [
    { "category": "landscape", "count": 150 },
    { "category": "portrait", "count": 120 }
  ],
  "totalPages": 5,
  "currentPage": 1
}
```

### GET /api/images

获取指定分类的图片列表。

**查询参数：**
- `category` (必需): 分类名称
- `page` (可选): 页码，默认 1
- `limit` (可选): 每页数量，默认 18

**响应示例：**
```json
{
  "images": [
    {
      "image_id": "abc123",
      "author": "John Doe",
      "description": "Beautiful sunset",
      "width": 4000,
      "height": 3000
    }
  ],
  "totalPages": 10,
  "currentPage": 1
}
```

### GET /image/{id}

获取图片文件。

**参数：**
- `id`: 图片 ID

**响应：** 图片二进制数据（JPEG）

### GET /api/category-stats

获取分类统计信息。

**响应示例：**
```json
{
  "success": true,
  "categoryStats": [
    {
      "category": "landscape",
      "count": 150,
      "total_size": 750000000,
      "avg_width": 4000,
      "avg_height": 3000
    }
  ],
  "totalStats": {
    "total_images": 808,
    "total_size": 4000000000,
    "total_categories": 168
  }
}
```

## 管理端点

所有管理端点都需要在请求头中包含 `X-Admin-Token`。

### POST /api/migrate

启动数据迁移任务。

**请求头：**
```
X-Admin-Token: your_admin_token
```

**请求体（可选）：**
```json
{
  "batchSize": 1
}
```

**响应示例：**
```json
{
  "success": true,
  "message": "Migration started"
}
```

### GET /api/migrate/status

获取迁移任务状态。

**请求头：**
```
X-Admin-Token: your_admin_token
```

**响应示例：**
```json
{
  "running": true,
  "processed": 50,
  "total": 100,
  "progress": "50%"
}
```

### POST /api/classify/start

启动后台 AI 分类任务。

**请求头：**
```
X-Admin-Token: your_admin_token
```

**响应示例：**
```json
{
  "success": true,
  "message": "Background classification started"
}
```

### GET /api/classify/status

获取分类任务状态。

**请求头：**
```
X-Admin-Token: your_admin_token
```

**响应示例：**
```json
{
  "running": true,
  "classified": 100,
  "failed": 5
}
```

### POST /api/redownload/start

启动批量重下载任务（原图质量）。

**请求头：**
```
X-Admin-Token: your_admin_token
```

**响应示例：**
```json
{
  "success": true,
  "message": "Redownload task started"
}
```

### GET /api/redownload/status

获取重下载任务状态。

**请求头：**
```
X-Admin-Token: your_admin_token
```

**响应示例：**
```json
{
  "running": true,
  "processed": 200,
  "total": 808
}
```

### GET /cron

手动触发 cron 下载任务。

**请求头：**
```
X-Admin-Token: your_admin_token
```

**响应示例：**
```json
{
  "success": true,
  "message": "Cron task executed",
  "result": {
    "downloaded": 100
  }
}
```

### POST /api/reclassify

重新分类指定数量的图片。

**请求头：**
```
X-Admin-Token: your_admin_token
```

**请求体（可选）：**
```json
{
  "limit": 50,
  "category": "uncategorized"
}
```

**响应示例：**
```json
{
  "success": true,
  "results": {
    "processed": 50,
    "reclassified": 45,
    "failed": 5
  }
}
```

## 错误响应

所有错误响应遵循以下格式：

```json
{
  "success": false,
  "error": "Error message"
}
```

**常见错误码：**
- `400` - 请求参数错误
- `401` - 未授权（缺少或无效的 admin token）
- `404` - 资源不存在
- `500` - 服务器内部错误

## 使用示例

### 获取分类列表

```bash
curl https://your-worker.workers.dev/api/categories
```

### 获取特定分类的图片

```bash
curl "https://your-worker.workers.dev/api/images?category=landscape&page=1&limit=20"
```

### 启动迁移（需要管理员权限）

```bash
curl -X POST https://your-worker.workers.dev/api/migrate \
  -H "X-Admin-Token: your_admin_token_here" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 1}'
```

### 检查迁移状态

```bash
curl https://your-worker.workers.dev/api/migrate/status \
  -H "X-Admin-Token: your_admin_token_here"
```

### 手动触发下载

```bash
curl https://your-worker.workers.dev/cron \
  -H "X-Admin-Token: your_admin_token_here"
```

## 速率限制

- **Unsplash API**: 50 请求/小时（Demo 模式）
- **管理端点**: 无限制（但需要认证）
- **公开端点**: 受 Cloudflare Workers 限制保护

## 注意事项

1. 所有时间戳使用 UTC 时区
2. 图片 URL 有效期为 1 年（Cache-Control）
3. 管理 Token 应妥善保管，不要泄露
4. 分类名称只包含小写字母、数字和连字符
5. 文件大小单位为字节

## 相关文档

- [配置指南](CONFIGURATION.md)
- [部署指南](DEPLOYMENT.md)
- [安全最佳实践](SECURITY.md)
