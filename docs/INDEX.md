# Lens 文档索引

更新日期：2026-09-19
状态：现行索引
适用范围：项目规范、架构设计、技术决策与运维手册入口

---

## 核心必读（活文档入口）

1. [AGENTS.md](../AGENTS.md)：仓库硬约束、AI 行为边界与跨 CLI 协作入口。
2. [CURRENT-STATE.md](CURRENT-STATE.md)：项目当前最高事实入口（运行环境、Bindings、数据库规模、质量基线）。
3. [INDEX.md](INDEX.md)：本文档索引，所有存活现行文档的唯一直达入口。
4. [KNOWN-ISSUES.md](KNOWN-ISSUES.md)：仓内技术债务与缺陷看板（本地闭环，替代外部 Issue）。

---

## 系统设计与开发规约（现行活文档）

- [ARCHITECTURE.md](ARCHITECTURE.md)：系统宏观架构、边缘计算拓扑与核心搜索/流水线算法规范。
- [API.md](API.md)：API 接口契约与网关规范（输入输出契约、SSE 流式通信与错误模型）。
- [DATABASE.md](DATABASE.md)：存储体系、数据契约与多维索引治理（D1、R2、Vectorize、KV 异构存储规范）。
- [DEVELOPMENT.md](DEVELOPMENT.md)：模块架构、开发规范与边缘工程实践指南（分层边界、边缘约束与类型安全）。
- [DEPLOYMENT.md](DEPLOYMENT.md)：构建编排、持续交付与云原生部署指南（Monorepo 构建、D1 迁移与 CI/CD）。
- [MAINTENANCE.md](MAINTENANCE.md)：系统运维、配额审计与全生命周期监控手册（指标巡检、FinOps 审计与应急预案）。
- [FAQ.md](FAQ.md)：核心架构、技术权衡与常见问题解答（FAQ）。

---

## 架构决策记录（ADR，死文档·只增不改）

所有对架构、安全、数据与重要流程产生深远影响的决策均沉淀于 [decisions/](decisions/)：

- [ADR-0000 架构决策记录模板](decisions/0000-ADR-TEMPLATE.md)：ADR 书写格式与生命周期状态规范。
- [ADR-0001 自研轻量 OpenTelemetry 兼容分布式追踪](decisions/0001-custom-agent-tracing.md)：替代重型 Agent 框架，实现微秒级冷启动与全链路可观测。
- [ADR-0002 引入 CodeGraph、Graphify 与 Pi 本地知识体系](decisions/0002-codegraph-graphify-pi-tooling.md)：增强代码导航，本地衍生数据隔离于 Git 之外。
- [ADR-0003 生产 D1 数据库只读保护与安全防线](decisions/0003-d1-readonly-protection.md)：防止不可逆的批处理或 DDL 删除对远端数据库造成破坏。
- [ADR-0004 全面确立 AI 驱动与人机协同研发范式总纲](decisions/0004-ai-driven-engineering-framework.md)：确立双层图谱导航、Harness 领域边界与自动化闸门四大工程支柱。
- [ADR-0005 Lens 2.0 次世代架构演进与重构蓝图](decisions/0005-lens-v2-architecture-blueprint.md)：规划原生多模态联合表征、Workers RPC 双核解耦、事务发件箱与多源适配演进路径。（已由 ADR-0006 取代）
- [ADR-0006 Lens 长期架构基线——单 Worker、Cloudflare 原生模块化单体](decisions/0006-single-worker-cloudflare-native-refactor.md)：确立每环境单 Worker 部署与模块化单体，定义 D1 单一事实源、R2 规范 Master 长期归档、发件箱最终一致性与版本化搜索投影。

---

## 文档生命周期管理规则

本项目遵循 **“活死分离、单一事实、机制优先于自觉”** 的治理原则：

1. **活文档（Living）**：描述“当前状态”，随代码提交必须原子同步更新；
2. **死文档（Frozen）**：记录“当时事实”（如 ADR），写完即冻结，只增不改，改动时以新增记录取代；
3. **防掉队闸门**：所有现行文档必须在本索引中登记，并通过 `pnpm run check:docs` 自动化校验，防止死链与孤立文档。

- [ADR-0007: Administrative authentication](decisions/0007-administrative-authentication.md)
- [Third-party image rights](ASSET-RIGHTS.md)
