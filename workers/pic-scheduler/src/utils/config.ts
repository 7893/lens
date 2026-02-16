export const CONFIG = {
  RATE_LIMIT: {
    UNSPLASH_API_MAX: 50,
    UNSPLASH_API_WINDOW: 3600000,
    PUBLIC_API_MAX: 100,
    PUBLIC_API_WINDOW: 60000,
  },
  PAGINATION: {
    MAX_PAGE_SIZE: 100,
    DEFAULT_CATEGORIES_LIMIT: 20,
    DEFAULT_IMAGES_LIMIT: 18,
  },
  DOWNLOAD: {
    MAX_COUNT: 2000,
    PHOTOS_PER_PAGE: 30,
  },
  AI: {
    MAX_CATEGORY_LENGTH: 50,
    CATEGORY_REGEX: /^[a-z0-9-]+$/,
  },
  CACHE: {
    IMAGE_MAX_AGE: 31536000,
  },
  VALIDATION: {
    IMAGE_ID_REGEX: /^[a-zA-Z0-9_-]+$/,
    CATEGORY_REGEX: /^[a-z0-9-]+$/,
  },
  LOG_LEVEL: {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
  },
} as const;

export class Logger {
  private level: number;

  constructor(level: number = CONFIG.LOG_LEVEL.INFO) {
    this.level = level;
  }

  debug(...args: unknown[]): void {
    if (this.level <= CONFIG.LOG_LEVEL.DEBUG) console.log('[DEBUG]', ...args);
  }

  info(...args: unknown[]): void {
    if (this.level <= CONFIG.LOG_LEVEL.INFO) console.log('[INFO]', ...args);
  }

  warn(...args: unknown[]): void {
    if (this.level <= CONFIG.LOG_LEVEL.WARN) console.warn('[WARN]', ...args);
  }

  error(...args: unknown[]): void {
    if (this.level <= CONFIG.LOG_LEVEL.ERROR) console.error('[ERROR]', ...args);
  }
}

export function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export function safeErrorResponse(error: Error, requestId: string): Response {
  return Response.json({
    success: false,
    error: error.message,
    requestId,
  }, { status: 500 });
}

export function validatePagination(page: unknown, limit: unknown, maxLimit: number = CONFIG.PAGINATION.MAX_PAGE_SIZE): { page: number; limit: number } {
  const validPage = Math.max(1, parseInt(String(page)) || 1);
  const validLimit = Math.min(maxLimit, Math.max(1, parseInt(String(limit)) || maxLimit));
  return { page: validPage, limit: validLimit };
}

export function validateImageId(imageId: unknown): boolean {
  if (!imageId || typeof imageId !== 'string') return false;
  return CONFIG.VALIDATION.IMAGE_ID_REGEX.test(imageId);
}

export function validateCategory(category: unknown): boolean {
  if (!category || typeof category !== 'string') return false;
  return CONFIG.VALIDATION.CATEGORY_REGEX.test(category);
}
