import React, { useState } from 'react';
import { Camera, MapPin } from 'lucide-react';
import { ImageResult } from '@lens/shared';
import { blurHashToDataURL } from '../../utils/blurhash';

interface ImageCardProps {
  image: ImageResult;
  onClick: () => void;
}

/**
 * Image card with blur placeholder and smooth fade-in.
 * Memoized to prevent re-renders unless the image data changes.
 */
export const ImageCard = React.memo(({ image, onClick }: ImageCardProps) => {
  const [loaded, setLoaded] = useState(false);
  const blurUrl = image.blurHash ? blurHashToDataURL(image.blurHash) : '';

  return (
    <div
      className="break-inside-avoid bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow group cursor-pointer"
      onClick={onClick}
    >
      <div className="relative" style={{ backgroundColor: image.color || '#e5e7eb' }}>
        {blurUrl && !loaded && (
          <img
            src={blurUrl}
            alt=""
            className="w-full h-auto object-cover blur-sm scale-110"
            style={{ aspectRatio: `${image.width}/${image.height}` }}
          />
        )}
        <img
          src={image.url}
          alt={image.caption || 'Lens Image'}
          className={`w-full h-auto object-cover transition-opacity duration-700 ease-in-out ${
            loaded ? 'opacity-100' : 'opacity-0'
          } ${blurUrl && !loaded ? 'absolute inset-0' : ''}`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
      </div>

      <div className="p-3">
        <p className="text-sm text-gray-700 line-clamp-2 leading-snug">
          {image.description || image.caption}
        </p>
        
        <div className="mt-2 space-y-1">
          {image.photographer && (
            <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
              <Camera className="w-3 h-3" /> {image.photographer}
            </p>
          )}
          {image.location && (
            <p className="text-[11px] text-gray-400 flex items-center gap-1.5">
              <MapPin className="w-3 h-3" /> {image.location}
            </p>
          )}
        </div>

        {image.topics && image.topics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {image.topics.slice(0, 3).map((t) => (
              <span key={t} className="text-[9px] px-1.5 py-0.5 bg-gray-50 text-gray-500 rounded-md">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

ImageCard.displayName = 'ImageCard';
