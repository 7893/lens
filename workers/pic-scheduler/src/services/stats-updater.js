export class StatsUpdater {
  constructor(db) {
    this.db = db;
  }

  async recordWorkflowStart(workflowId, page) {
    await this.db.prepare(`
      INSERT INTO WorkflowRuns (workflow_id, page, status, started_at)
      VALUES (?, ?, 'running', ?)
    `).bind(workflowId, page, new Date().toISOString()).run();
  }

  async recordWorkflowComplete(workflowId, result, durationMs) {
    const now = new Date().toISOString();
    await this.db.prepare(`
      UPDATE WorkflowRuns 
      SET status = ?, photos_total = ?, photos_success = ?, photos_failed = ?, photos_skipped = ?, duration_ms = ?, completed_at = ?
      WHERE workflow_id = ?
    `).bind(result.failed > 0 ? 'failed' : 'success', result.total, result.successful, result.failed, result.skipped, durationMs, now, workflowId).run();
  }

  async updateCategoryStats(category, fileSize) {
    const now = new Date().toISOString();
    await this.db.prepare(`
      INSERT INTO CategoryStats (category, photo_count, total_storage_bytes, first_photo_at, last_photo_at, updated_at)
      VALUES (?, 1, ?, ?, ?, ?)
      ON CONFLICT(category) DO UPDATE SET photo_count = photo_count + 1, total_storage_bytes = total_storage_bytes + ?, last_photo_at = ?, updated_at = ?
    `).bind(category, fileSize, now, now, now, fileSize, now, now).run();
  }

  async updateApiQuota(apiName, callsIncrement = 1) {}
  async checkAndResetQuota(apiName) {}
  async updateStorageStats() {}
}
