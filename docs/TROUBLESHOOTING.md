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

2. 检查 Queue 状态
```bash
wrangler queues list
```

3. 查看失败的 Workflow
```bash
wrangler d1 execute pic-d1 --remote --command \
  "SELECT * FROM Photos WHERE downloaded_at IS NULL LIMIT 10"
```

**常见原因：**
- Unsplash API 限流（50 次/小时）
- R2 存储空间不足
- AI 模型超时

**解决方案：**
- 降低 Cron 频率
- 检查 R2 配额
- Workflow 会自动重试

---

### 2. 照片重复下载

**症状：**
同一张照片被处理多次

**排查步骤：**

1. 检查重复照片
```bash
wrangler d1 execute pic-d1 --remote --command \
  "SELECT unsplash_id, COUNT(*) FROM Photos GROUP BY unsplash_id HAVING COUNT(*) > 1"
```

**解决方案：**
- Workflow ID 使用照片 ID 保证幂等性
- Cron 中已添加数据库去重逻辑

---

### 3. R2 临时文件残留

**症状：**
`temp/` 目录下有大量文件

**排查步骤：**

1. 列出临时文件
```bash
wrangler r2 object list pic-r2 --prefix temp/
```

**解决方案：**

使用 R2 生命周期规则自动清理：
```toml
# wrangler.toml
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

**优化方案：**
- 使用图像识别模型（ResNet）而非文本分类
- 调整 AI 提示词
- 添加人工审核流程

### 5. Cron 未触发

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

### 6. Queue 消息堆积

**症状：**
Queue 中有大量未处理消息

**排查步骤：**

1. 查看 Queue 状态
```bash
wrangler queues list
```

**解决方案：**
- 检查 Consumer Worker 是否正常运行
- 增加 max_concurrency（当前 10）
- 检查 Workflow 是否有大量失败

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

### Queue 状态
```bash
# 查看 Queue
wrangler queues list

# 查看消费者
wrangler queues consumer list photo-queue
```

---

## 紧急恢复

### 停止所有处理
```bash
# 暂停 Cron（在 Dashboard 中禁用）
# 或临时修改 cron 配置为不触发的时间
```

### 清空 Queue
```bash
# Queue 会自动处理，无需手动清空
# 如需停止消费，可以临时禁用 Consumer
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
