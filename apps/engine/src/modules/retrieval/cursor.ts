import { SearchCursor } from './contracts';

/**
 * Computes a fast, deterministic hash for query normalization in pagination.
 */
export function hashQuery(normalizedQuery: string): string {
  let hash = 5381;
  for (let i = 0; i < normalizedQuery.length; i++) {
    hash = ((hash << 5) + hash + normalizedQuery.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Encodes a SearchCursor into a URL-safe opaque string.
 */
export function encodeCursor(cursor: SearchCursor): string {
  const json = JSON.stringify({
    o: cursor.offset,
    q: cursor.queryHash,
    v: cursor.version,
  });
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decodes a URL-safe opaque cursor string into a SearchCursor.
 * Returns null if the cursor format is invalid.
 */
export function decodeCursor(cursorStr: string): SearchCursor | null {
  try {
    let base64 = cursorStr.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
      base64 += '=';
    }
    const json = atob(base64);
    const parsed = JSON.parse(json);
    if (typeof parsed.o !== 'number' || typeof parsed.q !== 'string' || typeof parsed.v !== 'string') {
      return null;
    }
    return {
      offset: parsed.o,
      queryHash: parsed.q,
      version: parsed.v,
    };
  } catch {
    return null;
  }
}
