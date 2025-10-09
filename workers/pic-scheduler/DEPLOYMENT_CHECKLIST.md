# 部署检查清单

## 重构完成 ✅

项目已完全重构，以下是主要变更：

### 已移除的功能
- ❌ 定时器（Cron）
- ❌ 重新下载逻辑（RedownloadDO）
- ❌ 迁移逻辑（MigrationDO）
- ❌ 独立分类器（ClassifierDO）
- ❌ 重新分类功能
- ❌ 状态管理器
- ❌ 分析服务

### 新的核心功能
- ✅ 下载原始最大尺寸图片（urls.raw）
- ✅ 一次请求30张图片
- ✅ 即时AI分类（4个模型并行）
- ✅ 直接保存到分类文件夹
- ✅ 简化的架构

### 保留的功能
- ✅ 图片浏览API
- ✅ 分类统计API
- ✅ 限流保护
- ✅ 管理员认证
- ✅ 健康检查

## 部署前准备

### 1. 清空现有数据（可选）

如果你想从零开始：

```bash
# 设置环境变量
export PIC_ADMIN_TOKEN="your_admin_token"
export WORKER_URL="https://your-worker.workers.dev"

# 运行清理脚本
./scripts/clear-all.sh
```

### 2. 更新wrangler.toml

确保以下配置正确：

```toml
[[d1_databases]]
binding = "DB"
database_name = "pic-db"
database_id = "YOUR_D1_DATABASE_ID"  # 替换为你的D1数据库ID

[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID"  # 替换为你的KV命名空间ID
```

### 3. 设置环境变量

在Cloudflare Workers设置中添加：

- `PIC_ADMIN_TOKEN` - 管理员令牌
- `UNSPLASH_API_KEY` - Unsplash API密钥

### 4. 部署

```bash
npm run deploy
```

## 使用新系统

### 下载图片

```bash
# 下载30张图片（默认）
./scripts/download.sh

# 下载50张图片
./scripts/download.sh 50
```

### 查看统计

```bash
curl https://your-worker.workers.dev/api/category-stats
```

### 查看分类

```bash
curl https://your-worker.workers.dev/api/categories
```

### 查看某个分类的图片

```bash
curl https://your-worker.workers.dev/api/images?category=nature
```

## 架构说明

### 下载流程

1. 从Unsplash API获取30张图片
2. 对每张图片：
   - 下载原始尺寸（urls.raw）
   - 使用4个AI模型并行分类
   - 多数投票决定最终分类
   - 保存到 `images/{category}/{image_id}.jpg`
   - 记录到数据库

### AI分类

使用4个模型并行调用，速度提升4倍：
- Meta Llama 3 8B
- Meta Llama 3.1 8B (优化版)
- Mistral 7B
- Meta Llama 3.2 3B (轻量版)

### 文件结构

```
R2存储桶:
images/
  ├── nature/
  │   ├── abc123.jpg
  │   └── def456.jpg
  ├── architecture/
  │   └── ghi789.jpg
  └── portrait/
      └── jkl012.jpg
```

## 注意事项

1. **无定时器**：需要手动触发下载
2. **即时分类**：下载时立即分类，无需后续处理
3. **原始尺寸**：下载最大尺寸图片，文件较大
4. **速率限制**：Unsplash API每小时50次请求

## 故障排除

### 下载失败

检查：
- Unsplash API密钥是否正确
- 是否超过API限制
- Worker日志中的错误信息

### AI分类失败

如果所有AI模型都失败，图片会被分类为 `uncategorized`

### 查看日志

```bash
npm run tail
```
