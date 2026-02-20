const GATEWAY = { gateway: { id: 'lens-gateway' } };

export async function analyzeImage(ai: Ai, imageStream: ReadableStream): Promise<{ caption: string; tags: string[] }> {
  const imageData = new Uint8Array(await new Response(imageStream).arrayBuffer());

  // Accept Llama license
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await ai.run('@cf/meta/llama-3.2-11b-vision-instruct' as any, { prompt: 'agree', max_tokens: 1 }, GATEWAY).catch(() => {});

  const response = (await ai.run(
    '@cf/meta/llama-3.2-11b-vision-instruct',
    {
      image: [...imageData],
      prompt:
        'Describe this photo in 2-3 sentences. Then list exactly 5 tags as comma-separated words. Format:\nDescription: <description>\nTags: <tag1>, <tag2>, <tag3>, <tag4>, <tag5>',
      max_tokens: 256,
    },
    GATEWAY,
  )) as { description?: string; response?: string };

  const text = response.response || response.description || '';

  // Parse structured output
  const descMatch = text.match(/Description:\s*(.+?)(?:\n|Tags:|$)/is);
  const tagsMatch = text.match(/Tags:\s*(.+)/i);

  const caption = descMatch?.[1]?.trim() || text.split('\n')[0].trim();
  const tags =
    tagsMatch?.[1]
      ?.split(',')
      .map((t: string) => t.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5) || [];

  return { caption, tags };
}

export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const response = (await ai.run('@cf/baai/bge-large-en-v1.5', { text: [text] }, GATEWAY)) as { data: number[][] };
  return response.data[0];
}
