export class ProcessPhotoTask {
  async run(env, { photoId, apiKey }) {
    // Check if exists
    const existing = await env.DB.prepare(
      'SELECT unsplash_id FROM Photos WHERE unsplash_id = ?'
    ).bind(photoId).first();
    
    if (existing) {
      return { success: true, skipped: true };
    }

    // Get photo details
    const detailRes = await fetch(
      `https://api.unsplash.com/photos/${photoId}?client_id=${apiKey}`
    );
    const detail = await detailRes.json();
    
    // Download image
    const imgRes = await fetch(detail.urls.raw);
    if (!imgRes.ok) throw new Error('Download failed');
    const imgBuf = await imgRes.arrayBuffer();

    // AI classify (simplified - using first model only for now)
    const aiRes = await env.AI.run('@cf/meta/llama-3.2-3b-instruct', {
      messages: [{
        role: 'user',
        content: `Classify this image into ONE category. Return ONLY a JSON object: {"label": "category-name", "score": 0.95}. Description: "${detail.alt_description || detail.description || 'No description'}"`
      }],
      max_tokens: 50,
      temperature: 0.1
    });

    const text = aiRes.response?.trim() || '{}';
    const jsonMatch = text.match(/\{[^}]+\}/);
    const aiResult = jsonMatch ? JSON.parse(jsonMatch[0]) : { label: 'uncategorized', score: 0 };
    const category = aiResult.label.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

    // Upload to R2
    const r2Key = `${category}/${detail.id}.jpg`;
    await env.R2.put(r2Key, imgBuf, {
      httpMetadata: { contentType: 'image/jpeg' }
    });

    // Save to DB
    await env.DB.prepare(`
      INSERT INTO Photos (
        unsplash_id, slug, r2_key, downloaded_at,
        description, alt_description, blur_hash, width, height, color, likes,
        created_at, updated_at, promoted_at,
        photographer_id, photographer_username, photographer_name, 
        photographer_bio, photographer_location, photographer_portfolio_url,
        photographer_instagram, photographer_twitter,
        photo_location_name, photo_location_city, photo_location_country,
        photo_location_latitude, photo_location_longitude,
        exif_make, exif_model, exif_name, exif_exposure_time,
        exif_aperture, exif_focal_length, exif_iso,
        tags, ai_category, ai_confidence, ai_model_scores
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      detail.id, detail.slug || '', r2Key, new Date().toISOString(),
      detail.description, detail.alt_description, detail.blur_hash,
      detail.width, detail.height, detail.color, detail.likes,
      detail.created_at, detail.updated_at, detail.promoted_at,
      detail.user?.id || '', detail.user?.username || '', detail.user?.name || '',
      detail.user?.bio, detail.user?.location, detail.user?.portfolio_url,
      detail.user?.instagram_username, detail.user?.twitter_username,
      detail.location?.name, detail.location?.city, detail.location?.country,
      detail.location?.position?.latitude, detail.location?.position?.longitude,
      detail.exif?.make, detail.exif?.model, detail.exif?.name,
      detail.exif?.exposure_time, detail.exif?.aperture, detail.exif?.focal_length, detail.exif?.iso,
      JSON.stringify(detail.tags?.map(t => t.title) || []),
      category, aiResult.score || 0, JSON.stringify({ [category]: aiResult.score })
    ).run();

    return { success: true, category };
  }
}
