# 贡献指南

感谢你对本项目的关注！

## 开发环境设置

1. Fork 本仓库
2. 克隆你的 fork
3. 安装依赖：`npm install`
4. 复制 `.env.example` 为 `.dev.vars`
5. 在 `.dev.vars` 中添加你的 API 密钥
6. 本地运行：`wrangler dev`

## 代码风格

- 使用 ES6+ 特性
- 遵循现有代码结构
- 为复杂逻辑添加注释
- 保持函数简短且专注

## 提交信息

使用约定式提交（英文）：
- `feat:` - 新功能
- `fix:` - Bug 修复
- `docs:` - 文档
- `refactor:` - 代码重构
- `test:` - 测试
- `chore:` - 维护

## Pull Request 流程

1. 创建功能分支
2. 进行修改
3. 使用 `wrangler dev` 本地测试
4. 如需要，更新文档
5. 提交 PR 并附上清晰的描述

## 测试

```bash
npm test
```

## 有问题？

在进行重大更改之前，请先开 issue 讨论。
