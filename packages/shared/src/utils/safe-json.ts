/**
 * Safely parses a JSON string, returning a fallback value if parsing fails.
 * Protects edge runtime from unhandled SyntaxError exceptions.
 */
export function safeJsonParse<T>(input: string | null | undefined, fallback: T): T {
  if (!input || typeof input !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}
