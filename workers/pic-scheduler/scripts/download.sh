#!/bin/bash

# 下载图片脚本

ADMIN_TOKEN="${PIC_ADMIN_TOKEN}"
WORKER_URL="${WORKER_URL:-https://pic.your-domain.workers.dev}"
COUNT="${1:-30}"

if [ -z "$ADMIN_TOKEN" ]; then
  echo "错误: 请设置 PIC_ADMIN_TOKEN 环境变量"
  exit 1
fi

echo "开始下载 ${COUNT} 张图片..."

curl -X POST "${WORKER_URL}/do/main-task/start" \
  -H "X-Admin-Token: ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "{\"count\": ${COUNT}}"

echo ""
echo "下载任务已启动！"
