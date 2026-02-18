import useSWR from 'swr';
import { SearchResponse } from '@lens/shared';
import { useState, useEffect, useCallback } from 'react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());
const PAGE_SIZE = 20;

export function useSearch() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedQuery(query), 500);
    return () => clearTimeout(handler);
  }, [query]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [debouncedQuery]);

  const searchUrl = debouncedQuery ? `/api/search?q=${encodeURIComponent(debouncedQuery)}` : null;

  const { data, isLoading } = useSWR<SearchResponse>(searchUrl, fetcher, { keepPreviousData: true });

  const all = debouncedQuery ? data?.results || [] : [];
  const results = all.slice(0, visible);
  const hasMore = visible < all.length;

  return {
    query,
    setQuery,
    results,
    total: all.length,
    isLoading,
    isSearching: !!debouncedQuery,
    hasMore,
    loadMore: useCallback(() => setVisible((v) => v + PAGE_SIZE), []),
    took: data?.took,
  };
}
