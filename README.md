# 🖼️ Pic - AI Photo Gallery

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-orange)](https://workers.cloudflare.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

基于 Cloudflare 无服务器生态的自动化图片收集和 AI 分类系统。从 Unsplash 获取照片，使用 AI 智能分类，存储在 R2，元数据保存在 D1。

## ✨ 特性

- 🤖 **自动收集**：每 10 分钟从 Unsplash 获取最新照片
- 🧠 **AI 分类**：使用 Cloudflare AI 模型智能分类
- 📦 **无服务器**：100% Cloudflare 生态（Workers + D1 + R2 + Workflows）
- 🔄 **去重机制**：基于游标的增量同步，避免重复
- 📊 **实时统计**：分类分布、处理状态、API 配额监控
- 🎯 **容错处理**：Workflow 步骤级重试，自动恢复

## 🚀 快速开始

### 前置要求

- Node.js 22.20.0（参见 `.nvmrc` 或 `.tool-versions`）
- Cloudflare 账户（启用 Workers、D1、R2、AI）
- Unsplash API Key（[免费申请](https://unsplash.com/developers)）

### 安装

```bash
# 克隆仓库
git clone git@github.com:7893/pic.git
cd pic

# 安装依赖
npm install

# 配置 Unsplash API Key
wrangler secret put UNSPLASH_API_KEY --config workers/pic-scheduler/wrangler.toml
```

### 初始化数据库

```bash
# 创建 D1 数据库
wrangler d1 create pic-d1

# 应用 schema
wrangler d1 execute pic-d1 --remote --file=workers/pic-scheduler/schema.sql
```

### 部署

```bash
# 部署所有服务
npm run deploy:all

# 或单独部署
npm run deploy:scheduler  # 后端调度器
npm run deploy:frontend   # 前端展示
```

### 验证

```bash
# 手动触发一次处理
curl -X POST https://pic-scheduler.53.workers.dev/api/trigger

# 查看统计
curl https://pic.53.workers.dev/api/stats

# 访问前端
open https://pic.53.workers.dev
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

### 当前架构（待优化）

```
Cron (10min) → Enqueue Photos → ProcessingQueue
                                      ↓
                              Download Workflow (30张)
                                      ↓
                              ProcessingQueue (已下载)
                                      ↓
                              Classify Workflow (30张)
                                      ↓
                              Photos 表 + R2 存储
```

**已知问题：**
- ⚠️ 双 Workflow 架构复杂，状态管理困难
- ⚠️ ProcessingQueue 表过度设计
- ⚠️ R2 临时文件需要手动清理
- ⚠️ 缺少幂等性保证

### 推荐架构（规划中）

```
Cron (10min) → Queue (60 messages) → Single Workflow
                                           ↓
                                    Download → Classify → Save
                                           ↓
                                    Photos 表 + R2 存储
```

**改进点：**
- ✅ 单一 Workflow，逻辑清晰
- ✅ 使用 Cloudflare Queues 解耦
- ✅ 步骤级重试，无需中间状态表
- ✅ 直接存最终位置，无临时文件

详见 [架构改进计划](docs/ARCHITECTURE.md)

### 技术栈

| 组件 | 技术 | 用途 |
|------|------|------|
| 计算 | Cloudflare Workers | 无服务器函数 |
| 数据库 | D1 (SQLite) | 元数据存储 |
| 存储 | R2 | 图片文件存储 |
| 编排 | Workflows | 多步骤任务编排 |
| 队列 | Queues (规划中) | 消息队列 |
| AI | Cloudflare AI | 图片分类 |
| 监控 | Analytics Engine | 事件追踪 |

## 📊 性能指标

### 当前状态
- **处理能力**：60 张照片/10分钟 = 8,640 张/天
- **API 调用**：2 次/10分钟 = 288 次/天（Unsplash 限制 50 次/小时）
- **AI 推理**：2 模型 × 8,640 张 = 17,280 次/天
- **成功率**：~100%（带重试机制）

### 资源使用（Cloudflare 免费套餐）
- Workers 请求：< 10 万次/天 ✅
- D1 读写：< 500 万次/天 ✅
- R2 存储：无限制 ✅
- AI 推理：无限制 ✅
- Workflows：10 万步/月 ⚠️（当前约 52 万步/月，需优化）

## 🛠️ 开发

```bash
# 本地开发
npm run dev:scheduler  # 启动调度器（端口 8787）
npm run dev:frontend   # 启动前端（端口 8788）

# 查看日志
wrangler tail pic-scheduler
wrangler tail pic-frontend

# 数据库操作
wrangler d1 execute pic-d1 --remote --command "SELECT COUNT(*) FROM Photos"

# 测试
npm test  # 运行单元测试
./scripts/test.sh  # 系统集成测试
```

## 📖 文档

- [架构改进计划](docs/ARCHITECTURE.md) - 从双 Workflow 迁移到 Queue + Single Workflow
- [部署指南](docs/DEPLOY.md) - 完整部署步骤和配置说明
- [API 文档](docs/API.md) - 前后端 API 接口说明
- [故障排查](docs/TROUBLESHOOTING.md) - 常见问题和解决方案

## 🔗 在线演示

- **前端**：https://pic.53.workers.dev
- **API**：https://pic-scheduler.53.workers.dev/api/stats

## 🤝 贡献

欢迎贡献！请遵循以下步骤：

1. Fork 本仓库
2. 创建特性分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'Add amazing feature'`）
4. 推送到分支（`git push origin feature/amazing-feature`）
5. 开启 Pull Request

详见 [贡献指南](CONTRIBUTING.md)

## 📝 许可证

MIT License - 详见 [LICENSE](LICENSE) 文件

## 🙏 致谢

- [Unsplash](https://unsplash.com/) - 提供高质量照片 API
- [Cloudflare](https://cloudflare.com/) - 提供无服务器平台
