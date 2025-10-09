import { DataPipelineWorkflow } from './workflows/data-pipeline.js';
import { EnqueuePhotosTask } from './tasks/enqueue-photos.js';

export { DataPipelineWorkflow };

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
      const [total, categories, queueStats] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) as total FROM Photos').first(),
        env.DB.prepare('SELECT ai_category, COUNT(*) as count FROM Photos GROUP BY ai_category ORDER BY count DESC').all(),
        env.DB.prepare('SELECT status, COUNT(*) as count FROM ProcessingQueue GROUP BY status').all()
      ]);

      return Response.json({
        total: total?.total || 0,
        categories: categories.results || [],
        queue: queueStats.results || []
      });
    }

    if (url.pathname === '/api/trigger' && request.method === 'POST') {
      const pageState = await env.DB.prepare('SELECT value FROM State WHERE key = ?').bind('last_page').first();
      const currentPage = pageState?.value ? parseInt(pageState.value) : 1;

      try {
        const enqueueTask = new EnqueuePhotosTask();
        const enqueueResult = await enqueueTask.run(env, { page: currentPage });

        if (enqueueResult.enqueued > 0) {
          await env.DB.prepare(`
            INSERT INTO State (key, value, updated_at) VALUES ('last_page', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
          `).bind(String(currentPage + 1), new Date().toISOString(), String(currentPage + 1), new Date().toISOString()).run();
        }

        const instance = await env.WORKFLOW.create({ payload: {} });

        return Response.json({
          success: true,
          workflowId: instance.id,
          page: currentPage,
          enqueued: enqueueResult.enqueued,
          skipped: enqueueResult.skipped,
          message: 'Photos enqueued and workflow triggered'
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

    const pageState = await env.DB.prepare('SELECT value FROM State WHERE key = ?').bind('last_page').first();
    const currentPage = pageState?.value ? parseInt(pageState.value) : 1;

    try {
      const enqueueTask = new EnqueuePhotosTask();
      const enqueueResult = await enqueueTask.run(env, { page: currentPage });

      if (enqueueResult.enqueued > 0) {
        await env.DB.prepare(`
          INSERT INTO State (key, value, updated_at) VALUES ('last_page', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
        `).bind(String(currentPage + 1), new Date().toISOString(), String(currentPage + 1), new Date().toISOString()).run();
      }

      const instance = await env.WORKFLOW.create({ payload: {} });

      console.log(`Enqueued ${enqueueResult.enqueued} photos from page ${currentPage}, workflow ID: ${instance.id}`);
    } catch (error) {
      console.error('Failed to enqueue and start workflow:', error);
    }
  }
};
