# 运维监控、成本管理与灾难恢复手册 (06-MAINTENANCE-MONITORING)

本手册是 Lens 系统的“飞行手册”，旨在指导运维人员如何通过数据监控来确保系统的长期健康，并在此基础上将 AI 运行成本压缩至极限。

---

## 1. 成本控制核心：动态节流体系

Lens 并不是一辆“刹车失灵”的赛车，我们通过 KV (SETTINGS) 实现了一套极其精密的实时控制系统。

### 1.1 `config:ingestion` 实时调节

通过修改 KV 中的 JSON 配置，你可以即时改变采集引擎的行为：

- **`backfill_enabled`**：一旦发现 Unsplash 配额异常或云端费用激增，将其设为 `false` 可立即熔断所有历史抓取任务。
- **`backfill_max_pages`**：这是你的“生产速率”。设为 2 代表每 10 分钟处理约 60 张历史图。通过增加此值，你可以让全库入库速度提升，但需警惕 Neurons 消耗。

### 1.2 离线 Neurons 水表监控

由于 Cloudflare 并没有实时账单 API，我们通过 KV `stats:neurons:YYYY-MM-DD` 记录当日预估消耗。

- **查看指令**：`npx wrangler kv key get --namespace-id <KV_ID> "stats:neurons:2026-02-22" --remote`
- **预警线**：若该值接近 10,000，系统会自动减少自进化（Evolution）任务，确保全天处于免费区。

---

## 2. 系统健康指标 (KPIs)

### 2.1 采集流动性 (Ingestion Flow)

- **SQL 观察**：`SELECT ai_model, COUNT(*) FROM images GROUP BY ai_model;`
  - **正常表现**：`llama-4-scout` 的数量应在每个小时的 0 分、10 分、20 分... 准时跳变。
- **日志观察**：使用 `wrangler tail lens-processor`。
  - **关键信号**：寻找 `🌟 Global anchor advanced to`。这代表高水位线已成功前移。

### 2.2 自进化爆发观察 (The 23:00 Peak)

在 **UTC 23:00** 这一小时，是 Lens 的“高光时刻”。

- 系统会清算全天剩余配额，并启动大规模的老图刷新。
- **监控要点**：此时 D1 的 CPU 时间片消耗会达到峰值，应通过 Cloudflare Dashboard 关注数据库的查询延迟。

---

## 3. 常见故障模型与“手术级”恢复

### 3.1 采集系统“血栓” (Anchor Deadlock)

- **现象**：定时任务在跑，但图片数不涨。
- **诊断**：`last_seen_id` 指向了一张并不存在的图，或者由于排序抖动导致系统认为“已经处理过了”。
- **修复**：手动将 `last_seen_id` 回拨到 D1 中最后一张已知图的 ID：
  ```sql
  UPDATE system_config SET value = (SELECT id FROM images ORDER BY created_at DESC LIMIT 1) WHERE key = 'last_seen_id';
  ```

### 3.2 Workflow 实例积压

- **诊断**：大量实例处于 `Failed` 或 `Running`。
- **对策**：检查 `wrangler secret` 是否过期（特别是 `CLOUDFLARE_API_TOKEN`）。更新密钥后，存量 Workflow 会自动利用指数退避机制完成自愈。

---

## 4. 数据重塑与索引迁移

当你决定修改 AI 分析逻辑（例如从 8 个 Tags 增加到 20 个）时：

1.  **重置同步标记**：将 D1 中 `system_config` 表的 `vectorize_last_sync` 设为 `0`。
2.  **清空旧索引**：`npx wrangler vectorize delete lens-vectors`。
3.  **触发同步**：系统会在下一个小时自动扫描 D1 全表并重建 Vectorize 索引。
4.  **模型漂移补救**：利用 `Self-Evolution` 模块，系统会在未来几周内利用免费额度，悄悄完成全量数据的逻辑升级。
