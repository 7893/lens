import { Hono } from 'hono';
import { ApiBindings, createTrace, Logger } from '@lens/shared';
import { rateLimit } from '../middleware/rateLimit';
import { SearchService } from '../services/SearchService';
import { recordSuggestion } from './suggest';

const search = new Hono<{ Bindings: ApiBindings }>();

search.use('/', rateLimit);

/**
 * GET /api/search
 * High-performance semantic search entry point.
 */
search.get('/', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'Missing query param "q"' }, 400);

  const trace = createTrace('SEARCH');
  const logger = new Logger(trace, c.env.TELEMETRY);

  // 1. Edge Cache Layer (L1)
  const cacheKey = new Request(`https://lens-cache/search?q=${encodeURIComponent(q.toLowerCase().trim())}`);
  const cache = caches.default;
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    logger.info('Edge Cache Hit');
    return cachedResponse;
  }

  try {
    // 2. Execute Search Service Logic
    const searchService = new SearchService(c.env, logger);
    const result = await searchService.search(q);

    const response = new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600', // 10 min cache
      },
    });

    // 3. Post-processing (Async)
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
    c.executionCtx.waitUntil(recordSuggestion(c.env.SETTINGS, q));

    logger.metric('search_complete', [result.took, result.total], [q.slice(0, 50)]);
    return response;
  } catch (err) {
    logger.metric('search_error', [], [String(err).slice(0, 100)]);
    logger.error('Fatal Search Failure', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export default search;
