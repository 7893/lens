export class ExtractExifTask {
  async run(_env: Env, { imageBuffer: _imageBuffer }: { imageBuffer: ArrayBuffer }): Promise<{ hasExif: boolean; message: string }> {
    return {
      hasExif: false,
      message: 'EXIF data from Unsplash API'
    };
  }
}
