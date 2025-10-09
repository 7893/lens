# 安全政策

## 支持的版本

当前正在接收安全更新的版本：

| 版本 | 支持状态 |
| --- | --- |
| 0.1.x | :white_check_mark: |

## 报告漏洞

如果你发现了安全漏洞，请**不要**公开提交 issue。

请通过以下方式私下报告：

1. 发送邮件至项目维护者
2. 或使用 GitHub Security Advisories

我们会在 48 小时内回复你的报告。

## 安全最佳实践

### 环境变量管理

- ✅ 使用 `wrangler secret` 管理敏感信息
- ❌ 不要在代码中硬编码 API 密钥
- ❌ 不要提交 `.env` 文件到仓库

### API 密钥

如果你的 API 密钥泄露：

1. 立即在服务提供商处撤销密钥
2. 生成新的密钥
3. 使用 `wrangler secret put` 更新

```bash
# 更新 Unsplash API Key
wrangler secret put UNSPLASH_API_KEY --env production
```

### 依赖安全

- 定期运行 `npm audit` 检查漏洞
- 启用 Dependabot 自动更新依赖
- 审查所有依赖更新

## 已知安全考虑

- 所有 API 端点都在 Cloudflare Workers 上运行
- 使用 Cloudflare D1 进行数据存储
- 图片存储在 Cloudflare R2（私有）
- AI 推理使用 Cloudflare AI
