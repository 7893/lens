import { AI_MODELS, AI_GATEWAY, VisionResponse, VisionResponseSchema } from '@lens/shared';
import { Logger } from '@lens/shared';
import { tracing } from 'cloudflare:workers';

const VISION_AGENT_NAME = 'lens-vision-agent';
const VISION_AGENT_ID = 'lens-vision-agent-prod';

export async function analyzeImage(
  ai: Ai,
  imageStream: ReadableStream,
  logger: Logger,
  photoId: string,
): Promise<{
  result: VisionResponse;
  telemetry: {
    promptTokens: number;
    completionTokens: number;
    parseRetries: number;
    isDegraded: boolean;
    model: string;
  };
}> {
  return tracing.enterSpan('invoke_agent', async (agentSpan) => {
    agentSpan.setAttribute('gen_ai.operation.name', 'invoke_agent');
    agentSpan.setAttribute('gen_ai.agent.name', VISION_AGENT_NAME);
    agentSpan.setAttribute('gen_ai.agent.id', VISION_AGENT_ID);
    agentSpan.setAttribute('gen_ai.conversation.id', photoId);
    agentSpan.setAttribute(
      'gen_ai.input.messages',
      JSON.stringify([{ role: 'user', content: `Analyze photo ${photoId}` }]),
    );

    const imageData = new Uint8Array(await new Response(imageStream).arrayBuffer());
    const model = AI_MODELS.TEXT;

    const response = await tracing.enterSpan('chat', async (chatSpan) => {
      chatSpan.setAttribute('gen_ai.operation.name', 'chat');
      chatSpan.setAttribute('gen_ai.agent.name', VISION_AGENT_NAME);
      chatSpan.setAttribute('gen_ai.agent.id', VISION_AGENT_ID);
      chatSpan.setAttribute('gen_ai.conversation.id', photoId);
      chatSpan.setAttribute('gen_ai.request.model', model);
      chatSpan.setAttribute('gen_ai.system', 'cloudflare-workers-ai');
      chatSpan.setAttribute(
        'gen_ai.input.messages',
        JSON.stringify([{ role: 'user', content: 'Analyze this image for deep-index retrieval.' }]),
      );

      const res = (await ai.run(
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

      chatSpan.setAttribute(
        'gen_ai.output.messages',
        JSON.stringify([{ role: 'assistant', content: res.response || '' }]),
      );
      if (res.usage?.prompt_tokens) chatSpan.setAttribute('gen_ai.usage.input_tokens', res.usage.prompt_tokens);
      if (res.usage?.completion_tokens)
        chatSpan.setAttribute('gen_ai.usage.output_tokens', res.usage.completion_tokens);

      return res;
    });

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

    agentSpan.setAttribute(
      'gen_ai.output.messages',
      JSON.stringify([{ role: 'assistant', content: JSON.stringify(result) }]),
    );

    return {
      result,
      telemetry: {
        promptTokens: response.usage?.prompt_tokens || 0,
        completionTokens: response.usage?.completion_tokens || 0,
        parseRetries,
        isDegraded,
        model,
      },
    };
  });
}

export async function generateEmbedding(ai: Ai, text: string): Promise<number[]> {
  const response = await tracing.enterSpan('chat', async (chatSpan) => {
    chatSpan.setAttribute('gen_ai.operation.name', 'chat');
    chatSpan.setAttribute('gen_ai.agent.name', VISION_AGENT_NAME);
    chatSpan.setAttribute('gen_ai.agent.id', VISION_AGENT_ID);
    chatSpan.setAttribute('gen_ai.request.model', AI_MODELS.EMBED);
    chatSpan.setAttribute('gen_ai.system', 'cloudflare-workers-ai');
    chatSpan.setAttribute('gen_ai.input.messages', JSON.stringify({ text: [text] }));

    const res = (await ai.run(AI_MODELS.EMBED, { text: [text] }, AI_GATEWAY)) as { data: number[][] };
    chatSpan.setAttribute('gen_ai.output.messages', JSON.stringify({ dimensions: res.data?.[0]?.length || 0 }));
    return res;
  });
  return response.data[0];
}
