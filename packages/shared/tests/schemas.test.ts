import { describe, it, expect } from 'vitest';
import { VisionResponseSchema } from '../src/schemas';

describe('VisionResponseSchema', () => {
  it('parses valid AI response', () => {
    const input = {
      caption: 'A beautiful sunset over the ocean with golden light',
      quality: 8.5,
      entities: ['Golden Gate Bridge', 'Pacific Ocean'],
      tags: ['sunset', 'ocean', 'golden hour'],
    };
    const result = VisionResponseSchema.parse(input);
    expect(result.caption).toBe(input.caption);
    expect(result.quality).toBe(8.5);
    expect(result.entities).toHaveLength(2);
    expect(result.tags).toEqual(['sunset', 'ocean', 'golden hour']);
  });

  it('applies defaults for missing optional fields', () => {
    const input = { caption: 'A minimal caption here' };
    const result = VisionResponseSchema.parse(input);
    expect(result.quality).toBe(5);
    expect(result.entities).toEqual([]);
    expect(result.tags).toEqual([]);
  });

  it('rejects caption shorter than 10 chars', () => {
    expect(() => VisionResponseSchema.parse({ caption: 'Too short' })).toThrow();
  });

  it('rejects quality outside 0-10 range', () => {
    expect(() => VisionResponseSchema.parse({ caption: 'Valid caption here', quality: 11 })).toThrow();
    expect(() => VisionResponseSchema.parse({ caption: 'Valid caption here', quality: -1 })).toThrow();
  });

  it('validates tags are lowercase (rejects uppercase)', () => {
    const input = { caption: 'A valid caption text', tags: ['SUNSET', 'Ocean'] };
    expect(() => VisionResponseSchema.parse(input)).toThrow();
  });

  it('accepts lowercase tags', () => {
    const input = { caption: 'A valid caption text', tags: ['sunset', 'ocean', 'beach'] };
    const result = VisionResponseSchema.parse(input);
    expect(result.tags).toEqual(['sunset', 'ocean', 'beach']);
  });

  it('limits entities to 15 items', () => {
    const input = {
      caption: 'A valid caption text',
      entities: Array(20).fill('entity'),
    };
    expect(() => VisionResponseSchema.parse(input)).toThrow();
  });
});
