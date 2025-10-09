import { DataPipelineWorkflow } from './workflows/data-pipeline.js';
import { DownloadWorkflow } from './workflows/download-workflow.js';
import { ClassifyWorkflow } from './workflows/classify-workflow.js';
import { EnqueuePhotosTask } from './tasks/enqueue-photos.js';

export { DataPipelineWorkflow, DownloadWorkflow, ClassifyWorkflow };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    if (url.pathname === '/health') {
      return Response.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString() 
      });
    }

    if (url.pathname === '/api/stats') {
      const [total, categories, queueStats, cursor] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) as total FROM Photos').first(),
        env.DB.prepare('SELECT ai_category, COUNT(*) as count FROM Photos GROUP BY ai_category ORDER BY count DESC').all(),
        env.DB.prepare('SELECT status, COUNT(*) as count FROM ProcessingQueue GROUP BY status').all(),
        env.DB.prepare('SELECT key, value FROM State WHERE key IN ("last_cursor_time", "last_cursor_id")').all()
      ]);

      return Response.json({
        total: total?.total || 0,
        categories: categories.results || [],
        queue: queueStats.results || [],
        cursor: cursor.results || []
      });
    }

    if (url.pathname === '/api/trigger' && request.method === 'POST') {
      try {
        const enqueueTask = new EnqueuePhotosTask();
        const enqueueResult = await enqueueTask.run(env, { 
          startPage: 1, 
          endPage: 3
        });

        const [downloadInstance, classifyInstance] = await Promise.all([
          env.DOWNLOAD_WORKFLOW.create({ payload: {} }),
          env.CLASSIFY_WORKFLOW.create({ payload: {} })
        ]);

        return Response.json({
          success: true,
          downloadWorkflowId: downloadInstance.id,
          classifyWorkflowId: classifyInstance.id,
          enqueued: enqueueResult.enqueued,
          skipped: enqueueResult.skipped,
          pages: enqueueResult.pages,
          cursor: enqueueResult.cursor,
          message: 'Photos enqueued and workflows triggered'
        });
      } catch (error) {
        return Response.json({
          success: false,
          error: error.message
        }, { status: 500 });
      }
    }
    
    return Response.json({ 
      message: 'Pic Scheduler API',
      endpoints: {
        health: 'GET /health',
        stats: 'GET /api/stats',
        trigger: 'POST /api/trigger'
      }
    });
  },

  async scheduled(event, env, ctx) {
    console.log('Cron triggered');

    try {
      const enqueueTask = new EnqueuePhotosTask();
      const enqueueResult = await enqueueTask.run(env, { 
        startPage: 1, 
        endPage: 3
      });

      const [downloadInstance, classifyInstance] = await Promise.all([
        env.DOWNLOAD_WORKFLOW.create({ payload: {} }),
        env.CLASSIFY_WORKFLOW.create({ payload: {} })
      ]);

      console.log(`Enqueued ${enqueueResult.enqueued} photos, download: ${downloadInstance.id}, classify: ${classifyInstance.id}`);
    } catch (error) {
      console.error('Failed to enqueue and start workflows:', error);
    }
  }
};
