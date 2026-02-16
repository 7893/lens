import { DataPipelineWorkflow } from './workflows/data-pipeline.js';
import { EnqueuePhotosTask } from './tasks/enqueue-photos.js';
import { Analytics } from './utils/analytics.js';
import FRONTEND_HTML from './frontend.html';

export { DataPipelineWorkflow };

let statsCache = null;
let statsCacheTime = 0;
const CACHE_TTL = 30000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Frontend: home page
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(FRONTEND_HTML, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    // Frontend: photo list
    if (url.pathname === '/api/photos') {
      const page = parseInt(url.searchParams.get('page')) || 1;
      const limit = parseInt(url.searchParams.get('limit')) || 30;
      const category = url.searchParams.get('category');
      const offset = (page - 1) * limit;

      let query = 'SELECT * FROM Photos';
      let params = [];

      if (category) {
        query += ' WHERE ai_category = ?';
        params.push(category);
      }

      query += ' ORDER BY downloaded_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const photos = await env.DB.prepare(query).bind(...params).all();

      return Response.json({ photos: photos.results, page, limit });
    }

    // Stats (merged: frontend detailed + scheduler simple)
    if (url.pathname === '/api/stats') {
      const now = Date.now();

      if (statsCache && (now - statsCacheTime) < CACHE_TTL) {
        return Response.json(statsCache);
      }

      const [globalStats, apiQuota, categoryStats, recentWorkflows] = await Promise.all([
        env.DB.prepare('SELECT * FROM GlobalStats WHERE id = 1').first(),
        env.DB.prepare('SELECT * FROM ApiQuota ORDER BY api_name').all(),
        env.DB.prepare('SELECT * FROM CategoryStats ORDER BY photo_count DESC LIMIT 10').all(),
        env.DB.prepare('SELECT * FROM WorkflowRuns ORDER BY started_at DESC LIMIT 5').all()
      ]);

      statsCache = {
        global: globalStats || {},
        apiQuota: apiQuota.results || [],
        categories: categoryStats.results || [],
        recentWorkflows: recentWorkflows.results || []
      };
      statsCacheTime = now;

      return Response.json(statsCache);
    }

    // Frontend: image proxy from R2
    if (url.pathname.startsWith('/image/')) {
      const key = url.pathname.slice(7);
      const object = await env.R2.get(key);
      if (!object) {
        return new Response('Image not found', { status: 404 });
      }
      return new Response(object.body, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000'
        }
      });
    }

    // Scheduler: health check
    if (url.pathname === '/health') {
      return Response.json({
        status: 'healthy',
        timestamp: new Date().toISOString()
      });
    }

    // Scheduler: manual trigger
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

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    console.log('Cron triggered');

    try {
      if (!env.UNSPLASH_API_KEY) {
        console.error('UNSPLASH_API_KEY not set');
        return;
      }

      const analytics = new Analytics(env.AE);

      const enqueueTask = new EnqueuePhotosTask();
      const enqueueResult = await enqueueTask.run(env, {
        startPage: 1,
        endPage: 1
      });

      const workflowInstance = await env.PHOTO_WORKFLOW.create({ payload: {} });

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

      const maxPhotos = config.max_photos || 4000;

      const { total } = await env.DB.prepare(
        'SELECT COUNT(*) as total FROM Photos'
      ).first();

      if (total <= maxPhotos) {
        console.log(`Photo count (${total}) within limit (${maxPhotos})`);
        return;
      }

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

      const photoIds = oldPhotos.results.map(p => p.unsplash_id);
      await env.DB.prepare(`
        DELETE FROM Photos WHERE unsplash_id IN (${photoIds.map(() => '?').join(',')})
      `).bind(...photoIds).run();

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
