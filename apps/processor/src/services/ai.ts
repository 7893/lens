import { AI_MODELS, AI_GATEWAY } from '@lens/shared';

export async function analyzeImage(
  ai: Ai,
  imageStream: ReadableStream,
): Promise<{ caption: string; tags: string[]; quality: number; entities: string[] }> {
  const imageData = new Uint8Array(await new Response(imageStream).arrayBuffer());

  const response = (await ai.run(
    AI_MODELS.TEXT,
    {
      image: [...imageData],
      prompt: `Act as a world-class gallery curator and senior photographer. 
Analyze this image for deep-index retrieval.

TASKS:
1. CAPTION: Write a 2-3 sentence narrative. Focus on the core subject, emotional resonance, specific photographic style (e.g. macro, silhouette, brutalism), and the interaction of light/shadow.
2. QUALITY SCORE: Rate the image quality/aesthetics from 0.0 to 10.0 based on composition and clarity.
3. ENTITIES: Identify any specific landmarks, notable brands, biological species, or unique objects.
4. TAGS: Provide up to 8 precise, descriptive lowercase tags.

OUTPUT FORMAT (Must strictly follow):
CAPTION: [Text]
QUALITY: [Float, e.g. 8.5]
ENTITIES: [item1, item2, ...]
TAGS: [tag1, tag2, ...]`,
      max_tokens: 512,
    },
    AI_GATEWAY,
  )) as { response?: string };

  const text = response.response || '';

  const captionMatch = text.match(/^\*?\*?CAPTION\*?\*?:\s*(.+)/im);
  const qualityMatch = text.match(/^\*?\*?QUALITY\*?\*?:\s*([0-9.]+)/im);
  const entitiesMatch = text.match(/^\*?\*?ENTITIES\*?\*?:\s*\[?(.*?)\]?$/im);
  const tagsMatch = text.match(/^\*?\*?TAGS\*?\*?:\s*\[?(.*?)\]?$/im);

  const caption = captionMatch?.[1]?.trim() || text.split('\n')[0].substring(0, 500);
  const quality = parseFloat(qualityMatch?.[1] || '5.0');
  const entities =
    entitiesMatch?.[1]
      ?.split(',')
      .map((e) => e.replace(/[[\]"']/g, '').trim())
      .filter(Boolean) || [];
  const tags =
    tagsMatch?.[1]
      ?.split(',')
      .map((t) => t.replace(/[[\]"']/g, '').trim().toLowerCase())
      .filter(Boolean) || [];

  return { caption, tags, quality, entities };
}

export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const response = (await ai.run(AI_MODELS.EMBED, { text: [text] }, AI_GATEWAY)) as { data: number[][] };
  return response.data[0];
}
