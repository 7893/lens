import { Hono } from 'hono';
import { ApiBindings, SuggestResponse } from '@lens/shared';

const suggest = new Hono<{ Bindings: ApiBindings }>();

/** Build the KV key for a given query prefix (first 2 chars). */
export function buildSuggestKey(query: string): string | null {
  const normalized = query.toLowerCase().trim();
  if (normalized.length < 2) return null;
  return `suggest:prefix:${normalized.slice(0, 2)}`;
}

/**
 * Record a successful search query into the suggestion index.
 * Call this inside waitUntil() to avoid blocking the response.
 */
export async function recordSuggestion(kv: KVNamespace, rawQuery: string): Promise<void> {
  const normalized = rawQuery.toLowerCase().trim();
  if (normalized.length < 2) return;

  const key = buildSuggestKey(normalized);
  if (!key) return;

  const existing = await kv.get(key);
  const entries: string[] = existing ? JSON.parse(existing) : [];

  // Deduplicate
  if (entries.includes(normalized)) return;

  // FIFO cap at 50
  entries.push(normalized);
  if (entries.length > 50) entries.shift();

  await kv.put(key, JSON.stringify(entries), { expirationTtl: 2592000 }); // 30 days
}

suggest.get('/', async (c) => {
  const q = c.req.query('q');
  if (!q || q.trim().length < 2) {
    return c.json<SuggestResponse>({ suggestions: [] });
  }

  const key = buildSuggestKey(q);
  if (!key) return c.json<SuggestResponse>({ suggestions: [] });

  const data = await c.env.SETTINGS.get(key);
  if (!data) return c.json<SuggestResponse>({ suggestions: [] });

  const entries: string[] = JSON.parse(data);
  const prefix = q.toLowerCase().trim();
  const matches = entries.filter((e) => e.startsWith(prefix)).slice(0, 8);

  return c.json<SuggestResponse>({ suggestions: matches });
});

export default suggest;
