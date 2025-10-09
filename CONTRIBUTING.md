# 贡献指南

感谢你对 Pic 项目的关注！本文档提供了贡献项目的指南。

## 开始

1. Fork 本仓库
2. 克隆你的 fork：`git clone <your-fork-url>`
3. 创建功能分支：`git checkout -b feature/your-feature-name`
4. 进行修改
5. 测试你的修改：`npm test`
6. 提交修改：`git commit -m "Add your feature"`
7. 推送到你的 fork：`git push origin feature/your-feature-name`
8. 打开 Pull Request

## 开发环境设置

```bash
# 安装依赖
npm install

# 设置环境变量
cp workers/pic-scheduler/.env.example workers/pic-scheduler/.env

# 启动开发服务器
npm run dev:scheduler
```

## 代码规范

- 使用 ES6+ 语法
- 遵循现有代码格式
- 为复杂逻辑添加注释（英文）
- 保持函数简洁专注
- 代码和注释使用英文

## 测试

提交 PR 前，请确保：

- 所有测试通过：`npm test`
- 系统测试通过：`./scripts/test.sh`
- 开发环境无控制台错误

## Pull Request 指南

- 保持 PR 专注于单一功能或修复
- 如需要，更新文档
- 为新功能添加测试
- 确保 CI 通过
- 提交信息使用英文

## 报告问题

报告问题时，请包含：

- 问题的清晰描述
- 重现步骤
- 预期行为 vs 实际行为
- 环境详情（Node 版本、操作系统等）

## 有疑问？

欢迎随时开 issue 进行讨论。
