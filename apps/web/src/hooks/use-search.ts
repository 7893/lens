import useSWRInfinite from 'swr/infinite';
import { SearchResponse, ImageResult } from '@pic/shared';
import { useState, useEffect } from 'react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());
const PAGE_SIZE = 20;

export function useSearch() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedQuery(query), 500);
    return () => clearTimeout(handler);
  }, [query]);

  const getKey = (pageIndex: number, prev: SearchResponse | null) => {
    if (!debouncedQuery) return null;
    if (prev && prev.results.length === 0) return null;
    return `/api/search?q=${encodeURIComponent(debouncedQuery)}&limit=${PAGE_SIZE}&page=${pageIndex + 1}`;
  };

  const { data, error, isLoading, isValidating, size, setSize } = useSWRInfinite<SearchResponse>(getKey, fetcher);

  const results: ImageResult[] = data ? data.flatMap(d => d.results) : [];
  const hasMore = data ? data[data.length - 1]?.results.length === PAGE_SIZE : false;

  return {
    query,
    setQuery,
    results,
    total: data?.[0]?.total || 0,
    isLoading,
    isLoadingMore: isValidating && size > 1,
    hasMore,
    loadMore: () => setSize(size + 1),
    took: data?.[0]?.took
  };
}
