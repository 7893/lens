# 🖼️ Pic

> 你搜"孤独感"，它给你一条空旷的街道。你搜"温暖"，它给你壁炉旁的猫。
>
> 这不是关键词匹配。这是 AI 真的看懂了图片。

[![Cloudflare Workers](https://img.shields.io/badge/Runs_on-Cloudflare_Edge-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![TypeScript](https://img.shields.io/badge/100%25-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 这玩意儿能干嘛

一个**全自动运转的 AI 图库**。你不需要管它 — 它每小时自己去 Unsplash 抓图，让 AI 看一遍，生成语义向量，存好。然后你可以用**任何自然语言**搜图。

没有服务器。没有容器。没有运维。月账单约等于零。

## 凭什么说它牛

```
零服务器     没有 EC2，没有 K8s，纯边缘计算，全球 300+ 节点
零冷启动     Cloudflare Workers，不是 Lambda 那种要等半天的
零运维       Cron 自动采集，Workflow 自动重试，推代码自动部署
零出口费     R2 不收出口流量费，图片随便看
趋近零成本   D1 免费额度 + Workers AI 按量计费 = 几乎不花钱
```

## 它是怎么工作的

**你搜图的时候：**

```
  "sunset over ocean"
         │
         ▼
    ┌─────────┐  BGE 向量化   ┌───────────┐  余弦相似度  ┌────┐
    │   pic   │ ────────────▶ │ Vectorize │ ──────────▶ │ D1 │ ──▶ 🎯 结果
    │ Worker  │               └───────────┘             └────┘
    └─────────┘
         │ 图片直出
         ▼
       ┌────┐
       │ R2 │  ← 零出口费，随便造
       └────┘
```

**你不在的时候（每小时自动执行）：**

```
    ⏰ Cron
       │
       ▼
  ┌───────────────┐     ┌───────┐     ┌─────────────────────────────┐
  │ pic-processor │ ──▶ │ Queue │ ──▶ │    PicIngestWorkflow        │
  └───────────────┘     └───────┘     │                             │
                                      │  📥 下载原图 + 展示图 → R2  │
                                      │  👁️ LLaVA 看图说话          │
                                      │  🧮 BGE 生成 768 维向量     │
                                      │  💾 写入 D1                 │
                                      └─────────────────────────────┘
                                                    │
                              Cron 顺手同步 ──────▶ Vectorize
```

每一步独立重试。单步炸了不影响整体。你睡觉，它干活。

## 技术栈

| 干什么 | 用什么 | 为什么 |
|--------|--------|--------|
| API + 前端 | Hono Worker + React/Vite | 一个 Worker 搞定一切，同源零跨域 |
| 采集引擎 | Workflows + Queues | 长任务编排，自动重试 |
| 图片存储 | R2 | 零出口费，存原图不心疼 |
| 元数据 | D1 (SQLite at Edge) | 关系查询，免费额度大 |
| 语义搜索 | Vectorize (768d, cosine) | 原生集成，毫秒级 |
| 看图 | LLaVA 1.5 7B | 边缘推理，不用自己部署 GPU |
| 向量化 | BGE Base EN v1.5 | 768 维，够用且快 |
| 基础设施 | Terraform | 声明式，一键拉起 |
| 部署 | GitHub Actions | `git push` = 上线 |

## 工程亮点

- **纯 TypeScript** — 代码、类型、配置，全是 TS。共享类型包让前后端契约在编译期就锁死
- **Monorepo** — npm workspaces，一次 commit 改 API + 前端 + 类型，原子提交
- **IaC** — Terraform 管理 D1/Queue/Vectorize，`terraform apply` 一键拉起整套基础设施
- **CI/CD** — 推到 main 自动构建部署，55 秒上线

## 文档

| 文档 | 内容 |
|------|------|
| [系统设计](docs/architecture/DESIGN.md) | 双管道架构、数据流、组件关系 |
| [前端架构](docs/architecture/FRONTEND_DESIGN.md) | React + SWR + Tailwind 实现细节 |
| [API 参考](docs/api/OPENAPI.md) | 接口定义、请求响应示例 |
| [开发指南](docs/guide/DEVELOPMENT.md) | 本地开发、类型检查、目录结构 |
| [部署指南](docs/guide/SETUP.md) | 从零部署完整系统 |
| [架构决策](docs/ADR/001-architecture-decisions.md) | 为什么选 D1 不选 KV？为什么要 Vectorize？ |

## License

MIT — 随便用，记得给 star ⭐
