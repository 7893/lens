#!/bin/bash

# 清空本地开发环境数据

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                                                              ║"
echo "║              清空本地数据 - Pic v2.0                         ║"
echo "║                                                              ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

echo "⚠️  警告: 这将清空本地开发环境的所有数据！"
echo ""
read -p "确认继续? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "已取消"
  exit 0
fi

echo ""
echo "🗑️  清理中..."
echo ""

# 清空数据库
echo "1. 清空D1数据库..."
wrangler d1 execute pic-db --command "DELETE FROM downloads" > /dev/null 2>&1
echo "   ✅ 数据库已清空"

# 清空R2
echo "2. 清空R2存储..."
rm -rf .wrangler/state/v3/r2/* 2>/dev/null
echo "   ✅ R2存储已清空"

# 清空KV
echo "3. 清空KV存储..."
rm -rf .wrangler/state/v3/kv/* 2>/dev/null
echo "   ✅ KV存储已清空"

# 清空DO
echo "4. 清空DO存储..."
rm -rf .wrangler/state/v3/do/* 2>/dev/null
echo "   ✅ DO存储已清空"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 本地数据清理完成！"
echo ""
echo "下一步:"
echo "  npm run dev    # 启动本地开发"
echo ""
