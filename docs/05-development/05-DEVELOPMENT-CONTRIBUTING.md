# 开发与扩展指南 (05-DEVELOPMENT-CONTRIBUTING)

本指南面向希望深入参与 Lens 核心开发或进行功能扩展的开发者。

---

## 1. Monorepo 体系结构

Lens 采用 pnpm workspaces 驱动的 Monorepo 结构，各组件高度解耦：

- **`packages/shared`**: 整个系统的“骨架”。定义了 D1 表结构接口、API 响应契约、环境绑定类型及共享配置常量。
- **`apps/api`**: Hono 后端。负责流量分发、AI 搜索编排及 KV 缓存管理。
- **`apps/processor`**: 采集心脏。承载了“线性对撞”算法及 Workflow 状态机。
- **`apps/web`**: React 前端。实现高性能图片画廊。

---

## 2. 核心 AI 提示词 (Prompts)

AI 表现的优劣取决于提示词的质量。修改提示词前请进行充分回归测试。

### 2.1 采集端：视觉理解 (Llama 4 Scout 17B)

位于: `apps/processor/src/services/ai.ts`

> `Act as a world-class gallery curator and senior photographer. Analyze this image for deep-index retrieval...`

### 2.2 搜索端：语义扩展 (Llama 4 Scout 17B)

位于: `apps/api/src/index.ts`

> `Expand this image search query with related visual terms. If the query is not in English, translate it to English first, then expand. Reply with ONLY the expanded English query, no explanation. Keep it under 30 words.`

---

## 3. 维护规范：代码准则

### 3.1 线性边界原则

在修改 `processor` 的抓取逻辑时，必须确保 **`filterAndEnqueue`** 的返回值被正确处理。

- 严禁在 `Forward` 阶段移除 `hitExisting` 熔断判断，否则会导致 API 配额瞬间枯竭。

### 3.2 内存敏感度

由于边缘 Worker 内存仅 128MB：

- 处理图片时，严禁使用 `Array.from(uint8Array)` 或大范围 `spread [...]` 转换。
- 应尽量维持 `Uint8Array` 的原始引用。

---

## 4. 本地测试技巧

### 4.1 模拟 D1 行为

```bash
# 在 apps/api 目录下运行以启动本地 SQLite 模拟环境
npx wrangler dev --remote --persist
```

### 4.2 强校验

在提交 PR 之前，请务必在根目录运行：

```bash
pnpm run lint
pnpm run typecheck
```

这两个 Quality Gate 是 CI 通过的硬性条件。
