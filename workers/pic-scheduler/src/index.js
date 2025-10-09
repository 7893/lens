import { DataPipelineWorkflow } from './workflows/data-pipeline.js';

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
      const [total, categories] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) as total FROM Photos').first(),
        env.DB.prepare('SELECT ai_category, COUNT(*) as count FROM Photos GROUP BY ai_category ORDER BY count DESC').all()
      ]);

      return Response.json({
        total: total?.total || 0,
        categories: categories.results || []
      });
    }

    if (url.pathname === '/api/trigger' && request.method === 'POST') {
      const [pageState, offsetState] = await Promise.all([
        env.DB.prepare('SELECT value FROM State WHERE key = ?').bind('last_page').first(),
        env.DB.prepare('SELECT value FROM State WHERE key = ?').bind('page_offset').first()
      ]);

      const currentPage = pageState?.value ? parseInt(pageState.value) : 1;
      const currentOffset = offsetState?.value ? parseInt(offsetState.value) : 0;

      try {
        const instance = await env.WORKFLOW.create({ 
          payload: { page: currentPage, offset: currentOffset } 
        });

        return Response.json({
          success: true,
          workflowId: instance.id,
          page: currentPage,
          offset: currentOffset,
          message: 'Workflow triggered successfully'
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

    const [pageState, offsetState] = await Promise.all([
      env.DB.prepare('SELECT value FROM State WHERE key = ?').bind('last_page').first(),
      env.DB.prepare('SELECT value FROM State WHERE key = ?').bind('page_offset').first()
    ]);

    const currentPage = pageState?.value ? parseInt(pageState.value) : 1;
    const currentOffset = offsetState?.value ? parseInt(offsetState.value) : 0;

    try {
      const instance = await env.WORKFLOW.create({ 
        payload: { page: currentPage, offset: currentOffset } 
      });

      console.log(`Workflow started: page ${currentPage}, offset ${currentOffset}, ID: ${instance.id}`);
    } catch (error) {
      console.error('Failed to start workflow:', error);
    }
  }
};
