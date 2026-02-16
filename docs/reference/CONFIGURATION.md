# 配置指南 (Configuration Reference)

本文档详细说明了 Pic 项目的所有配置项，包括环境变量、Wrangler 配置和运行时常量。

## 1. 环境变量 (Secrets)

以下变量需要通过 `wrangler secret put <NAME>` 设置，不会提交到代码库中。

| 变量名 | 必填 | 说明 | 获取方式 |
|--------|------|------|----------|
| `UNSPLASH_API_KEY` | 是 | Unsplash Application Access Key | [Unsplash Developers](https://unsplash.com/developers) |

## 2. Wrangler 配置 (`wrangler.toml`)

位于 `workers/pic-scheduler/wrangler.toml`。

### 核心绑定 (Bindings)

| 绑定名称 | 类型 | 说明 |
|----------|------|------|
| `DB` | D1 Database | 指向 `pic-d1` 数据库，用于存储元数据。 |
| `R2` | R2 Bucket | 指向 `pic-r2` 存储桶，用于存储图片文件。 |
| `AI` | Workers AI | 用于调用 `resnet-50` 或 `vit` 模型进行图片分类。 |
| `PHOTO_WORKFLOW` | Workflow | 指向 `DataPipelineWorkflow` 类，用于任务编排。 |

### 定时任务 (Cron Triggers)

```toml
[triggers]
crons = ["0 * * * *"]
```
- `0 * * * *`: 意味着每小时的第 0 分钟触发一次（即每小时执行一次）。
- **调整建议**：
    - 每 2 小时：`0 */2 * * *`
    - 每天一次：`0 0 * * *`
    - *注意*：Unsplash 免费 API 限制为 50 次/小时，过于频繁的触发可能导致配额耗尽。

### 兼容性 (Compatibility)

```toml
compatibility_date = "2024-10-01"
compatibility_flags = ["nodejs_compat"]
```
- `nodejs_compat`: 启用 Node.js 兼容模式，允许使用部分 Node.js 内置模块。

## 3. 运行时配置 (Runtime Config)

目前部分配置项硬编码在 `src/utils/config.js` 或数据库 `State` 表中（如果有）。

### 默认常量

- **BATCH_SIZE**: `30`
    - 每次 Cron 触发从 Unsplash 获取的图片数量。
- **MAX_PHOTOS_RETENTION**: `4000`
    - 系统保留的最大图片数量。超过此数量时，清理任务会自动删除旧图。
    - *修改方式*：目前需修改代码中的 `cleanupOldData` 函数或更新数据库配置表。

### 数据库配置表 (State Table)

如果启用了 `State` 表，可以通过 SQL 动态更新配置：

```sql
-- 修改最大保留数量为 5000
UPDATE State SET value = '5000' WHERE key = 'max_photos';
```
