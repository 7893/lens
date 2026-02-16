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

大部分"AI 图库"项目到 `npm start` 就结束了。我们不一样：

🔒 **端到端类型安全** — 纯 TypeScript，strict mode，零 `any`。`@pic/shared` 共享类型包锁死前后端契约 — API 返回什么、前端收到什么，编译期就确定。接口改了忘改前端？`tsc` 直接拦住你，不是等到线上 500 才发现。

📐 **单一部署产物** — 前端构建后打包进 Worker assets，API + 前端 + 图片代理同源同 Worker。不是分开部署三个服务再配 CORS、再搞 API Gateway。一个 `wrangler deploy`，完事。

🧱 **Monorepo 原子提交** — npm workspaces 管理 API、前端、类型定义、采集引擎。一次 commit 同时改四个包，不存在"后端上了新接口但前端还没跟上"的版本漂移窗口。

♻️ **幂等全链路** — D1 写入用 `ON CONFLICT DO UPDATE`，Vectorize 用 `upsert`，Cron 每轮全量同步。同一张图跑一百遍结果都一样。不怕重复消费，不怕 Workflow 重试，不怕网络抖动。

🔄 **事件驱动 + 自愈** — Cron → Queue → Workflow，完全异步解耦。采集管道和搜索管道互不干扰 — 搜索永远快，采集慢慢来。每一步独立重试，Vectorize 没同步？下一轮 Cron 自动补上。不需要人工干预，不需要告警群里 @all。

🏭 **基础设施即代码** — D1、Queue、Vectorize 全部 Terraform 声明式管理。新环境？`terraform apply`，30 秒拉起整套系统。不是手动在 Dashboard 上点点点，也不是一个谁也不敢动的 shell 脚本。

🚀 **55 秒 `git push` 到生产** — GitHub Actions：build shared → build web → copy assets → deploy Worker × 2。没有手动步骤，没有审批流程，没有"我本地能跑"。推了就上，挂了就回滚。

🧠 **边缘原生 AI** — 不是调 OpenAI API 等半天，是直接在 Cloudflare 边缘节点跑 LLaVA 视觉模型和 BGE 嵌入模型。模型离用户近，数据不出边缘网络。也不用自己管 GPU、装 CUDA、搞模型服务。

🪶 **极简架构** — 两个 Worker 撑起整个系统。没有微服务地狱，没有 sidecar，没有 service mesh，没有 Kubernetes。简单到离谱，但它就是能跑，而且跑得很好。

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
