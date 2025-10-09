export class EnqueuePhotosTask {
  async run(env, { page }) {
    const response = await fetch(
      `https://api.unsplash.com/photos?order_by=latest&per_page=30&page=${page}&client_id=${env.UNSPLASH_API_KEY}`
    );
    
    if (!response.ok) {
      throw new Error(`Unsplash API failed: ${response.status}`);
    }
    
    const photos = await response.json();
    let enqueued = 0;
    let skipped = 0;

    for (const photo of photos) {
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
    }

    console.log(`Enqueued ${enqueued} photos, skipped ${skipped} from page ${page}`);

    return { enqueued, skipped, total: photos.length };
  }
}
