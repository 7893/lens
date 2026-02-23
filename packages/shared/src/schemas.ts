import { z } from 'zod';

/**
 * Llama 4 Vision Output Contract
 * Forces the AI's probabilistic output into a deterministic structure.
 */
export const VisionResponseSchema = z.object({
  caption: z.string().min(10).max(1000),
  quality: z.number().min(0).max(10).default(5),
  entities: z.array(z.string()).max(15).default([]),
  tags: z.array(z.string().lowercase()).max(15).default([]),
});

export type VisionResponse = z.infer<typeof VisionResponseSchema>;

/**
 * Distributed Trace Context
 */
export interface TraceContext {
  traceId: string;
  startTime: number;
}
