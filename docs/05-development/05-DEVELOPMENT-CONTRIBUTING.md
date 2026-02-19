# 开发与扩展指南 (05-DEVELOPMENT-CONTRIBUTING)

Lens 是一个基于 Monorepo 的项目，本指南将帮助您理解其代码结构、开发模式以及核心的 AI 提示词逻辑。

---

## 1. 项目结构 (Monorepo)

```text
lens/
├── apps/
│   ├── api/          # 核心 API 服务 (Hono + React Frontend)
│   ├── processor/    # 采集引擎 (Cron + Queue + Workflow)
│   └── web/          # 前端单页应用源码 (React + Tailwind)
├── packages/
│   └── shared/       # 共享类型定义 (D1 Schema, API 契约, DTOs)
└── docs/             # 完整系统文档
```

### 1.1 开发流程
1.  **修改 API 契约**: 所有的类型定义都在 `packages/shared/src/index.ts` 中。修改后，必须运行 `pnpm build --filter "@lens/shared"`。
2.  **前端实时预览**: 
    ```bash
    cd lens/apps/web && pnpm dev
    ```
3.  **API 本地模拟**:
    ```bash
    cd lens/apps/api && ppx wrangler dev
    ```

---

## 2. AI 提示词工程 (Prompt Engineering)

AI 的表现取决于提示词。Lens 的三级搜索增强逻辑背后是经过精心调优的 Llama 3.2 提示词。

### 2.1 查询扩展提示词 (Query Expansion)
用于将简短关键词转化为视觉丰富词：
> `Expand this image search query with related visual terms. If the query is not in English, translate it to English first, then expand. Reply with ONLY the expanded English query, no explanation. Keep it under 30 words.
Query: {q}`

### 2.2 结果重排提示词 (Re-ranking)
用于在向量初筛后，根据原查询词进行相关性精修排序：
> `Given the search query "{q}", rank the most relevant images by their index number. Return ONLY a comma-separated list of index numbers from most to least relevant. Only include the top 20 most relevant.

Images:
{summaries}`

### 2.3 视觉理解 (Captioning)
由 Llama 3.2 Vision 根据图片生成的描述。

---

## 3. 模型切换与性能权衡

Lens 默认使用的是 Cloudflare 提供的 **Llama 3.2 11B Vision Instruct**。

如果您希望切换到更轻量的模型或更高精度的外部 API（如 OpenAI gpt-4o-mini）：
1.  **修改 AI 推理入口**: 在 `apps/processor/src/services/ai.ts` 中更新模型 ID。
2.  **调整 BGE 维度**: 如果更换了文本嵌入模型（Embedding Model），请务必更新 Vectorize 的 `dimensions` 参数（默认 1024）。

---

## 4. 编码规范

- **类型安全**: 严格禁止使用 `any`。所有 D1 查询必须通过 `@lens/shared` 中定义的接口进行泛型注解。
- **异步控制**: 使用 `p-limit` 或 Cloudflare 队列限流，避免瞬时 AI 推理并发导致 Neurons 超出限额。
- **Workflow 幂等性**: 每个 Workflow 步骤（Step）必须是幂等的，即重复执行不应产生副作用。
