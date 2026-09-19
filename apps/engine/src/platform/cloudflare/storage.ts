import { Logger } from '@lens/shared';

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
