import { useState, useEffect, useRef, useCallback } from 'react';
import useSWR from 'swr';
import { useSearch, useSuggestions } from '../hooks/use-search';
import { ImageResult } from '@lens/shared';
import { SearchBar } from '../components/search/SearchBar';
import { ImageCard } from '../components/gallery/ImageCard';
import { ImageModal } from '../components/modals/ImageModal';

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function Skeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="break-inside-avoid rounded-2xl overflow-hidden bg-gray-100 animate-pulse">
          <div style={{ height: `${250 + (i % 3) * 100}px` }} />
          <div className="p-4 space-y-2">
            <div className="h-3 bg-gray-200 rounded w-3/4" />
            <div className="h-3 bg-gray-200 rounded w-1/2" />
          </div>
        </div>
      ))}
    </>
  );
}

function Stats() {
  const { data } = useSWR<{ total: number; recent: number }>('/api/stats', fetcher, { refreshInterval: 60000 });
  if (!data) return null;
  return (
    <div className="text-center py-12">
      <p className="text-[11px] font-bold text-gray-300 uppercase tracking-widest">
        {data.total.toLocaleString()} Indexed Images 
        {data.recent > 0 && <span className="text-blue-400 ml-2">· {data.recent} New Today</span>}
      </p>
    </div>
  );
}

export default function Home() {
  const { query, setQuery, selectSuggestion, results, isLoading, isSearching, hasMore, loadMore, took, total } = useSearch();
  const { suggestions } = useSuggestions(query);
  const [selected, setSelected] = useState<ImageResult | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      if (entries[0].isIntersecting && hasMore && !isLoading) loadMore();
    },
    [hasMore, loadMore, isLoading],
  );

  useEffect(() => {
    const observer = new IntersectionObserver(handleObserver, { rootMargin: '400px' });
    if (sentinelRef.current) observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [handleObserver]);

  const hasResults = results.length > 0;

  return (
    <div className="min-h-screen bg-gray-50/50 selection:bg-blue-100 selection:text-blue-700">
      {/* Search Header */}
      <div className={`transition-all duration-700 ease-[cubic-bezier(0.23,1,0.32,1)] ${hasResults || isLoading ? 'pt-12 pb-8' : 'pt-[28vh] pb-12'}`}>
        <div className="max-w-4xl mx-auto text-center px-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-[10px] font-bold uppercase tracking-wider mb-6 animate-fade-in">
            Edge-Native Visual Intelligence
          </div>
          <h1 className="text-6xl font-black text-gray-900 mb-4 tracking-tight">Lens<span className="text-blue-500">.</span></h1>
          <p className="text-gray-500 mb-10 text-lg font-medium">Beyond keywords. Search with pure artistic intent.</p>

          <SearchBar 
            query={query} 
            setQuery={setQuery} 
            suggestions={suggestions} 
            onSelectSuggestion={selectSuggestion} 
          />

          {took !== undefined && isSearching && (
            <div className="mt-6 flex items-center justify-center gap-4 animate-fade-in">
              <span className="text-[11px] font-bold text-gray-400 uppercase tracking-tighter">
                {total.toLocaleString()} Match{total !== 1 ? 'es' : ''}
              </span>
              <div className="w-1 h-1 bg-gray-200 rounded-full" />
              <span className="text-[11px] font-bold text-blue-500 uppercase tracking-tighter">
                Latency: {took}ms
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Main Gallery */}
      <main className="max-w-[1600px] mx-auto px-6 pb-20">
        <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6 space-y-6">
          {isLoading ? (
            <Skeleton />
          ) : (
            results.map((img) => (
              <ImageCard 
                key={img.id} 
                image={img} 
                onClick={() => setSelected(img)} 
              />
            ))
          )}
        </div>

        {/* Empty State */}
        {!isLoading && results.length === 0 && isSearching && (
          <div className="text-center py-32 space-y-4 animate-fade-in">
            <div className="text-5xl">🔭</div>
            <p className="text-gray-400 font-medium">We couldn't find anything matching your intent.</p>
            <button onClick={() => setQuery('')} className="text-sm text-blue-500 font-bold hover:underline">Clear search</button>
          </div>
        )}

        {/* Infinite Scroll Sentinel */}
        <div ref={sentinelRef} className="h-20" />
      </main>

      {/* Detail Modal */}
      {selected && (
        <ImageModal 
          image={selected} 
          score={selected.score} 
          onClose={() => setSelected(null)} 
        />
      )}

      <Stats />
    </div>
  );
}
