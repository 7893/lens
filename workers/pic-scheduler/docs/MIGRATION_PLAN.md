# 数据迁移和一致性修复方案

## 📋 问题总结

### 当前问题：
1. **分类混乱** - 27个分类，包含中文、英文、各种格式
2. **路径不一致** - 部分文件路径缺少 `images/` 前缀
3. **数据可能不一致** - 数据库记录和R2文件可能不匹配

### 标准分类（10个）：
- nature（自然）
- architecture（建筑）
- people（人物）
- travel（旅行）
- food（美食）
- technology（科技）
- art（艺术）
- sports（运动）
- business（商务）
- abstract（抽象）
- uncategorized（未分类）

## 🔧 修改内容

### 1. 下载器 (downloader.js)
**新逻辑：**
- 先保存到 `images/uncategorized/{id}.jpg`
- 立即AI分类
- AI失败 → 使用API分类映射
- API也无分类 → 保持uncategorized
- 分类成功 → 移动到 `images/{category}/{id}.jpg`
- 更新数据库记录

### 2. Unsplash服务 (unsplash.js)
**新增方法：** `getEnglishCategory(photo)`
- 将API的topic_submissions映射到标准英文分类
- 例如：`wallpapers` → `abstract`
- 例如：`architecture-interior` → `architecture`

### 3. 任务管理器 (task.js)
- 传递unsplashService到DownloadManager
- 保持其他逻辑不变

### 4. 迁移脚本 (migrate-and-fix.js)
**功能：**
- 检查数据库和R2一致性
- 删除孤立的数据库记录（有记录无文件）
- 删除孤立的R2文件（有文件无记录）
- 批量重新AI分类所有图片
- 移动文件到正确路径
- 更新数据库记录

### 5. API端点 (index.js)
**新增：** `POST /api/migrate`
- 需要管理员token
- 执行完整迁移流程
- 返回详细统计报告

## 📝 执行步骤

### 阶段1：部署新代码（不影响现有数据）
```bash
# 1. 部署更新
wrangler deploy

# 2. 验证新下载功能
# 新下载的图片会自动使用新逻辑
```

### 阶段2：执行历史数据迁移
```bash
# 1. 设置管理员token
export PIC_ADMIN_TOKEN="your-admin-token"

# 2. 调用迁移API
curl -X POST "https://your-worker.workers.dev/api/migrate" \
  -H "X-Admin-Token: $PIC_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cleanOrphaned": true,
    "migrate": true,
    "batchSize": 30
  }'
```

### 阶段3：验证结果
```bash
# 1. 检查分类分布
curl "https://your-worker.workers.dev/api/category-stats"

# 2. 运行一致性检查
node check-consistency.js
```

## ⚠️ 注意事项

### 迁移过程中：
1. **时间** - 792张图片，每批30张，预计需要5-10分钟
2. **R2操作** - 每张图片需要：读取 + 写入 + 删除 = 3次操作
3. **AI调用** - 每张图片调用多个AI模型，可能较慢
4. **Worker限制** - 单次请求可能超时，建议分批执行

### 数据安全：
1. **备份** - 迁移前建议备份D1数据库
2. **可恢复** - R2文件先复制再删除，失败不影响原文件
3. **日志** - 所有操作都有详细日志

### 成本考虑：
- R2操作：792 × 3 = 2,376次操作
- AI推理：792 × 4模型 = 3,168次调用
- 在免费额度内

## 🎯 预期结果

### 迁移后：
- ✅ 所有分类统一为10个标准英文分类
- ✅ 所有文件路径格式：`images/{category}/{id}.jpg`
- ✅ 数据库和R2完全一致
- ✅ 新下载的图片自动正确分类
- ✅ uncategorized文件夹仅作为临时中转

### 分类分布示例：
```
nature: 150张
architecture: 120张
people: 100张
travel: 90张
abstract: 80张
art: 70张
food: 60张
business: 50张
technology: 40张
sports: 32张
uncategorized: 0张（理想状态）
```

## 🚀 快速开始

```bash
# 1. 部署新代码
cd /home/ubuntu/pic
wrangler deploy

# 2. 测试新下载（会使用新逻辑）
# 访问你的worker触发一次cron或手动下载

# 3. 执行迁移（需要管理员权限）
# 使用上面的curl命令或通过API调用

# 4. 验证结果
node check-consistency.js
```

## 📞 问题排查

### 如果迁移失败：
1. 检查Worker日志：`wrangler tail`
2. 查看错误信息
3. 可以多次执行迁移（幂等操作）
4. 分批执行：减小batchSize

### 如果分类不准确：
1. 调整AI分类器的prompt
2. 修改fallback关键词映射
3. 手动调用 `/api/reclassify` 重新分类特定分类

## ✅ 验收标准

- [ ] 数据库只有10个标准分类（+uncategorized）
- [ ] 所有路径格式统一
- [ ] 数据库记录数 = R2文件数
- [ ] 新下载图片自动正确分类
- [ ] uncategorized文件夹为空或接近空
