import { Eye, Download, Heart, MapPin, Sparkles, Aperture, Clock, ExternalLink, X } from 'lucide-react';
import { ImageResult, ImageDetail } from '@lens/shared';
import { useEffect } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

const Stat = ({ icon: Icon, label, value }: { icon: any; label: string; value: string | number | null }) => {
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
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative max-w-6xl w-full max-h-[92vh] flex flex-col md:flex-row bg-white rounded-3xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-black/40 hover:bg-black/60 rounded-full text-white transition-all backdrop-blur-md"
        >
          <X className="w-5 h-5" />
        </button>

        <div
          className="md:w-[65%] bg-neutral-900 flex items-center justify-center min-h-[300px]"
          style={{ backgroundColor: detail?.color || '#1a1a1a' }}
        >
          <img
            src={image.url}
            alt={image.caption || ''}
            className="max-w-full max-h-[85vh] object-contain shadow-inner"
          />
        </div>

        <div className="md:w-[35%] p-7 overflow-y-auto space-y-6 max-h-[92vh] bg-white">
          {/* Photographer & Sponsorship */}
          <div className="space-y-4">
            {detail?.sponsorship && (
              <div className="flex items-center gap-3 p-3.5 bg-amber-50 rounded-2xl border border-amber-100">
                {detail.sponsorship.logo && <img src={detail.sponsorship.logo} alt="" className="w-9 h-9 rounded-xl" />}
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-amber-600 font-bold uppercase tracking-widest">Sponsored</p>
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

            {detail?.photographer && (
              <div className="flex items-center gap-3.5">
                <img
                  src={detail.photographer.profileImage || ''}
                  alt=""
                  className="w-12 h-12 rounded-2xl object-cover ring-2 ring-gray-50"
                />
                <div className="flex-1 min-w-0">
                  <a
                    href={detail.photographer.profile || '#'}
                    target="_blank"
                    rel="noopener"
                    className="font-bold text-gray-900 hover:text-blue-600 transition-colors"
                  >
                    {detail.photographer.name}
                  </a>
                  <p className="text-[11px] text-gray-400">{detail.photographer.location || 'Unknown'}</p>
                </div>
              </div>
            )}
          </div>

          <div className="h-px bg-gray-100" />

          {/* Description & AI */}
          <div className="space-y-4">
            {detail?.description && (
              <p className="text-sm text-gray-700 leading-relaxed font-medium">{detail.description}</p>
            )}

            <div className="bg-blue-50/50 p-4 rounded-2xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs text-blue-600 font-bold uppercase tracking-wider">
                  <Sparkles className="w-4 h-4" /> Lens Intelligence
                </div>
                {detail?.ai?.qualityScore && (
                  <span className="text-[10px] px-2 py-0.5 bg-white text-blue-600 rounded-full font-bold shadow-sm">
                    {detail.ai.qualityScore.toFixed(1)}/10
                  </span>
                )}
              </div>
              <p className="text-sm text-blue-900/80 leading-relaxed">{detail?.ai?.caption || image.caption}</p>
              <div className="flex flex-wrap gap-1.5">
                {(detail?.ai?.tags || []).map((t) => (
                  <span
                    key={t}
                    className="text-[10px] px-2.5 py-1 bg-white text-blue-500 rounded-lg shadow-sm font-medium"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Technical Info */}
          <div className="grid grid-cols-2 gap-4">
            {detail?.exif && (
              <div className="space-y-2 col-span-2 bg-gray-50 p-4 rounded-2xl">
                <div className="flex items-center gap-2 text-xs text-gray-400 font-bold uppercase tracking-wider mb-1">
                  <Aperture className="w-3.5 h-3.5" /> Technical Info
                </div>
                <p className="text-sm text-gray-800 font-bold">{detail.exif.camera || 'Unknown Camera'}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                  {detail.exif.aperture && <span>{detail.exif.aperture}</span>}
                  {detail.exif.exposure && (
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {detail.exif.exposure}
                    </span>
                  )}
                  {detail.exif.iso && <span>ISO {detail.exif.iso}</span>}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-1 border-t pt-5">
            <Stat icon={Eye} label="Views" value={detail?.stats.views || 0} />
            <Stat icon={Download} label="Downloads" value={detail?.stats.downloads || 0} />
            <Stat icon={Heart} label="Likes" value={detail?.stats.likes || 0} />
          </div>

          <div className="text-[10px] text-gray-400 space-y-1 pt-4 border-t border-dashed">
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

          {detail?.source && (
            <a
              href={detail.source}
              target="_blank"
              rel="noopener"
              className="flex items-center justify-center gap-2 py-3 w-full bg-gray-900 text-white rounded-2xl text-xs font-bold hover:bg-black transition-colors"
            >
              <ExternalLink className="w-4 h-4" /> View Original on Unsplash
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
