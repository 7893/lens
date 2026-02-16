# API Reference

Base URL: `https://pic.<subdomain>.workers.dev`

## Public Endpoints

### `GET /`

Returns the HTML frontend page.

### `GET /api/photos`

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `limit` | int | 30 | Items per page |
| `category` | string | — | Filter by AI category |

Response:
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
      "downloaded_at": "2026-02-15T12:00:00Z"
    }
  ],
  "page": 1,
  "limit": 30
}
```

### `GET /api/stats`

Returns system statistics.

```json
{
  "global": {
    "id": 1,
    "total_photos": 77,
    "total_storage_bytes": 5046041184,
    "total_categories": 61,
    "total_workflows": 8,
    "successful_workflows": 7,
    "failed_workflows": 1,
    "total_downloads": 90,
    "successful_downloads": 74,
    "skipped_downloads": 3,
    "updated_at": "2026-02-15T10:00:37.150Z"
  },
  "apiQuota": [
    {
      "api_name": "unsplash",
      "calls_used": 1,
      "quota_limit": 50,
      "next_reset_at": "2026-02-16T09:00:04.657Z",
      "updated_at": "2026-02-16T08:00:05.606Z"
    }
  ],
  "categories": [
    { "category": "landscape", "photo_count": 13, "updated_at": "..." }
  ],
  "recentWorkflows": [
    {
      "id": "wf-1771149628063",
      "page": 1,
      "status": "success",
      "photos_success": 2,
      "photos_failed": 0,
      "photos_skipped": 0,
      "started_at": "2026-02-15T10:00:36.980Z",
      "completed_at": "2026-02-15T10:00:36.980Z"
    }
  ]
}
```

### `GET /image/{category}/{photo_id}.jpg`

Proxies image from R2. Returns `image/jpeg` with 1-year cache.

### `GET /health`

```json
{
  "status": "healthy",
  "timestamp": "2026-02-16T08:24:03.260Z"
}
```

### `POST /api/trigger`

Manually trigger the photo pipeline (same as cron).

```json
{
  "success": true,
  "message": "Workflow triggered"
}
```

## Error Format

All errors return:
```json
{
  "success": false,
  "error": "Description of the error"
}
```
