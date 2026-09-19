import { ImageResult } from '@lens/shared';
import { SearchFilters } from '../contracts';

/**
 * Pure filter policy to apply structured constraints to hydrated search results.
 */
export function filterResults(results: ImageResult[], filters: SearchFilters): ImageResult[] {
  return results.filter((item) => {
    // 1. Color filter (prefix or exact match, case-insensitive)
    if (filters.color) {
      if (!item.color || !item.color.toLowerCase().startsWith(filters.color.toLowerCase())) {
        return false;
      }
    }

    // 2. Orientation filter (landscape / portrait / square)
    if (filters.orientation) {
      const ar = item.height > 0 ? item.width / item.height : 1.0;
      let orientation: 'landscape' | 'portrait' | 'square' = 'square';
      if (ar > 1.05) orientation = 'landscape';
      else if (ar < 0.95) orientation = 'portrait';

      if (orientation !== filters.orientation) {
        return false;
      }
    }

    // 3. Tag filter
    if (filters.tag) {
      const targetTag = filters.tag.toLowerCase();
      const tags = (item.tags || []).map((t) => t.toLowerCase());
      if (!tags.includes(targetTag)) {
        return false;
      }
    }

    // 4. Author filter
    if (filters.authorName) {
      const author = (item.photographer || '').toLowerCase();
      if (!author.includes(filters.authorName.toLowerCase())) {
        return false;
      }
    }

    return true;
  });
}

/**
 * Pure diversity policy to prevent author clustering or extreme duplication.
 * Limits the number of consecutive items from the same author.
 */
export function applyDiversityPolicy(results: ImageResult[], maxConsecutivePerAuthor = 2): ImageResult[] {
  if (results.length <= 1) return results;

  const output: ImageResult[] = [];
  const deferred: ImageResult[] = [];

  let currentAuthor: string | null = null;
  let authorStreak = 0;

  for (const item of results) {
    const author = item.photographer || 'unknown';

    if (author !== 'unknown' && author === currentAuthor) {
      if (authorStreak >= maxConsecutivePerAuthor) {
        deferred.push(item);
        continue;
      }
      authorStreak++;
    } else {
      currentAuthor = author;
      authorStreak = 1;
    }

    output.push(item);
  }

  // Append deferred items to tail
  return [...output, ...deferred];
}
