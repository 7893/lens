# Pic v6.0 API 参考 (OpenAPI)

所有 API 路径均以 `/api` 为前缀。

基础 URL: `https://<your-worker-subdomain>.workers.dev`

## 接口列表 (Endpoints)

### 1. 语义搜图 (Search Images)

使用自然语言查询进行语义图像搜索。

- **方法**: `GET /api/search`
- **查询参数**:
  - `q` (string, 必填): 搜索关键词 (例如 "sad rainy day", "cyberpunk city")。
  - `limit` (integer, 可选): 返回结果数量 (默认: 20)。
  - `page` (integer, 可选): 分页页码 (默认: 1)。
- **响应**:
  - **Status 200 OK**:
    ```json
    {
      "results": [
        {
          "id": "abc-123",
          "url": "https://r2.pic.app/display/abc-123.jpg",
          "width": 1920,
          "height": 1080,
          "caption": "A futuristic city street at night...",
          "score": 0.85
        }
      ],
      "total": 120,
      "page": 1
    }
    ```

### 2. 获取图片详情 (Get Image Details)

获取指定图片的详细元数据。

- **方法**: `GET /api/images/:id`
- **路径参数**:
  - `id` (string, 必填): 图片 ID (Unsplash ID)。
- **响应**:
  - **Status 200 OK**:
    ```json
    {
      "id": "abc-123",
      "urls": {
        "raw": "https://r2.pic.app/raw/abc-123.jpg",
        "display": "https://r2.pic.app/display/abc-123.jpg"
      },
      "metadata": {
        "photographer": "John Doe",
        "location": "New York, USA",
        "exif": { "camera": "Sony A7III", "iso": 100 }
      },
      "ai_analysis": {
        "tags": ["city", "night", "rain"],
        "caption": "A futuristic city street at night..."
      }
    }
    ```

### 3. 手动触发采集 (Trigger Ingestion)

手动触发数据采集流水线（需要管理员权限）。

- **方法**: `POST /api/admin/trigger`
- **Header**:
  - `Authorization`: `Bearer <ADMIN_SECRET>`
- **响应**:
  - **Status 202 Accepted**:
    ```json
    {
      "message": "Ingestion triggered successfully",
      "job_id": "job-456"
    }
    ```

### 4. 健康检查 (Health Check)

检查系统运行状态。

- **方法**: `GET /health`
- **响应**:
  - **Status 200 OK**:
    ```json
    {
      "status": "healthy",
      "version": "v6.0.0"
    }
    ```
