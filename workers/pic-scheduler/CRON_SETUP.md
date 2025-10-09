# 定时器配置

## 配置时间
2025-10-09 18:55

---

## ⏰ Cron 配置

### 触发时间
```
0 * * * *
```
- **含义**：每小时整点触发
- **示例**：00:00, 01:00, 02:00, ..., 23:00

### 下载数量
- **每次下载**：1500 张图片（30 × 50）
- **每天下载**：36,000 张图片（1500 × 24）
- **每月下载**：~1,080,000 张图片

---

## 🔧 实现细节

### 1. Cron 触发器
```toml
# wrangler.toml
[triggers]
crons = ["0 * * * *"]
```

### 2. Scheduled 事件处理
```javascript
async scheduled(event, env, ctx) {
  const id = env.DOWNLOAD_TASK.idFromName('cron');
  const stub = env.DOWNLOAD_TASK.get(id);
  
  ctx.waitUntil(
    stub.fetch(new Request('https://internal/start', {
      method: 'POST',
      body: JSON.stringify({ count: 1500 })
    }))
  );
}
```

### 3. 配置更新
- **MAX_COUNT**：100 → 2000（支持更大批量）
- **DO实例**：使用独立的 'cron' 实例，避免与手动下载冲突

---

## 📊 资源消耗估算

### Unsplash API
- **每小时**：50 次请求（1500 ÷ 30）
- **每天**：1200 次请求
- **限制**：50 次/小时（免费版）
- ⚠️ **需要升级到付费版或多个API Key**

### Cloudflare Workers
- **CPU时间**：在 Durable Object 中运行，无限制
- **请求数**：24 次/天（Cron触发）
- **AI调用**：6000 次/小时（1500 × 4 模型）

### 存储
- **R2存储**：假设平均 3MB/张
  - 每小时：4.5 GB
  - 每天：108 GB
  - 每月：3.24 TB

### D1 数据库
- **行数**：1500 行/小时
- **每天**：36,000 行
- **每月**：~1,080,000 行

---

## ⚠️ 重要注意事项

### 1. Unsplash API 限制
**问题**：免费版限制 50 次/小时

**解决方案**：
- 选项A：升级到付费版（5000 次/小时）
- 选项B：使用多个 API Key 轮换
- 选项C：降低下载频率（每2小时一次）

### 2. 存储成本
**R2 存储成本**（按 3.24 TB/月计算）：
- 存储：$0.015/GB/月 × 3240 GB = $48.6/月
- 写入：$4.50/百万次 × 1,080,000 = $4.86/月
- **总计**：~$53/月

### 3. AI 调用成本
**Cloudflare AI**（按 6000 次/小时计算）：
- 每天：144,000 次
- 每月：4,320,000 次
- 免费额度：10,000 次/天
- 超出部分需要付费

---

## 🎯 优化建议

### 短期优化
1. **降低频率**：改为每2小时一次
   ```toml
   crons = ["0 */2 * * *"]
   ```

2. **减少数量**：每次下载 500 张
   ```javascript
   body: JSON.stringify({ count: 500 })
   ```

3. **错峰下载**：避开高峰时段
   ```toml
   crons = ["0 2,6,10,14,18,22 * * *"]
   ```

### 中期优化
1. **API Key 轮换**：使用多个 Unsplash API Key
2. **智能去重**：跳过已下载的图片
3. **失败重试**：记录失败任务，稍后重试

### 长期优化
1. **分布式下载**：多个 Worker 并行
2. **增量下载**：只下载新图片
3. **成本监控**：实时监控存储和API使用

---

## 📝 监控命令

### 查看 Cron 日志
```bash
npx wrangler tail --format=pretty
```

### 查看下载统计
```bash
curl "https://pic.53.workers.dev/api/category-stats"
```

### 查看数据库大小
```bash
npx wrangler d1 execute pic-db --remote \
  --command "SELECT COUNT(*) as total FROM downloads"
```

### 查看 R2 存储
```bash
npx wrangler r2 object list pic-images --limit 10
```

---

## 🔄 调整 Cron 时间

### 每2小时
```toml
crons = ["0 */2 * * *"]
```

### 每4小时
```toml
crons = ["0 */4 * * *"]
```

### 每天特定时间（例如：凌晨2点）
```toml
crons = ["0 2 * * *"]
```

### 工作日每小时
```toml
crons = ["0 * * * 1-5"]
```

### 禁用 Cron
```toml
# 注释掉或删除
# [triggers]
# crons = ["0 * * * *"]
```

---

## ✅ 部署信息

- **Version ID**: `4e2c0656-03c0-4b50-be55-692b5427fe50`
- **部署时间**: 2025-10-09 18:55
- **Cron 状态**: ✅ 已启用
- **触发时间**: 每小时整点
- **下载数量**: 1500 张/次

---

## 🚨 成本警告

**当前配置下的月度成本估算**：
- R2 存储：~$53/月
- AI 调用：超出免费额度
- Unsplash API：需要付费版

**建议**：
1. 先测试运行1-2天
2. 监控实际成本
3. 根据需求调整频率和数量
