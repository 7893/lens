# Pic v6.0 API Reference (OpenAPI)

All APIs are prefixed with `/api`.

Base URL: `https://<your-worker-subdomain>.workers.dev`

## Endpoints

### 1. Search Images

Semantic search for images using natural language queries.

- **Method**: `GET /api/search`
- **Query Parameters**:
  - `q` (string, required): The search query (e.g., "sad rainy day", "cyberpunk city").
  - `limit` (integer, optional): Number of results to return (default: 20).
  - `page` (integer, optional): Pagination offset (default: 1).
- **Response**:
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

### 2. Get Image Details

Retrieve detailed metadata for a specific image.

- **Method**: `GET /api/images/:id`
- **Path Parameters**:
  - `id` (string, required): The image ID (Unsplash ID).
- **Response**:
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

### 3. Trigger Ingestion (Manual)

Manually trigger the ingestion pipeline (requires admin authentication).

- **Method**: `POST /api/admin/trigger`
- **Headers**:
  - `Authorization`: `Bearer <ADMIN_SECRET>`
- **Response**:
  - **Status 202 Accepted**:
    ```json
    {
      "message": "Ingestion triggered successfully",
      "job_id": "job-456"
    }
    ```

### 4. Health Check

Check system status.

- **Method**: `GET /health`
- **Response**:
  - **Status 200 OK**:
    ```json
    {
      "status": "healthy",
      "version": "v6.0.0"
    }
    ```
