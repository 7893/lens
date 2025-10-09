import exifr from 'exifr';

export class ExifParser {
  async parse(imageBuffer) {
    try {
      const exif = await exifr.parse(imageBuffer, {
        pick: [
          'Make', 'Model', 'ExposureTime', 'FNumber', 
          'FocalLength', 'ISO', 'DateTimeOriginal',
          'GPSLatitude', 'GPSLongitude'
        ]
      });

      if (!exif) {
        return { hasExif: false };
      }

      return {
        hasExif: true,
        camera_make: exif.Make || null,
        camera_model: exif.Model || null,
        exposure_time: exif.ExposureTime ? `1/${Math.round(1/exif.ExposureTime)}` : null,
        f_number: exif.FNumber || null,
        focal_length: exif.FocalLength || null,
        iso: exif.ISO || null,
        taken_at: exif.DateTimeOriginal ? exif.DateTimeOriginal.toISOString() : null,
        gps_latitude: exif.GPSLatitude || null,
        gps_longitude: exif.GPSLongitude || null,
        exif_all_data: JSON.stringify(exif)
      };
    } catch (error) {
      console.error('EXIF parsing failed:', error.message);
      return { hasExif: false };
    }
  }
}
