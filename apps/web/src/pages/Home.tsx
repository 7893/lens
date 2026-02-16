import { useSearch } from '../hooks/use-search';
import { ImageResult } from '@pic/shared';
import { Search, X, Camera, Sparkles } from 'lucide-react';
import { useState, useEffect, useRef, useCallback } from 'react';

function ImageModal({ image, onClose }: { image: ImageResult; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <div className="relative max-w-5xl w-full max-h-[90vh] flex flex-col md:flex-row bg-white rounded-2xl overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-3 right-3 z-10 p-1.5 bg-black/50 hover:bg-black/70 rounded-full text-white transition-colors" aria-label="Close">
          <X className="w-5 h-5" />
        </button>

        <div className="md:w-2/3 bg-gray-900 flex items-center justify-center min-h-[300px]">
          <img src={image.url} alt={image.caption || ''} className="max-w-full max-h-[70vh] object-contain" />
        </div>

        <div className="md:w-1/3 p-6 overflow-y-auto">
          {image.photographer && (
            <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
              <Camera className="w-4 h-4" />
              <span>{image.photographer}</span>
            </div>
          )}

          {image.caption && (
            <div className="mb-4">
              <div className="flex items-center gap-1.5 text-xs text-gray-400 mb-2">
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI Description</span>
              </div>
              <p className="text-sm text-gray-700 leading-relaxed">{image.caption}</p>
            </div>
          )}

          {image.score !== undefined && (
            <div className="text-xs text-gray-400">
              Relevance: {(image.score * 100).toFixed(1)}%
            </div>
          )}

          <div className="mt-4 text-xs text-gray-400">
            {image.width} × {image.height}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { query, setQuery, results, isLoading, isLoadingMore, hasMore, loadMore, took } = useSearch();
  const [selected, setSelected] = useState<ImageResult | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleObserver = useCallback((entries: IntersectionObserverEntry[]) => {
    if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
      loadMore();
    }
  }, [hasMore, isLoadingMore, loadMore]);

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
              <img 
                src={img.url} 
                alt={img.caption || 'Image'} 
                className="w-full h-auto object-cover"
                loading="lazy"
              />
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

      {isLoadingMore && (
        <div className="text-center py-8 text-blue-500">Loading more...</div>
      )}

      {!isLoading && results.length === 0 && query && (
        <div className="text-center py-20 text-gray-400">No results found. Try a different query.</div>
      )}
      
      {isLoading && (
        <div className="text-center py-20 text-blue-500">Searching...</div>
      )}

      {selected && <ImageModal image={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
