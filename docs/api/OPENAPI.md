# Lens API Reference

Base URL: `https://lens.53.workers.dev`

## Endpoints

### 1. Health Check

- **GET** `/health`
- **Response** `200`:
  ```json
  { "status": "healthy", "version": "6.0.0" }
  ```

### 2. Semantic Search

- **GET** `/api/search?q={query}`
- **Parameters**:
  - `q` (string, required): natural language query (auto-expanded by LLM for short queries)
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
        "tags": ["city", "night", "street"],
        "score": 0.69,
        "photographer": "Tsuyoshi Kozu",
        "blurHash": "LKO2?U%2Tw=w]~RBVZRi...",
        "color": "#262626",
        "location": "Tokyo, Japan",
        "description": "Busy intersection in Shibuya at night",
        "exif": {
          "camera": "SONY, ILCE-7RM5",
          "aperture": "f/2.8",
          "exposure": "1/100s",
          "focalLength": "28.0mm",
          "iso": 100
        },
        "topics": ["street-photography", "travel"]
      }
    ],
    "total": 100,
    "took": 2300
  }
  ```

### 3. Image Details

- **GET** `/api/images/:id`
- **Response** `200`:
  ```json
  {
    "id": "pRFX1RbTsfU",
    "urls": { "raw": "/image/raw/pRFX1RbTsfU.jpg", "display": "/image/display/pRFX1RbTsfU.jpg" },
    "width": 4093,
    "height": 2729,
    "color": "#262626",
    "blurHash": "LKO2?U%2Tw=w...",
    "description": null,
    "altDescription": "Busy intersection in Shibuya at night",
    "createdAt": "2026-01-15T08:10:26Z",
    "promotedAt": "2026-01-22T00:18:00Z",
    "photographer": {
      "name": "Tsuyoshi Kozu",
      "username": "tsuyoshi",
      "bio": "Street photographer",
      "location": "Tokyo, Japan",
      "profile": "https://unsplash.com/@tsuyoshi",
      "profileImage": "https://images.unsplash.com/profile-...",
      "instagram": "tsuyoshi_photo",
      "twitter": null,
      "portfolio": null,
      "totalPhotos": 352
    },
    "exif": {
      "make": "SONY",
      "model": "ILCE-7RM5",
      "camera": "SONY, ILCE-7RM5",
      "aperture": "f/2.8",
      "exposure": "1/100s",
      "focalLength": "28.0mm",
      "iso": 100
    },
    "location": {
      "name": "Tokyo, Japan",
      "city": "Tokyo",
      "country": "Japan",
      "latitude": 35.6762,
      "longitude": 139.6503
    },
    "topics": ["street-photography", "travel"],
    "stats": { "views": 416317, "downloads": 9522, "likes": 10 },
    "ai": { "caption": "A bustling city street at night...", "tags": ["city", "night", "street", "urban", "lights"] },
    "source": "https://unsplash.com/photos/..."
  }
  ```

### 4. Image Proxy

- **GET** `/image/:type/:filename`
- `type`: `raw` or `display`
- Returns image binary with `cache-control: public, max-age=31536000`
