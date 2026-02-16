import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SearchResponse, ImageDetailResponse, DBImage, ImageResult } from '@pic/shared';

// Define Bindings
type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  R2: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

// Middleware
app.use('/*', cors());

// 1. Health Check
app.get('/health', (c) => c.json({ status: 'healthy', version: '6.0.0' }));

// 2. Semantic Search
app.get('/api/search', async (c) => {
  const q = c.req.query('q');
  const limit = parseInt(c.req.query('limit') || '20');
  
  if (!q) return c.json({ error: 'Missing query param "q"' }, 400);

  const start = Date.now();

  try {
    // A. Generate Embedding for Query
    const embeddingResp = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [q]
    }) as { data: number[][] };
    const vector = embeddingResp.data[0];

    // B. Search Vector Index
    const vecResults = await c.env.VECTORIZE.query(vector, {
      topK: limit,
      returnMetadata: true
    });

    if (vecResults.matches.length === 0) {
      return c.json<SearchResponse>({ results: [], total: 0, page: 1, took: Date.now() - start });
    }

    // C. Fetch Metadata from D1
    // Extract IDs
    const ids = vecResults.matches.map(m => m.id);
    const placeholders = ids.map(() => '?').join(',');
    
    // Query D1 (Order by FIELD to maintain vector relevance order)
    // Note: D1/SQLite doesn't support "ORDER BY FIELD" natively easily, so we sort in JS
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM images WHERE id IN (${placeholders})`
    ).bind(...ids).all<DBImage>();

    // D. Assemble Response
    // Map D1 results back to Vector order and format
    const images: ImageResult[] = vecResults.matches.map(match => {
      const dbImage = results.find(r => r.id === match.id);
      if (!dbImage) return null;

      return {
        id: dbImage.id,
        url: `/image/display/${dbImage.id}.jpg`, // Or public R2 URL if configured
        width: dbImage.width,
        height: dbImage.height,
        caption: dbImage.ai_caption,
        tags: JSON.parse(dbImage.ai_tags || '[]'),
        score: match.score,
        photographer: JSON.parse(dbImage.meta_json || '{}').user?.name
      };
    }).filter(Boolean) as ImageResult[];

    return c.json<SearchResponse>({
      results: images,
      total: images.length, // Vector search is approximate, total is usually topK
      page: 1,
      took: Date.now() - start
    });

  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// 3. Image Details
app.get('/api/images/:id', async (c) => {
  const id = c.req.param('id');
  
  const image = await c.env.DB.prepare('SELECT * FROM images WHERE id = ?').bind(id).first<DBImage>();
  
  if (!image) return c.json({ error: 'Not found' }, 404);

  const meta = JSON.parse(image.meta_json || '{}');

  const response: ImageDetailResponse = {
    id: image.id,
    urls: {
      raw: `/image/raw/${image.id}.jpg`, // Proxy URL
      display: `/image/display/${image.id}.jpg`
    },
    metadata: {
      photographer: meta.user?.name || 'Unknown',
      location: meta.location?.name,
      exif: meta.exif
    },
    ai: {
      caption: image.ai_caption,
      tags: JSON.parse(image.ai_tags || '[]')
    }
  };

  return c.json(response);
});

// 4. Image Proxy (Optional: if R2 is not public)
// GET /image/:type/:filename
app.get('/image/:type/:filename', async (c) => {
  const type = c.req.param('type'); // 'raw' or 'display'
  const filename = c.req.param('filename');
  const key = `${type === 'raw' ? 'raw' : 'display'}/${filename}`;

  const object = await c.env.R2.get(key);
  if (!object) return c.text('Image not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000'); // Cache 1 year

  return new Response(object.body, { headers });
});

export default app;
