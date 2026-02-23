# 运维监控、成本管理与灾难恢复手册 (06-MAINTENANCE-MONITORING)

本手册是 Lens 系统的“飞行手册”，旨在指导运维人员如何通过数据监控来确保系统的长期健康，并在此基础上将 AI 运行成本压缩至极限。

---

## 1. 成本控制核心：动态节流体系

Lens 并不是一辆“刹车失灵”的赛车，我们通过 KV (SETTINGS) 实现了一套极其精密的实时控制系统。

### 1.1 `config:ingestion` 实时调节

通过修改 KV 中的 JSON 配置，你可以即时改变采集引擎的行为：

- **`backfill_enabled`**：一旦发现 Unsplash 配额异常或云端费用激增，将其设为 `false` 可立即熔断所有历史抓取任务。
- **`daily_evolution_limit_usd`**：这是你的“财务刹车”。设为 0.15 代表每天愿意花费约 1 元人民币用于系统进化。系统会自动审计官方账单，确保不超支。

### 1.2 官方账单审计 (The Oracle)

由于 Cloudflare 并没有实时账单 API，我们通过 **AI Gateway GraphQL API** 实时探测 `lens-gateway` 产生的真实 USD 开销。

- **计费隔离**: 系统会自动排除用户搜索产生的费用，仅统计由 Llama 4 Scout (旗舰模型) 产生的系统性开销（抓新图与进化）。
- **安全缓冲**: 预算计算逻辑内置了 5% 的安全余量，防止由于计费延迟导致的超支。

---

## 2. 系统健康指标 (KPIs)

### 2.1 采集流动性 (Ingestion Flow)

- **SQL 观察**: `SELECT ai_model, COUNT(*) FROM images GROUP BY ai_model;`
  - **正常表现**: `llama-4-scout` 的数量应在每个整点（或 10 分钟周期）准时跳变。
- **进化窗口**: 自进化爆发仅在 **UTC 23:00** 的第一个 10 分钟窗口触发，以确保利用全天最后的 Neurons 余额。

### 2.2 AI 网关 (AI Gateway)

- **监控点**: 访问 Cloudflare Dashboard -> AI -> AI Gateway -> `lens-gateway`。
- **关键图表**:
  - **Success Rate**: 应保持在 99% 以上。
  - **Token/Neuron Usage**: 结合图片入库数，预估每日账单。

---

## 3. 故障追踪实战 (Trace-ID)

利用 Lens 的链路追踪系统，你可以实现分钟级的精准故障定位。

### 3.1 核心流程定位

如果你收到用户反馈某个搜索请求异常：

1.  **获取 Trace-ID**: 在 `wrangler tail` 或 Cloudflare Logs 中找到对应的 `[SEARCH-xxxx]` 标记。
2.  **全量检索**: 使用 该 ID 作为关键词过滤日志。
3.  **分析原因**: 观察该 ID 下的所有步骤，确定是 `Query Expansion` 阶段的 AI 故障，还是最后的 `Reranker` 逻辑错误。

---

## 4. 常见故障模型与“手术级”恢复

### 4.1 采集系统“血栓” (Anchor Deadlock)

- **现象**：定时任务在跑，但图片数不涨。
- **修复**：手动将 `last_seen_id` 回拨到 D1 中最后一张已知图的 ID：
  ```sql
  UPDATE system_config SET value = (SELECT id FROM images ORDER BY created_at DESC LIMIT 1) WHERE key = 'last_seen_id';
  ```

### 4.2 Workflow 实例积压

- **对策**：检查 `wrangler secret` 是否过期。更新密钥后，存量 Workflow 会自动利用指数退避机制完成自愈。

---

## 5. 极致成本精算模型 (AI Cost Modeling)

Lens 实现了一套基于“实付金额”的闭环反馈系统，确保 AI 运营成本永远不会失控。

### 5.1 精算公式

系统在执行自进化任务前，会通过以下公式计算今日“捡漏”容量：
$$ Capacity = \frac{(DailyLimit - CurrentSpend) \times 0.95}{UnitCost} $$

- **0.95 (安全边际)**: 预留 5% 的冗余，用于抵消 GraphQL API 的分钟级数据聚合延迟。
- **UnitCost ($0.001)**: 基于 Llama 4 Scout 17B 在边缘侧的平均输入/输出 Token 消耗折算的单图成本。

### 5.2 零成本进化原理

由于老图的资产已存储在 R2 中，重刷过程不产生额外的网络传输费或 Unsplash API 费。系统本质上是在利用 Cloudflare 已付月费（Paid Plan）中的闲置 Neurons 资源进行**“资产重塑”**。
