export async function streamToR2(url: string, key: string, bucket: R2Bucket): Promise<void> {
  console.log(`⬇️ Downloading ${url} to R2://${key}...`);

  const response = await fetch(url);

  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${url}: ${response.status}`);
  }

  // Stream directly to R2
  await bucket.put(key, response.body, {
    httpMetadata: {
      contentType: response.headers.get('content-type') || 'image/jpeg',
    },
  });

  console.log(`✅ Saved to R2://${key}`);
}
