export class EnqueuePhotosTask {
  async run(env, { startPage = 1, endPage = 3 }) {
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

    for (let page = startPage; page <= endPage; page++) {
      const response = await fetch(
        `https://api.unsplash.com/photos?order_by=latest&per_page=30&page=${page}&client_id=${env.UNSPLASH_API_KEY}`
      );
      
      if (!response.ok) {
        throw new Error(`Unsplash API failed: ${response.status}`);
      }
      
      const photos = await response.json();

      for (const photo of photos) {
        if (lastCursorTime && photo.created_at <= lastCursorTime) {
          skipped++;
          continue;
        }

        const existing = await env.DB.prepare(
          'SELECT unsplash_id FROM Photos WHERE unsplash_id = ?'
        ).bind(photo.id).first();

        if (existing) {
          skipped++;
          continue;
        }

        const inQueue = await env.DB.prepare(
          'SELECT unsplash_id FROM ProcessingQueue WHERE unsplash_id = ?'
        ).bind(photo.id).first();

        if (inQueue) {
          skipped++;
          continue;
        }

        await env.DB.prepare(`
          INSERT OR IGNORE INTO ProcessingQueue 
          (unsplash_id, page, status, photo_data, created_at, updated_at)
          VALUES (?, ?, 'pending', ?, datetime('now'), datetime('now'))
        `).bind(photo.id, page, JSON.stringify(photo)).run();

        enqueued++;

        if (!newCursorTime || photo.created_at > newCursorTime) {
          newCursorTime = photo.created_at;
          newCursorId = photo.id;
        }
      }

      console.log(`Page ${page}: enqueued ${enqueued}, skipped ${skipped}`);
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

    return { 
      enqueued, 
      skipped, 
      pages: endPage - startPage + 1,
      cursor: newCursorTime 
    };
  }
}
