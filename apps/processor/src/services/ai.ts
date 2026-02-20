import { UnsplashPhoto } from '@lens/shared';

const GATEWAY = { gateway: { id: 'lens-gateway' } };

function buildVisionPrompt(meta?: UnsplashPhoto): string {
  const contextParts: string[] = [];
  if (meta?.alt_description) contextParts.push(`Alt: ${meta.alt_description}`);
  if (meta?.description) contextParts.push(`Desc: ${meta.description}`);
  if (meta?.location?.name) contextParts.push(`Location: ${meta.location.name}`);
  if (meta?.user?.name) contextParts.push(`Photographer: ${meta.user.name}`);
  if (meta?.exif?.make) contextParts.push(`Camera: ${meta.exif.make} ${meta.exif.model || ''}`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const topics = Object.keys((meta as any)?.topic_submissions || {});
  if (topics.length) contextParts.push(`Topics: ${topics.join(', ')}`);
  const contextStr = contextParts.length ? `\n\nMETADATA CONTEXT:\n${contextParts.join('\n')}` : '';

  return `Analyze this image for a high-precision semantic search engine.${contextStr}

TASK:
1. DETAILED CAPTION: Write 2-3 concise sentences. Identify the core subject, specific landmarks/brands (if visible), lighting quality (e.g. golden hour, neon, flat), and the overall mood. If significant text is present, transcribe it. Use the metadata context to enhance accuracy.
2. SEARCH TAGS: List up to 8 specific, non-redundant tags. Focus on entities, materials, and artistic styles.

CONSTRAINTS:
- Use factual, descriptive language.
- No buzzwords (e.g., "stunning", "beautiful").
- Tags must be lowercase only.

OUTPUT FORMAT (Strict):
CAPTION: [Your description here]
TAGS: [tag1, tag2, tag3, ...]`;
}

export async function analyzeImage(ai: Ai, imageStream: ReadableStream, meta?: UnsplashPhoto): Promise<{ caption: string; tags: string[] }> {
  const imageData = new Uint8Array(await new Response(imageStream).arrayBuffer());

  const response = (await ai.run(
    '@cf/meta/llama-3.2-11b-vision-instruct',
    {
      image: [...imageData],
      prompt: buildVisionPrompt(meta),
      max_tokens: 300,
    },
    GATEWAY,
  )) as { description?: string; response?: string };

  const text = response.response || response.description || '';

  // Robust parsing with fallback (handles **CAPTION:** variants)
  const captionMatch = text.match(/^\*?\*?CAPTION\*?\*?:\s*(.+?)(?:\n|TAGS|$)/ims);
  const tagsMatch = text.match(/^\*?\*?TAGS\*?\*?:\s*(.+)/im);

  const caption = captionMatch?.[1]?.trim().replace(/^\*+\s*/, '') || text.split('\n')[0].trim();
  const tags =
    tagsMatch?.[1]
      ?.split(',')
      .map((t: string) => t.trim().toLowerCase().replace(/[\[\]\*]/g, '').trim())
      .filter((t: string) => t && t.length > 1)
      .slice(0, 8) || [];

  return { caption, tags };
}

export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const response = (await ai.run('@cf/google/embeddinggemma-300m', { text: [text] }, GATEWAY)) as { data: number[][] };
  return response.data[0];
}
