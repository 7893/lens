#!/bin/bash

# 部署前检查脚本

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║                  部署前检查 - Pic v2.0                       ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

ERRORS=0

# 检查核心文件
echo "📁 检查核心文件..."
FILES=(
  "src/index.js"
  "src/config.js"
  "src/middleware/rate-limiter.js"
  "src/services/ai-classifier.js"
  "src/services/downloader.js"
  "src/services/task.js"
  "src/services/unsplash.js"
)

for file in "${FILES[@]}"; do
  if [ -f "$file" ]; then
    echo "  ✅ $file"
  else
    echo "  ❌ $file (缺失)"
    ERRORS=$((ERRORS + 1))
  fi
done
echo ""

# 检查配置文件
echo "⚙️  检查配置文件..."
if [ -f "wrangler.toml" ]; then
  echo "  ✅ wrangler.toml"
  
  # 检查是否包含占位符
  if grep -q "YOUR_D1_DATABASE_ID" wrangler.toml; then
    echo "  ⚠️  警告: wrangler.toml 包含占位符 YOUR_D1_DATABASE_ID"
    ERRORS=$((ERRORS + 1))
  fi
  
  if grep -q "YOUR_KV_NAMESPACE_ID" wrangler.toml; then
    echo "  ⚠️  警告: wrangler.toml 包含占位符 YOUR_KV_NAMESPACE_ID"
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "  ❌ wrangler.toml (缺失)"
  ERRORS=$((ERRORS + 1))
fi

if [ -f "package.json" ]; then
  echo "  ✅ package.json"
else
  echo "  ❌ package.json (缺失)"
  ERRORS=$((ERRORS + 1))
fi

if [ -f "schema.sql" ]; then
  echo "  ✅ schema.sql"
else
  echo "  ❌ schema.sql (缺失)"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 检查脚本文件
echo "📜 检查脚本文件..."
SCRIPTS=(
  "scripts/download.sh"
  "scripts/clear-all.sh"
  "scripts/test-system.sh"
  "scripts/deploy.sh"
)

for script in "${SCRIPTS[@]}"; do
  if [ -f "$script" ] && [ -x "$script" ]; then
    echo "  ✅ $script"
  elif [ -f "$script" ]; then
    echo "  ⚠️  $script (存在但不可执行)"
  else
    echo "  ❌ $script (缺失)"
    ERRORS=$((ERRORS + 1))
  fi
done
echo ""

# 检查环境变量
echo "🔐 检查环境变量..."
if [ -n "$PIC_ADMIN_TOKEN" ]; then
  echo "  ✅ PIC_ADMIN_TOKEN 已设置"
else
  echo "  ⚠️  PIC_ADMIN_TOKEN 未设置（部署后需要在Cloudflare设置）"
fi

if [ -n "$UNSPLASH_API_KEY" ]; then
  echo "  ✅ UNSPLASH_API_KEY 已设置"
else
  echo "  ⚠️  UNSPLASH_API_KEY 未设置（部署后需要在Cloudflare设置）"
fi
echo ""

# 检查node_modules
echo "📦 检查依赖..."
if [ -d "node_modules" ]; then
  echo "  ✅ node_modules 存在"
else
  echo "  ⚠️  node_modules 不存在，请运行: npm install"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 检查wrangler
echo "🔧 检查工具..."
if command -v wrangler &> /dev/null; then
  echo "  ✅ wrangler 已安装"
else
  echo "  ❌ wrangler 未安装，请运行: npm install -g wrangler"
  ERRORS=$((ERRORS + 1))
fi
echo ""

# 总结
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
if [ $ERRORS -eq 0 ]; then
  echo "✅ 所有检查通过！可以部署了。"
  echo ""
  echo "下一步:"
  echo "  1. 确保 wrangler.toml 中的资源ID正确"
  echo "  2. 在Cloudflare设置环境变量"
  echo "  3. 运行: npm run deploy"
  exit 0
else
  echo "❌ 发现 $ERRORS 个问题，请修复后再部署。"
  exit 1
fi
