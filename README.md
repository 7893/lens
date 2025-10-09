# 🖼️ Pic - AI 驱动的图片收集系统

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

基于 Cloudflare 无服务器生态系统构建的自动化图片收集和分类系统。从 Unsplash API 获取照片，使用 AI 进行分类，并将其存储在 R2 中，元数据保存在 D1 数据库中。

## ✨ 特性

- 🤖 **自动收集**：每 10 分钟从 Unsplash 获取 60 张照片
- 🧠 **AI 分类**：使用 2 个 Cloudflare AI 模型进行智能分类
- 📦 **无服务器架构**：100% 基于 Cloudflare Workers、D1、R2 和 Workflows
- 🔄 **游标同步**：通过智能分页防止重复照片
- 📊 **实时统计**：带有处理指标的实时仪表板
- 🎯 **检查点系统**：具有自动重试的容错处理

## 🚀 快速开始

### 前置要求

- Node.js 22.19.0（参见 `.nvmrc`）
- 启用了 Workers、D1、R2 和 AI 的 Cloudflare 账户
- Unsplash API 密钥

### 安装

```bash
# 克隆仓库
git clone <your-repo-url>
cd pic

# 安装依赖
npm install

# 设置环境变量
cp workers/pic-scheduler/.env.example workers/pic-scheduler/.env
# 编辑 .env 并添加你的 UNSPLASH_API_KEY
```

### 部署

```bash
# 部署所有服务
npm run deploy

# 或单独部署
npm run deploy:scheduler
npm run deploy:frontend
```

## 📁 项目结构

```
pic/
├── .github/
│   └── workflows/          # GitHub Actions CI/CD
├── docs/                   # 文档
│   ├── DEPLOY.md          # 部署指南
│   ├── STATUS.md          # 系统状态
│   └── SUMMARY.md         # 项目摘要
├── scripts/               # 实用脚本
│   └── test.sh           # 系统测试脚本
├── workers/
│   ├── pic-scheduler/    # 后端 Worker
│   │   ├── src/
│   │   │   ├── workflows/    # 下载和分类工作流
│   │   │   ├── tasks/        # 任务实现
│   │   │   ├── services/     # 外部服务
│   │   │   └── utils/        # 工具函数
│   │   ├── schema.sql        # D1 数据库架构
│   │   └── wrangler.toml     # Worker 配置
│   └── pic-frontend/     # 前端 Worker
│       ├── src/
│       └── wrangler.toml
├── package.json          # 根工作区配置
├── .nvmrc               # Node 版本锁定
└── README.md
```

## 🏗️ 架构

### 组件

- **pic-scheduler**：定时触发的后端，编排照片收集
- **pic-frontend**：用于浏览照片和查看统计信息的 Web UI
- **pic-download-wf**：下载照片到 R2 的工作流
- **pic-classify-wf**：AI 分类工作流

### 技术栈

| 组件 | 技术 |
|------|------|
| 计算 | Cloudflare Workers |
| 数据库 | Cloudflare D1 (SQLite) |
| 存储 | Cloudflare R2 |
| 编排 | Cloudflare Workflows |
| AI | Cloudflare AI (Llama 3.2-3B, Mistral 7B) |
| 分析 | Analytics Engine |
| 图片源 | Unsplash API |

### 数据流

```
Cron（每 10 分钟）
  → EnqueuePhotosTask（通过 2 次 API 调用获取 60 张照片）
    → ProcessingQueue（待处理）
      → DownloadWorkflow（下载到 R2）
        → ProcessingQueue（已下载）
          → ClassifyWorkflow（AI 分类）
            → Photos 表（已完成）
```

## 📊 性能

- **吞吐量**：360 张照片/小时（8,640 张/天）
- **API 使用**：288 次 Unsplash API 调用/天
- **AI 推理**：约 17,000 次调用/天（2 个模型 × 8,640 张照片）
- **成功率**：100%（带重试机制）

## 🛠️ 开发

```bash
# 启动本地开发
npm run dev:scheduler
npm run dev:frontend

# 运行测试
npm test

# 检查系统状态
./scripts/test.sh
```

## 📖 文档

- [部署指南](docs/DEPLOY.md)
- [系统状态](docs/STATUS.md)
- [项目摘要](docs/SUMMARY.md)

## 🔗 在线演示

- **前端**：https://pic.53.workers.dev
- **调度器 API**：https://pic-scheduler.53.workers.dev

## 🤝 贡献

欢迎贡献！请随时提交 Pull Request。

## 📝 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- [Unsplash](https://unsplash.com/) 提供照片 API
- [Cloudflare](https://cloudflare.com/) 提供无服务器平台
