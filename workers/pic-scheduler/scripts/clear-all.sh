#!/bin/bash

# 清空所有数据和图片的脚本

ADMIN_TOKEN="${PIC_ADMIN_TOKEN}"
WORKER_URL="${WORKER_URL:-https://pic.your-domain.workers.dev}"

if [ -z "$ADMIN_TOKEN" ]; then
  echo "错误: 请设置 PIC_ADMIN_TOKEN 环境变量"
  exit 1
fi

echo "正在清空所有数据和图片..."

curl -X POST "${WORKER_URL}/api/admin/clear" \
  -H "X-Admin-Token: ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json"

echo ""
echo "清理完成！"
