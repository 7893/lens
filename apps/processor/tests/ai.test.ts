import { describe, it, expect } from 'vitest';

// Extract and test the JSON parsing + fallback logic from ai.ts
function parseAIResponse(text: string) {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonStr = jsonMatch ? jsonMatch[0] : text;
  return JSON.parse(jsonStr);
}

function gracefulFallback(text: string) {
  return {
    caption: text.substring(0, 200) || 'Image analysis failed',
    quality: 5.0,
    entities: [],
    tags: [],
  };
}

describe('AI response parsing', () => {
  it('extracts JSON from clean response', () => {
    const input = '{"caption": "A sunset", "quality": 8}';
    const result = parseAIResponse(input);
    expect(result.caption).toBe('A sunset');
    expect(result.quality).toBe(8);
  });

  it('extracts JSON wrapped in prose', () => {
    const input = `Here is my analysis:
{"caption": "Beautiful mountain", "quality": 9, "tags": ["nature"]}
I hope this helps!`;
    const result = parseAIResponse(input);
    expect(result.caption).toBe('Beautiful mountain');
    expect(result.tags).toContain('nature');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseAIResponse('not json at all')).toThrow();
    expect(() => parseAIResponse('{broken')).toThrow();
  });
});

describe('graceful fallback', () => {
  it('returns default structure with truncated text', () => {
    const longText = 'A'.repeat(300);
    const result = gracefulFallback(longText);
    expect(result.caption).toHaveLength(200);
    expect(result.quality).toBe(5.0);
    expect(result.entities).toEqual([]);
    expect(result.tags).toEqual([]);
  });

  it('handles empty text', () => {
    const result = gracefulFallback('');
    expect(result.caption).toBe('Image analysis failed');
  });
});
