# 系统运维与监控手册 (06-MAINTENANCE-MONITORING)

本手册旨在指导运维人员如何监控 Lens 系统的健康度、控制成本、以及进行故障应急处理。

---

## 1. 成本调优：KV 动态控制面板

Lens 提供了一套基于 KV 的“实时节流阀”，允许你在不重启系统的前提下调整运营策略。

### 1.1 操作指令

```bash
# 获取当前采集设置
npx wrangler kv key get --namespace-id <KV_ID> "config:ingestion" --remote

# 修改回填限制 (例如增加到 10 页)
npx wrangler kv key put --namespace-id <KV_ID> "config:ingestion" '{"backfill_enabled": true, "backfill_max_pages": 10}' --remote
```

### 1.2 参数说明

- **`backfill_max_pages`**: 每小时回填页数。增加此值会加速旧图入库，但会显著增加 Neurons 消耗费。
- **`backfill_enabled`**: 紧急刹车开关。设为 `false` 可立即停止所有非必要的抓取任务。

---

## 2. 核心指标监控

### 2.1 自我进化进度 (Self-Evolution Progress)

系统会自动利用每日剩余的免费 Neurons 配额，将 `llama-3.2` 的旧数据升级至 `llama-4-scout`。

- **查看进度**:
  ```sql
  SELECT ai_model, COUNT(*) FROM images GROUP BY ai_model;
  ```
- **监控消耗**: 在 KV 中检查当日已用 Neuron 计数器：
  `npx wrangler kv key get --namespace-id <KV_ID> "stats:neurons:YYYY-MM-DD" --remote`

### 2.2 AI 网关 (AI Gateway)

- **监控点**: 访问 Cloudflare Dashboard -> AI -> AI Gateway -> `lens-gateway`。
- **关键图表**:
  - **Success Rate**: 应保持在 99% 以上。
  - **Token/Neuron Usage**: 结合图片入库数，预估每日账单。

---

## 3. 计费参考模型

基于目前 Llama 4 Scout + BGE-M3 的组合，你可以按以下经验公式预估开销：

| 动作             | 消耗 (Neurons) | 费用 ($)            |
| :--------------- | :------------- | :------------------ |
| **单张新图入库** | ~32            | $0.00035             |
| **单次复杂搜索** | ~5,000         | $0.055              |
| **每日免费额度** | 10,000         | **$0 (抵扣 $0.11)** |

---

## 4. 故障排除指南 (FAQ)

### 3.1 现象：D1 数据涨了，但搜不到新图

- **诊断**: 检查 `vectorize_last_sync` 配置项。
- **解决**: 向量同步逻辑会在下一个整点自动补全。如需手动修复，可执行本地脚本重触发 `runVectorSync` 逻辑。

### 3.2 现象：Unsplash 采集结果一直是 0

- **诊断**: 检查 Unsplash API 的配额。
- **解决**: 可能是因为上一周期爆发式回填透支了额度。静待 1 小时自动重置即可。

### 3.3 现象：Search API 返回 500

- **诊断**: 查看网关 Logs。
- **解决**: 如果错误是 401，请检查 `CLOUDFLARE_API_TOKEN` 的 Secret 是否过期。

---

## 4. 深度维护操作

### 4.1 重建索引

如果修改了 AI 描述逻辑，需要全量更新 Vectorize：

1.  清空 Vectorize 索引。
2.  在 D1 中将 `system_config` 表的 `vectorize_last_sync` 设为 `0`。
3.  等待下一个 Cron 周期自动全量同步。

### 4.2 数据库导出备份

```bash
npx wrangler d1 export lens-d1 --remote --output ./backups/lens_db_$(date +%F).sql
```
