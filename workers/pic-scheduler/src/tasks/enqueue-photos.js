export class EnqueuePhotosTask {
  async run(env, { startPage = 1, endPage = 2 }) {
    try {
      const [cursorTime, cursorId] = await Promise.all([
        env.DB.prepare('SELECT value FROM State WHERE key = ?').bind('last_cursor_time').first(),
        env.DB.prepare('SELECT value FROM State WHERE key = ?').bind('last_cursor_id').first()
      ]);

      const lastCursorTime = cursorTime?.value || '';
      const lastCursorId = cursorId?.value || '';
      
      let enqueued = 0;
      let skipped = 0;
      let newCursorTime = lastCursorTime;
      let newCursorId = lastCursorId;
      let allPhotos = [];

      for (let page = startPage; page <= endPage; page++) {
        const response = await fetch(
          `https://api.unsplash.com/photos?order_by=latest&per_page=30&page=${page}&client_id=${env.UNSPLASH_API_KEY}`
        );
        
        if (!response.ok) {
          console.error(`Unsplash API failed: ${response.status}`);
          continue;
        }
        
        const photos = await response.json();
        allPhotos.push(...photos);
      }

      if (allPhotos.length === 0) {
        return { enqueued: 0, skipped: 0, pages: 0, cursor: lastCursorTime };
      }

      // Batch query for existing photos
      const photoIds = allPhotos.map(p => p.id);
      const placeholders = photoIds.map(() => '?').join(',');
      
      const [existingPhotos, queuedPhotos] = await Promise.all([
        env.DB.prepare(`SELECT unsplash_id FROM Photos WHERE unsplash_id IN (${placeholders})`)
          .bind(...photoIds).all(),
        env.DB.prepare(`SELECT unsplash_id FROM ProcessingQueue WHERE unsplash_id IN (${placeholders})`)
          .bind(...photoIds).all()
      ]);

      const existingIds = new Set(existingPhotos.results.map(r => r.unsplash_id));
      const queuedIds = new Set(queuedPhotos.results.map(r => r.unsplash_id));

      for (const photo of allPhotos) {
        // Fix: use < instead of <=
        if (lastCursorTime && photo.created_at < lastCursorTime) {
          skipped++;
          continue;
        }

        if (existingIds.has(photo.id) || queuedIds.has(photo.id)) {
          skipped++;
          continue;
        }

        await env.DB.prepare(`
          INSERT OR IGNORE INTO ProcessingQueue 
          (unsplash_id, page, status, photo_data, created_at, updated_at)
          VALUES (?, ?, 'pending', ?, datetime('now'), datetime('now'))
        `).bind(photo.id, 1, JSON.stringify(photo)).run();

        enqueued++;

        if (!newCursorTime || photo.created_at > newCursorTime) {
          newCursorTime = photo.created_at;
          newCursorId = photo.id;
        }
      }

      if (newCursorTime && newCursorTime !== lastCursorTime) {
        await env.DB.prepare(`
          INSERT INTO State (key, value, updated_at) VALUES ('last_cursor_time', ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
        `).bind(newCursorTime, newCursorTime).run();

        await env.DB.prepare(`
          INSERT INTO State (key, value, updated_at) VALUES ('last_cursor_id', ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = datetime('now')
        `).bind(newCursorId, newCursorId).run();

        console.log(`Updated cursor: ${newCursorTime} (${newCursorId})`);
      }

      console.log(`Enqueued: ${enqueued}, Skipped: ${skipped}`);

      return { 
        enqueued, 
        skipped, 
        pages: endPage - startPage + 1,
        cursor: newCursorTime 
      };
    } catch (error) {
      console.error('EnqueuePhotosTask error:', error);
      throw error;
    }
  }
}
