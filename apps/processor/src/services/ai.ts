export async function analyzeImage(ai: Ai, imageStream: ReadableStream): Promise<{ caption: string; tags: string[] }> {
  // Need to convert stream to array buffer for current AI bindings
  // Note: This limits us to Worker memory limits. For huge files, we might need a workaround,
  // but for analysis, we can use the 'display' (smaller) version of the image!
  const inputs = {
    image: [...new Uint8Array(await new Response(imageStream).arrayBuffer())],
    prompt: "Describe this image in detail and list 5 key tags.",
    max_tokens: 256,
  };

  const response = await ai.run('@cf/llava-hf/llava-1.5-7b-hf', inputs) as { description: string };
  
  // Simple parsing (LLaVA output is free text)
  // In a real app, we might want structured output or use regex
  const text = response.description || "";
  
  return {
    caption: text,
    tags: [] // LLaVA extraction needs more prompt engineering, keeping simple for now
  };
}

export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const response = await ai.run('@cf/baai/bge-base-en-v1.5', {
    text: [text]
  }) as { data: number[][] };

  return response.data[0];
}
