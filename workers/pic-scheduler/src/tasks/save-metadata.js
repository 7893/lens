export class SaveMetadataTask {
  async run(env, { photoDetail, category, confidence, r2Key }) {
    const imageSize = photoDetail.width * photoDetail.height * 3;
    
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
      photoDetail.id,
      photoDetail.slug || '',
      r2Key,
      new Date().toISOString(),
      photoDetail.description || null,
      photoDetail.alt_description || null,
      photoDetail.blur_hash || null,
      photoDetail.width,
      photoDetail.height,
      photoDetail.color || null,
      photoDetail.likes || 0,
      photoDetail.created_at,
      photoDetail.updated_at || null,
      photoDetail.promoted_at || null,
      photoDetail.user?.id || '',
      photoDetail.user?.username || '',
      photoDetail.user?.name || '',
      photoDetail.user?.bio || null,
      photoDetail.user?.location || null,
      photoDetail.user?.portfolio_url || null,
      photoDetail.user?.instagram_username || null,
      photoDetail.user?.twitter_username || null,
      photoDetail.location?.name || null,
      photoDetail.location?.city || null,
      photoDetail.location?.country || null,
      photoDetail.location?.position?.latitude || null,
      photoDetail.location?.position?.longitude || null,
      photoDetail.exif?.make || null,
      photoDetail.exif?.model || null,
      photoDetail.exif?.name || null,
      photoDetail.exif?.exposure_time || null,
      photoDetail.exif?.aperture || null,
      photoDetail.exif?.focal_length || null,
      photoDetail.exif?.iso || null,
      JSON.stringify(photoDetail.tags?.map(t => t.title) || []),
      category,
      confidence,
      JSON.stringify({ [category]: confidence })
    ).run();

    await env.DB.prepare(`
      UPDATE GlobalStats SET 
        total_photos = total_photos + 1,
        total_storage_bytes = total_storage_bytes + ?,
        updated_at = ?
      WHERE id = 1
    `).bind(imageSize, new Date().toISOString()).run();

    await env.DB.prepare(`
      INSERT INTO CategoryStats (category, photo_count, updated_at)
      VALUES (?, 1, ?)
      ON CONFLICT(category) DO UPDATE SET 
        photo_count = photo_count + 1,
        updated_at = ?
    `).bind(category, new Date().toISOString(), new Date().toISOString()).run();

    const categories = await env.DB.prepare('SELECT COUNT(DISTINCT ai_category) as count FROM Photos').first();
    await env.DB.prepare('UPDATE GlobalStats SET total_categories = ? WHERE id = 1').bind(categories.count).run();

    return { success: true };
  }
}
