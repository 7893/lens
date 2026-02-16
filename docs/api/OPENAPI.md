# Pic v6.0 API Reference

Base URL: `https://pic-api.53.workers.dev`

## Endpoints

### 1. Health Check

- **GET** `/health`
- **Response** `200`:
  ```json
  { "status": "healthy", "version": "v6.0.0" }
  ```

### 2. Semantic Search

- **GET** `/api/search?q={query}&limit={limit}`
- **Parameters**:
  - `q` (string, required): natural language query
  - `limit` (integer, optional, default: 20): max results
- **Response** `200`:
  ```json
  {
    "results": [
      {
        "id": "pRFX1RbTsfU",
        "url": "/image/display/pRFX1RbTsfU.jpg",
        "width": 4093,
        "height": 2729,
        "caption": "A bustling city street at night...",
        "tags": [],
        "score": 0.69,
        "photographer": "Tsuyoshi Kozu"
      }
    ],
    "total": 3,
    "page": 1,
    "took": 794
  }
  ```

### 3. Image Details

- **GET** `/api/images/:id`
- **Response** `200`:
  ```json
  {
    "id": "pRFX1RbTsfU",
    "urls": {
      "raw": "/image/raw/pRFX1RbTsfU.jpg",
      "display": "/image/display/pRFX1RbTsfU.jpg"
    },
    "metadata": {
      "photographer": "Tsuyoshi Kozu",
      "location": "Tokyo, Japan",
      "exif": { "make": "Sony", "model": "A7III" }
    },
    "ai": {
      "caption": "A bustling city street at night...",
      "tags": []
    }
  }
  ```

### 4. Image Proxy

- **GET** `/image/:type/:filename`
- `type`: `raw` or `display`
- Returns image binary with `cache-control: public, max-age=31536000`
