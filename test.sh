#!/bin/bash

echo "=== Pic System Test ==="
echo ""

echo "1. Health Check"
curl -s https://pic-scheduler.53.workers.dev/health | jq
echo ""

echo "2. Current Stats"
curl -s https://pic.53.workers.dev/api/stats | jq '{photos: .global.total_photos, categories: .global.total_categories, workflows: .global.total_workflows}'
echo ""

echo "3. Trigger Workflow"
curl -s -X POST https://pic-scheduler.53.workers.dev/api/trigger | jq
echo ""

echo "Waiting 40 seconds for workflow to complete..."
sleep 40
echo ""

echo "4. Updated Stats"
curl -s https://pic.53.workers.dev/api/stats | jq '{photos: .global.total_photos, categories: .global.total_categories, workflows: .global.total_workflows, recent: .recentWorkflows[0]}'
echo ""

echo "5. Recent Photos"
curl -s https://pic.53.workers.dev/api/photos?limit=5 | jq '.photos[] | {id: .unsplash_id, category: .ai_category, photographer: .photographer_name}'
echo ""

echo "=== Test Complete ==="
