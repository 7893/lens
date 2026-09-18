# ADR-0002: 引入 CodeGraph、Graphify 与 Pi 本地知识体系

更新日期：2026-09-18
状态：采纳
责任人：@lens-team
适用范围：本地 AI 辅助编码、上下文索引、领域约束与 Harness 验收

---

## 背景 (Context)

随着 Lens Monorepo 项目结构（`apps/engine`, `apps/client`, `packages/shared`）和业务深度不断增长：

1. 通用的大模型在面对几十个文件时，常依赖暴力 `grep` 或盲目遍历，消耗大量 Context 窗口且容易遗漏深层调用关系；
2. 缺乏领域划分与任务验收检查机制，在多 Agent 协同修改时容易产生范围漂移。

## 决策 (Decision)

我们决定为 Lens 引入三套轻量、无侵入的本地 AI 增强工具链：

1. **CodeGraph**：初始化 `.codegraph/`，建立 AST 级别的符号引用与调用图拓扑数据库；
2. **Graphify**：提取多模态知识图谱（`graphify-out/`），提供架构社区发现与语义关联分析；
3. **Pi / Local Harness**：在 `.pi/` 中配置 `harness.json` 和 `settings.json`，将项目划分为 `engine`, `client`, `shared`, `docs`, `tooling`, `infra` 6 大领域，明确各领域范围与检查命令；
4. **Git 严格隔离**：将 `.codegraph/`、`graphify-out/` 及 `.graphify*` 完全列入 `.gitignore`，避免大体积衍生缓存污染版本库。

## 理由与考量 (Rationale)

- **高效代码定位**：通过 `codegraph explore` 和 `graphify query`，AI 能够在单个调用中直达关键符号与架构上下文，避免无效扫描；
- **任务边界隔离**：通过 Local Harness 约束，AI 在接手特定领域任务时只读取相关上下文并运行特定领域检查；
- **零仓库负担**：所有索引数据库均在本地生成且被 Git 忽略，不影响 CI 构建与远程部署。

## 影响与后果 (Consequences)

- **正面收益**：AI 读代码速度与准确度大幅提升，跨模块调用关系一目了然；
- **维护成本**：在修改核心代码后，需要偶尔执行 `codegraph init -y` 或 `graphify update .` 刷新索引（纯本地 AST 解析，耗时仅数秒）。
