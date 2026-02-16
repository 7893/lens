export class Analytics {
  private ae: AnalyticsEngineDataset | null;

  constructor(ae: AnalyticsEngineDataset | null) {
    this.ae = ae;
  }

  async logEvent(eventType: string, data: Record<string, unknown>): Promise<void> {
    if (!this.ae) return;

    try {
      this.ae.writeDataPoint({
        blobs: [eventType],
        doubles: [1],
        indexes: [String(data.status || '')]
      });
    } catch (error) {
      console.error('Analytics write failed:', error);
    }
  }

  async logDownload(photoId: string, success: boolean): Promise<void> {
    await this.logEvent('download', {
      status: success ? 'success' : 'failed',
      photoId
    });
  }

  async logClassify(photoId: string, success: boolean, category: string): Promise<void> {
    await this.logEvent('classify', {
      status: success ? 'success' : 'failed',
      photoId,
      category
    });
  }

  async logWorkflow(type: string, result: { successful: number; total: number }): Promise<void> {
    await this.logEvent(`workflow_${type}`, {
      status: result.successful > 0 ? 'success' : 'failed',
      count: result.total
    });
  }
}
