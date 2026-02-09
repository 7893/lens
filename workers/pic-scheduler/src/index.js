import { DataPipelineWorkflow } from './workflows/data-pipeline.js';
import { EnqueuePhotosTask } from './tasks/enqueue-photos.js';
import { Analytics } from './utils/analytics.js';

export { DataPipelineWorkflow };

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

        const workflowInstance = await env.PHOTO_WORKFLOW.create({ payload: {} });

        await analytics.logEvent('trigger', { status: 'success' });

        return Response.json({
          success: true,
          workflowId: workflowInstance.id,
          enqueued: enqueueResult.enqueued,
          skipped: enqueueResult.skipped,
          pages: enqueueResult.pages,
          cursor: enqueueResult.cursor,
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
    console.log('Cron triggered (every 10 minutes)');

    try {
      // Check if UNSPLASH_API_KEY is set
      if (!env.UNSPLASH_API_KEY) {
        console.error('UNSPLASH_API_KEY not set');
        return;
      }

      const analytics = new Analytics(env.AE);
      
      // Step 1: Enqueue new photos
      const enqueueTask = new EnqueuePhotosTask();
      const enqueueResult = await enqueueTask.run(env, { 
        startPage: 1, 
        endPage: 1
      });

      // Step 2: Start workflow to process queue
      const workflowInstance = await env.PHOTO_WORKFLOW.create({ payload: {} });

      // Step 3: Cleanup old data (async)
      ctx.waitUntil(this.cleanupOldData(env));

      await analytics.logEvent('cron', { 
        status: 'success',
        enqueued: enqueueResult.enqueued 
      });

      console.log(`Enqueued ${enqueueResult.enqueued} photos, workflow: ${workflowInstance.id}`);
    } catch (error) {
      console.error('Failed to enqueue and start workflow:', error);
    }
  },

  async cleanupOldData(env) {
    try {
      const retentionConfig = await env.DB.prepare(
        'SELECT key, value FROM State WHERE key IN (?, ?)'
      ).bind('retention_days', 'max_photos').all();

      const config = Object.fromEntries(
        retentionConfig.results.map(r => [r.key, parseInt(r.value)])
      );

      const retentionDays = config.retention_days || 30;
      const maxPhotos = config.max_photos || 10000;

      // Check current photo count
      const { total } = await env.DB.prepare(
        'SELECT COUNT(*) as total FROM Photos'
      ).first();

      if (total <= maxPhotos) {
        console.log(`Photo count (${total}) within limit (${maxPhotos})`);
        return;
      }

      // Delete oldest photos beyond limit
      const toDelete = total - maxPhotos;
      const oldPhotos = await env.DB.prepare(`
        SELECT unsplash_id, r2_key FROM Photos 
        ORDER BY downloaded_at ASC 
        LIMIT ?
      `).bind(toDelete).all();

      let deletedFiles = 0;
      for (const photo of oldPhotos.results) {
        try {
          await env.R2.delete(photo.r2_key);
          deletedFiles++;
        } catch (err) {
          console.error(`Failed to delete R2 file ${photo.r2_key}:`, err);
        }
      }

      // Delete from database
      const photoIds = oldPhotos.results.map(p => p.unsplash_id);
      await env.DB.prepare(`
        DELETE FROM Photos WHERE unsplash_id IN (${photoIds.map(() => '?').join(',')})
      `).bind(...photoIds).run();

      // Log cleanup
      await env.DB.prepare(`
        INSERT INTO CleanupLog (photos_deleted, r2_files_deleted, cleanup_reason, executed_at)
        VALUES (?, ?, ?, ?)
      `).bind(
        photoIds.length,
        deletedFiles,
        `Exceeded max_photos limit (${maxPhotos})`,
        new Date().toISOString()
      ).run();

      console.log(`Cleanup: deleted ${photoIds.length} photos, ${deletedFiles} R2 files`);
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }
};
