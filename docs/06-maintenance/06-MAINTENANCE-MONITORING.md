# 运维与监控 (06-MAINTENANCE-MONITORING)

本指南介绍如何监控 Lens 的运行状态、管理 AI 调用成本以及处理常见的系统异常。

---

## 1. 成本监控 (AI Tokens & Neurons)

由于 Lens 频繁使用 Llama 3.2 Vision 进行图片分析，AI 调用是系统的核心成本项。

### 1.1 使用 AI Gateway
在 `wrangler.toml` 中，我们配置了 `gateway = { id = "lens-gateway" }`。
- **操作**: 登录 Cloudflare Dashboard -> AI -> AI Gateway。
- **指标**: 查看请求数、Token 消耗量以及每种模型的响应时长。
- **缓存**: 您可以在网关层开启 AI 缓存，以减少相同查询扩展带来的重复扣费。

---

## 2. 采集任务监控 (Workflows & Queues)

采集管道是全自动运行的。

### 2.1 Workflow 状态查看
```bash
# 列出最近的工作流实例
npx wrangler workflows list lens-workflow
# 查看特定实例的执行日志
npx wrangler workflows instances lens-workflow <INSTANCE_ID>
```

### 2.2 队列堆积检查
如果发现 `total_images` 长时间不增加，请检查 Cloudflare Queues 仪表盘。
- **生产者状态**: 检查 Processor Worker 每一小时的执行日志。
- **消费者异常**: 检查是否有大量任务进入了死信队列（Dead Letter Queue）。

---

## 3. 常见故障处理 (FAQ)

### 3.1 搜索结果不更新
- **现象**: D1 数据在增加，但搜索不到新图。
- **原因**: 向量同步 (`runVectorSync`) 可能因为 API 抖动未执行。
- **解决**: 等待下一个整点 Cron 触发，或者手动在本地触发 `runVectorSync` 逻辑。

### 3.2 Unsplash API 限流 (403 Forbidden)
- **现象**: 采集任务报错，`api_remaining` 始终为 0。
- **解决**: 检查 `UNSPLASH_API_KEY` 是否有效。如果是 Demo 级别 Key，每小时限 50 次请求，请勿手动频繁触发测试。

### 3.3 D1 数据库锁冲突
- **现象**: Workflow 写入 `images` 表时报错 `Database is locked`。
- **原因**: 并发写入过高。
- **解决**: 在 `processor` 的 `wrangler.toml` 中调低 `max_concurrency`（默认 5）。

---

## 4. 数据库管理与迁移

如果您需要备份或迁移数据：
```bash
# 导出整个 D1 到 SQL 文件
npx wrangler d1 export lens-d1 --remote --output backup.sql
# 导入数据
npx wrangler d1 execute lens-d1 --remote --file=backup.sql
```

---

## 5. 定期维护建议

- **清理 R2 RAW 目录**: 如果存储压力过大，可以考虑仅保留 `display/` 目录，并定期清理 `raw/` 目录。
- **索引重建**: 如果大幅修改了 AI 描述逻辑，建议使用 `wrangler vectorize delete` 后重新创建索引并全量同步。
