import { useSearch, useSuggestions } from '../hooks/use-search';
import { ImageResult } from '@lens/shared';
import { useState, useEffect, useRef, useCallback } from 'react';
import { Skeleton } from '@heroui/react';
import useSWR from 'swr';
import { ImageCard } from '../components/gallery/ImageCard';
import { ImageModal } from '../components/modals/ImageModal';
import { SearchBar } from '../components/search/SearchBar';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function SkeletonCard({ height }: { height: number }) {
  return (
    <div className="break-inside-avoid rounded-xl overflow-hidden">
      <Skeleton className="w-full rounded-xl" style={{ height }} />
      <div className="p-3 space-y-2 mt-1">
        <Skeleton className="h-3 w-3/4 rounded-lg" />
        <Skeleton className="h-3 w-1/2 rounded-lg" />
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <SkeletonCard key={i} height={200 + (i % 3) * 80} />
      ))}
    </>
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
  const sentinelRef = useRef<HTMLDivElement>(null);

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

  const handleSelectSuggestion = (s: string) => {
    selectSuggestion(s);
    dismissSuggestions();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className={`transition-all duration-500 ease-out ${results.length > 0 || isLoading ? 'pt-8' : 'pt-[30vh]'}`}>
        <div className="max-w-4xl mx-auto mb-12 text-center px-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Lens</h1>
          <p className="text-gray-500 mb-8">AI-Powered Semantic Image Search on Cloudflare Edge</p>

          <SearchBar
            query={query}
            setQuery={setQuery}
            suggestions={suggestions}
            onSelectSuggestion={handleSelectSuggestion}
          />

          {took !== undefined && isSearching && (
            <p className="text-xs text-gray-400 mt-3">
              Found {total} results in {took}ms
            </p>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4 px-8">
        {isLoading ? (
          <SkeletonGrid />
        ) : (
          results.map((img: ImageResult) => <ImageCard key={img.id} image={img} onClick={() => setSelected(img)} />)
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
