# Database Tables Analysis

## Current Tables (8)

### 1. Photos (40 fields)
**Purpose:** Store photo metadata from Unsplash
- unsplash_id, slug, r2_key, downloaded_at
- description, alt_description, blur_hash, width, height, color, likes
- created_at, updated_at, promoted_at
- photographer_id, photographer_username, photographer_name, photographer_bio, photographer_location, photographer_portfolio_url, photographer_instagram, photographer_twitter
- photo_location_name, photo_location_city, photo_location_country, photo_location_latitude, photo_location_longitude
- exif_make, exif_model, exif_name, exif_exposure_time, exif_aperture, exif_focal_length, exif_iso
- tags
- ai_category, ai_confidence, ai_model_scores

### 2. GlobalStats (22 fields)
**Purpose:** Global statistics (single row)
- id
- total_photos, total_storage_bytes, avg_file_size_bytes, total_categories
- total_api_calls, unsplash_api_calls, ai_api_calls
- total_workflows, successful_workflows, failed_workflows
- total_downloads, successful_downloads, failed_downloads, skipped_downloads
- avg_download_time_ms, avg_ai_classify_time_ms, avg_workflow_time_ms
- first_photo_at, last_photo_at, last_updated_at

### 3. ApiQuota (12 fields)
**Purpose:** API quota management
- api_name
- quota_limit, quota_period
- calls_used, calls_remaining
- period_start_at, period_end_at, last_call_at, next_reset_at
- is_limited, limit_reason
- updated_at

### 4. CategoryStats (7 fields)
**Purpose:** Per-category statistics
- category
- photo_count, total_storage_bytes, avg_confidence
- first_photo_at, last_photo_at, updated_at

### 5. WorkflowRuns (11 fields)
**Purpose:** Workflow execution records
- workflow_id, page, status
- photos_total, photos_success, photos_failed, photos_skipped
- duration_ms, error_message
- started_at, completed_at

### 6. DailyStats (14 fields)
**Purpose:** Daily aggregated statistics
- date
- photos_added, storage_added_bytes
- api_calls, workflows_run, workflows_success, workflows_failed
- downloads_attempted, downloads_success, downloads_failed, downloads_skipped
- avg_download_time_ms, avg_ai_time_ms
- created_at

### 7. RuntimeState (5 fields)
**Purpose:** Runtime state key-value store
- key, value, value_type, description, updated_at

### 8. ApiCalls (8 fields)
**Purpose:** Detailed API call logs (optional)
- id, api_type, endpoint, method
- status_code, duration_ms, success, error_message, called_at

---

## Issues Found

### 🔴 Critical Issues

1. **Redundant Time Fields**
   - `GlobalStats`: first_photo_at, last_photo_at, last_updated_at
   - `CategoryStats`: first_photo_at, last_photo_at, updated_at
   - `WorkflowRuns`: started_at, completed_at
   - `DailyStats`: created_at
   - `ApiQuota`: period_start_at, period_end_at, last_call_at, next_reset_at, updated_at
   - **Problem:** Too many timestamp fields, inconsistent naming

2. **Duplicate Statistics**
   - `GlobalStats.total_photos` vs `Photos.COUNT(*)`
   - `GlobalStats.total_categories` vs `CategoryStats.COUNT(*)`
   - `GlobalStats.total_storage_bytes` vs `CategoryStats.SUM(total_storage_bytes)`
   - **Problem:** Data redundancy, sync issues

3. **Overlapping Counters**
   - `GlobalStats`: total_downloads, successful_downloads, failed_downloads, skipped_downloads
   - `DailyStats`: downloads_attempted, downloads_success, downloads_failed, downloads_skipped
   - **Problem:** Same data in different tables

4. **Unused Fields**
   - `GlobalStats.avg_download_time_ms` - never updated
   - `GlobalStats.avg_ai_classify_time_ms` - never updated
   - `DailyStats.storage_added_bytes` - never updated
   - `DailyStats.avg_download_time_ms` - never updated
   - `DailyStats.avg_ai_time_ms` - never updated

5. **Missing Relationships**
   - No foreign keys
   - No referential integrity

---

## Recommended Redesign

### Option 1: Minimal Design (Recommended)

**Keep only 4 core tables:**

1. **Photos** (keep as is) - 40 fields
   - Core data, no changes needed

2. **Metrics** (replace GlobalStats + DailyStats + CategoryStats)
   ```sql
   CREATE TABLE Metrics (
     metric_key TEXT PRIMARY KEY,
     metric_value TEXT NOT NULL,
     metric_type TEXT NOT NULL,  -- counter/gauge/histogram
     dimension TEXT,              -- category/date/global
     updated_at TEXT NOT NULL
   );
   ```
   - Flexible key-value metrics
   - Examples:
     - `photos.total` → `{value: "150", type: "counter", dimension: "global"}`
     - `photos.by_category.nature` → `{value: "45", type: "counter", dimension: "nature"}`
     - `photos.by_date.2025-10-10` → `{value: "30", type: "counter", dimension: "2025-10-10"}`

3. **State** (keep RuntimeState) - 5 fields
   - Runtime state management

4. **Events** (replace WorkflowRuns + ApiCalls)
   ```sql
   CREATE TABLE Events (
     id TEXT PRIMARY KEY,
     event_type TEXT NOT NULL,  -- workflow/api_call
     event_data TEXT NOT NULL,  -- JSON
     status TEXT NOT NULL,
     created_at TEXT NOT NULL,
     completed_at TEXT
   );
   ```

### Option 2: Simplified Design

**Keep 5 tables:**

1. **Photos** - unchanged
2. **Counters** - simple counters (photos, workflows, api_calls)
3. **Timeseries** - time-based metrics (daily stats)
4. **State** - runtime state
5. **Logs** - execution logs (workflows, api calls)

---

## Recommendation

**Use Option 1 (Minimal Design)** because:
- ✅ Eliminates redundancy
- ✅ Flexible schema
- ✅ Easy to query
- ✅ No sync issues
- ✅ Scales better

**Migration path:**
1. Create new Metrics and Events tables
2. Migrate data from old tables
3. Drop old tables (GlobalStats, DailyStats, CategoryStats, WorkflowRuns, ApiCalls, ApiQuota)
4. Update code to use new schema
