import { describe, it, expect } from 'vitest';

// Extracted logic to test: filename validation regex
const isValidFilename = (f: string) => /^[a-zA-Z0-9_-]+\.jpg$/.test(f);

// Extracted logic to test: dynamic relevance threshold
const calcThreshold = (topScore: number) => Math.max(topScore * 0.9, 0.6);

describe('filename validation', () => {
  it('accepts valid filenames', () => {
    expect(isValidFilename('abc123.jpg')).toBe(true);
    expect(isValidFilename('QkeqB-iJcOc.jpg')).toBe(true);
    expect(isValidFilename('a_b-c.jpg')).toBe(true);
  });

  it('rejects invalid filenames', () => {
    expect(isValidFilename('../etc/passwd')).toBe(false);
    expect(isValidFilename('file.png')).toBe(false);
    expect(isValidFilename('')).toBe(false);
    expect(isValidFilename('a b.jpg')).toBe(false);
    expect(isValidFilename('.jpg')).toBe(false);
  });
});

describe('dynamic relevance threshold', () => {
  it('uses topScore * 0.9 when above floor', () => {
    expect(calcThreshold(0.8)).toBeCloseTo(0.72);
    expect(calcThreshold(0.75)).toBeCloseTo(0.675);
  });

  it('uses floor 0.6 when topScore is low', () => {
    expect(calcThreshold(0.5)).toBe(0.6);
    expect(calcThreshold(0.0)).toBe(0.6);
  });
});
