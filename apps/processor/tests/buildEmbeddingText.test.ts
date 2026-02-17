import { describe, it, expect } from 'vitest';
import { buildEmbeddingText } from '../src/utils/embedding';

describe('buildEmbeddingText', () => {
  it('returns caption only when no tags or meta', () => {
    expect(buildEmbeddingText('A sunset', [])).toBe('A sunset');
  });

  it('includes tags', () => {
    expect(buildEmbeddingText('A cat', ['cute', 'animal'])).toBe('A cat | Tags: cute, animal');
  });

  it('includes all meta fields', () => {
    const meta = {
      alt_description: 'alt desc',
      description: 'full desc',
      user: { name: 'John' },
      location: { name: 'Tokyo' },
      topic_submissions: { nature: {}, travel: {} },
    };
    const result = buildEmbeddingText('caption', ['tag1'], meta);
    expect(result).toContain('caption');
    expect(result).toContain('Tags: tag1');
    expect(result).toContain('alt desc');
    expect(result).toContain('full desc');
    expect(result).toContain('Photographer: John');
    expect(result).toContain('Location: Tokyo');
    expect(result).toContain('Topics: nature, travel');
  });

  it('skips missing meta fields', () => {
    const result = buildEmbeddingText('caption', [], { user: { name: 'Jane' } });
    expect(result).toBe('caption | Photographer: Jane');
    expect(result).not.toContain('Location');
    expect(result).not.toContain('Topics');
  });
});
