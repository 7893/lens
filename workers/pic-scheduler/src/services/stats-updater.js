export class StatsUpdater {
  constructor(db) {
    this.db = db;
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
        VALUES ('current_workflow_id', ?, 'string', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).bind(workflowId, now),
      
      this.db.prepare(`
        INSERT INTO RuntimeState (key, value, value_type, updated_at)
        VALUES ('last_workflow_start', ?, 'datetime', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).bind(now, now),
      
      this.db.prepare(`
        INSERT INTO RuntimeState (key, value, value_type, updated_at)
        VALUES ('system_status', 'running', 'string', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).bind(now)
    ]);
  }

  async recordWorkflowComplete(workflowId, result, durationMs) {
    const now = new Date().toISOString();
    const date = now.split('T')[0];
    const status = result.failed > 0 ? 'failed' : 'success';
    
    await this.db.batch([
      this.db.prepare(`
        UPDATE WorkflowRuns 
        SET status = ?, photos_total = ?, photos_success = ?, 
            photos_failed = ?, photos_skipped = ?, 
            duration_ms = ?, completed_at = ?
        WHERE workflow_id = ?
      `).bind(status, result.total, result.successful, result.failed, result.skipped, durationMs, now, workflowId),
      
      this.db.prepare(`
        UPDATE GlobalStats SET
          total_photos = total_photos + ?,
          total_workflows = total_workflows + 1,
          successful_workflows = successful_workflows + ?,
          failed_workflows = failed_workflows + ?,
          successful_downloads = successful_downloads + ?,
          failed_downloads = failed_downloads + ?,
          skipped_downloads = skipped_downloads + ?,
          last_updated_at = ?
        WHERE id = 1
      `).bind(result.successful, status === 'success' ? 1 : 0, status === 'failed' ? 1 : 0, result.successful, result.failed, result.skipped, now)
    ]);
  }

  async updateCategoryStats(category, fileSize) {
    const now = new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO CategoryStats (category, photo_count, total_storage_bytes, first_photo_at, last_photo_at, updated_at)
      VALUES (?, 1, ?, ?, ?, ?)
      ON CONFLICT(category) DO UPDATE SET photo_count = photo_count + 1, total_storage_bytes = total_storage_bytes + ?, last_photo_at = ?, updated_at = ?
    `).bind(category, fileSize, now, now, now, fileSize, now, now).run();
  }

  async updateApiQuota(apiName, callsIncrement = 1) {
    const now = new Date().toISOString();
    await this.db.prepare(`
      UPDATE ApiQuota SET calls_used = calls_used + ?, calls_remaining = quota_limit - (calls_used + ?), last_call_at = ?, updated_at = ? WHERE api_name = ?
    `).bind(callsIncrement, callsIncrement, now, now, apiName).run();
  }

  async checkAndResetQuota(apiName) {
    const quota = await this.db.prepare('SELECT * FROM ApiQuota WHERE api_name = ?').bind(apiName).first();
    if (!quota) return;
    
    const now = new Date();
    const resetTime = new Date(quota.next_reset_at);
    if (now < resetTime) return;
    
    let nextReset = quota.quota_period === 'hourly' ? new Date(now.getTime() + 3600000).toISOString() : new Date(now.getTime() + 86400000).toISOString();
    await this.db.prepare(`UPDATE ApiQuota SET calls_used = 0, calls_remaining = quota_limit, next_reset_at = ?, updated_at = ? WHERE api_name = ?`).bind(nextReset, now.toISOString(), apiName).run();
  }

  async updateStorageStats() {
    await this.db.prepare(`UPDATE GlobalStats SET total_storage_bytes = (SELECT COALESCE(SUM(total_storage_bytes), 0) FROM CategoryStats), total_categories = (SELECT COUNT(*) FROM CategoryStats), last_updated_at = ? WHERE id = 1`).bind(new Date().toISOString()).run();
  }
}
