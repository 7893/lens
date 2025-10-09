export class StatsUpdater {
  constructor(db) {
    this.db = db;
  }

  async setState(key, value, valueType = 'string') {
    await this.db.prepare(`
      INSERT INTO RuntimeState (key, value, value_type, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = ?,
        updated_at = ?
    `).bind(key, String(value), valueType, new Date().toISOString(), String(value), new Date().toISOString()).run();
  }

  async getState(key) {
    const result = await this.db.prepare(
      'SELECT value, value_type FROM RuntimeState WHERE key = ?'
    ).bind(key).first();
    
    if (!result) return null;
    
    if (result.value_type === 'integer') return parseInt(result.value);
    if (result.value_type === 'float') return parseFloat(result.value);
    return result.value;
  }

  async recordWorkflowStart(workflowId, page) {
    const now = new Date().toISOString();
    
    await this.db.batch([
      this.db.prepare(`
        INSERT INTO WorkflowRuns (workflow_id, page, status, started_at)
        VALUES (?, ?, 'running', ?)
      `).bind(workflowId, page, now),
      
      this.db.prepare(`
        INSERT INTO RuntimeState (key, value, value_type, updated_at)
        VALUES ('current_workflow_id', ?, 'string', ?),
               ('last_workflow_start', ?, 'datetime', ?),
               ('system_status', 'running', 'string', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).bind(workflowId, now, now, now, now)
    ]);
  }

  async recordWorkflowComplete(workflowId, result, durationMs) {
    const now = new Date().toISOString();
    const date = now.split('T')[0];
    const status = result.failed > 0 ? 'failed' : 'success';
    
    const batch = [
      this.db.prepare(`
        UPDATE WorkflowRuns 
        SET status = ?, photos_total = ?, photos_success = ?, 
            photos_failed = ?, photos_skipped = ?, 
            duration_ms = ?, completed_at = ?
        WHERE workflow_id = ?
      `).bind(
        status, result.total, result.successful, 
        result.failed, result.skipped,
        durationMs, now, workflowId
      ),
      
      this.db.prepare(`
        UPDATE GlobalStats SET
          total_photos = total_photos + ?,
          total_workflows = total_workflows + 1,
          successful_workflows = successful_workflows + ?,
          failed_workflows = failed_workflows + ?,
          successful_downloads = successful_downloads + ?,
          failed_downloads = failed_downloads + ?,
          skipped_downloads = skipped_downloads + ?,
          avg_workflow_time_ms = CASE 
            WHEN total_workflows = 0 THEN ?
            ELSE (avg_workflow_time_ms * total_workflows + ?) / (total_workflows + 1)
          END,
          last_photo_at = CASE WHEN ? > 0 THEN ? ELSE last_photo_at END,
          first_photo_at = CASE WHEN first_photo_at IS NULL AND ? > 0 THEN ? ELSE first_photo_at END,
          last_updated_at = ?
        WHERE id = 1
      `).bind(
        result.successful,
        status === 'success' ? 1 : 0,
        status === 'failed' ? 1 : 0,
        result.successful,
        result.failed,
        result.skipped,
        durationMs, durationMs,
        result.successful, now,
        result.successful, now,
        now
      ),
      
      this.db.prepare(`
        INSERT INTO DailyStats (
          date, photos_added, workflows_run, workflows_success, workflows_failed,
          downloads_attempted, downloads_success, downloads_failed, downloads_skipped,
          created_at
        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(date) DO UPDATE SET
          photos_added = photos_added + ?,
          workflows_run = workflows_run + 1,
          workflows_success = workflows_success + ?,
          workflows_failed = workflows_failed + ?,
          downloads_attempted = downloads_attempted + ?,
          downloads_success = downloads_success + ?,
          downloads_failed = downloads_failed + ?,
          downloads_skipped = downloads_skipped + ?
      `).bind(
        date, result.successful,
        status === 'success' ? 1 : 0,
        status === 'failed' ? 1 : 0,
        result.total, result.successful, result.failed, result.skipped,
        now,
        result.successful,
        status === 'success' ? 1 : 0,
        status === 'failed' ? 1 : 0,
        result.total, result.successful, result.failed, result.skipped
      ),
      
      this.db.prepare(`
        INSERT INTO RuntimeState (key, value, value_type, updated_at)
        VALUES ('last_workflow_end', ?, 'datetime', ?),
               ('system_status', 'idle', 'string', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).bind(now, now, now)
    ];
    
    if (result.failed > 0 && result.errorMessage) {
      batch.push(
        this.db.prepare(`
          INSERT INTO RuntimeState (key, value, value_type, updated_at)
          VALUES ('last_error', ?, 'string', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).bind(result.errorMessage, now)
      );
    }
    
    await this.db.batch(batch);
  }

  async updateCategoryStats(category, fileSize) {
    const now = new Date().toISOString();
    
    await this.db.prepare(`
      INSERT INTO CategoryStats (
        category, photo_count, total_storage_bytes, 
        first_photo_at, last_photo_at, updated_at
      ) VALUES (?, 1, ?, ?, ?, ?)
      ON CONFLICT(category) DO UPDATE SET
        photo_count = photo_count + 1,
        total_storage_bytes = total_storage_bytes + ?,
        last_photo_at = ?,
        updated_at = ?
    `).bind(
      category, fileSize, now, now, now,
      fileSize, now, now
    ).run();
  }

  async updateApiQuota(apiName, callsIncrement = 1) {
    const now = new Date().toISOString();
    
    await this.db.prepare(`
      UPDATE ApiQuota SET
        calls_used = calls_used + ?,
        calls_remaining = quota_limit - (calls_used + ?),
        last_call_at = ?,
        updated_at = ?
      WHERE api_name = ?
    `).bind(callsIncrement, callsIncrement, now, now, apiName).run();
  }

  async checkAndResetQuota(apiName) {
    const quota = await this.db.prepare(
      'SELECT * FROM ApiQuota WHERE api_name = ?'
    ).bind(apiName).first();
    
    if (!quota) return;
    
    const now = new Date();
    const resetTime = new Date(quota.next_reset_at);
    
    if (now >= resetTime) {
      let nextReset;
      if (quota.quota_period === 'hourly') {
        nextReset = new Date(now.getTime() + 3600000).toISOString();
      } else if (quota.quota_period === 'daily') {
        nextReset = new Date(now.getTime() + 86400000).toISOString();
      }
      
      await this.db.prepare(`
        UPDATE ApiQuota SET
          calls_used = 0,
          calls_remaining = quota_limit,
          period_start_at = ?,
          period_end_at = ?,
          next_reset_at = ?,
          is_limited = 0,
          updated_at = ?
        WHERE api_name = ?
      `).bind(
        now.toISOString(), nextReset, nextReset, now.toISOString(), apiName
      ).run();
    }
  }

  async updateStorageStats() {
    await this.db.prepare(`
      UPDATE GlobalStats SET
        total_storage_bytes = (SELECT COALESCE(SUM(total_storage_bytes), 0) FROM CategoryStats),
        avg_file_size_bytes = CASE 
          WHEN total_photos > 0 
          THEN (SELECT COALESCE(SUM(total_storage_bytes), 0) FROM CategoryStats) / total_photos
          ELSE 0 
        END,
        total_categories = (SELECT COUNT(DISTINCT category) FROM CategoryStats WHERE photo_count > 0),
        last_updated_at = ?
      WHERE id = 1
    `).bind(new Date().toISOString()).run();
  }
}
