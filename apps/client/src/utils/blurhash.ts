import { decode } from 'blurhash';

const blurCache = new Map<string, string>();

/**
 * Converts a BlurHash string into a Base64-encoded Data URL.
 * Includes an internal cache to prevent redundant decoding.
 */
export function blurHashToDataURL(hash: string, w = 32, h = 32): string {
  if (!hash) return '';
  if (blurCache.has(hash)) return blurCache.get(hash)!;

  try {
    const pixels = decode(hash, w, h);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    const imageData = ctx.createImageData(w, h);
    imageData.data.set(pixels);
    ctx.putImageData(imageData, 0, 0);
    const url = canvas.toDataURL();
    blurCache.set(hash, url);
    return url;
  } catch (error) {
    console.warn('BlurHash decode failed', error);
    return '';
  }
}
