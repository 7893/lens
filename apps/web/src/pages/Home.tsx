import { useSearch, useSuggestions } from '../hooks/use-search';
import { ImageResult } from '@lens/shared';
import { Search, X, Camera, Sparkles, MapPin, Eye, Download, Heart, Aperture, Clock, ExternalLink } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';
import { decode } from 'blurhash';
import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

// BlurHash → data URL (cached)
const blurCache = new Map<string, string>();
function blurHashToDataURL(hash: string, w = 32, h = 32): string {
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
  } catch {
    return '';
  }
}

// Image card with blur placeholder + fade-in
function ImageCard({ image, onClick }: { image: ImageResult; onClick: () => void }) {
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
            className="w-full h-auto object-cover"
            style={{ aspectRatio: `${image.width}/${image.height}` }}
          />
        )}
        <img
          src={image.url}
          alt={image.caption || 'Image'}
          className={`w-full h-auto object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'} ${blurUrl && !loaded ? 'absolute inset-0' : ''}`}
          loading="lazy"
          onLoad={() => setLoaded(true)}
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors" />
      </div>
      <div className="p-3">
        <p className="text-sm text-gray-700 line-clamp-2">{image.description || image.caption}</p>
        <div className="mt-1.5 space-y-0.5">
          {image.photographer && (
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <Camera className="w-3 h-3" /> {image.photographer}
            </p>
          )}
          {image.location && (
            <p className="text-xs text-gray-400 flex items-center gap-1">
              <MapPin className="w-3 h-3" /> {image.location}
            </p>
          )}
        </div>
        {image.topics && image.topics.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {image.topics.slice(0, 3).map((t) => (
              <span key={t} className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Skeleton loader
function Skeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="break-inside-avoid rounded-xl overflow-hidden">
          <div className="bg-gray-200 animate-pulse" style={{ height: `${200 + (i % 3) * 80}px` }} />
          <div className="p-3 space-y-2">
            <div className="h-3 bg-gray-200 rounded animate-pulse w-3/4" />
            <div className="h-3 bg-gray-200 rounded animate-pulse w-1/2" />
          </div>
        </div>
      ))}
    </>
  );
}

// Image detail modal
interface ImageDetail {
  id: string;
  urls: { raw: string; display: string };
  width: number;
  height: number;
  color: string | null;
  blurHash: string | null;
  description: string | null;
  altDescription: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  promotedAt: string | null;
  alternativeTitles: Record<string, string> | null;
  sponsorship: {
    name: string;
    tagline: string;
    url: string;
    logo: string | null;
    profile: string | null;
  } | null;
  photographer: {
    name: string;
    username: string;
    bio: string | null;
    location: string | null;
    profile: string | null;
    profileImage: string | null;
    instagram: string | null;
    twitter: string | null;
    portfolio: string | null;
    forHire: boolean;
    totalPhotos: number | null;
    totalLikes: number | null;
    totalCollections: number | null;
    totalPromotedPhotos: number | null;
  };
  exif: {
    make: string | null;
    model: string | null;
    camera: string | null;
    aperture: string | null;
    exposure: string | null;
    focalLength: string | null;
    iso: number | null;
  } | null;
  location: {
    name: string | null;
    city: string | null;
    country: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
  topics: string[];
  stats: { views: number | null; downloads: number | null; likes: number | null };
  ai: {
    caption: string | null;
    tags: string[];
    model: string | null;
    qualityScore: number | null;
    entities: string[];
  };
  source: string | null;
}

function Stat({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: string | number | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center gap-1.5 text-xs text-gray-500">
      <Icon className="w-3.5 h-3.5 text-gray-400" />
      <span className="text-gray-400">{label}</span>
      <span className="ml-auto font-medium text-gray-600">
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
    </div>
  );
}

function ImageModal({ image, score, onClose }: { image: ImageResult; score?: number; onClose: () => void }) {
  const { data: detail } = useSWR<ImageDetail>(`/api/images/${image.id}`, fetcher);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative max-w-6xl w-full max-h-[90vh] flex flex-col md:flex-row bg-white rounded-2xl overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-10 p-1.5 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div
          className="md:w-2/3 bg-gray-900 flex items-center justify-center min-h-[300px]"
          style={{ backgroundColor: detail?.color || '#111' }}
        >
          <img src={image.url} alt={image.caption || ''} className="max-w-full max-h-[80vh] object-contain" />
        </div>

        <div className="md:w-1/3 p-6 overflow-y-auto space-y-5 max-h-[90vh]">
          {/* Sponsorship */}
          {detail?.sponsorship && (
            <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
              {detail.sponsorship.logo && <img src={detail.sponsorship.logo} alt="" className="w-8 h-8 rounded-full" />}
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-amber-600 uppercase tracking-wide">Sponsored</p>
                <a
                  href={detail.sponsorship.url || detail.sponsorship.profile || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-medium text-amber-800 hover:underline truncate block"
                >
                  {detail.sponsorship.name}
                </a>
                {detail.sponsorship.tagline && <p className="text-xs text-amber-600">{detail.sponsorship.tagline}</p>}
              </div>
            </div>
          )}

          {/* Photographer */}
          {detail?.photographer?.name && (
            <div className="flex items-start gap-3">
              {detail.photographer.profileImage && (
                <img src={detail.photographer.profileImage} alt="" className="w-10 h-10 rounded-full" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <a
                    href={detail.photographer.profile || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-gray-800 hover:text-blue-600 transition-colors"
                  >
                    {detail.photographer.name}
                  </a>
                  {detail.photographer.forHire && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full">
                      Available for hire
                    </span>
                  )}
                </div>
                {detail.photographer.location && (
                  <p className="text-xs text-gray-400">{detail.photographer.location}</p>
                )}
                {detail.photographer.bio && (
                  <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{detail.photographer.bio}</p>
                )}
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[10px] text-gray-400">
                  {detail.photographer.totalPhotos && (
                    <span>{detail.photographer.totalPhotos.toLocaleString()} photos</span>
                  )}
                  {detail.photographer.totalLikes && (
                    <span>{detail.photographer.totalLikes.toLocaleString()} likes</span>
                  )}
                  {detail.photographer.totalCollections && (
                    <span>{detail.photographer.totalCollections} collections</span>
                  )}
                  {detail.photographer.totalPromotedPhotos && detail.photographer.totalPromotedPhotos > 0 && (
                    <span>⭐ {detail.photographer.totalPromotedPhotos} featured</span>
                  )}
                </div>
                <div className="flex gap-2 mt-1 text-[10px] text-gray-400">
                  {detail.photographer.instagram && <span>IG: @{detail.photographer.instagram}</span>}
                  {detail.photographer.twitter && <span>X: @{detail.photographer.twitter}</span>}
                  {detail.photographer.portfolio && (
                    <a
                      href={detail.photographer.portfolio}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:underline"
                    >
                      Portfolio
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {detail?.altDescription && <p className="text-sm text-gray-600 italic">{detail.altDescription}</p>}

          {detail?.description && detail.description !== detail.altDescription && (
            <p className="text-sm text-gray-600">{detail.description}</p>
          )}

          {detail?.location?.name && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
              <div>
                <span>{detail.location.name}</span>
                {detail.location.latitude && detail.location.longitude && (
                  <span className="text-[10px] text-gray-400 ml-2">
                    {detail.location.latitude.toFixed(2)}°, {detail.location.longitude.toFixed(2)}°
                  </span>
                )}
              </div>
            </div>
          )}

          {detail?.ai?.caption && (
            <div>
              <div className="flex items-center justify-between text-xs text-gray-400 mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>AI Analysis</span>
                </div>
                {detail.ai.qualityScore && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-purple-50 text-purple-600 rounded-full">
                    Quality: {detail.ai.qualityScore}/10
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{detail.ai.caption}</p>
              {detail.ai.entities && detail.ai.entities.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {detail.ai.entities.map((e) => (
                    <span key={e} className="text-[10px] px-1.5 py-0.5 bg-orange-50 text-orange-600 rounded-full">
                      {e}
                    </span>
                  ))}
                </div>
              )}
              {detail.ai.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {detail.ai.tags.map((t) => (
                    <span key={t} className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-500 rounded-full">
                      {t}
                    </span>
                  ))}
                </div>
              )}
              {detail.ai.model && <p className="text-[10px] text-gray-400 mt-2">Model: {detail.ai.model}</p>}
            </div>
          )}

          {detail?.topics && detail.topics.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {detail.topics.map((t) => (
                <span key={t} className="text-[10px] px-2 py-0.5 bg-green-50 text-green-600 rounded-full">
                  {t}
                </span>
              ))}
            </div>
          )}

          {detail?.exif && (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-1">
                <Aperture className="w-3.5 h-3.5" />
                <span>Camera</span>
              </div>
              {detail.exif.camera && <p className="text-sm text-gray-700 font-medium">{detail.exif.camera}</p>}
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-gray-500">
                {detail.exif.aperture && <span>{detail.exif.aperture}</span>}
                {detail.exif.exposure && (
                  <span>
                    <Clock className="w-3 h-3 inline mr-0.5" />
                    {detail.exif.exposure}
                  </span>
                )}
                {detail.exif.focalLength && <span>{detail.exif.focalLength}</span>}
                {detail.exif.iso && <span>ISO {detail.exif.iso}</span>}
              </div>
            </div>
          )}

          {detail?.stats && (
            <div className="space-y-1.5">
              <Stat icon={Eye} label="Views" value={detail.stats.views} />
              <Stat icon={Download} label="Downloads" value={detail.stats.downloads} />
              <Stat icon={Heart} label="Likes" value={detail.stats.likes} />
            </div>
          )}

          {/* Alternative Titles */}
          {detail?.alternativeTitles && Object.keys(detail.alternativeTitles).length > 0 && (
            <div className="border-t pt-4">
              <p className="text-[10px] text-gray-400 mb-2">Titles in other languages</p>
              <div className="space-y-1 max-h-24 overflow-y-auto">
                {Object.entries(detail.alternativeTitles)
                  .slice(0, 5)
                  .map(([lang, title]) => (
                    <p key={lang} className="text-[10px] text-gray-500">
                      <span className="uppercase text-gray-400 w-6 inline-block">{lang}</span> {title}
                    </p>
                  ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5 text-xs text-gray-400 border-t pt-4">
            <div>
              {detail?.width || image.width} × {detail?.height || image.height}
            </div>
            {score !== undefined && <div>Relevance: {(score * 100).toFixed(1)}%</div>}
            {detail?.createdAt && <div>Uploaded: {new Date(detail.createdAt).toLocaleDateString()}</div>}
            {detail?.promotedAt && (
              <div className="text-green-600">⭐ Featured: {new Date(detail.promotedAt).toLocaleDateString()}</div>
            )}
            {detail?.updatedAt && <div>Updated: {new Date(detail.updatedAt).toLocaleDateString()}</div>}
            {detail?.color && (
              <div className="flex items-center gap-2">
                Color:{' '}
                <span className="inline-block w-4 h-4 rounded-full border" style={{ backgroundColor: detail.color }} />{' '}
                {detail.color}
              </div>
            )}
          </div>

          {detail?.source && (
            <a
              href={detail.source}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-700 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" /> View on Unsplash
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function Stats() {
  const { data } = useSWR<{ total: number; recent: number }>('/api/stats', fetcher, { refreshInterval: 60000 });
  if (!data) return null;
  return (
    <p className="text-center text-[11px] text-gray-300 py-6">
      {data.total.toLocaleString()} images{data.recent > 0 ? ` · ${data.recent} added recently` : ''}
    </p>
  );
}

export default function Home() {
  const { query, setQuery, selectSuggestion, results, isLoading, isSearching, hasMore, loadMore, took, total } =
    useSearch();
  const { suggestions, dismiss: dismissSuggestions } = useSuggestions(query);
  const [selected, setSelected] = useState<ImageResult | null>(null);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const suggestRef = useRef<HTMLDivElement>(null);

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasMore) loadMore();
    },
    [hasMore, loadMore],
  );

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className={`transition-all duration-500 ease-out ${results.length > 0 || isLoading ? 'pt-8' : 'pt-[30vh]'}`}>
        <div className="max-w-4xl mx-auto mb-12 text-center px-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Lens</h1>
          <p className="text-gray-500 mb-8">AI-Powered Semantic Image Search on Cloudflare Edge</p>

          <div className="relative max-w-xl mx-auto">
            <input
              type="text"
              className="w-full pl-12 pr-4 py-3 rounded-full border border-gray-200 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
              placeholder="Search for 'sad rainy day' or 'cyberpunk city'..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setShowSuggestions(true);
                setHighlightIdx(-1);
              }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={(e) => {
                const visible = showSuggestions && suggestions.length > 0;
                if (!visible) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.min(i + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setHighlightIdx((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter' && highlightIdx >= 0) {
                  e.preventDefault();
                  selectSuggestion(suggestions[highlightIdx]);
                  setShowSuggestions(false);
                  dismissSuggestions();
                } else if (e.key === 'Escape') {
                  setShowSuggestions(false);
                }
              }}
            />
            <Search className="absolute left-4 top-3.5 text-gray-400 w-5 h-5" />

            {/* Typeahead Suggestions Dropdown */}
            {showSuggestions && suggestions.length > 0 && (
              <div
                ref={suggestRef}
                className="absolute z-40 left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden"
              >
                {suggestions.map((s, i) => (
                  <button
                    key={s}
                    className={`w-full text-left px-5 py-2.5 text-sm flex items-center gap-3 transition-colors ${
                      i === highlightIdx ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSuggestion(s);
                      setShowSuggestions(false);
                      dismissSuggestions();
                    }}
                    onMouseEnter={() => setHighlightIdx(i)}
                  >
                    <Search className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {took !== undefined && isSearching && (
            <p className="text-xs text-gray-400 mt-2">
              Found {total} results in {took}ms
            </p>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4 px-8">
        {isLoading ? (
          <Skeleton />
        ) : (
          results.map((img) => <ImageCard key={img.id} image={img} onClick={() => setSelected(img)} />)
        )}
      </div>

      <div ref={sentinelRef} className="h-4" />

      {!isLoading && results.length === 0 && isSearching && (
        <div className="text-center py-20 text-gray-400">No results found. Try a different query.</div>
      )}

      {selected && <ImageModal image={selected} score={selected.score} onClose={() => setSelected(null)} />}

      <Stats />
    </div>
  );
}
