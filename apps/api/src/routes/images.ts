import { Hono } from 'hono';
import { ApiBindings, DBImage } from '@lens/shared';
import { toImageResult } from '../utils/transform';

const images = new Hono<{ Bindings: ApiBindings }>();

// Latest images
images.get('/latest', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM images WHERE ai_caption IS NOT NULL ORDER BY created_at DESC LIMIT 100',
  ).all<DBImage>();

  return c.json({ results: results.map((img) => toImageResult(img)), total: results.length });
});

// Image details
images.get('/:id', async (c) => {
  const id = c.req.param('id');
  const image = await c.env.DB.prepare('SELECT * FROM images WHERE id = ?').bind(id).first<DBImage>();
  if (!image) return c.json({ error: 'Not found' }, 404);

  const meta = JSON.parse(image.meta_json || '{}');
  const user = meta.user || {};

  return c.json({
    id: image.id,
    urls: { raw: `/images/raw/${image.id}.jpg`, display: `/images/display/${image.id}.jpg` },
    width: image.width,
    height: image.height,
    color: image.color,
    blurHash: meta.blur_hash || null,
    description: meta.description || null,
    altDescription: meta.alt_description || null,
    createdAt: meta.created_at || null,
    promotedAt: meta.promoted_at || null,
    photographer: {
      name: user.name || null,
      username: user.username || null,
      bio: user.bio || null,
      location: user.location || null,
      profile: user.links?.html || null,
      profileImage: user.profile_image?.medium || null,
      instagram: user.instagram_username || null,
      twitter: user.twitter_username || null,
      portfolio: user.portfolio_url || null,
      totalPhotos: user.total_photos || null,
    },
    exif: meta.exif
      ? {
          make: meta.exif.make || null,
          model: meta.exif.model || null,
          camera: meta.exif.name || null,
          aperture: meta.exif.aperture ? `f/${meta.exif.aperture}` : null,
          exposure: meta.exif.exposure_time || null,
          focalLength: meta.exif.focal_length ? `${meta.exif.focal_length}mm` : null,
          iso: meta.exif.iso || null,
        }
      : null,
    location: meta.location
      ? {
          name: meta.location.name || null,
          city: meta.location.city || null,
          country: meta.location.country || null,
          latitude: meta.location.position?.latitude || null,
          longitude: meta.location.position?.longitude || null,
        }
      : null,
    topics: Object.keys(meta.topic_submissions || {}),
    stats: { views: meta.views || null, downloads: meta.downloads || null, likes: meta.likes || null },
    ai: {
      caption: image.ai_caption,
      tags: JSON.parse(image.ai_tags || '[]'),
      model: image.ai_model,
      qualityScore: image.ai_quality_score,
      entities: image.entities_json ? JSON.parse(image.entities_json) : [],
    },
    source: meta.links?.html || null,
  });
});

// Image proxy
images.get('/display/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) return c.text('Invalid filename', 400);

  const object = await c.env.R2.get(`display/${filename}`);
  if (!object) return c.text('Image not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
});

images.get('/raw/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) return c.text('Invalid filename', 400);

  const object = await c.env.R2.get(`raw/${filename}`);
  if (!object) return c.text('Image not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
});

export default images;
