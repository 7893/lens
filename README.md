# Lens

**AI-Powered Semantic Image Search on Cloudflare Edge**

> 你搜"孤独感"，它给你一条雪夜独行的小巷。你搜"温暖"，它给你壁炉旁的猫。
> 不是关键词匹配 — 是 AI 真的看懂了每一张图。

[![Live Demo](https://img.shields.io/badge/Live-lens.53.workers.dev-F38020?logo=cloudflare&logoColor=white)](https://lens.53.workers.dev)
[![TypeScript](https://img.shields.io/badge/100%25-TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 这是什么

Lens 是一个**全自动、语义驱动**的 AI 图片搜索引擎。

传统图片搜索靠标签、文件名、关键词。Lens 不一样 — 它让 AI 真正"看"每一张图，理解画面里的情绪、氛围、故事，甚至能**识别具体的品牌、地标，并对图片的审美质量进行打分**。

你可以搜"那种让人心碎的落日"、"带耐克标志的运动街拍"、"极简主义风格的建筑"，它都能精准捕捉。

---

## 为什么牛逼

### 🧠 三级搜索管道

不是简单的向量匹配就完事了：

1. **查询扩展** — 你输入"猫"，AI 自动补充"毛茸茸、慵懒、宠物、温馨"
2. **向量检索** — 1024 维语义向量，从万级图库中毫秒级召回
3. **LLM 重排** — 大模型逐个审视候选结果，按相关性重新排序

三层漏斗，层层过滤，结果就是比普通向量搜索准得多。

### ⚡ 零运维架构

没有服务器。没有容器。没有 K8s。没有 GPU 实例。

整个系统跑在 Cloudflare Edge 上：

- **Workers** 处理请求，全球边缘节点，延迟极低
- **D1** 存元数据，SQLite 内核，就近访问
- **R2** 存图片，S3 兼容，零出口流量费
- **Vectorize** 存向量，原生向量数据库
- **Workflows** 跑后台任务，持久化执行，自动重试

部署一次，永远在线。不用半夜爬起来修服务器。

### 🤖 全自动数据采集与进化

系统自己会"长大"，且不断变聪明：

- 每小时自动从 Unsplash 抓取最新图片
- 同时回填历史数据，图库持续膨胀
- **数据自进化**：利用每日剩余免费 AI 额度，自动将旧版描述升级为旗舰级理解。
- 不需要人工干预，7x24 小时运转

### 🔄 双管道解耦

搜索和采集完全分离：

- **搜索管道**：同步，毫秒级响应，用户体验优先
- **采集管道**：异步，后台慢慢跑，不影响前台

采集任务堆积？没关系，搜索照样快。这就是工程上的解耦。

### 💰 成本控制

精打细算每一分钱：

- Unsplash API 免费版每小时 50 次，算法设计充分利用每一次配额
- Workflow 第一步检查图片是否已存在，重复的直接跳过，不浪费 AI 调用
- R2 零出口费，图片随便访问不心疼
- 整套系统跑在 Cloudflare 免费额度内

### 🛡️ 数据一致性

三个存储，三份数据，必须一致：

- D1 存元数据
- R2 存图片文件
- Vectorize 存向量

每次写入都是原子操作，Workflow 保证要么全成功，要么全失败。不会出现"图片有了但搜不到"的尴尬。

---

## 技术亮点

| 特性           | 实现                                     |
| :------------- | :--------------------------------------- |
| 语义搜索       | Llama 4 Scout + Gemma 3 768 维向量       |
| 查询理解       | LLM 自动扩展、翻译、视觉词汇补全         |
| 结果重排       | BGE Reranker Base 专用精排模型           |
| 图片理解       | Llama 4 Scout 17B 生成审美评分与实体识别 |
| 持久化任务     | Cloudflare Workflows，自动重试最多 10 次 |
| 数据进化       | 异步余粮算法，自动升级存量索引版本       |
| 边缘部署       | 全球 300+ 节点，就近响应                 |
| 基础设施即代码 | Terraform 管理，一键重建                 |

---

## 系统架构 (Architecture)

```text
       用户 (User)
          │
          ▼
┌─────────────────────────────────────────┐
│           Search API (Hono)             │
│                                         │
│  查询扩展 → 向量检索 → LLM重排 → 返回   │
└─────────────────────────────────────────┘
          │           │           │
          ▼           ▼           ▼
      D1 Database  Vectorize   R2 Bucket
      (元数据)      (向量索引)  (图片存储)
          ▲           ▲           ▲
          │           │           │
┌─────────────────────────────────────────┐
│        数据采集管道 (Ingestion)         │
│                                         │
│  检查存在 → 下载 → AI分析 → 写入同步    │
└─────────────────────────────────────────┘
          ▲           ▲
          │           │
      Cloudflare    Cron任务
        Queue      (每小时)
```

---

## 📚 文档中心 (Documentation Index)

- [**01. 系统架构与算法详解**](docs/01-architecture/01-ARCHITECTURE.md) — 深度剖析双管道解耦与高水位线采集算法。
- [**02. 存储与数据模型**](docs/02-storage/02-DATABASE-STORAGE.md) — D1、R2 与 Vectorize 的表结构与一致性策略。
- [**03. 完整接口指南**](docs/03-api/03-API-REFERENCE.md) — 详细的 API 字段定义与交互示例。
- [**04. 全栈部署与 IaC**](docs/04-deployment/04-DEPLOYMENT-GUIDE.md) — 修正后的手动部署与 GitHub Actions 流程。
- [**05. 开发与扩展指南**](docs/05-development/05-DEVELOPMENT-CONTRIBUTING.md) — AI 提示词工程、Monorepo 模式与模型切换。
- [**06. 运维与监控**](docs/06-maintenance/06-MAINTENANCE-MONITORING.md) — AI 成本控制、故障排查与数据库管理。

---

## License

MIT
