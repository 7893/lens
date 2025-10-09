#!/bin/bash

echo "🚀 Cloudflare Workers 部署脚本"
echo "================================"

# 检查认证状态
echo "📋 检查认证状态..."
if ! wrangler whoami > /dev/null 2>&1; then
    echo "❌ 未认证，需要登录"
    echo "请运行: wrangler login"
    exit 1
fi

echo "✅ 认证成功"

# 设置 API 密钥
echo "🔐 设置 API 密钥..."

if [ -z "$UNSPLASH_API_KEY" ]; then
    echo "❌ 未检测到 UNSPLASH_API_KEY 环境变量"
    echo "请在执行前导出密钥，例如:"
    echo "  export UNSPLASH_API_KEY=your_api_key_here"
    exit 1
fi

echo "$UNSPLASH_API_KEY" | wrangler secret put UNSPLASH_API_KEY

if [ $? -eq 0 ]; then
    echo "✅ API 密钥设置成功"
else
    echo "❌ API 密钥设置失败"
    exit 1
fi

# 设置管理令牌
echo "🛡️  设置管理令牌..."

ADMIN_SECRET="${PIC_ADMIN_TOKEN:-$ADMIN_TOKEN}"

if [ -z "$ADMIN_SECRET" ]; then
    echo "❌ 未检测到 PIC_ADMIN_TOKEN 环境变量"
    echo "请在执行前导出令牌，例如:"
    echo "  export PIC_ADMIN_TOKEN=choose_a_strong_token"
    exit 1
fi

echo "$ADMIN_SECRET" | wrangler secret put PIC_ADMIN_TOKEN

if [ $? -eq 0 ]; then
    echo "✅ 管理令牌设置成功"
else
    echo "❌ 管理令牌设置失败"
    exit 1
fi

# 验证配置
echo "🔍 验证配置..."
wrangler secret list

# 部署
echo "🚀 开始部署..."
wrangler deploy

if [ $? -eq 0 ]; then
    echo "✅ 部署成功！"
    echo "📊 查看部署状态..."
    wrangler deployments list
else
    echo "❌ 部署失败"
    exit 1
fi

echo "🎉 部署完成！"
