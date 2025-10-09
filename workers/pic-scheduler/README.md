# Pic - AI图片分类系统

基于Cloudflare Workers的自动化图片下载和AI分类系统。

## 核心特性

- 从Unsplash下载原始最大尺寸图片
- 使用4个AI模型并行分类（多数投票机制）
- 即时分类并保存到对应文件夹
- 一次请求30张图片
- 简洁高效的架构

## 技术栈

- **Cloudflare Workers** - 无服务器计算平台
- **Cloudflare R2** - 对象存储
- **Cloudflare D1** - SQLite数据库
- **Cloudflare AI** - 4个AI模型并行分类
- **Unsplash API** - 图片来源

## AI模型

系统使用4个AI模型并行分类，通过多数投票选择最终分类：

1. Meta Llama 3 8B
2. Meta Llama 3.1 8B (优化版)
3. Mistral 7B
4. Meta Llama 3.2 3B (轻量版)

## 快速开始

### 1. 环境配置

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 文件，填入你的配置
```

### 2. 创建资源

```bash
# 创建R2存储桶
wrangler r2 bucket create pic-images

# 创建D1数据库
wrangler d1 create pic-db

# 创建KV命名空间
wrangler kv:namespace create "PIC_KV"

# 初始化数据库
wrangler d1 execute pic-db --file=./schema.sql
```

### 3. 更新配置

编辑 `wrangler.toml`，填入你的资源ID。

### 4. 部署

```bash
npm run deploy
```

## 使用方法

### 下载图片

```bash
# 下载30张图片（默认）
./scripts/download.sh

# 下载指定数量
./scripts/download.sh 50
```

### 清空所有数据

```bash
./scripts/clear-all.sh
```

### API接口

#### 查看分类统计
```bash
curl https://your-worker.workers.dev/api/category-stats
```

#### 查看分类列表
```bash
curl https://your-worker.workers.dev/api/categories
```

#### 查看分类下的图片
```bash
curl https://your-worker.workers.dev/api/images?category=nature
```

#### 获取图片
```bash
curl https://your-worker.workers.dev/image/{image_id}
```

## 项目结构

```
pic/
├── src/
│   ├── index.js              # 主入口
│   ├── config.js             # 配置文件
│   ├── middleware/
│   │   └── rate-limiter.js   # 限流中间件
│   └── services/
│       ├── ai-classifier.js  # AI分类服务
│       ├── downloader.js     # 下载管理器
│       ├── task.js           # 任务管理器
│       └── unsplash.js       # Unsplash API
├── public/                   # 静态资源
├── scripts/                  # 工具脚本
├── wrangler.toml            # Cloudflare配置
└── schema.sql               # 数据库结构
```

## 数据库结构

```sql
CREATE TABLE downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id TEXT UNIQUE NOT NULL,
  download_url TEXT NOT NULL,
  author TEXT,
  description TEXT,
  category TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  file_size INTEGER,
  downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 环境变量

- `PIC_ADMIN_TOKEN` - 管理员令牌
- `UNSPLASH_API_KEY` - Unsplash API密钥
- `WORKER_URL` - Worker URL（用于脚本）

## 开发

```bash
# 本地开发
npm run dev

# 部署到生产环境
npm run deploy
```

## 许可证

MIT License
