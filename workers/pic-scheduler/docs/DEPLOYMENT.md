# 部署指南

## 前置要求

1. Cloudflare 账号
2. 已安装 Wrangler CLI
3. Unsplash API 密钥
4. Node.js 18+

## 初始设置

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 Secrets

```bash
# 设置 Unsplash API 密钥
wrangler secret put UNSPLASH_API_KEY
# 提示时输入你的密钥

# 设置管理员 token
wrangler secret put PIC_ADMIN_TOKEN
# 提示时输入你的 token
```

### 3. 创建资源

```bash
# 创建 D1 数据库
wrangler d1 create pic-db

# 创建 R2 存储桶
wrangler r2 bucket create pic-r2

# 创建 KV 命名空间
wrangler kv namespace create KV

# 将返回的 ID 更新到 wrangler.toml
```

### 4. 初始化数据库

```bash
# 运行 schema
wrangler d1 execute pic-db --remote --file=./schema.sql
```

### 5. 部署

```bash
wrangler deploy
```

## 生产部署

### 部署命令

```bash
# 部署到生产环境
wrangler deploy

# 部署到特定环境
wrangler deploy --env production
```

### 验证部署

```bash
# 查看日志
wrangler tail --format pretty

# 测试端点
curl https://your-worker.workers.dev/api/categories
```

## 环境配置

### 本地开发 (.dev.vars)

```env
UNSPLASH_API_KEY=your_key
PIC_ADMIN_TOKEN=your_token
```

### 生产环境 (Secrets)

```bash
wrangler secret put UNSPLASH_API_KEY
wrangler secret put PIC_ADMIN_TOKEN
```

### 变量 (wrangler.toml)

```toml
[vars]
CRON_DOWNLOAD_COUNT = 100
```

## 部署后任务

### 1. 验证 Cron 触发器

```bash
# 检查 cron 是否已注册
wrangler deployments list
```

### 2. 手动测试

```bash
# 手动触发下载
curl -X POST https://your-worker.workers.dev/cron \
  -H "X-Admin-Token: your_token"
```

### 3. 监控

```bash
# 查看日志
wrangler tail --format pretty

# 检查数据库
wrangler d1 execute pic-db --remote --command \
  "SELECT COUNT(*) as total FROM downloads"
```

## 回滚

```bash
# 列出部署
wrangler deployments list

# 回滚到之前的版本
wrangler rollback [version-id]
```

## 故障排查

### 问题：Secrets 不工作

```bash
# 列出 secrets
wrangler secret list

# 重新设置 secret
wrangler secret put SECRET_NAME
```

### 问题：找不到数据库

```bash
# 列出数据库
wrangler d1 list

# 检查 wrangler.toml 中的 database_id 是否正确
```

### 问题：Cron 未触发

```bash
# 检查触发器
wrangler triggers

# 手动触发
curl -X POST https://your-worker.workers.dev/cron \
  -H "X-Admin-Token: your_token"
```

## 监控

### 检查状态

```bash
# Worker 日志
wrangler tail

# 数据库统计
wrangler d1 execute pic-db --remote --command \
  "SELECT category, COUNT(*) FROM downloads GROUP BY category"

# R2 使用情况
wrangler r2 bucket info pic-r2
```

### 性能指标

- 检查 Analytics Engine 仪表板
- 监控 Worker CPU 时间
- 跟踪 R2 存储使用
- 监控 API 速率限制

## 扩展

### 增加下载频率

编辑 `wrangler.toml`：
```toml
[triggers]
crons = ["*/30 * * * *"]  # 每 30 分钟
```

### 增加批量大小

编辑 `wrangler.toml`：
```toml
[vars]
CRON_DOWNLOAD_COUNT = 200  # 最多 200
```

### 升级资源

- R2：自动扩展
- D1：联系 Cloudflare 提高限制
- Workers：升级到付费计划以获得更高限制

## 备份

### 数据库备份

```bash
# 导出数据
wrangler d1 export pic-db --remote --output backup.sql

# 恢复
wrangler d1 execute pic-db --remote --file backup.sql
```

### R2 备份

使用 `rclone` 或 Cloudflare 仪表板备份 R2 存储桶。

## 安全最佳实践

1. ✅ 永远不要将 secrets 提交到 git
2. ✅ 使用 `.env.example` 作为模板
3. ✅ 定期轮换 tokens
4. ✅ 使用强随机 tokens（32+ 字节）
5. ✅ 监控访问日志
6. ✅ 保持依赖更新

## 成本估算

**免费套餐：**
- Workers：100,000 请求/天
- R2：10GB 存储，10M 读取/月
- D1：5GB 存储，5M 读取/天
- AI：10,000 neurons/天

**典型使用：**
- 约 2,400 张图片/天
- 约 50GB 存储/月（原图质量）
- R2 存储可能需要付费计划

详见 [Cloudflare 定价](https://www.cloudflare.com/plans/developer-platform/)。
