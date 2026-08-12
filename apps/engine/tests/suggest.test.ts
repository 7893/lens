import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSuggestKey, recordSuggestion } from '../src/routes/suggest';

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

describe('recordSuggestion', () => {
  let mockKv: {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockKv = {
      get: vi.fn(),
      put: vi.fn(),
    };
  });

  it('creates new entry for empty KV', async () => {
    mockKv.get.mockResolvedValue(null);

    await recordSuggestion(mockKv as unknown as KVNamespace, 'sunset beach');

    expect(mockKv.get).toHaveBeenCalledWith('suggest:prefix:su');
    expect(mockKv.put).toHaveBeenCalledWith('suggest:prefix:su', JSON.stringify(['sunset beach']), {
      expirationTtl: 2592000,
    });
  });

  it('appends to existing entries', async () => {
    mockKv.get.mockResolvedValue(JSON.stringify(['sunrise']));

    await recordSuggestion(mockKv as unknown as KVNamespace, 'sunset');

    expect(mockKv.put).toHaveBeenCalledWith('suggest:prefix:su', JSON.stringify(['sunrise', 'sunset']), {
      expirationTtl: 2592000,
    });
  });

  it('deduplicates: does not add existing entry', async () => {
    mockKv.get.mockResolvedValue(JSON.stringify(['sunset', 'sunflower']));

    await recordSuggestion(mockKv as unknown as KVNamespace, 'sunset');

    expect(mockKv.put).not.toHaveBeenCalled();
  });

  it('normalizes query to lowercase', async () => {
    mockKv.get.mockResolvedValue(null);

    await recordSuggestion(mockKv as unknown as KVNamespace, '  SUNSET Beach  ');

    expect(mockKv.put).toHaveBeenCalledWith('suggest:prefix:su', JSON.stringify(['sunset beach']), {
      expirationTtl: 2592000,
    });
  });

  it('skips queries shorter than 2 chars', async () => {
    await recordSuggestion(mockKv as unknown as KVNamespace, 'a');

    expect(mockKv.get).not.toHaveBeenCalled();
    expect(mockKv.put).not.toHaveBeenCalled();
  });

  it('enforces FIFO cap at 50 entries', async () => {
    const existingEntries = Array.from({ length: 50 }, (_, i) => `query-${i}`);
    mockKv.get.mockResolvedValue(JSON.stringify(existingEntries));

    await recordSuggestion(mockKv as unknown as KVNamespace, 'query-new');

    const expectedEntries = [...existingEntries.slice(1), 'query-new'];
    expect(mockKv.put).toHaveBeenCalledWith('suggest:prefix:qu', JSON.stringify(expectedEntries), {
      expirationTtl: 2592000,
    });
    expect(expectedEntries).toHaveLength(50);
  });
});
