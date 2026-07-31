import React, { useState } from 'react';
import { Card, CardBody, Chip } from '@heroui/react';
import { Camera, MapPin } from 'lucide-react';
import { ImageResult } from '@lens/shared';
import { blurHashToDataURL } from '../../utils/blurhash';

interface ImageCardProps {
  image: ImageResult;
  onClick: () => void;
}

export const ImageCard = React.memo(({ image, onClick }: ImageCardProps) => {
  const [loaded, setLoaded] = useState(false);
  const blurUrl = image.blurHash ? blurHashToDataURL(image.blurHash) : '';

  return (
    <Card
      isPressable
      onPress={onClick}
      className="break-inside-avoid w-full animate-fade-in-up border-none shadow-sm hover:shadow-md transition-shadow"
      radius="lg"
    >
      <CardBody className="p-0 overflow-hidden">
        {/* Image area */}
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

        {/* Info area */}
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
            <div className="mt-2.5 flex flex-wrap gap-1">
              {image.topics.slice(0, 3).map((t) => (
                <Chip
                  key={t}
                  size="sm"
                  variant="flat"
                  classNames={{
                    base: 'h-5 bg-gray-100',
                    content: 'text-[9px] text-gray-500 px-1.5',
                  }}
                >
                  {t}
                </Chip>
              ))}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
});

ImageCard.displayName = 'ImageCard';
