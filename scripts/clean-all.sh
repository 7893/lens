#!/bin/bash
# Clean all data but keep bucket and table structures

echo "Cleaning R2 bucket contents (keeping bucket)..."
rclone delete r2:pic-r2 --verbose

echo "Cleaning database tables (keeping structures)..."
cd /home/ubuntu/pic/workers/pic-scheduler
npx wrangler d1 execute pic-d1 --remote --command "
DELETE FROM WorkflowRuns;
DELETE FROM State;
DELETE FROM Photos;
DELETE FROM ApiQuota;
DELETE FROM ProcessingQueue;
DELETE FROM CategoryStats;
UPDATE GlobalStats SET 
  total_photos=0, 
  total_storage_bytes=0, 
  total_categories=0, 
  total_workflows=0, 
  successful_workflows=0, 
  failed_workflows=0, 
  total_downloads=0, 
  successful_downloads=0, 
  skipped_downloads=0 
WHERE id=1;
"

echo "✅ Cleanup complete!"
echo "- R2 bucket 'pic-r2' still exists (files deleted)"
echo "- Database tables still exist (data deleted)"
echo "- All counters reset to 0"
