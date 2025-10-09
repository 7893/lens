export class ExtractExifTask {
  async run(env, { imageBuffer }) {
    // Note: exifr library is not available in Workers
    // Unsplash API already provides EXIF data, so we skip local parsing
    // This task is a placeholder for future enhancement
    return {
      hasExif: false,
      message: 'EXIF data from Unsplash API'
    };
  }
}
