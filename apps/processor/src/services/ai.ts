const GATEWAY_URL = 'https://gateway.ai.cloudflare.com/v1/ed3e4f0448b71302675f2b436e5e8dd3/lens-gateway/workers-ai';

async function runViaGateway(model: string, apiToken: string, payload: any) {
  const url = `${GATEWAY_URL}/${model}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`AI Gateway error (${response.status}): ${err}`);
  }

  const result = (await response.json()) as any;
  return result.result;
}

export async function analyzeImage(
  ai: Ai,
  imageStream: ReadableStream,
  apiToken: string,
): Promise<{ caption: string; tags: string[] }> {
  const imageData = new Uint8Array(await new Response(imageStream).arrayBuffer());

  const result = await runViaGateway('@cf/meta/llama-3.2-11b-vision-instruct', apiToken, {
    image: [...imageData],
    prompt:
      'Describe this photo in 2-3 sentences. Then list exactly 5 tags as comma-separated words. Format:\nDescription: <description>\nTags: <tag1>, <tag2>, <tag3>, <tag4>, <tag5>',
    max_tokens: 256,
  });

  const text = result.response || result.description || '';

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

export async function generateEmbedding(ai: Ai, text: string, apiToken: string): Promise<number[]> {
  const result = await runViaGateway('@cf/baai/bge-large-en-v1.5', apiToken, {
    text: [text],
  });

  return result.data[0];
}
