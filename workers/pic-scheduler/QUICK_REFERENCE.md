# 🚀 快速参考卡片

## 📖 文档导航

| 需求 | 文档 | 路径 |
|------|------|------|
| 🏁 快速开始 | 项目主文档 | `README.md` |
| ⚙️ 配置环境 | 配置指南 | `docs/CONFIGURATION.md` |
| 🚀 部署项目 | 部署指南 | `docs/DEPLOYMENT.md` |
| 🔐 安全实践 | 安全文档 | `docs/SECURITY.md` |
| 📁 项目结构 | 结构说明 | `docs/PROJECT_STRUCTURE.md` |
| 🔌 API 接口 | API 文档 | `docs/API.md` |
| 🤖 AI 分类 | AI 策略 | `docs/AI_CLASSIFICATION_STRATEGY.md` |
| 🤝 参与贡献 | 贡献指南 | `CONTRIBUTING.md` |

## 🔐 机密信息管理

### 本地开发

```bash
# 1. 复制模板
cp .env.example .dev.vars

# 2. 编辑配置
nano .dev.vars

# 3. 填入真实值
UNSPLASH_API_KEY=your_key_here
PIC_ADMIN_TOKEN=your_token_here

# 4. 启动开发
wrangler dev
```

### 生产部署

```bash
# 设置 Secrets
wrangler secret put UNSPLASH_API_KEY
wrangler secret put PIC_ADMIN_TOKEN

# 验证
wrangler secret list

# 部署
wrangler deploy
```

### 生成 Token

```bash
# 使用 OpenSSL
openssl rand -hex 32

# 或使用 Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 🛠️ 常用命令

### 开发

```bash
# 本地开发
wrangler dev

# 查看日志
wrangler tail

# 运行测试
npm test
```

### 部署

```bash
# 测试部署
wrangler deploy --dry-run

# 实际部署
wrangler deploy

# 查看实时日志
wrangler tail --format pretty
```

### 数据库

```bash
# 执行 SQL
wrangler d1 execute pic-db --remote --command "SELECT COUNT(*) FROM downloads"

# 导入 Schema
wrangler d1 execute pic-db --file=./schema.sql

# 查看数据库列表
wrangler d1 list
```

### 资源管理

```bash
# 查看 Secrets
wrangler secret list

# 查看 R2 存储桶
wrangler r2 bucket list

# 查看 KV 命名空间
wrangler kv:namespace list
```

## 🔍 故障排查

### 问题：部署失败

```bash
# 检查配置
wrangler deploy --dry-run

# 查看详细错误
wrangler deploy --verbose
```

### 问题：Secrets 未设置

```bash
# 列出所有 Secrets
wrangler secret list

# 重新设置
wrangler secret put UNSPLASH_API_KEY
wrangler secret put PIC_ADMIN_TOKEN
```

### 问题：数据库错误

```bash
# 检查数据库
wrangler d1 list

# 重新初始化
wrangler d1 execute pic-db --file=./schema.sql
```

### 问题：机密文件被追踪

```bash
# 检查
git status | grep -E "(\.dev\.vars|\.env$)"

# 移除
git rm --cached .dev.vars
git commit -m "Remove secret file"
```

## 📊 项目统计

```bash
# 文档数量
find . -name "*.md" -not -path "./node_modules/*" | wc -l

# 代码行数
find src -name "*.js" -exec wc -l {} + | tail -1

# 服务模块数量
ls -1 src/services/*.js | wc -l
```

## 🔗 重要链接

### 官方文档

- [Cloudflare Workers](https://developers.cloudflare.com/workers/)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- [Unsplash API](https://unsplash.com/documentation)
- [Workers AI](https://developers.cloudflare.com/workers-ai/)

### 项目资源

- [GitHub 仓库](https://github.com/yourusername/pic)
- [问题追踪](https://github.com/yourusername/pic/issues)
- [贡献指南](CONTRIBUTING.md)

## 🎯 快速任务

### 添加新功能

1. 创建分支：`git checkout -b feature/new-feature`
2. 编写代码：`src/services/new-service.js`
3. 更新文档：`docs/API.md`
4. 测试：`wrangler dev`
5. 提交：`git commit -m "feat: add new feature"`
6. 推送：`git push origin feature/new-feature`
7. 创建 PR

### 修复 Bug

1. 创建分支：`git checkout -b fix/bug-name`
2. 修复代码
3. 测试：`wrangler dev`
4. 提交：`git commit -m "fix: resolve bug"`
5. 推送并创建 PR

### 更新文档

1. 编辑文档：`docs/*.md`
2. 预览：使用 Markdown 编辑器
3. 提交：`git commit -m "docs: update documentation"`
4. 推送：`git push`

## 🔐 安全检查清单

### 开发前

- [ ] `.dev.vars` 已创建且填写
- [ ] `.dev.vars` 在 `.gitignore` 中
- [ ] 代码中无硬编码密钥

### 提交前

- [ ] 运行 `git status` 检查
- [ ] 无机密文件被追踪
- [ ] 代码已测试
- [ ] 文档已更新

### 部署前

- [ ] Secrets 已设置
- [ ] 资源已创建（D1, R2, KV）
- [ ] `wrangler.toml` 已更新
- [ ] 测试部署成功

## 📞 获取帮助

### 文档

1. 查看 `README.md`
2. 搜索 `docs/` 目录
3. 阅读 `CONTRIBUTING.md`

### 社区

1. 创建 [Issue](https://github.com/yourusername/pic/issues)
2. 查看现有 Issues
3. 参与讨论

### 紧急问题

1. 查看 `docs/SECURITY.md`
2. 联系维护者
3. 报告安全漏洞（私密方式）

## 💡 提示和技巧

### 开发效率

```bash
# 使用别名
alias wd='wrangler dev'
alias wt='wrangler tail'
alias wd1='wrangler d1'

# 快速查看日志
wrangler tail --format pretty | grep ERROR

# 监控数据库
watch -n 5 'wrangler d1 execute pic-db --remote --command "SELECT COUNT(*) FROM downloads"'
```

### 调试技巧

```javascript
// 在代码中添加日志
console.log('Debug:', { variable, value });

// 使用 wrangler tail 实时查看
// wrangler tail --format pretty
```

### 性能优化

- 使用 KV 缓存频繁访问的数据
- 批量操作数据库（减少查询次数）
- 并行调用 AI 模型（已实现）
- 使用 Durable Objects 处理长时间任务（已实现）

## 📅 定期维护

### 每周

- [ ] 检查日志错误
- [ ] 监控 API 使用量
- [ ] 查看数据库大小

### 每月

- [ ] 更新依赖：`npm update`
- [ ] 审计安全：`npm audit`
- [ ] 检查文档更新

### 每季度

- [ ] 轮换 Token
- [ ] 审查安全策略
- [ ] 性能优化
- [ ] 备份数据

---

**快速参考版本：** 1.0  
**最后更新：** 2025-10-09  
**维护者：** Pic 项目团队
