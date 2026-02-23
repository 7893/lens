# Changelog

All notable changes to this project will be documented in this file.

## [2026-02-23] - Architecture Upgrade

### Added
- **Analytics Engine (lens-ae)** - 全链路遥测系统，收集搜索延迟、错误率、进化效率
- **Trace ID 机制** - 每个请求/任务分配唯一 ID，支持跨组件日志追踪
- **Zod Schema 校验** - AI 输出强制契约验证，拒绝非结构化响应
- **D1 Migrations** - 数据库表结构版本化管理 (`migrations/0001_init_flagship.sql`)
- **Logger.metric()** - 统一的指标写入接口，自动关联 Trace ID
- **并发 Evolution** - 自进化改为 chunk=3 并发处理，提升效率
- **Stats KV 缓存** - 首页统计数据 60 秒缓存，减少 D1 压力
- **单元测试** - 新增 schemas、logger、ai、billing 测试，覆盖率从 8 提升到 32

### Changed
- **Vectorize 索引** - `lens-vectors` → `lens-vectorize`（产品名规范）
- **AI 输出格式** - 从正则解析改为 JSON + Zod 校验
- **Billing 日志** - 全面接入 Logger，支持 Trace ID

### Removed
- **schema.sql** - 改用 migrations 管理，删除冗余文件
- **lens-vectors** - 旧索引已迁移并删除

### Migration
- 20,610 条向量从 `lens-vectors` 迁移到 `lens-vectorize`

---

## [2026-02-22] - AI Gateway Billing API

### Added
- **billing.ts** - 基于 GraphQL 的官方计费 API 客户端
- **USD 预算控制** - 替代手动 Neuron 计数，实时审计实付金额

### Removed
- **quota.ts** - 手动 Neuron 追踪逻辑

---

## [2026-02-21] - Initial Release

### Added
- Lens 语义图片搜索引擎上线
- Unsplash 自动采集管道
- Llama 4 Scout 图片分析
- BGE-M3 向量嵌入
- BGE Reranker 结果重排
- Cloudflare Workers + D1 + R2 + Vectorize 全栈
