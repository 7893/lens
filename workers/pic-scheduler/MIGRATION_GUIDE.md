# 迁移指南 - 从旧版本到v2.0

## 重大变更

### 架构简化

旧版本使用复杂的多DO架构：
- DownloadTask DO（下载）
- ClassifierDO（分类）
- MigrationDO（迁移）
- RedownloadDO（重新下载）

新版本只使用一个DO：
- PicDO（下载+即时分类）

### 功能变更

#### 已移除
- ❌ 定时任务（Cron）
- ❌ 后台分类器
- ❌ 迁移工具
- ❌ 重新下载功能
- ❌ 重新分类功能
- ❌ 状态管理器

#### 新增/改进
- ✅ 下载原始最大尺寸（urls.raw）
- ✅ 即时AI分类（下载时立即分类）
- ✅ 4个AI模型并行（速度提升4倍）
- ✅ 简化的API
- ✅ 清理数据接口

### API变更

#### 保持不变
- `GET /api/categories` - 获取分类列表
- `GET /api/images?category=xxx` - 获取分类下的图片
- `GET /api/category-stats` - 获取分类统计
- `GET /image/{id}` - 获取图片
- `GET /health` - 健康检查

#### 已移除
- `POST /api/reclassify` - 重新分类
- `POST /api/migrate` - 迁移
- `GET /api/migrate/status` - 迁移状态
- `POST /api/classify/start` - 启动分类器
- `GET /api/classify/status` - 分类器状态
- `POST /api/redownload/start` - 重新下载
- `GET /api/redownload/status` - 重新下载状态
- `POST /cron` - 定时任务

#### 新增
- `POST /api/admin/clear` - 清空所有数据和图片

### 下载流程变更

**旧版本：**
1. 下载图片到 `uncategorized` 文件夹
2. 保存到数据库，标记为 `uncategorized`
3. 后台分类器定期检查
4. 分类后移动文件
5. 更新数据库

**新版本：**
1. 下载图片
2. 立即使用4个AI模型并行分类
3. 直接保存到分类文件夹 `images/{category}/{id}.jpg`
4. 保存到数据库

### 配置变更

**wrangler.toml 变更：**

移除：
```toml
[triggers]
crons = ["0 */6 * * *"]

[[durable_objects.bindings]]
name = "MIGRATION_TASK"
class_name = "MigrationDO"

[[durable_objects.bindings]]
name = "CLASSIFIER_TASK"
class_name = "ClassifierDO"

[[durable_objects.bindings]]
name = "REDOWNLOAD_TASK"
class_name = "RedownloadDO"
```

保留：
```toml
[[durable_objects.bindings]]
name = "DOWNLOAD_TASK"
class_name = "PicDO"
```

## 迁移步骤

### 选项1：全新开始（推荐）

如果你想从零开始，使用新的简化架构：

```bash
# 1. 清空所有数据
export PIC_ADMIN_TOKEN="your_token"
export WORKER_URL="https://your-worker.workers.dev"
./scripts/clear-all.sh

# 2. 部署新版本
npm run deploy

# 3. 开始下载
./scripts/download.sh 30
```

### 选项2：保留现有数据

如果你想保留现有图片：

```bash
# 1. 备份数据库
wrangler d1 export pic-db --output=backup.sql

# 2. 部署新版本
npm run deploy

# 3. 现有图片保持不变，新下载的图片使用新流程
```

**注意：** 旧的 `uncategorized` 图片不会自动分类，需要手动处理或删除。

## 数据库变更

数据库结构保持不变，但不再使用以下表（如果存在）：
- `api_stats`
- `rate_limits`（移到KV）
- 其他临时表

## 环境变量

保持不变：
- `PIC_ADMIN_TOKEN`
- `UNSPLASH_API_KEY`

移除（不再需要）：
- `CRON_DOWNLOAD_COUNT`

## 脚本变更

### 新增脚本
- `scripts/download.sh` - 手动触发下载
- `scripts/clear-all.sh` - 清空所有数据
- `scripts/test-system.sh` - 系统测试

### 移除脚本
- `scripts/migrate-and-fix.js`
- `scripts/batch-migrate.sh`
- `scripts/watch-migration.sh`
- `scripts/monitor-migration.sh`
- `scripts/check-migration-status.sh`
- `scripts/test-migration.sh`
- `scripts/run-migration.js`

## 性能提升

1. **下载速度**：移除了中间步骤，直接下载到目标位置
2. **分类速度**：4个AI模型并行，速度提升4倍
3. **存储效率**：不再需要移动文件，减少R2操作
4. **代码简洁**：代码量减少约60%

## 故障排除

### 问题：部署后无法下载

检查：
1. `UNSPLASH_API_KEY` 是否正确设置
2. `PIC_ADMIN_TOKEN` 是否正确设置
3. wrangler.toml 中的资源ID是否正确

### 问题：AI分类失败

如果所有AI模型都失败，图片会被分类为 `uncategorized`。检查：
1. Cloudflare AI绑定是否正确
2. Worker日志中的错误信息

### 问题：旧图片未分类

旧版本的 `uncategorized` 图片不会自动处理。选项：
1. 手动删除：使用清理脚本
2. 保留：它们仍然可以访问，只是在 `uncategorized` 分类下

## 回滚

如果需要回滚到旧版本：

```bash
# 1. 检出旧版本
git checkout <old-commit>

# 2. 重新部署
npm run deploy
```

## 支持

如果遇到问题，请查看：
1. Worker日志：`npm run tail`
2. 部署检查清单：`DEPLOYMENT_CHECKLIST.md`
3. README：`README.md`
