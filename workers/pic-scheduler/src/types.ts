// Core interfaces for Pic project

export interface PhotoRow {
  unsplash_id: string;
  r2_key: string;
  ai_category: string | null;
  ai_confidence: number | null;
  width: number;
  height: number;
  color: string;
  likes: number;
  photographer_name: string;
  downloaded_at: string; // ISO 8601
}

export interface GlobalStatsRow {
  id: number;
  total_photos: number;
  total_workflows: number;
  last_updated: string;
}

export interface CleanupLogRow {
  id?: number;
  photos_deleted: number;
  r2_files_deleted: number;
  cleanup_reason: string;
  executed_at: string;
}

export interface ApiQuotaRow {
  api_name: string;
  calls_used: number;
  quota_limit: number;
  next_reset_at: string;
}

export interface CategoryStatsRow {
  category: string;
  photo_count: number;
}

export interface WorkflowRunRow {
  workflow_id: string;
  status: string;
  page: number;
  photos_success: number;
  photos_failed: number;
  photos_skipped: number;
  started_at: string;
}
