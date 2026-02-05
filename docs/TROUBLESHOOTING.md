# 故障排查指南

## 常见问题

### 1. Workflow 执行失败

**症状：**
```
Error: Workflow execution failed
```

**排查步骤：**

1. 查看 Workflow 日志
```bash
wrangler tail pic-scheduler --format pretty
```

2. 检查 ProcessingQueue 状态
```bash
wrangler d1 execute pic-d1 --remote --command \
  "SELECT status, COUNT(*) FROM ProcessingQueue GROUP BY status"
```

3. 查看失败任务
```bash
wrangler d1 execute pic-d1 --remote --command \
  "SELECT * FROM ProcessingQueue WHERE status='failed' LIMIT 10"
```

**常见原因：**
- Unsplash API 限流（50 次/小时）
- R2 存储空间不足
- AI 模型超时

**解决方案：**
- 降低 Cron 频率
- 检查 R2 配额
- 增加重试次数

---

### 2. 照片重复下载

**症状：**
同一张照片被处理多次

**排查步骤：**

1. 检查游标状态
```bash
wrangler d1 execute pic-d1 --remote --command \
  "SELECT * FROM State WHERE key LIKE 'last_cursor%'"
```

2. 查看重复照片
```bash
wrangler d1 execute pic-d1 --remote --command \
  "SELECT unsplash_id, COUNT(*) FROM Photos GROUP BY unsplash_id HAVING COUNT(*) > 1"
```

**解决方案：**
- 确保 Workflow ID 使用照片 ID（幂等性）
- 在 Cron 中添加去重逻辑

---

### 3. R2 临时文件残留

**症状：**
`temp/` 目录下有大量文件

**排查步骤：**

1. 列出临时文件
```bash
wrangler r2 object list pic-r2 --prefix temp/
```

2. 检查对应的 ProcessingQueue 记录
```bash
wrangler d1 execute pic-d1 --remote --command \
  "SELECT * FROM ProcessingQueue WHERE status='failed' AND download_success=1"
```

**解决方案：**

手动清理脚本：
```bash
# 列出所有临时文件
wrangler r2 object list pic-r2 --prefix temp/ > temp_files.txt

# 批量删除（谨慎操作）
while read key; do
  wrangler r2 object delete pic-r2 "$key"
done < temp_files.txt
```

或使用 R2 生命周期规则（推荐）：
```toml
# wrangler.toml
[[r2_buckets]]
binding = "R2"
bucket_name = "pic-r2"

[[r2_buckets.lifecycle_rules]]
prefix = "temp/"
expiration_days = 1
```

---

### 4. AI 分类不准确

**症状：**
照片被分到错误的分类

**排查步骤：**

1. 查看分类置信度
```bash
wrangler d1 execute pic-d1 --remote --command \
  "SELECT ai_category, AVG(ai_confidence) as avg_conf FROM Photos GROUP BY ai_category"
```

2. 查看低置信度照片
```bash
wrangler d1 execute pic-d1 --remote --command \
  "SELECT * FROM Photos WHERE ai_confidence < 0.5 LIMIT 10"
```

**优化方案：**
- 使用图像识别模型（ResNet）而非文本分类
- 增加 AI 模型数量（投票机制）
- 添加人工审核流程

---

### 5. 数据库查询慢

**症状：**
前端加载缓慢

**排查步骤：**

1. 检查索引
```bash
wrangler d1 execute pic-d1 --remote --command \
  "SELECT * FROM sqlite_master WHERE type='index'"
```

2. 分析查询计划
```bash
wrangler d1 execute pic-d1 --remote --command \
  "EXPLAIN QUERY PLAN SELECT * FROM Photos ORDER BY downloaded_at DESC LIMIT 30"
```

**优化方案：**
- 添加索引：`CREATE INDEX idx_photos_downloaded ON Photos(downloaded_at DESC)`
- 使用缓存（30 秒 TTL）
- 分页查询

---

### 6. Cron 未触发

**症状：**
超过 10 分钟没有新照片

**排查步骤：**

1. 检查 Cron 配置
```bash
wrangler deployments list --name pic-scheduler
```

2. 查看最近的 Cron 执行
```bash
wrangler tail pic-scheduler --format pretty | grep "Cron triggered"
```

**解决方案：**
- 确认 wrangler.toml 中 crons 配置正确
- 重新部署：`npm run deploy:scheduler`
- 检查 Cloudflare Dashboard 中的 Cron Triggers

---

### 7. API 配额超限

**症状：**
```
Error: Unsplash API rate limit exceeded
```

**排查步骤：**

1. 查看 API 使用情况
```bash
wrangler d1 execute pic-d1 --remote --command \
  "SELECT * FROM ApiQuota WHERE api_name='unsplash'"
```

**解决方案：**
- 降低 Cron 频率（从 10 分钟改为 15 分钟）
- 减少每次获取的页数（从 2 页改为 1 页）
- 升级 Unsplash API 套餐

---

## 监控命令

### 实时日志
```bash
# Scheduler 日志
wrangler tail pic-scheduler --format pretty

# Frontend 日志
wrangler tail pic-frontend --format pretty
```

### 数据库查询
```bash
# 总照片数
wrangler d1 execute pic-d1 --remote --command "SELECT COUNT(*) FROM Photos"

# 队列状态
wrangler d1 execute pic-d1 --remote --command \
  "SELECT status, COUNT(*) FROM ProcessingQueue GROUP BY status"

# 分类分布
wrangler d1 execute pic-d1 --remote --command \
  "SELECT category, photo_count FROM CategoryStats ORDER BY photo_count DESC LIMIT 10"
```

### R2 存储
```bash
# 列出文件
wrangler r2 object list pic-r2 --limit 10

# 查看存储使用
wrangler r2 bucket info pic-r2
```

---

## 紧急恢复

### 停止所有处理
```bash
# 暂停 Cron
wrangler deployments list --name pic-scheduler
# 在 Dashboard 中禁用 Cron Trigger
```

### 清空队列
```bash
wrangler d1 execute pic-d1 --remote --command \
  "DELETE FROM ProcessingQueue WHERE status IN ('pending', 'downloading', 'classifying')"
```

### 回滚部署
```bash
# 查看历史部署
wrangler deployments list --name pic-scheduler

# 回滚到指定版本
wrangler rollback --deployment-id <deployment-id>
```

---

## 联系支持

如果以上方法无法解决问题，请：

1. 收集日志：`wrangler tail pic-scheduler > logs.txt`
2. 导出数据库状态：`wrangler d1 export pic-d1 > db_dump.sql`
3. 提交 Issue：https://github.com/7893/pic/issues
