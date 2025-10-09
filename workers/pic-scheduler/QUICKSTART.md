# 快速开始指南

## 5分钟部署Pic系统

### 前置要求

- Cloudflare账号
- Node.js 18+
- Unsplash API密钥

### 步骤1：克隆并安装

```bash
cd /home/ubuntu/pic
npm install
```

### 步骤2：创建Cloudflare资源

```bash
# 创建R2存储桶
wrangler r2 bucket create pic-images

# 创建D1数据库
wrangler d1 create pic-db

# 创建KV命名空间
wrangler kv:namespace create "PIC_KV"
```

记录输出的ID。

### 步骤3：初始化数据库

```bash
# 替换 YOUR_D1_DATABASE_ID 为你的数据库ID
wrangler d1 execute pic-db --file=./schema.sql
```

### 步骤4：配置

编辑 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "pic-db"
database_id = "YOUR_D1_DATABASE_ID"  # 替换这里

[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"  # 替换这里
```

### 步骤5：设置环境变量

在Cloudflare Workers设置中添加：

```bash
# 在Cloudflare Dashboard中设置
PIC_ADMIN_TOKEN=your_secure_random_token_here
UNSPLASH_API_KEY=your_unsplash_access_key
```

或使用命令行：

```bash
wrangler secret put PIC_ADMIN_TOKEN
wrangler secret put UNSPLASH_API_KEY
```

### 步骤6：部署

```bash
npm run deploy
```

### 步骤7：测试

```bash
# 设置本地环境变量
export PIC_ADMIN_TOKEN="your_token"
export WORKER_URL="https://pic.your-subdomain.workers.dev"

# 运行测试
./scripts/test-system.sh
```

### 步骤8：下载图片

```bash
# 下载30张图片
./scripts/download.sh 30
```

### 步骤9：查看结果

```bash
# 查看分类统计
curl https://pic.your-subdomain.workers.dev/api/category-stats

# 查看分类列表
curl https://pic.your-subdomain.workers.dev/api/categories

# 查看某个分类的图片
curl https://pic.your-subdomain.workers.dev/api/images?category=nature
```

## 常用命令

### 下载图片
```bash
./scripts/download.sh 30  # 下载30张
./scripts/download.sh 50  # 下载50张
```

### 查看统计
```bash
curl $WORKER_URL/api/category-stats | jq '.'
```

### 清空数据
```bash
./scripts/clear-all.sh
```

### 查看日志
```bash
npm run tail
```

### 本地开发
```bash
npm run dev
```

## 故障排除

### 问题：部署失败

检查：
- wrangler.toml 中的ID是否正确
- 是否有权限访问Cloudflare资源

### 问题：下载失败

检查：
- UNSPLASH_API_KEY 是否正确
- PIC_ADMIN_TOKEN 是否正确
- 查看Worker日志：`npm run tail`

### 问题：AI分类失败

检查：
- Cloudflare AI绑定是否正确
- 查看Worker日志中的错误信息

## 下一步

- 阅读 [README.md](README.md) 了解详细功能
- 查看 [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) 了解部署细节
- 阅读 [MIGRATION_GUIDE.md](MIGRATION_GUIDE.md) 如果从旧版本升级

## 获取帮助

- 查看Worker日志：`npm run tail`
- 检查健康状态：`curl $WORKER_URL/health`
- 运行测试脚本：`./scripts/test-system.sh`

## 完成！🎉

你的Pic系统现在已经运行了！享受AI驱动的图片分类吧！
