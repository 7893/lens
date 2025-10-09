export class SaveMetadataTask {
  async run(env, { photoDetail, category, confidence, r2Key }) {
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
      photoDetail.description,
      photoDetail.alt_description,
      photoDetail.blur_hash,
      photoDetail.width,
      photoDetail.height,
      photoDetail.color,
      photoDetail.likes,
      photoDetail.created_at,
      photoDetail.updated_at,
      photoDetail.promoted_at,
      photoDetail.user?.id || '',
      photoDetail.user?.username || '',
      photoDetail.user?.name || '',
      photoDetail.user?.bio,
      photoDetail.user?.location,
      photoDetail.user?.portfolio_url,
      photoDetail.user?.instagram_username,
      photoDetail.user?.twitter_username,
      photoDetail.location?.name,
      photoDetail.location?.city,
      photoDetail.location?.country,
      photoDetail.location?.position?.latitude,
      photoDetail.location?.position?.longitude,
      photoDetail.exif?.make,
      photoDetail.exif?.model,
      photoDetail.exif?.name,
      photoDetail.exif?.exposure_time,
      photoDetail.exif?.aperture,
      photoDetail.exif?.focal_length,
      photoDetail.exif?.iso,
      JSON.stringify(photoDetail.tags?.map(t => t.title) || []),
      category,
      confidence,
      JSON.stringify({ [category]: confidence })
    ).run();

    return { success: true };
  }
}
