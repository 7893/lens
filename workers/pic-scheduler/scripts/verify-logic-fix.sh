#!/bin/bash

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🔍 逻辑修复验证"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# 使用正确的token
TOKEN="your-secure-admin-token-7b6524bb4e59f824c43569105d30ec7c"

echo "1️⃣  测试重复下载保护..."
echo ""

# 第一次下载5张
echo "   下载5张图片..."
RESULT1=$(curl -s -X POST "https://pic.53.workers.dev/api/download?count=5" \
  -H "X-Admin-Token: $TOKEN")

echo "   结果: $RESULT1"
echo ""

# 等待3秒
echo "   等待3秒..."
sleep 3
echo ""

# 再次下载5张（应该跳过已存在的）
echo "   再次下载5张图片（测试重复保护）..."
RESULT2=$(curl -s -X POST "https://pic.53.workers.dev/api/download?count=5" \
  -H "X-Admin-Token: $TOKEN")

echo "   结果: $RESULT2"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "2️⃣  检查数据库记录..."
echo ""

npx wrangler d1 execute pic-db --remote --command "SELECT COUNT(*) as total FROM downloads"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "3️⃣  检查分类分布..."
echo ""

npx wrangler d1 execute pic-db --remote --command "SELECT category, COUNT(*) as count FROM downloads GROUP BY category ORDER BY count DESC"
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ 验证完成"
echo ""
echo "预期结果："
echo "  - 第二次下载应该跳过已存在的图片"
echo "  - uncategorized 分类应该很少或没有"
echo "  - 所有图片都有有效的分类"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
