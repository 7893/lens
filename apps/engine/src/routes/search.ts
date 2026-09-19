import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ApiBindings, createTrace, Logger } from '@lens/shared';
import { rateLimit } from '../middleware/rateLimit';
import { SearchService } from '../modules/retrieval';
import { recordSuggestion } from './suggest';

const search = new Hono<{ Bindings: ApiBindings }>();

search.use('/', rateLimit);

/**
 * GET /api/search
 * High-performance semantic search entry point.
 * Supports standard JSON responses as well as Server-Sent Events (SSE) streaming via `?stream=true`.
 */
search.get('/', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'Missing query param "q"' }, 400);

  const isStream = c.req.query('stream') === 'true' || c.req.header('accept')?.includes('text/event-stream');
  const cursor = c.req.query('cursor');
  const color = c.req.query('color');
  const orientation = c.req.query('orientation') as 'landscape' | 'portrait' | 'square' | undefined;
  const tag = c.req.query('tag');

  const trace = createTrace('SEARCH');
  const logger = new Logger(trace, c.env.TELEMETRY);

  // 1. Edge Cache Layer (L1) with normalized query and filters
  const cacheUrl = new URL('https://lens-cache/search');
  cacheUrl.searchParams.set('q', q.toLowerCase().trim());
  if (cursor) cacheUrl.searchParams.set('cursor', cursor);
  if (color) cacheUrl.searchParams.set('color', color);
  if (orientation) cacheUrl.searchParams.set('orientation', orientation);
  if (tag) cacheUrl.searchParams.set('tag', tag);
  const cacheKey = new Request(cacheUrl.toString());

  const cache = caches.default;
  const cachedResponse = await cache.match(cacheKey);
  if (cachedResponse) {
    logger.info('Edge Cache Hit');
    if (isStream) {
      const cachedData = (await cachedResponse.json()) as Record<string, unknown>;
      return streamSSE(c, async (stream) => {
        await stream.writeSSE({
          event: 'stage',
          data: JSON.stringify({ stage: 'complete', ...cachedData }),
        });
        await stream.writeSSE({ event: 'done', data: '{}' });
      });
    }
    return cachedResponse;
  }

  const searchService = new SearchService(c.env, logger);
  const searchSpec = {
    query: q,
    cursor,
    filters: {
      color,
      orientation,
      tag,
    },
  };

  // 2. Stream Response via Server-Sent Events (SSE)
  if (isStream) {
    return streamSSE(c, async (stream) => {
      try {
        const finalResult = await searchService.searchStream(
          searchSpec,
          async (event, data) => {
            await stream.writeSSE({
              event,
              data: JSON.stringify(data),
            });
          },
          trace.traceId,
        );

        // Cache completed result in edge cache
        const fullResponse = new Response(JSON.stringify(finalResult), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=600',
          },
        });
        c.executionCtx.waitUntil(cache.put(cacheKey, fullResponse));
        c.executionCtx.waitUntil(recordSuggestion(c.env.SETTINGS, q));

        if (finalResult.telemetry) {
          logger.trackSearch({
            query: q,
            resultsBeforeCliff: finalResult.telemetry.resultsBeforeCliff,
            resultsAfterCliff: finalResult.telemetry.resultsAfterCliff,
            highestScore: finalResult.telemetry.highestScore,
            lowestScore: finalResult.telemetry.lowestScore,
            fts5Hits: finalResult.telemetry.fts5Hits,
            vectorHits: finalResult.telemetry.vectorHits,
            zeroResult: finalResult.results.length === 0,
          });
        }
      } catch (err) {
        logger.metric('search_error', [], [String(err).slice(0, 100)]);
        logger.error('Stream Search Failure', err);
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ error: 'Search stream error' }),
        });
      }
    });
  }

  // 3. Standard JSON Response (Fallback / Direct)
  try {
    const result = await searchService.search(searchSpec, trace.traceId);

    const response = new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600', // 10 min cache
      },
    });

    // Post-processing (Async)
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
    c.executionCtx.waitUntil(recordSuggestion(c.env.SETTINGS, q));

    if (result.telemetry) {
      logger.trackSearch({
        query: q,
        resultsBeforeCliff: result.telemetry.resultsBeforeCliff,
        resultsAfterCliff: result.telemetry.resultsAfterCliff,
        highestScore: result.telemetry.highestScore,
        lowestScore: result.telemetry.lowestScore,
        fts5Hits: result.telemetry.fts5Hits,
        vectorHits: result.telemetry.vectorHits,
        zeroResult: result.results.length === 0,
      });
    }

    return response;
  } catch (err) {
    logger.metric('search_error', [], [String(err).slice(0, 100)]);
    logger.error('Fatal Search Failure', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export default search;
