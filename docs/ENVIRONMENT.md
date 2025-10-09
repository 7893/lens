# 环境变量配置

## 必需的环境变量

### Cloudflare Secrets

使用 `wrangler secret` 命令设置以下密钥：

```bash
# Unsplash API Key
wrangler secret put UNSPLASH_API_KEY

# 如果需要管理员 API
wrangler secret put PIC_ADMIN_TOKEN
```

### GitHub Secrets

在 GitHub 仓库设置中配置：

1. `CLOUDFLARE_API_TOKEN` - Cloudflare API Token
   - 获取方式：Cloudflare Dashboard → My Profile → API Tokens
   - 权限：Edit Cloudflare Workers

2. `CLOUDFLARE_ACCOUNT_ID` - Cloudflare Account ID
   - 获取方式：Cloudflare Dashboard → Workers & Pages → Account ID

## 验证配置

```bash
# 检查 Cloudflare 配置
wrangler whoami

# 列出已设置的 secrets
wrangler secret list

# 测试部署
wrangler deploy --dry-run
```

## 安全注意事项

⚠️ **永远不要**：
- 在代码中硬编码 API 密钥
- 提交 `.env` 文件到 Git
- 在 `wrangler.toml` 中存储敏感信息
- 在日志中打印密钥

✅ **始终**：
- 使用 `wrangler secret` 管理密钥
- 使用 `.env.example` 作为模板
- 定期轮换 API 密钥
- 使用最小权限原则
