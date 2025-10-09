# 安全最佳实践

本文档说明 Pic 项目的安全措施和最佳实践。

## 🔐 机密信息管理

### 原则

**绝不在代码中硬编码机密信息！**

所有敏感信息必须通过以下方式管理：
- 本地开发：`.dev.vars` 文件（已在 `.gitignore` 中）
- 生产环境：Cloudflare Secrets（加密存储）

### 机密信息类型

| 类型 | 示例 | 存储方式 |
|------|------|----------|
| API 密钥 | `UNSPLASH_API_KEY` | Cloudflare Secret |
| 认证 Token | `PIC_ADMIN_TOKEN` | Cloudflare Secret |
| 数据库凭证 | D1 自动管理 | Cloudflare 内部 |
| 加密密钥 | 如需要 | Cloudflare Secret |

### 检查清单

在提交代码前，确保：

- [ ] 没有硬编码的 API 密钥
- [ ] 没有硬编码的 Token
- [ ] `.dev.vars` 在 `.gitignore` 中
- [ ] `wrangler.toml` 中没有机密信息
- [ ] 日志中不输出敏感信息

### 代码审查

**❌ 错误示例：**
```javascript
// 永远不要这样做！
const UNSPLASH_API_KEY = 'abc123xyz789';
const ADMIN_TOKEN = '3896b0674fc7b7906ab067cff75ffed1';
```

**✅ 正确示例：**
```javascript
// 从环境变量读取
const apiKey = env.UNSPLASH_API_KEY;
const adminToken = env.PIC_ADMIN_TOKEN;

// 验证是否配置
if (!apiKey) {
  throw new Error('UNSPLASH_API_KEY not configured');
}
```

## 🛡️ 认证和授权

### 管理接口保护

所有管理接口都需要 Token 认证：

```javascript
// 请求头验证
const token = request.headers.get('X-Admin-Token');
if (token !== env.PIC_ADMIN_TOKEN) {
  return new Response('Unauthorized', { status: 401 });
}
```

### Token 生成

使用加密安全的随机数生成器：

```bash
# 推荐：OpenSSL（32 字节 = 64 字符十六进制）
openssl rand -hex 32

# 或使用 Node.js
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Token 轮换

定期更换 Token（建议每 90 天）：

```bash
# 1. 生成新 Token
NEW_TOKEN=$(openssl rand -hex 32)

# 2. 更新 Cloudflare Secret
echo $NEW_TOKEN | wrangler secret put PIC_ADMIN_TOKEN

# 3. 更新本地 .dev.vars
echo "PIC_ADMIN_TOKEN=$NEW_TOKEN" >> .dev.vars

# 4. 通知团队成员更新
```

## 🔒 HTTP 安全头

项目已实现以下安全响应头：

```javascript
const securityHeaders = {
  'X-Frame-Options': 'DENY',                    // 防止点击劫持
  'X-Content-Type-Options': 'nosniff',          // 防止 MIME 类型嗅探
  'Referrer-Policy': 'strict-origin-when-cross-origin',  // 控制 Referer
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"  // CSP
};
```

### CSP 策略说明

当前 CSP 策略：
- `default-src 'self'`：默认只允许同源资源
- `script-src 'self' 'unsafe-inline'`：允许内联脚本（前端需要）
- `style-src 'self' 'unsafe-inline'`：允许内联样式（前端需要）

**改进建议**（如果前端重构）：
```javascript
// 使用 nonce 替代 unsafe-inline
const nonce = crypto.randomUUID();
const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'nonce-${nonce}'`;
```

## 🚫 输入验证

### SQL 注入防护

使用参数化查询（D1 自动处理）：

**✅ 安全：**
```javascript
await env.DB.prepare(
  'SELECT * FROM downloads WHERE category = ?'
).bind(category).all();
```

**❌ 危险：**
```javascript
// 永远不要拼接 SQL！
await env.DB.prepare(
  `SELECT * FROM downloads WHERE category = '${category}'`
).all();
```

### 路径遍历防护

验证文件路径：

```javascript
// 验证分类名称（只允许字母、数字、连字符）
const CATEGORY_REGEX = /^[a-z0-9-]+$/;
if (!CATEGORY_REGEX.test(category)) {
  return new Response('Invalid category', { status: 400 });
}
```

### XSS 防护

- 使用 CSP 头
- 转义用户输入
- 使用安全的模板引擎

```javascript
// HTML 转义
function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
```

## 🔍 日志安全

### 不要记录敏感信息

**❌ 错误：**
```javascript
console.log('API Key:', env.UNSPLASH_API_KEY);
console.log('Admin Token:', token);
console.log('User data:', JSON.stringify(userData));
```

**✅ 正确：**
```javascript
console.log('API Key configured:', !!env.UNSPLASH_API_KEY);
console.log('Token validation:', token ? 'provided' : 'missing');
console.log('User ID:', userId);  // 只记录 ID，不记录完整数据
```

### 日志脱敏

如果必须记录，先脱敏：

```javascript
function maskToken(token) {
  if (!token || token.length < 8) return '***';
  return token.slice(0, 4) + '...' + token.slice(-4);
}

console.log('Token:', maskToken(token));
// 输出：Token: 3896...8a31
```

## 🌐 CORS 配置

当前项目不需要 CORS（同源访问），如需启用：

```javascript
// 限制允许的源
const allowedOrigins = [
  'https://yourdomain.com',
  'https://www.yourdomain.com'
];

function handleCORS(request, response) {
  const origin = request.headers.get('Origin');
  if (allowedOrigins.includes(origin)) {
    response.headers.set('Access-Control-Allow-Origin', origin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST');
    response.headers.set('Access-Control-Max-Age', '86400');
  }
  return response;
}
```

## 🚦 速率限制

### Cloudflare 内置保护

Cloudflare Workers 自动提供：
- DDoS 防护
- Bot 检测
- IP 信誉过滤

### 应用层速率限制

使用 KV 实现简单的速率限制：

```javascript
async function checkRateLimit(env, ip, limit = 100, window = 3600) {
  const key = `ratelimit:${ip}`;
  const count = await env.KV.get(key);
  
  if (count && parseInt(count) >= limit) {
    return false;  // 超出限制
  }
  
  await env.KV.put(key, (parseInt(count || 0) + 1).toString(), {
    expirationTtl: window
  });
  
  return true;  // 允许请求
}
```

## 🔐 数据加密

### 传输加密

- 所有流量通过 HTTPS（Cloudflare 自动处理）
- TLS 1.3 支持

### 存储加密

- R2：服务端加密（AES-256）
- D1：自动加密
- KV：自动加密
- Secrets：加密存储

### 敏感数据处理

如需存储敏感数据，使用 Web Crypto API：

```javascript
async function encryptData(data, key) {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: crypto.getRandomValues(new Uint8Array(12)) },
    key,
    dataBuffer
  );
  
  return encrypted;
}
```

## 🛡️ 依赖安全

### 定期更新依赖

```bash
# 检查过期依赖
npm outdated

# 更新依赖
npm update

# 审计安全漏洞
npm audit

# 自动修复
npm audit fix
```

### 最小化依赖

当前项目依赖极少（仅 Wrangler），降低供应链风险。

## 📋 安全检查清单

### 开发阶段

- [ ] 使用 `.dev.vars` 存储本地机密
- [ ] 验证所有用户输入
- [ ] 使用参数化查询
- [ ] 实现错误处理（不泄露内部信息）
- [ ] 添加日志（不记录敏感信息）

### 部署前

- [ ] 运行 `npm audit`
- [ ] 检查 `.gitignore` 包含 `.dev.vars`
- [ ] 确认没有硬编码的机密
- [ ] 测试认证和授权
- [ ] 验证安全响应头

### 部署后

- [ ] 设置 Cloudflare Secrets
- [ ] 测试管理接口认证
- [ ] 监控异常请求
- [ ] 定期审查日志
- [ ] 定期轮换 Token

### 定期维护

- [ ] 每月更新依赖
- [ ] 每季度轮换 Token
- [ ] 每年审查安全策略
- [ ] 监控 Cloudflare 安全报告

## 🚨 安全事件响应

### 如果 Token 泄露

1. **立即轮换**
   ```bash
   openssl rand -hex 32 | wrangler secret put PIC_ADMIN_TOKEN
   ```

2. **检查日志**
   ```bash
   wrangler tail --format pretty | grep "X-Admin-Token"
   ```

3. **审查访问记录**
   - 检查 Analytics Engine 数据
   - 查找异常 API 调用

4. **通知团队**

### 如果发现漏洞

1. 不要公开披露
2. 创建私有 Issue
3. 开发修复补丁
4. 测试修复
5. 部署更新
6. 负责任地披露

## 📚 相关资源

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [Cloudflare Security](https://developers.cloudflare.com/workers/platform/security/)
- [Web Crypto API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [Content Security Policy](https://developer.mozilla.org/en-US/docs/Web/HTTP/CSP)

## 📧 报告安全问题

如发现安全漏洞，请通过以下方式报告：

- **不要**创建公开 Issue
- 发送邮件至：security@yourdomain.com
- 或使用 GitHub Security Advisories

我们承诺在 48 小时内响应安全报告。
