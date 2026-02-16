import { useSearch } from '../hooks/use-search';
import { ImageResult } from '@pic/shared';
import { Search, X, Camera, Sparkles, MapPin, Eye, Download, Heart, Aperture, Clock, ExternalLink } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface ImageDetail {
  id: string;
  urls: { raw: string; display: string };
  width: number;
  height: number;
  color: string | null;
  description: string | null;
  photographer: { name: string; username: string; location: string | null; profile: string | null };
  exif: { camera: string | null; aperture: string | null; exposure: string | null; focalLength: string | null; iso: number | null } | null;
  location: string | null;
  stats: { views: number | null; downloads: number | null; likes: number | null };
  ai: { caption: string | null; tags: string[] };
  source: string | null;
  createdAt: string | null;
}

function Stat({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: string | number | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <Icon className="w-3.5 h-3.5 text-gray-400" />
      <span className="text-gray-400">{label}</span>
      <span className="ml-auto font-medium text-gray-600">{typeof value === 'number' ? value.toLocaleString() : value}</span>
    </div>
  );
}

function ImageModal({ image, score, onClose }: { image: ImageResult; score?: number; onClose: () => void }) {
  const { data: detail } = useSWR<ImageDetail>(`/api/images/${image.id}`, fetcher);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', handler); document.body.style.overflow = ''; };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative max-w-6xl w-full max-h-[90vh] flex flex-col md:flex-row bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 z-10 p-1.5 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors" aria-label="Close">
          <X className="w-5 h-5" />
        </button>

        <div className="md:w-2/3 bg-gray-900 flex items-center justify-center min-h-[300px]" style={{ backgroundColor: detail?.color || '#111' }}>
          <img src={image.url} alt={image.caption || ''} className="max-w-full max-h-[80vh] object-contain" />
        </div>

        <div className="md:w-1/3 p-6 overflow-y-auto space-y-5 max-h-[90vh]">
          {/* Photographer */}
          {detail?.photographer?.name && (
            <div>
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-gray-400" />
                <span className="font-medium text-gray-800">{detail.photographer.name}</span>
              </div>
              {detail.photographer.location && (
                <p className="text-xs text-gray-400 ml-6">{detail.photographer.location}</p>
              )}
            </div>
          )}

          {/* Location */}
          {detail?.location && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin className="w-4 h-4 text-gray-400" />
              <span>{detail.location}</span>
            </div>
          )}

          {/* AI Analysis */}
          {detail?.ai?.caption && (
            <div>
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Description</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{detail.ai.caption}</p>
            </div>
          )}

          {/* EXIF */}
          {detail?.exif && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                <Aperture className="w-3.5 h-3.5" />
                <span>Camera Info</span>
              </div>
              {detail.exif.camera && <p className="text-sm text-gray-700 font-medium">{detail.exif.camera}</p>}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                {detail.exif.aperture && <span>{detail.exif.aperture}</span>}
                {detail.exif.exposure && <span><Clock className="w-3 h-3 inline mr-0.5" />{detail.exif.exposure}</span>}
                {detail.exif.focalLength && <span>{detail.exif.focalLength}</span>}
                {detail.exif.iso && <span>ISO {detail.exif.iso}</span>}
              </div>
            </div>
          )}

          {/* Stats */}
          {detail?.stats && (
            <div className="space-y-1.5">
              <Stat icon={Eye} label="Views" value={detail.stats.views} />
              <Stat icon={Download} label="Downloads" value={detail.stats.downloads} />
              <Stat icon={Heart} label="Likes" value={detail.stats.likes} />
            </div>
          )}

          {/* Meta */}
          <div className="space-y-1.5 text-xs text-gray-400 border-t pt-4">
            <div>{detail?.width || image.width} × {detail?.height || image.height}</div>
            {score !== undefined && <div>Relevance: {(score * 100).toFixed(1)}%</div>}
            {detail?.createdAt && <div>Taken: {new Date(detail.createdAt).toLocaleDateString()}</div>}
            {detail?.color && (
              <div className="flex items-center gap-2">
                Color: <span className="inline-block w-4 h-4 rounded-full border" style={{ backgroundColor: detail.color }} /> {detail.color}
              </div>
            )}
          </div>

          {/* Source link */}
          {detail?.source && (
            <a href={detail.source} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 transition-colors">
              <ExternalLink className="w-3.5 h-3.5" /> View on Unsplash
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { query, setQuery, results, isLoading, hasMore, loadMore, took } = useSearch();
  const [selected, setSelected] = useState<ImageResult | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    if (entries[0].isIntersecting && hasMore) loadMore();
  }, [hasMore, loadMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-4xl mx-auto mb-12 text-center">
        <h1 className="text-4xl font-bold text-gray-900 mb-4">Pic Gallery</h1>
        <p className="text-gray-500 mb-8">AI-Powered Semantic Search</p>
        
        <div className="relative max-w-xl mx-auto">
          <input
            type="text"
            className="w-full pl-12 pr-4 py-3 rounded-full border border-gray-200 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
            placeholder="Search for 'sad rainy day' or 'cyberpunk city'..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Search className="absolute left-4 top-3.5 text-gray-400 w-5 h-5" />
        </div>
        
        {took && <p className="text-xs text-gray-400 mt-2">Found {results.length} results in {took}ms</p>}
      </div>

      <div className="max-w-7xl mx-auto columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
        {results.map((img) => (
          <div
            key={img.id}
            className="break-inside-avoid bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow group cursor-pointer"
            onClick={() => setSelected(img)}
          >
            <div className="relative">
              <img src={img.url} alt={img.caption || 'Image'} className="w-full h-auto object-cover" loading="lazy" />
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
            </div>
            <div className="p-3">
              <p className="text-sm text-gray-700 line-clamp-2">{img.caption}</p>
              {img.photographer && (
                <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
                  <Camera className="w-3 h-3" /> {img.photographer}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      <div ref={sentinelRef} className="h-4" />

      {!isLoading && results.length === 0 && query && <div className="text-center py-20 text-gray-400">No results found. Try a different query.</div>}
      {isLoading && <div className="text-center py-20 text-blue-500">Searching...</div>}

      {selected && <ImageModal image={selected} score={selected.score} onClose={() => setSelected(null)} />}
    </div>
  );
}
