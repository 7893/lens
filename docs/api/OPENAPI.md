# Lens v6.0 API 参考 (OpenAPI)

所有 API 路径均以 `/api` 为前缀。

基础 URL: `https://<your-worker-subdomain>.workers.dev`

## 接口列表 (Endpoints)

### 1. 语义搜图 (Search Images)

核心检索接口，包含 AI 查询扩展与结果重排。

- **方法**: `GET /api/search`
- **查询参数**:
  - `q` (string, 必填): 搜索关键词。支持自然语言。
  - `limit` (integer, 可选): 返回数量 (默认 20)。
- **智能增强逻辑**:
  - **自动翻译**: 非英文查询会自动翻译。
  - **视觉扩展**: 简短词（如 "cat"）会被扩展为视觉丰富词。
  - **LLM 重排**: 结果经过 Llama 3.2 的相关性验证。
- **响应示例**:
  ```json
  {
    "results": [
      {
        "id": "abc-123",
        "url": "/image/display/abc-123.jpg",
        "caption": "A detailed description...",
        "score": 0.99,
        "exif": { "camera": "Sony A7III" }
      }
    ],
    "total": 100,
    "took": 450
  }
  ```

### 2. 获取最新图片 (Latest Gallery)

用于首页默认展示，按入库时间倒序排列。

- **方法**: `GET /api/latest`
- **响应**: 返回最近入库的 100 张图片列表。

### 3. 获取图片详情 (Get Image Details)

获取指定图片的完整元数据（包含 EXIF、Location、RAW 链接）。

- **方法**: `GET /api/images/:id`

### 4. 系统统计 (System Stats)

- **方法**: `GET /api/stats`
- **返回**: 包含图片总数 (`total`) 和过去 1 小时新增数量 (`recent`)。

---

## 缓存策略 (Caching)

- **搜索缓存**: 相同查询词的结果会在边缘节点缓存 10 分钟。
- **图片代理**: R2 代理接口 (`/image/*`) 会返回 `immutable` 头部，浏览器端长效缓存。

## 错误处理

- **429 Too Many Requests**: 搜索接口对单个 IP 限制为 10 次/分。
- **500 Internal Server Error**: AI 模型调用超时或 D1 数据库异常。
