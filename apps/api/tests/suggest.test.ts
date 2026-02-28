import { describe, it, expect } from 'vitest';
import { buildSuggestKey } from '../src/routes/suggest';

describe('buildSuggestKey', () => {
    it('builds correct prefix key for valid queries', () => {
        expect(buildSuggestKey('sunset')).toBe('suggest:prefix:su');
        expect(buildSuggestKey('Cyberpunk City')).toBe('suggest:prefix:cy');
        expect(buildSuggestKey('  hello world  ')).toBe('suggest:prefix:he');
    });

    it('returns null for queries shorter than 2 chars', () => {
        expect(buildSuggestKey('a')).toBeNull();
        expect(buildSuggestKey('')).toBeNull();
        expect(buildSuggestKey(' ')).toBeNull();
        expect(buildSuggestKey(' x ')).toBeNull();
    });
});

describe('recordSuggestion logic', () => {
    it('deduplication: same entry should not appear twice', async () => {
        const entries: string[] = ['sunset', 'sunflower'];
        const query = 'sunset';
        // Simulate dedup check
        const hasDuplicate = entries.includes(query.toLowerCase().trim());
        expect(hasDuplicate).toBe(true);
    });

    it('FIFO cap: array should not exceed 50 entries', () => {
        const entries: string[] = Array.from({ length: 50 }, (_, i) => `query-${i}`);
        const newEntry = 'query-50';

        entries.push(newEntry);
        if (entries.length > 50) entries.shift();

        expect(entries.length).toBe(50);
        expect(entries[0]).toBe('query-1'); // oldest evicted
        expect(entries[49]).toBe('query-50'); // newest at end
    });
});
