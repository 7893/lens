# 系统运维、财务精算与全生命周期监控手册 (06-MAINTENANCE)

本手册是 Lens 系统的“飞行指南”。它详细记录了如何监控这个分布式视觉大脑的健康状态，并教你如何在 $5/月的预算内，通过极致的精算逻辑管理上万条 AI 资产。

---

## 1. 核心运维逻辑：财务驱动的自演进

Lens 的最牛逼之处在于其 **“自主财务意识”**。

### 1.1 官方账单实时对账体系 (The Oracle)

由于 Cloudflare 并没有提供 Neurons 余额的查询 API，我们利用 AI Gateway 的 GraphQL 接口实现了“影子对账”：

- **计费隔离原理**：系统在查账时会精准过滤 `model = 'llama-4-scout-17b-16e-instruct'`。
- **逻辑**：这意味着只有后台的图片抓取和自进化消耗计入“每日限额”，而用户产生的 Reranker 搜索费用属于“免费公共开支”，不会导致系统自动进化停摆。

### 1.2 KV 可配置的 Evolution 触发

Evolution 的触发时间和预算通过 KV 配置 `config:ingestion` 控制：

```json
{
  "backfill_enabled": false,
  "backfill_max_pages": 1,
  "daily_evolution_limit_usd": 1,
  "evolution_trigger_utc": "01:00"
}
```

| 配置项                      | 说明                                                |
| --------------------------- | --------------------------------------------------- |
| `daily_evolution_limit_usd` | 每日预算（美元），设为 0 则关闭 Evolution           |
| `evolution_trigger_utc`     | 触发时间，格式 `"HH:MM"`，如 `"01:00"` = 北京 09:00 |

### 1.3 Evolution 爆发期的观察

在配置的触发时间（`evolution_trigger_utc`），系统会结算余额并发起一波刷新冲刺。

- **监控信号**：此时你应该在日志中看到 `🧬 Queueing XXX images for self-evolution...`。
- **性能数据**：Queue + Workflow 并发处理，吞吐量约 500 张/分钟，6,000 张图约 12 分钟完成。
- **成本参考**：单图约 $0.00025，$1 预算可刷约 3,800 张。

---

## 2. 故障诊断与“手术级”恢复实战

### 2.1 采集引擎“认知黑洞”修复 (Anchor Recovery)

- **故障现象**：Unsplash 持续产出新图，但数据库总量死活不涨。
- **排查路径**：
  1.  执行 `SELECT value FROM system_config WHERE key = 'last_seen_id';` 拿到当前锚点。
  2.  如果该锚点指向一张赞助图或损坏的 ID，采集逻辑会在此处无限对撞。
- **修复指令**：手动将锚点回拨到 D1 中真实存在的最新 ID。
  ```sql
  UPDATE system_config SET value = (SELECT id FROM images ORDER BY created_at DESC LIMIT 1) WHERE key = 'last_seen_id';
  ```

### 2.2 Zod 契约冲突处理

- **现象**：Workflow 频繁报错 `Contract Violation`。
- **根因**：通常是 Llama 4 模型进行了静默更新，输出了包含非标准标点符号的 JSON。
- **对策**：修改 `src/services/ai.ts` 中的 Regex 预提取层，或在 `schemas.ts` 中放宽 Zod 的校验范围。

---

## 3. 极致成本模型 (FinOps Specs)

基于目前 **Llama 4 Scout + BGE-M3** 的架构，系统遵循以下经济学参数：

| 动作                | 预期消耗 (USD) | 备注                            |
| :------------------ | :------------- | :------------------------------ |
| **单张新图入库**    | ~$0.00025      | 包含 Vision + Embedding + D1 IO |
| **全库刷新 (2w张)** | ~$5.00         | 基于实测数据 ($0.00025/张)      |
| **$1 预算可刷**     | ~3,800 张      | 含 5% 安全余量                  |

---

## 4. 资产重塑与索引重构流程

当你决定升级模型（例如从 1024 维换到更高维度）时：

1.  **逻辑重写**：更新 `shared` 包中的维度常量。
2.  **索引清零**：`npx wrangler vectorize delete lens-vectors`。
3.  **触发全量重写**：系统不需要特殊停机位。只需要将 D1 中的 `ai_model` 全部重置为 `legacy`，自进化引擎会在接下来的几周内，利用每日闲置配额，像“蚂蚁搬家”一样自动完成 2 万张图片的向量重绘。
