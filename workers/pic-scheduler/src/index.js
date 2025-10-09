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
    
    return Response.json({ 
      message: 'Pic API',
      endpoints: {
        health: '/health',
        stats: '/api/stats'
      }
    });
  },

  async scheduled(event, env, ctx) {
    console.log('Cron triggered');

    const state = await env.DB.prepare('SELECT value FROM State WHERE key = ?').bind('last_page').first();
    const currentPage = state?.value ? parseInt(state.value) : 0;
    const nextPage = currentPage + 1;

    try {
      const instance = await env.WORKFLOW.create({ params: { page: nextPage } });

      await env.DB.prepare(`
        INSERT INTO State (key, value, updated_at) VALUES ('last_page', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
      `).bind(String(nextPage), new Date().toISOString(), String(nextPage), new Date().toISOString()).run();

      console.log(`Workflow started: page ${nextPage}, ID: ${instance.id}`);
    } catch (error) {
      console.error('Failed to start workflow:', error);
    }
  }
};
