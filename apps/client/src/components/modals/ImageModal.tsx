import {
  Modal, ModalContent, ModalBody,
  Button, Chip, Divider,
} from '@heroui/react';
import { Eye, Download, Heart, Sparkles, Aperture, Clock, ExternalLink, LucideIcon } from 'lucide-react';
import { ImageResult, ImageDetail } from '@lens/shared';
import { useEffect } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const Stat = ({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string | number | null }) => {
  if (!value) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500 py-1">
      <Icon className="w-3.5 h-3.5 text-gray-400" />
      <span className="text-gray-400">{label}</span>
      <span className="ml-auto font-medium text-gray-600">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
    </div>
  );
};

export function ImageModal({ image, score, onClose }: { image: ImageResult; score?: number; onClose: () => void }) {
  const { data: detail } = useSWR<ImageDetail>(`/api/images/${image.id}`, fetcher);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  return (
    <Modal
      isOpen
      onClose={onClose}
      size="5xl"
      scrollBehavior="inside"
      classNames={{
        backdrop: 'bg-black/85 backdrop-blur-sm',
        base: 'max-h-[92vh]',
        wrapper: 'items-center',
        closeButton: 'z-10 top-3 right-3 bg-black/40 hover:bg-black/60 text-white',
      }}
    >
      <ModalContent>
        {() => (
          <ModalBody className="p-0 flex flex-col md:flex-row overflow-hidden rounded-3xl">
            {/* Image side */}
            <div
              className="md:w-[65%] flex items-center justify-center min-h-[300px] bg-neutral-900"
              style={{ backgroundColor: detail?.color || '#1a1a1a' }}
            >
              <img
                src={image.url}
                alt={image.caption || ''}
                className="max-w-full max-h-[85vh] object-contain"
              />
            </div>

            {/* Info side */}
            <div className="md:w-[35%] p-7 overflow-y-auto space-y-5 bg-white">
              {/* Sponsorship */}
              {detail?.sponsorship && (
                <div className="flex items-center gap-3 p-3.5 bg-amber-50 rounded-2xl border border-amber-100">
                  {detail.sponsorship.logo && (
                    <img src={detail.sponsorship.logo} alt="" className="w-9 h-9 rounded-xl" />
                  )}
                  <div className="flex-1 min-w-0">
                    <Chip size="sm" color="warning" variant="flat" className="mb-1 text-[10px]">Sponsored</Chip>
                    <a
                      href={detail.sponsorship.url || '#'}
                      target="_blank"
                      rel="noopener"
                      className="text-sm font-semibold text-amber-900 hover:underline truncate block"
                    >
                      {detail.sponsorship.name}
                    </a>
                  </div>
                </div>
              )}

              {/* Photographer */}
              {detail?.photographer && (
                <div className="flex items-center gap-3.5">
                  {detail.photographer.profileImage && (
                    <img
                      src={detail.photographer.profileImage}
                      alt=""
                      className="w-12 h-12 rounded-2xl object-cover ring-2 ring-gray-50"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <a
                      href={detail.photographer.profile || '#'}
                      target="_blank"
                      rel="noopener"
                      className="font-bold text-gray-900 hover:text-blue-600 transition-colors block"
                    >
                      {detail.photographer.name}
                    </a>
                    <p className="text-[11px] text-gray-400">{detail.photographer.location || 'Unknown'}</p>
                    {detail.photographer.forHire && (
                      <Chip size="sm" color="success" variant="flat" className="mt-1 text-[10px]">
                        Available for hire
                      </Chip>
                    )}
                  </div>
                </div>
              )}

              <Divider />

              {/* Description */}
              {detail?.description && (
                <p className="text-sm text-gray-700 leading-relaxed font-medium">{detail.description}</p>
              )}

              {/* AI */}
              <div className="bg-blue-50/50 p-4 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs text-blue-600 font-bold uppercase tracking-wider">
                    <Sparkles className="w-4 h-4" /> Lens Intelligence
                  </div>
                  {detail?.ai?.qualityScore && (
                    <Chip size="sm" color="default" variant="flat" className="text-[10px] text-blue-600">
                      {detail.ai.qualityScore.toFixed(1)}/10
                    </Chip>
                  )}
                </div>
                <p className="text-sm text-blue-900/80 leading-relaxed">
                  {detail?.ai?.caption || image.caption}
                </p>
                {(detail?.ai?.tags || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(detail?.ai?.tags || []).map((t) => (
                      <Chip key={t} size="sm" variant="flat" color="secondary" className="text-[10px]">
                        #{t}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>

              {/* EXIF */}
              {detail?.exif && (
                <div className="bg-gray-50 p-4 rounded-2xl space-y-2">
                  <div className="flex items-center gap-2 text-xs text-gray-400 font-bold uppercase tracking-wider">
                    <Aperture className="w-3.5 h-3.5" /> Technical Info
                  </div>
                  <p className="text-sm text-gray-800 font-bold">{detail.exif.camera || 'Unknown Camera'}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                    {detail.exif.aperture && <span>{detail.exif.aperture}</span>}
                    {detail.exif.exposure && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />{detail.exif.exposure}
                      </span>
                    )}
                    {detail.exif.iso && <span>ISO {detail.exif.iso}</span>}
                  </div>
                </div>
              )}

              <Divider />

              {/* Stats */}
              <div className="space-y-1">
                <Stat icon={Eye} label="Views" value={detail?.stats.views || 0} />
                <Stat icon={Download} label="Downloads" value={detail?.stats.downloads || 0} />
                <Stat icon={Heart} label="Likes" value={detail?.stats.likes || 0} />
              </div>

              {/* Meta */}
              <div className="text-[10px] text-gray-400 space-y-1 pt-2 border-t border-dashed">
                <div className="flex justify-between">
                  <span>Resolution</span>
                  <span className="text-gray-600 font-medium">
                    {detail?.width || image.width} × {detail?.height || image.height}
                  </span>
                </div>
                {score !== undefined && (
                  <div className="flex justify-between">
                    <span>Semantic Score</span>
                    <span className="text-blue-500 font-bold">{(score * 100).toFixed(1)}%</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span>Engine Model</span>
                  <span className="text-gray-600">{detail?.ai?.model || 'llama-4-scout'}</span>
                </div>
              </div>

              {/* CTA */}
              {detail?.source && (
                <Button
                  as="a"
                  href={detail.source}
                  target="_blank"
                  rel="noopener"
                  color="default"
                  variant="solid"
                  radius="lg"
                  fullWidth
                  className="bg-gray-900 text-white font-bold text-xs"
                  endContent={<ExternalLink className="w-4 h-4" />}
                >
                  View Original on Unsplash
                </Button>
              )}
            </div>
          </ModalBody>
        )}
      </ModalContent>
    </Modal>
  );
}
