import { Logger } from '@lens/shared';
import { ValidationError, ExternalServiceError } from '../../kernel';

export const MAX_MEDIA_BYTES = 40 * 1024 * 1024; // 40MB limit

export interface StoredMasterMedia {
  contentHash: string;
  masterKey: string;
  byteSize: number;
  mimeType: string;
  isNewUpload: boolean;
}

/**
 * Standard Web Crypto SHA-256 hex digest.
 */
export async function computeSha256Hex(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Legacy direct streaming (kept for backwards compatibility).
 */
export async function streamToR2(url: string, key: string, bucket: R2Bucket, logger: Logger): Promise<void> {
  logger.info(`Downloading to R2://${key}`);

  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  await bucket.put(key, response.body, {
    httpMetadata: {
      contentType: response.headers.get('content-type') || 'image/jpeg',
    },
  });

  logger.info(`Saved to R2://${key}`);
}

/**
 * ADR-0006 Canonical Master Streaming Writer.
 * - Streams chunks to R2 staging while enforcing size ceiling to prevent OOM.
 * - Computes native Web Crypto SHA-256 from the staged object.
 * - Promotes to content-addressed media/{contentHash}/master.{ext} with deduplication.
 * - Purges temporary staging object.
 */
export async function streamMasterToR2(
  downloadUrl: string,
  bucket: R2Bucket,
  logger: Logger,
  extension: string = 'jpg',
): Promise<StoredMasterMedia> {
  logger.info(`Initiating streaming download for master media from ${downloadUrl.slice(0, 80)}...`);

  const response = await fetch(downloadUrl);
  if (!response.ok || !response.body) {
    throw new ExternalServiceError('MediaDownloader', `HTTP ${response.status}: ${response.statusText}`);
  }

  const mimeType = response.headers.get('content-type') || 'image/jpeg';
  const tempKey = `staging/raw-${crypto.randomUUID()}.${extension}`;
  let byteSize = 0;

  const sizeGuardStream = new TransformStream({
    transform(chunk: Uint8Array, controller) {
      byteSize += chunk.byteLength;
      if (byteSize > MAX_MEDIA_BYTES) {
        throw new ValidationError(
          `Media size exceeded maximum limit of ${MAX_MEDIA_BYTES} bytes (received > ${byteSize} bytes)`,
        );
      }
      controller.enqueue(chunk);
    },
  });

  try {
    await bucket.put(tempKey, response.body.pipeThrough(sizeGuardStream), {
      httpMetadata: { contentType: mimeType },
    });

    const stagedObject = await bucket.get(tempKey);
    if (!stagedObject) {
      throw new ExternalServiceError('Storage', `Failed to read staged object at ${tempKey}`);
    }

    const stagedBuffer = await stagedObject.arrayBuffer();
    const contentHash = await computeSha256Hex(stagedBuffer);
    const masterKey = `media/${contentHash}/master.${extension}`;

    // Check if identical content already exists (content-addressed deduplication)
    const existing = await bucket.head(masterKey);
    let isNewUpload = false;

    if (!existing) {
      await bucket.put(masterKey, stagedBuffer, {
        httpMetadata: { contentType: mimeType },
        customMetadata: {
          contentHash,
          uploadedAt: new Date().toISOString(),
        },
      });
      isNewUpload = true;
      logger.info(`Promoted new canonical master to R2://${masterKey} (${byteSize} bytes)`);
    } else {
      logger.info(`Identical master already archived at R2://${masterKey}, deduplicating.`);
    }

    return {
      contentHash,
      masterKey,
      byteSize,
      mimeType,
      isNewUpload,
    };
  } finally {
    // Clean up temporary staging file
    try {
      await bucket.delete(tempKey);
    } catch (err) {
      logger.warn(`Failed to clean up staging key R2://${tempKey}`, err);
    }
  }
}
