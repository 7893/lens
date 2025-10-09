export class Analytics {
  constructor(ae) {
    this.ae = ae;
  }

  async logEvent(eventType, data) {
    if (!this.ae) return;
    
    try {
      this.ae.writeDataPoint({
        blobs: [eventType],
        doubles: [1],
        indexes: [data.status || '']
      });
    } catch (error) {
      console.error('Analytics write failed:', error);
    }
  }

  async logDownload(photoId, success) {
    await this.logEvent('download', { 
      status: success ? 'success' : 'failed',
      photoId 
    });
  }

  async logClassify(photoId, success, category) {
    await this.logEvent('classify', { 
      status: success ? 'success' : 'failed',
      photoId,
      category 
    });
  }

  async logWorkflow(type, result) {
    await this.logEvent(`workflow_${type}`, { 
      status: result.successful > 0 ? 'success' : 'failed',
      count: result.total 
    });
  }
}
