import { describe, it, expect, vi } from 'vitest';
import { AI_MODELS, Logger, createTrace } from '@lens/shared';
import { analyzeImage, encodeImageToDataUri, generateEmbedding } from '../src/platform/cloudflare/ai';

function toStream(bytes: Uint8Array): ReadableStream {
  return new Response(bytes).body as ReadableStream;
}

describe('Cloudflare Workers AI Vision & Embedding Adapter', () => {
  it('encodes JPEG, PNG, and large buffers into base64 data URIs without stack overflow', () => {
    const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
    expect(encodeImageToDataUri(jpegBytes)).toMatch(/^data:image\/jpeg;base64,/);

    const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(encodeImageToDataUri(pngBytes)).toMatch(/^data:image\/png;base64,/);

    // 100 KB payload exceeding single-chunk 32 KB boundary
    const largeBytes = new Uint8Array(100 * 1024);
    largeBytes[0] = 0xff;
    largeBytes[1] = 0xd8;
    const uri = encodeImageToDataUri(largeBytes);
    expect(uri.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(uri.length).toBeGreaterThan(130000);
  });

  it('sends multimodal messages with image_url data URI to Llama 4 Scout and parses string JSON response', async () => {
    const logger = new Logger(createTrace('AI_TEST'));
    const runMock = vi.fn().mockResolvedValue({
      response: JSON.stringify({
        caption: 'Golden alpine peak illuminated by early morning sunlight above a sea of clouds.',
        quality: 9.1,
        entities: ['Matterhorn'],
        tags: ['Mountain', 'Sunrise', 'Alps'],
      }),
      usage: { prompt_tokens: 420, completion_tokens: 68 },
    });
    const mockAi = { run: runMock } as unknown as Ai;

    const sampleBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const { result, telemetry } = await analyzeImage(mockAi, toStream(sampleBytes), logger, 'photo-001');

    expect(runMock).toHaveBeenCalledTimes(1);
    const [calledModel, calledInput] = runMock.mock.calls[0];
    expect(calledModel).toBe(AI_MODELS.TEXT);
    expect(calledInput).not.toHaveProperty('image');
    expect(calledInput).not.toHaveProperty('prompt');
    expect(calledInput.response_format).toEqual({ type: 'json_object' });
    expect(calledInput.messages).toHaveLength(1);
    expect(calledInput.messages[0].role).toBe('user');
    expect(calledInput.messages[0].content[0]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/jpeg;base64,/9j/2Q==' },
    });
    expect(calledInput.messages[0].content[1].type).toBe('text');

    expect(result.quality).toBe(9.1);
    expect(result.tags).toEqual(['mountain', 'sunrise', 'alps']);
    expect(telemetry.isDegraded).toBe(false);
    expect(telemetry.promptTokens).toBe(420);
    expect(telemetry.completionTokens).toBe(68);
  });

  it('accepts pre-parsed JSON object responses from Workers AI JSON mode', async () => {
    const logger = new Logger(createTrace('AI_TEST_OBJ'));
    const mockAi = {
      run: vi.fn().mockResolvedValue({
        response: {
          caption: 'Close-up portrait of a ginger tabby cat resting by a sunlit window.',
          quality: 8.7,
          entities: ['Felis catus'],
          tags: ['cat', 'portrait', 'sunlight'],
        },
        usage: { prompt_tokens: 310, completion_tokens: 45 },
      }),
    } as unknown as Ai;

    const { result, telemetry } = await analyzeImage(mockAi, toStream(new Uint8Array([1, 2, 3])), logger, 'photo-002');
    expect(result.tags).toEqual(['cat', 'portrait', 'sunlight']);
    expect(telemetry.isDegraded).toBe(false);
  });

  it('degrades gracefully when AI output violates VisionResponseSchema', async () => {
    const logger = new Logger(createTrace('AI_TEST_DEGRADE'));
    const mockAi = {
      run: vi.fn().mockResolvedValue({
        response: 'Unparseable plain text error message',
      }),
    } as unknown as Ai;

    const { result, telemetry } = await analyzeImage(mockAi, toStream(new Uint8Array([1, 2, 3])), logger, 'photo-003');
    expect(telemetry.isDegraded).toBe(true);
    expect(result.quality).toBe(5.0);
    expect(result.tags).toEqual([]);
    expect(result.caption).toBe('Unparseable plain text error message');
  });

  it('generates 1024-d embeddings via BGE-M3', async () => {
    const vector = Array.from({ length: 1024 }, (_, i) => i * 0.001);
    const runMock = vi.fn().mockResolvedValue({ data: [vector] });
    const mockAi = { run: runMock } as unknown as Ai;

    const out = await generateEmbedding(mockAi, 'snowy mountain peak');
    expect(runMock).toHaveBeenCalledWith(AI_MODELS.EMBED, { text: ['snowy mountain peak'] }, expect.any(Object));
    expect(out).toHaveLength(1024);
  });
});
