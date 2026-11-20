import { AI_MODELS, AI_GATEWAY, AI_GATEWAY_PREPAID, VisionResponse, VisionResponseSchema, Logger } from '@lens/shared';
import { tracing } from 'cloudflare:workers';

const VISION_AGENT_NAME = 'lens-vision-agent';
const VISION_AGENT_ID = 'lens-vision-agent-prod';

export function isFreeQuotaExhaustedError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /\b4006\b/.test(msg) || /daily free allocation|10,000 neurons/i.test(msg);
}

/**
 * Runs Workers AI via the primary free-allocation gateway first.
 * If Cloudflare returns Error 4006 (daily 10,000 free neurons exhausted),
 * seamlessly falls back to the Unified Billing prepaid gateway.
 */
export async function runAiWithQuotaFallback<T = unknown>(
  ai: Ai,
  model: keyof AiModels,
  input: unknown,
  logger?: Logger,
): Promise<{ result: T; gateway: 'free' | 'prepaid' }> {
  try {
    const result = (await ai.run(model, input as never, AI_GATEWAY)) as unknown as T;
    return { result, gateway: 'free' };
  } catch (error) {
    if (!isFreeQuotaExhaustedError(error)) {
      throw error;
    }
    logger?.warn('Free Workers AI daily quota exhausted (4006); falling back to prepaid Unified Billing gateway', {
      model,
    });
    const result = (await ai.run(model, input as never, AI_GATEWAY_PREPAID)) as unknown as T;
    return { result, gateway: 'prepaid' };
  }
}

const VISION_PROMPT = `Act as a world-class gallery curator and senior photographer.
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
}`;

interface LlamaVisionRawResponse {
  response?: string | Record<string, unknown>;
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

function detectImageMimeType(bytes: Uint8Array): string {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp';
  }
  return 'image/jpeg';
}

export function encodeImageToDataUri(bytes: Uint8Array): string {
  const mimeType = detectImageMimeType(bytes);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    let segment = '';
    for (let j = 0; j < slice.length; j++) {
      segment += String.fromCharCode(slice[j]);
    }
    chunks.push(segment);
  }
  return `data:${mimeType};base64,${btoa(chunks.join(''))}`;
}

function extractRawVisionPayload(res: LlamaVisionRawResponse): {
  text: string;
  parsedObject?: Record<string, unknown>;
} {
  if (res.response && typeof res.response === 'object') {
    return {
      text: JSON.stringify(res.response),
      parsedObject: res.response,
    };
  }
  if (typeof res.response === 'string') {
    return { text: res.response };
  }
  const choiceContent = res.choices?.[0]?.message?.content;
  if (typeof choiceContent === 'string') {
    return { text: choiceContent };
  }
  return { text: '' };
}

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
    const imageDataUri = encodeImageToDataUri(imageData);
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

      const { result: res } = await runAiWithQuotaFallback<LlamaVisionRawResponse>(
        ai,
        model,
        {
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: { url: imageDataUri },
                },
                {
                  type: 'text',
                  text: VISION_PROMPT,
                },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: 512,
        },
        logger,
      );

      const preview = typeof res.response === 'string' ? res.response : JSON.stringify(res.response ?? '');
      chatSpan.setAttribute('gen_ai.output.messages', JSON.stringify([{ role: 'assistant', content: preview }]));
      if (res.usage?.prompt_tokens) chatSpan.setAttribute('gen_ai.usage.input_tokens', res.usage.prompt_tokens);
      if (res.usage?.completion_tokens)
        chatSpan.setAttribute('gen_ai.usage.output_tokens', res.usage.completion_tokens);

      return res;
    });

    const { text, parsedObject } = extractRawVisionPayload(response);
    logger.info('AI Raw Response received', { length: text.length });

    let parseRetries = 0;
    let isDegraded = false;
    let result: VisionResponse;

    try {
      let rawData: unknown = parsedObject;
      if (!rawData) {
        // Attempt to extract JSON from the response (in case AI adds prose around it)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        let jsonStr = jsonMatch ? jsonMatch[0] : text;

        if (jsonStr.match(/,\s*([\]}])/)) {
          parseRetries += 1;
        }
        // Sanitize trailing commas (common AI hallucination) before parsing
        jsonStr = jsonStr.replace(/,\s*([\]}])/g, '$1');

        rawData = JSON.parse(jsonStr);
      }

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

export async function generateEmbedding(ai: Ai, text: string, logger?: Logger): Promise<number[]> {
  const response = await tracing.enterSpan('chat', async (chatSpan) => {
    chatSpan.setAttribute('gen_ai.operation.name', 'chat');
    chatSpan.setAttribute('gen_ai.agent.name', VISION_AGENT_NAME);
    chatSpan.setAttribute('gen_ai.agent.id', VISION_AGENT_ID);
    chatSpan.setAttribute('gen_ai.request.model', AI_MODELS.EMBED);
    chatSpan.setAttribute('gen_ai.system', 'cloudflare-workers-ai');
    chatSpan.setAttribute('gen_ai.input.messages', JSON.stringify({ text: [text] }));

    const { result: res } = await runAiWithQuotaFallback<{ data: number[][] }>(
      ai,
      AI_MODELS.EMBED,
      { text: [text] },
      logger,
    );
    chatSpan.setAttribute('gen_ai.output.messages', JSON.stringify({ dimensions: res.data?.[0]?.length || 0 }));
    return res;
  });
  return response.data[0];
}
