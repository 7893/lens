# 🚀 立即部署指南

## 当前状态
- ✅ 代码已修改完成
- ✅ 迁移脚本已准备
- ✅ 文档已完善
- ⏳ 等待部署和执行

## 快速部署（3步）

### 步骤1：部署新代码
```bash
cd /home/ubuntu/pic
wrangler deploy
```

**预期输出：**
```
✨ Successfully published your script to
   https://pic.your-domain.workers.dev
```

### 步骤2：验证部署
```bash
# 查看实时日志
wrangler tail

# 在另一个终端触发一次下载测试
curl -X POST "https://pic.your-domain.workers.dev/do/test-task/start" \
  -H "X-Admin-Token: $PIC_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"count": 1}'
```

**观察日志：**
- 应该看到 "Image xxx classified as: xxx"
- 新图片应该保存到正确的分类文件夹

### 步骤3：执行历史数据迁移
```bash
# 设置管理员token（如果还没设置）
export PIC_ADMIN_TOKEN="your-admin-token-here"

# 执行迁移
curl -X POST "https://pic.your-domain.workers.dev/api/migrate" \
  -H "X-Admin-Token: $PIC_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "cleanOrphaned": true,
    "migrate": true,
    "batchSize": 30
  }' | jq '.'
```

**预期时间：** 5-10分钟（792张图片）

## 📊 监控迁移进度

### 实时日志
```bash
wrangler tail --format pretty
```

### 检查进度
```bash
# 每隔30秒检查一次分类分布
watch -n 30 'curl -s "https://pic.your-domain.workers.dev/api/category-stats" | jq ".categoryStats[] | {category, count}" | head -15'
```

## ✅ 验证结果

### 1. 运行一致性检查
```bash
cd /home/ubuntu/pic
node check-consistency.js
```

**期望结果：**
- 分类数量：10-11个（10个标准分类 + uncategorized）
- 路径格式：全部为 `images/{category}/{id}.jpg`
- 孤立记录：0条
- 孤立文件：0个

### 2. 检查分类分布
```bash
wrangler d1 execute pic-db --remote --command "SELECT category, COUNT(*) as count FROM downloads GROUP BY category ORDER BY count DESC"
```

**期望结果：**
```
nature: xxx
architecture: xxx
people: xxx
travel: xxx
...
uncategorized: 0-50（理想情况接近0）
```

### 3. 抽查文件路径
```bash
wrangler d1 execute pic-db --remote --command "SELECT image_id, category, download_url FROM downloads LIMIT 10"
```

**期望结果：**
每条记录的 `download_url` 应该是 `images/{category}/{image_id}.jpg`

## 🔧 如果出现问题

### 问题1：迁移超时
**解决方案：**
```bash
# 减小批次大小，分多次执行
curl -X POST "https://pic.your-domain.workers.dev/api/migrate" \
  -H "X-Admin-Token: $PIC_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"batchSize": 10, "migrate": true}'
```

### 问题2：AI分类失败率高
**解决方案：**
- 检查 Cloudflare AI 配额
- 查看日志中的错误信息
- 可以多次运行迁移（幂等操作）

### 问题3：部分图片仍在uncategorized
**解决方案：**
```bash
# 单独重新分类uncategorized的图片
curl -X POST "https://pic.your-domain.workers.dev/api/reclassify" \
  -H "X-Admin-Token: $PIC_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"category": "uncategorized", "limit": 100}'
```

## 📋 部署后检查清单

- [ ] 新代码已部署
- [ ] 定时任务正常运行
- [ ] 新下载的图片使用新分类逻辑
- [ ] 历史数据迁移完成
- [ ] 分类数量正确（10-11个）
- [ ] 路径格式统一
- [ ] 数据库和R2一致
- [ ] uncategorized数量接近0

## 🎯 成功标准

### 完全成功：
- ✅ 所有图片都有正确的英文分类
- ✅ 路径格式：`images/{category}/{id}.jpg`
- ✅ uncategorized = 0
- ✅ 数据库记录 = R2文件数

### 基本成功：
- ✅ 90%以上图片有正确分类
- ✅ 路径格式统一
- ✅ uncategorized < 50
- ✅ 无孤立数据

## 📞 需要帮助？

如果遇到问题：
1. 查看 `wrangler tail` 日志
2. 运行 `node check-consistency.js` 诊断
3. 检查 Worker 的错误日志
4. 可以安全地多次运行迁移

## 🎉 完成后

迁移成功后，你的系统将：
- 使用标准的10个英文分类
- 所有文件路径统一规范
- 数据库和存储完全一致
- 新图片自动正确分类
- 更易于维护和扩展

---

**准备好了吗？开始部署吧！** 🚀

```bash
cd /home/ubuntu/pic && wrangler deploy
```
