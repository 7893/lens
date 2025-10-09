# 项目结构说明

本文档详细说明 Pic 项目的目录结构和文件组织。

## 📁 目录树

```
pic/
├── .git/                       # Git 版本控制
├── .github/                    # GitHub 配置（可选）
│   ├── workflows/              # GitHub Actions
│   └── ISSUE_TEMPLATE/         # Issue 模板
├── docs/                       # 项目文档
│   ├── API.md                  # API 接口文档
│   ├── CONFIGURATION.md        # 配置指南
│   ├── DEPLOYMENT.md           # 部署指南
│   ├── SECURITY.md             # 安全最佳实践
│   ├── PROJECT_STRUCTURE.md    # 本文件
│   ├── AI_CLASSIFICATION_STRATEGY.md  # AI 分类策略
│   ├── CHANGES_SUMMARY.md      # 变更总结
│   ├── MIGRATION_PLAN.md       # 迁移计划
│   └── README_MIGRATION.md     # 迁移说明
├── public/                     # 静态资源（前端）
│   ├── index.html              # 主页面
│   ├── main.js                 # 前端 JavaScript
│   └── style.css               # 样式表
├── scripts/                    # 工具脚本
│   ├── deploy.sh               # 部署脚本
│   ├── check-consistency.js    # 数据一致性检查
│   ├── migrate-and-fix.js      # 迁移和修复脚本
│   └── run-migration.js        # 运行迁移
├── src/                        # 源代码
│   ├── index.js                # Worker 主入口
│   ├── index.test.js           # 测试文件
│   ├── services/               # 服务模块
│   │   ├── ai-classifier.js    # AI 分类服务
│   │   ├── analytics.js        # 分析统计
│   │   ├── classifier-do.js    # 分类 Durable Object
│   │   ├── downloader.js       # 下载服务
│   │   ├── migration-do.js     # 迁移 Durable Object
│   │   ├── reclassifier.js     # 重新分类服务
│   │   ├── redownload-do.js    # 重下载 Durable Object
│   │   ├── state.js            # 状态管理（KV）
│   │   ├── task.js             # 任务管理
│   │   ├── unsplash.js         # Unsplash API 客户端
│   │   └── README.md           # 服务模块说明
│   └── templates/              # HTML 模板
│       └── home.html           # 首页模板
├── .gitignore                  # Git 忽略规则
├── .env.example                # 环境变量模板
├── CONTRIBUTING.md             # 贡献指南
├── LICENSE                     # MIT 许可证
├── README.md                   # 项目主文档
├── package.json                # Node.js 依赖配置
├── schema.sql                  # D1 数据库 Schema
└── wrangler.toml               # Cloudflare Workers 配置
```

## 📂 目录说明

### `/` 根目录

| 文件 | 说明 | 重要性 |
|------|------|--------|
| `README.md` | 项目主文档，快速开始指南 | ⭐⭐⭐ |
| `wrangler.toml` | Cloudflare Workers 配置文件 | ⭐⭐⭐ |
| `package.json` | Node.js 项目配置和依赖 | ⭐⭐⭐ |
| `schema.sql` | D1 数据库表结构定义 | ⭐⭐⭐ |
| `.gitignore` | Git 忽略规则（包含机密文件） | ⭐⭐⭐ |
| `.env.example` | 环境变量配置模板 | ⭐⭐⭐ |
| `LICENSE` | MIT 开源许可证 | ⭐⭐ |
| `CONTRIBUTING.md` | 贡献指南 | ⭐⭐ |

### `/src` 源代码

#### `src/index.js` - 主入口

Worker 的主入口文件，负责：
- 路由处理
- 请求分发
- 认证验证
- 响应构建

**主要路由：**
```javascript
GET  /                      # 首页
GET  /api/categories        # 获取分类列表
GET  /api/images            # 获取图片列表
GET  /image/:id             # 获取图片
POST /api/migrate           # 启动迁移（管理）
GET  /api/migrate/status    # 迁移状态（管理）
POST /api/classify/start    # 启动分类（管理）
POST /api/redownload/start  # 启动重下载（管理）
GET  /cron                  # Cron 触发器（管理）
```

#### `src/services/` - 服务模块

| 文件 | 职责 | 依赖 |
|------|------|------|
| `ai-classifier.js` | AI 分类（4 模型并行） | Workers AI |
| `analytics.js` | 统计分析 | Analytics Engine |
| `classifier-do.js` | 后台分类 DO | AI, D1, R2 |
| `downloader.js` | 图片下载管理 | Unsplash, R2, D1 |
| `migration-do.js` | 数据迁移 DO | D1, R2, AI |
| `reclassifier.js` | 重新分类 | AI, D1, R2 |
| `redownload-do.js` | 批量重下载 DO | Unsplash, R2, D1 |
| `state.js` | 状态管理 | KV |
| `task.js` | 任务编排 | Downloader, State |
| `unsplash.js` | Unsplash API 封装 | Unsplash API |

**服务依赖关系：**
```
index.js
  ├── task.js
  │   ├── downloader.js
  │   │   ├── unsplash.js
  │   │   └── ai-classifier.js
  │   └── state.js
  ├── classifier-do.js
  │   └── ai-classifier.js
  ├── migration-do.js
  │   └── ai-classifier.js
  └── redownload-do.js
      └── unsplash.js
```

#### `src/templates/` - HTML 模板

| 文件 | 说明 |
|------|------|
| `home.html` | 首页 HTML 模板 |

### `/public` 静态资源

前端文件，通过 Cloudflare Workers Assets 服务：

| 文件 | 说明 | 大小 |
|------|------|------|
| `index.html` | 前端主页面 | ~4KB |
| `main.js` | 前端 JavaScript（图片加载、分类切换） | ~18KB |
| `style.css` | 样式表（响应式设计） | ~8KB |

### `/docs` 文档

| 文件 | 内容 | 受众 |
|------|------|------|
| `API.md` | API 接口文档 | 开发者 |
| `CONFIGURATION.md` | 配置指南 | 运维人员 |
| `DEPLOYMENT.md` | 部署指南 | 运维人员 |
| `SECURITY.md` | 安全最佳实践 | 开发者、运维 |
| `PROJECT_STRUCTURE.md` | 项目结构说明（本文件） | 新贡献者 |
| `AI_CLASSIFICATION_STRATEGY.md` | AI 分类策略 | 开发者 |
| `CHANGES_SUMMARY.md` | 变更总结 | 所有人 |
| `MIGRATION_PLAN.md` | 迁移计划 | 开发者 |
| `README_MIGRATION.md` | 迁移说明 | 运维人员 |

### `/scripts` 工具脚本

| 文件 | 用途 | 使用场景 |
|------|------|----------|
| `deploy.sh` | 自动化部署脚本 | CI/CD |
| `check-consistency.js` | 数据一致性检查 | 维护 |
| `migrate-and-fix.js` | 迁移和修复数据 | 一次性任务 |
| `run-migration.js` | 运行迁移 | 一次性任务 |

## 🔧 配置文件

### `wrangler.toml`

Cloudflare Workers 配置文件，包含：

```toml
[vars]                      # 环境变量
[assets]                    # 静态资源配置
[triggers]                  # Cron 触发器
[[kv_namespaces]]          # KV 命名空间
[[d1_databases]]           # D1 数据库
[[r2_buckets]]             # R2 存储桶
[[durable_objects.bindings]] # Durable Objects
[[analytics_engine_datasets]] # Analytics Engine
[ai]                       # Workers AI
[[migrations]]             # DO 迁移历史
```

**注意：** 机密信息（API Key、Token）不在此文件中，使用 `wrangler secret put` 设置。

### `package.json`

Node.js 项目配置：

```json
{
  "name": "pic",
  "version": "1.0.0",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest"
  },
  "devDependencies": {
    "wrangler": "^3.x.x"
  }
}
```

### `schema.sql`

D1 数据库表结构：

```sql
-- 图片元数据
CREATE TABLE downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  image_id TEXT NOT NULL UNIQUE,
  download_url TEXT NOT NULL,
  author TEXT,
  description TEXT,
  category TEXT,
  width INTEGER,
  height INTEGER,
  file_size INTEGER,
  downloaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 下载状态
CREATE TABLE download_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_page INTEGER DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- API 统计
CREATE TABLE api_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  status_code INTEGER,
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## 🗂️ 数据存储

### R2 存储结构

```
pic-r2/
├── landscape/
│   ├── abc123.jpg
│   ├── def456.jpg
│   └── ...
├── portrait/
│   ├── ghi789.jpg
│   └── ...
├── architecture/
│   └── ...
├── uncategorized/
│   ├── xyz999.jpg  # 待分类
│   └── ...
└── [其他动态分类]/
```

### D1 数据库

- **表数量：** 3 个
- **索引：** `image_id`, `category`, `downloaded_at`
- **大小：** ~100KB（808 条记录）

### KV 存储

```
download:state          # 下载状态
migration:progress      # 迁移进度
classifier:progress     # 分类进度
redownload:progress     # 重下载进度
```

## 📊 代码统计

```
Language      Files    Lines    Code    Comments    Blanks
─────────────────────────────────────────────────────────
JavaScript       11     1500     1200        150       150
HTML              2      300      250         20        30
CSS               1      200      180         10        10
SQL               1       50       40          5         5
Markdown         10     2000     1500        100       400
─────────────────────────────────────────────────────────
Total            25     4050     3170        285       595
```

## 🔄 文件生命周期

### 开发流程

1. **编辑源代码** → `src/`
2. **本地测试** → `wrangler dev`
3. **提交代码** → Git
4. **部署** → `wrangler deploy`

### 配置流程

1. **复制模板** → `cp .env.example .dev.vars`
2. **填写配置** → 编辑 `.dev.vars`
3. **本地测试** → `wrangler dev`
4. **设置生产 Secrets** → `wrangler secret put`
5. **部署** → `wrangler deploy`

### 文档流程

1. **编写文档** → `docs/`
2. **更新 README** → `README.md`
3. **提交** → Git
4. **发布** → GitHub

## 🚀 扩展指南

### 添加新服务

1. 在 `src/services/` 创建新文件
2. 导出服务类或函数
3. 在 `src/index.js` 中导入
4. 添加路由处理
5. 更新文档

示例：
```javascript
// src/services/new-service.js
export class NewService {
  constructor(env) {
    this.env = env;
  }
  
  async doSomething() {
    // 实现逻辑
  }
}

// src/index.js
import { NewService } from './services/new-service.js';

// 在路由中使用
if (url.pathname === '/api/new') {
  const service = new NewService(env);
  const result = await service.doSomething();
  return Response.json(result);
}
```

### 添加新 Durable Object

1. 创建 DO 类文件 `src/services/my-do.js`
2. 在 `src/index.js` 中导出
3. 在 `wrangler.toml` 中添加绑定
4. 创建迁移标签
5. 部署

示例：
```javascript
// src/services/my-do.js
export class MyDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  
  async fetch(request) {
    // 处理请求
  }
}

// src/index.js
export { MyDO } from './services/my-do.js';

// wrangler.toml
[[durable_objects.bindings]]
name = "MY_DO"
class_name = "MyDO"

[[migrations]]
tag = "v8"
new_sqlite_classes = ["MyDO"]
```

## 📚 相关文档

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Durable Objects 指南](https://developers.cloudflare.com/durable-objects/)
- [Wrangler CLI 文档](https://developers.cloudflare.com/workers/wrangler/)

## 🤝 贡献

如需修改项目结构，请：
1. 先讨论（创建 Issue）
2. 更新本文档
3. 提交 Pull Request
