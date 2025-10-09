import { DownloadWorkflow } from './workflows/download-workflow.js';
import { ClassifyWorkflow } from './workflows/classify-workflow.js';
import { EnqueuePhotosTask } from './tasks/enqueue-photos.js';
import { Analytics } from './utils/analytics.js';

export { DownloadWorkflow, ClassifyWorkflow };

let statsCache = null;
let statsCacheTime = 0;
const CACHE_TTL = 30000;

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
      const now = Date.now();
      
      if (statsCache && (now - statsCacheTime) < CACHE_TTL) {
        return Response.json(statsCache);
      }

      const [total, queueStats] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) as total FROM Photos').first(),
        env.DB.prepare('SELECT status, COUNT(*) as count FROM ProcessingQueue GROUP BY status').all()
      ]);

      statsCache = {
        total: total?.total || 0,
        queue: queueStats.results || [],
        cached: true,
        cacheAge: 0
      };
      statsCacheTime = now;

      return Response.json(statsCache);
    }

    if (url.pathname === '/api/trigger' && request.method === 'POST') {
      try {
        const analytics = new Analytics(env.AE);
        
        const enqueueTask = new EnqueuePhotosTask();
        const enqueueResult = await enqueueTask.run(env, { 
          startPage: 1, 
          endPage: 3
        });

        const [downloadInstance, classifyInstance] = await Promise.all([
          env.DOWNLOAD_WORKFLOW.create({ payload: {} }),
          env.CLASSIFY_WORKFLOW.create({ payload: {} })
        ]);

        await analytics.logEvent('trigger', { status: 'success' });

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
    console.log('Cron triggered (every 10 minutes)');

    try {
      const analytics = new Analytics(env.AE);
      
      const enqueueTask = new EnqueuePhotosTask();
      const enqueueResult = await enqueueTask.run(env, { 
        startPage: 1, 
        endPage: 3
      });

      const [downloadInstance, classifyInstance] = await Promise.all([
        env.DOWNLOAD_WORKFLOW.create({ payload: {} }),
        env.CLASSIFY_WORKFLOW.create({ payload: {} })
      ]);

      await analytics.logEvent('cron', { 
        status: 'success',
        enqueued: enqueueResult.enqueued 
      });

      console.log(`Enqueued ${enqueueResult.enqueued} photos, download: ${downloadInstance.id}, classify: ${classifyInstance.id}`);
    } catch (error) {
      console.error('Failed to enqueue and start workflows:', error);
    }
  }
};
