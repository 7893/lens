# 架构改进计划

## 当前架构问题

### 1. 双 Workflow 设计缺陷

**问题：**
```javascript
// Cron 触发
downloadWorkflow.create()  // Workflow 1
setTimeout(30s)
classifyWorkflow.create()  // Workflow 2
```

**缺陷：**
- 硬编码 30 秒延迟，无法保证下载完成
- 两个 Workflow 独立轮询 ProcessingQueue，效率低
- 状态不一致风险（下载失败但分类仍启动）
- 难以追踪同一批次的处理流程

### 2. ProcessingQueue 表过度复杂

**问题：**
```sql
status TEXT,  -- pending/downloading/downloaded/classifying/completed
download_success INTEGER,
ai_success INTEGER,
metadata_success INTEGER,
db_success INTEGER,
retry_count INTEGER
```

**缺陷：**
- 8 个状态字段，容易不一致
- 查询条件复杂
- 并发更新冲突
- 难以扩展

### 3. R2 临时文件管理

**问题：**
```javascript
// 下载时
R2.put('temp/photo.jpg')
// 分类后
R2.put('category/photo.jpg')
R2.delete('temp/photo.jpg')
```

**缺陷：**
- 双倍存储空间
- 分类失败导致临时文件残留
- 移动操作不是原子的

### 4. 缺少幂等性保证

**问题：**
- Workflow 重启可能重复处理
- 无分布式锁
- 统计可能重复计数

---

## 推荐架构

### 架构图

```
┌─────────────┐
│ Cron Trigger│ (每 10 分钟)
└──────┬──────┘
       │ 1. Fetch 60 photos from Unsplash API
       │ 2. Filter duplicates (check DB)
       │ 3. Send to Queue
       ▼
┌─────────────────┐
│ Cloudflare Queue│ (60 messages)
└────────┬────────┘
         │ Batch consume (max_concurrency: 10)
         ▼
┌──────────────────────────────────────┐
│   Single Workflow (per photo)        │
│                                      │
│  Step 1: Download to R2              │
│    ├─ Fetch from Unsplash            │
│    └─ Upload to R2 (final location)  │
│                                      │
│  Step 2: AI Classify                 │
│    ├─ Call Cloudflare AI             │
│    └─ Get category                   │
│                                      │
│  Step 3: Move to final location      │
│    └─ R2.put(category/id.jpg)        │
│                                      │
│  Step 4: Save to DB                  │
│    ├─ INSERT INTO Photos             │
│    └─ UPDATE CategoryStats           │
└──────────────────────────────────────┘
```

### 核心改进

#### 1. Cron Worker（调度器）

**职责：** 只做"发令枪"

```javascript
async scheduled(event, env) {
  // 1. 批量获取照片列表（2 次 API 调用）
  const photos = await fetchFromUnsplash(60);
  
  // 2. 去重（检查数据库）
  const newPhotos = await filterDuplicates(photos);
  
  // 3. 发送到 Queue
  await env.PHOTO_QUEUE.sendBatch(
    newPhotos.map(photo => ({
      body: {
        id: photo.id,
        downloadUrl: photo.urls.raw,
        description: photo.description,
        // ... 其他元数据
      }
    }))
  );
}
```

**优势：**
- API 调用次数不变（288 次/天）
- 在 Cron 中去重，减少无效处理
- 快速完成，不阻塞下次触发

#### 2. Queue Consumer（触发器）

**职责：** 解耦和并发控制

```javascript
async queue(batch, env) {
  for (const message of batch.messages) {
    const photo = message.body;
    
    // 启动 Workflow（使用照片 ID 保证幂等性）
    await env.PHOTO_WORKFLOW.create({
      id: `photo-${photo.id}`,  // 同一照片不会重复处理
      params: photo
    });
    
    message.ack();
  }
}
```

**配置：**
```toml
[[queues.consumers]]
queue = "photo-queue"
max_batch_size = 10
max_concurrency = 10  # 控制并发，避免触发 Rate Limit
```

**优势：**
- 自动重试（Queue 内置）
- 并发控制（避免源站限流）
- 解耦（API 挂了不影响 Cron）

#### 3. Single Workflow（处理核心）

**职责：** 执行完整的处理流程

```javascript
export class PhotoProcessingWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const photo = event.params;
    
    // Step 1: 下载并上传到 R2（临时位置）
    const r2Result = await step.do('download-to-r2', async () => {
      const response = await fetch(photo.downloadUrl);
      const key = `temp/${photo.id}.jpg`;
      await this.env.R2.put(key, response.body);
      return { r2Key: key };
    });
    
    // Step 2: AI 分类
    const aiResult = await step.do('ai-classify', async () => {
      const result = await this.env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
        messages: [{ role: 'user', content: `Classify: ${photo.description}` }]
      });
      return { category: result.response.trim() };
    });
    
    // Step 3: 移动到最终位置
    await step.do('move-to-final', async () => {
      const tempObj = await this.env.R2.get(r2Result.r2Key);
      const finalKey = `${aiResult.category}/${photo.id}.jpg`;
      await this.env.R2.put(finalKey, tempObj.body);
      await this.env.R2.delete(r2Result.r2Key);
      return { finalKey };
    });
    
    // Step 4: 保存到数据库
    await step.do('save-to-db', async () => {
      await this.env.DB.prepare('INSERT INTO Photos...').bind(...).run();
      await this.env.DB.prepare('UPDATE CategoryStats...').bind(...).run();
    });
  }
}
```

**优势：**
- **步骤级重试**：Step 2 失败不需要重新执行 Step 1
- **状态自动管理**：Workflow 引擎持久化每个 step 的输出
- **逻辑清晰**：一个文件包含完整流程
- **易于追踪**：Workflow ID = 照片 ID

---

## 迁移步骤

### Phase 1: 准备（1 小时）

1. 创建 Queue
```bash
wrangler queues create photo-queue
```

2. 更新 wrangler.toml
```toml
[[queues.producers]]
queue = "photo-queue"
binding = "PHOTO_QUEUE"

[[queues.consumers]]
queue = "photo-queue"
max_batch_size = 10
max_concurrency = 10
```

### Phase 2: 实现新架构（2-3 小时）

1. 创建 Single Workflow
2. 修改 Cron Worker（发送到 Queue）
3. 创建 Queue Consumer
4. 删除 ProcessingQueue 表

### Phase 3: 测试（30 分钟）

1. 手动触发测试
2. 验证幂等性
3. 检查统计数据

### Phase 4: 部署（15 分钟）

1. 部署新版本
2. 监控日志
3. 清理旧代码

---

## 对比总结

| 维度 | 当前架构 | 新架构 |
|------|---------|--------|
| Workflow 数量 | 2 个 | 1 个 |
| 中间状态表 | ProcessingQueue | 无（Queue 替代） |
| 临时文件 | 需要 | 需要（但更安全） |
| 幂等性 | 无保证 | Workflow ID 保证 |
| 重试粒度 | Workflow 级 | Step 级 |
| 代码复杂度 | 高 | 低 |
| 可追踪性 | 困难 | 容易 |
| API 调用次数 | 288/天 | 288/天（不变） |
| Workflow 步数 | ~52 万/月 | ~26 万/月（减半） |

---

## 风险评估

### 低风险
- ✅ API 调用次数不变
- ✅ 功能完全兼容
- ✅ 可以灰度发布

### 中风险
- ⚠️ 需要迁移现有数据
- ⚠️ Queue 配额（100 万条/月，足够）

### 缓解措施
- 保留旧代码 7 天
- 监控告警
- 准备回滚脚本

---

## 下一步

1. 确认架构方案
2. 实现代码
3. 本地测试
4. 部署到生产
5. 监控和优化
