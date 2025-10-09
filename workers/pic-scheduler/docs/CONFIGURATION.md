# 配置指南

本文档详细说明如何配置 Pic 项目的所有环境变量和 Cloudflare 资源。

## 🔐 机密信息管理

**重要原则：所有机密信息必须通过环境变量管理，绝不写入代码！**

### 本地开发环境

本地开发使用 `.dev.vars` 文件（已在 `.gitignore` 中排除）：

```bash
# 1. 复制模板
cp .env.example .dev.vars

# 2. 编辑配置
nano .dev.vars
```

`.dev.vars` 内容：
```env
# Unsplash API 配置
UNSPLASH_API_KEY=your_unsplash_api_key_here

# 管理员认证 Token
PIC_ADMIN_TOKEN=your_secure_random_token_here
```

### 生产环境

生产环境使用 Cloudflare Secrets（加密存储）：

```bash
# 设置 Unsplash API Key
wrangler secret put UNSPLASH_API_KEY
# 提示输入后粘贴你的 API Key

# 设置管理员 Token
wrangler secret put PIC_ADMIN_TOKEN
# 提示输入后粘贴你的 Token
```

**查看已设置的 Secrets：**
```bash
wrangler secret list
```

**删除 Secret：**
```bash
wrangler secret delete SECRET_NAME
```

## 📋 环境变量说明

### 必需变量

| 变量名 | 说明 | 获取方式 | 示例 |
|--------|------|----------|------|
| `UNSPLASH_API_KEY` | Unsplash API 访问密钥 | [Unsplash Developers](https://unsplash.com/developers) | `abc123...` |
| `PIC_ADMIN_TOKEN` | 管理接口认证 Token | `openssl rand -hex 32` | `3896b0674f...` |

### 可选变量

| 变量名 | 说明 | 默认值 | 配置位置 |
|--------|------|--------|----------|
| `CRON_DOWNLOAD_COUNT` | 每小时下载图片数量 | 100 | `wrangler.toml` |

## 🔑 获取 Unsplash API Key

1. 访问 [Unsplash Developers](https://unsplash.com/developers)
2. 点击 "Register as a developer"
3. 创建新应用（New Application）
4. 填写应用信息：
   - Application name: `Pic Gallery`
   - Description: `AI-powered image gallery`
5. 同意条款后提交
6. 在应用详情页找到 "Access Key"
7. 复制 Access Key 作为 `UNSPLASH_API_KEY`

**API 限制：**
- Demo 模式：50 请求/小时
- Production 模式：5000 请求/小时（需申请）

## 🔐 生成管理员 Token

使用 OpenSSL 生成安全的随机 Token：

```bash
# 生成 32 字节（64 字符）的十六进制 Token
openssl rand -hex 32
```

输出示例：
```
3896b0674fc7b7906ab067cff75ffed161fe955a7f1052fb9126ff7400708a31
```

将此 Token 设置为 `PIC_ADMIN_TOKEN`。

## ☁️ Cloudflare 资源配置

### 1. D1 数据库

```bash
# 创建数据库
wrangler d1 create pic-db

# 输出示例：
# ✅ Successfully created DB 'pic-db'
# database_id = "a4830c70-3eae-463a-b879-e1ae438c4b81"
```

将 `database_id` 更新到 `wrangler.toml`：
```toml
[[d1_databases]]
binding = "DB"
database_name = "pic-db"
database_id = "a4830c70-3eae-463a-b879-e1ae438c4b81"  # 替换为你的 ID
```

初始化数据库：
```bash
wrangler d1 execute pic-db --file=./schema.sql
```

### 2. R2 存储桶

```bash
# 创建 R2 存储桶
wrangler r2 bucket create pic-r2

# 输出示例：
# ✅ Created bucket 'pic-r2'
```

更新 `wrangler.toml`：
```toml
[[r2_buckets]]
binding = "R2"
bucket_name = "pic-r2"  # 使用你的存储桶名称
```

### 3. KV 命名空间

```bash
# 创建 KV 命名空间
wrangler kv:namespace create KV

# 输出示例：
# ✅ Created namespace with id "8501848889124d2581e7d9009fe936e7"
```

更新 `wrangler.toml`：
```toml
[[kv_namespaces]]
binding = "KV"
id = "8501848889124d2581e7d9009fe936e7"  # 替换为你的 ID
```

### 4. Analytics Engine

```bash
# 创建 Analytics Engine 数据集
wrangler analytics-engine create pic-ae

# 输出示例：
# ✅ Created Analytics Engine dataset 'pic-ae'
```

更新 `wrangler.toml`：
```toml
[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "pic-ae"  # 使用你的数据集名称
```

### 5. Workers AI

Workers AI 无需单独创建，但需要 **Workers Paid 计划**（$5/月）。

在 `wrangler.toml` 中配置：
```toml
[ai]
binding = "AI"
```

## 📝 wrangler.toml 完整配置

```toml
name = "pic"
main = "src/index.js"
compatibility_date = "2025-01-01"

[vars]
CRON_DOWNLOAD_COUNT = 100

[assets]
binding = "ASSETS"
directory = "./public"

# Secrets (使用 wrangler secret put 设置)
# - UNSPLASH_API_KEY
# - PIC_ADMIN_TOKEN

[triggers]
crons = ["0 * * * *"]  # 每小时执行一次

[[kv_namespaces]]
binding = "KV"
id = "your_kv_namespace_id"  # 替换

[[d1_databases]]
binding = "DB"
database_name = "pic-db"
database_id = "your_d1_database_id"  # 替换

[[r2_buckets]]
binding = "R2"
bucket_name = "pic-r2"

[[durable_objects.bindings]]
name = "DOWNLOAD_TASK"
class_name = "PicDO"

[[durable_objects.bindings]]
name = "MIGRATION_TASK"
class_name = "MigrationDO"

[[durable_objects.bindings]]
name = "CLASSIFIER_TASK"
class_name = "ClassifierDO"

[[durable_objects.bindings]]
name = "REDOWNLOAD_TASK"
class_name = "RedownloadDO"

[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "pic-ae"

[ai]
binding = "AI"

# Durable Objects 迁移历史
[[migrations]]
tag = "v1"
new_sqlite_classes = ["ImgTask"]

[[migrations]]
tag = "v2"
renamed_classes = [{from = "ImgTask", to = "PicTask"}]

[[migrations]]
tag = "v3"
renamed_classes = [{from = "PicTask", to = "Pic"}]

[[migrations]]
tag = "v4"
renamed_classes = [{from = "Pic", to = "PicDO"}]

[[migrations]]
tag = "v5"
new_sqlite_classes = ["MigrationDO"]

[[migrations]]
tag = "v6"
new_sqlite_classes = ["ClassifierDO"]

[[migrations]]
tag = "v7"
new_sqlite_classes = ["RedownloadDO"]
```

## 🔍 验证配置

### 检查本地配置

```bash
# 检查 .dev.vars 是否存在
ls -la .dev.vars

# 验证 wrangler.toml 语法
wrangler deploy --dry-run
```

### 检查生产配置

```bash
# 列出所有 Secrets
wrangler secret list

# 检查 D1 数据库
wrangler d1 list

# 检查 R2 存储桶
wrangler r2 bucket list

# 检查 KV 命名空间
wrangler kv:namespace list
```

### 测试配置

```bash
# 本地测试
wrangler dev

# 访问 http://localhost:8787
# 检查是否能正常加载页面

# 测试管理接口（需要 Token）
curl -X POST http://localhost:8787/api/migrate \
  -H "X-Admin-Token: your_token"
```

## ⚠️ 安全注意事项

1. **永远不要提交机密信息到 Git**
   - `.dev.vars` 已在 `.gitignore` 中
   - 检查：`git status` 不应显示 `.dev.vars`

2. **定期轮换 Token**
   ```bash
   # 生成新 Token
   openssl rand -hex 32
   
   # 更新 Secret
   wrangler secret put PIC_ADMIN_TOKEN
   ```

3. **限制 API Key 权限**
   - Unsplash API Key 仅用于读取
   - 不要共享 Admin Token

4. **监控 API 使用**
   ```bash
   # 查看 Unsplash API 使用情况
   # 访问 https://unsplash.com/oauth/applications/YOUR_APP_ID
   ```

## 🆘 常见问题

### Q: 忘记了 Admin Token 怎么办？

A: 重新生成并设置：
```bash
openssl rand -hex 32
wrangler secret put PIC_ADMIN_TOKEN
```

### Q: Unsplash API 超出限制怎么办？

A: 
1. 检查当前使用量：访问 Unsplash 开发者控制台
2. 申请 Production 访问（5000 请求/小时）
3. 或降低 `CRON_DOWNLOAD_COUNT` 值

### Q: 如何在多个环境使用不同配置？

A: 使用 wrangler 环境：
```toml
[env.staging]
name = "pic-staging"
vars = { CRON_DOWNLOAD_COUNT = 10 }

[env.production]
name = "pic-production"
vars = { CRON_DOWNLOAD_COUNT = 100 }
```

部署：
```bash
wrangler deploy --env staging
wrangler deploy --env production
```

## 📚 相关文档

- [Wrangler 配置文档](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Cloudflare Secrets 管理](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Unsplash API 文档](https://unsplash.com/documentation)
