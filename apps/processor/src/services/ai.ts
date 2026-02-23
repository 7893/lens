import { AI_MODELS, AI_GATEWAY, VisionResponse, VisionResponseSchema } from '@lens/shared';
import { Logger } from '@lens/shared';

export async function analyzeImage(ai: Ai, imageStream: ReadableStream, logger: Logger): Promise<VisionResponse> {
  const imageData = new Uint8Array(await new Response(imageStream).arrayBuffer());

  const response = (await ai.run(
    AI_MODELS.TEXT, // Llama 4 Scout
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
  )) as { response?: string };

  const text = response.response || '';
  logger.info('AI Raw Response received', { length: text.length });

  try {
    // Attempt to extract JSON from the response (in case AI adds prose around it)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : text;
    const rawData = JSON.parse(jsonStr);

    // GOD-LEVEL VALIDATION: Zod forces the contract
    const validated = VisionResponseSchema.parse(rawData);
    return validated;
  } catch (error) {
    logger.error('Contract Violation: AI output failed schema validation', error);

    // Graceful Degradation: Fallback to basic data if parsing fails
    return {
      caption: text.substring(0, 200) || 'Image analysis failed',
      quality: 5.0,
      entities: [],
      tags: [],
    };
  }
}

export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const response = (await ai.run(AI_MODELS.EMBED, { text: [text] }, AI_GATEWAY)) as { data: number[][] };
  return response.data[0];
}
