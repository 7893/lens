# 前端架构设计说明书 (Frontend Architecture Design)

**适用范围**: Pic Web 端 (Cloudflare Pages)
**技术栈**: React 18 + Vite + Tailwind CSS + SWR

## 1. 技术选型 (Tech Stack Strategy)

我们追求的是**轻量级、高性能、易部署**。

| 模块 | 选型建议 | 架构师理由 (Rationale) |
| --- | --- | --- |
| **框架** | **React + Vite** | 生态最成熟，Vite 构建速度极快，适配 Cloudflare Pages。 |
| **样式** | **Tailwind CSS** | 原子化 CSS，开发效率高，且构建产物极小（Tree-shaking）。 |
| **UI 组件库** | **shadcn/ui** | (基于 Radix UI) 并不是一个 npm 包，而是复制代码到项目中。**非常适合我们这种需要深度定制（如瀑布流、图片详情模态框）的项目**，没有黑盒依赖。 |
| **状态/请求** | **SWR (Vercel)** | **核心选型**。我们需要轮询 Dashboard 状态，且需要缓存搜索结果。SWR (Stale-While-Revalidate) 是处理 Server State 的神器。 |
| **图标** | **Lucide React** | 轻量、风格统一的 SVG 图标库。 |
| **路由** | **React Router v6** | 标准路由管理。 |

---

## 2. 核心页面与组件架构 (Component Architecture)

前端主要包含三个核心视图，我们需要明确它们的数据流向。

### 2.1 公共画廊 (The Gallery View) - `/`

这是首页，核心是**性能**。

* **布局算法**: 使用 **Masonry Layout (瀑布流)**。
    * *注意*: 不要使用等高布局，因为我们的图片有横有竖。推荐使用 `react-masonry-css` 或纯 CSS `columns` 方案。
* **图片加载策略**:
    * **源 (Source)**: 必须加载 R2 的 `/display` 目录 (500KB)，**严禁**直接加载 `/raw` (50MB)。
    * **懒加载 (Lazy Load)**: 必须实现。屏幕外的图片不加载。
    * **预加载 (Preconnect)**: 在 `<head>` 中添加 `<link rel="preconnect" href="https://assets.yourdomain.com">`，加速 R2 连接建立。
* **搜索交互**:
    * **防抖 (Debounce)**: 用户输入 "Cyberpunk" 时，不要每敲一个字母就调一次 API。设置 500ms 的防抖，保护后端 Vectorize 资源。

### 2.2 图片详情模态框 (The Detail Modal) - `/image/:id`

当用户点击瀑布流中的图片时，弹出此层。

* **数据展示**:
    * **左侧**: 图片预览 (依然使用 `/display` 版本，但显示得更大)。
    * **右侧**: 元数据面板 (Metadata Panel)。
        * *EXIF*: 相机、光圈、ISO (从 D1 的 `meta_json` 解析)。
        * *AI*: 显示生成的 Caption 和 Tags。
        * *Location*: 显示拍摄地（如有）。
* **核心功能**: **下载原图 (Download RAW)**。
    * *动作*: 点击按钮 -> 浏览器请求 R2 的 `/raw/{id}.jpg`。
    * *体验*: 这是一个 50MB 的文件，按钮上应该显示“Loading”或“Downloading”状态。

### 2.3 仪表盘 (The Dashboard) - `/admin`

这是给管理员（你）看的“驾驶舱”。

* **数据源**: 调用 Worker 的 `/api/stats` 接口。
* **实时性**: 使用 SWR 的 `refreshInterval: 5000` (5秒轮询)。
* **关键指标 (KPIs)**:
    * **Unsplash Quota**: 用 **进度条** 展示 (e.g., 20/50)。如果 < 5，显示红色警告。
    * **Ingestion Status**: 显示最近一次 Cron 任务的日志（成功/失败/抓取数量）。
    * **Storage**: R2 估算用量。

---

## 3. 数据接口规范 (API Contract)

前端开发者（或者写前端代码时的你）需要严格遵守此约定。

### 3.1 搜索接口

* **Endpoint**: `GET /api/search?q={query}`
* **Response**:
```json
{
  "results": [
    {
      "id": "img_001",
      "display_url": "https://assets.pic.com/display/img_001.jpg",
      "width": 4000,
      "height": 6000,
      "ai_caption": "A rainy night in Tokyo...",
      "score": 0.89  // 向量相似度分数
    }
  ]
}
```

### 3.2 统计接口

* **Endpoint**: `GET /api/stats`
* **Response**:
```json
{
  "system": {
    "api_remaining": 42,
    "api_reset_time": 1715000000,
    "last_cron_run": "2024-05-06T10:00:00Z"
  },
  "storage": {
    "total_images": 1250,
    "raw_size_gb": 35.2
  }
}
```

---

## 4. 目录结构规范 (Directory Structure)

保持整洁，方便维护。

```text
apps/web/
├── public/
├── src/
│   ├── components/
│   │   ├── ui/          # shadcn 通用组件 (Button, Card, Input)
│   │   ├── gallery/     # 业务组件 (MasonryGrid, ImageCard)
│   │   └── admin/       # 后台组件 (StatsCard, LogViewer)
│   ├── hooks/
│   │   └── use-search.ts # 封装 SWR 的搜索逻辑
│   ├── lib/
│   │   └── utils.ts     # 工具函数 (CN, DateFormatter)
│   ├── pages/
│   │   ├── Home.tsx
│   │   └── Dashboard.tsx
│   ├── App.tsx
│   └── main.tsx
├── package.json
└── vite.config.ts
```

---

## 5. 部署与安全 (Deployment & Security)

### 5.1 部署流程

* **平台**: Cloudflare Pages。
* **配置**:
    * Build command: `npm run build`
    * Output directory: `dist`
* **绑定**: 建议在 Pages 设置中绑定自定义域名 `pic.yourdomain.com`。

### 5.2 安全建议 (Security Note)

* **Dashboard 保护**:
    * 虽然是个人项目，但不要让全世界都能看到你的 API 配额和后台日志。
    * **方案**: 使用 **Cloudflare Access** (Zero Trust)。
    * **配置**: 在 Cloudflare Dash 面板中，为 `pic.yourdomain.com/admin` 路径设置一个 Access Policy，只允许你的邮箱（One-time PIN）访问。**零代码，绝对安全。**
