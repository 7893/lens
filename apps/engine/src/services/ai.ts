import { AI_MODELS, AI_GATEWAY, VisionResponse, VisionResponseSchema } from '@lens/shared';
import { Logger } from '@lens/shared';

export async function analyzeImage(
  ai: Ai,
  imageStream: ReadableStream,
  logger: Logger,
  photoId: string,
): Promise<{ result: VisionResponse; telemetry: { promptTokens: number; completionTokens: number; parseRetries: number; isDegraded: boolean; model: string } }> {
  const imageData = new Uint8Array(await new Response(imageStream).arrayBuffer());
  const model = AI_MODELS.TEXT;

  const response = (await ai.run(
    // @ts-expect-error - model not yet in workers-types
    model, // Llama 4 Scout
    {
      image: [...imageData],
      prompt: `Act as a world-class gallery curator and senior photographer. 
Analyze this image for deep-index retrieval.

TASKS:
1. CAPTION: Write a 2-3 sentence narrative. Focus on the core subject, emotional resonance, specific photographic style, and light/shadow.
2. QUALITY: Rate the image quality/aesthetics from 0.0 to 10.0.
3. ENTITIES: Identify specific landmarks, notable brands, biological species, or unique objects.
4. TAGS: Provide up to 8 precise, descriptive lowercase tags.

OUTPUT FORMAT (JSON STRICT):
{
  "caption": "...",
  "quality": 8.5,
  "entities": ["item1", "item2"],
  "tags": ["tag1", "tag2"]
}`,
    },
    AI_GATEWAY,
  )) as { response?: string; usage?: { prompt_tokens?: number; completion_tokens?: number } };

  const text = response.response || '';
  logger.info('AI Raw Response received', { length: text.length });

  let parseRetries = 0;
  let isDegraded = false;
  let result: VisionResponse;

  try {
    // Attempt to extract JSON from the response (in case AI adds prose around it)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    let jsonStr = jsonMatch ? jsonMatch[0] : text;

    if (jsonStr.match(/,\s*([\]}])/)) {
      parseRetries += 1;
    }
    // Sanitize trailing commas (common AI hallucination) before parsing
    jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');

    const rawData = JSON.parse(jsonStr);

    // GOD-LEVEL VALIDATION: Zod forces the contract
    result = VisionResponseSchema.parse(rawData);
  } catch (error) {
    logger.error('Contract Violation: AI output failed schema validation', error);
    isDegraded = true;

    // Graceful Degradation: Fallback to basic data if parsing fails
    result = {
      caption: text.substring(0, 200) || 'Image analysis failed',
      quality: 5.0,
      entities: [],
      tags: [],
    };
  }

  return {
    result,
    telemetry: {
      promptTokens: response.usage?.prompt_tokens || 0,
      completionTokens: response.usage?.completion_tokens || 0,
      parseRetries,
      isDegraded,
      model,
    }
  };
}

export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const response = (await ai.run(AI_MODELS.EMBED, { text: [text] }, AI_GATEWAY)) as { data: number[][] };
  return response.data[0];
}
