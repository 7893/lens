import useSWR from 'swr';
import { SearchResponse } from '@pic/shared';
import { useState, useEffect } from 'react';

// Fetcher function
const fetcher = (url: string) => fetch(url).then((res) => res.json());

export function useSearch() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  // Debounce logic
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedQuery(query);
    }, 500); // 500ms delay

    return () => {
      clearTimeout(handler);
    };
  }, [query]);

  // SWR Hook
  // Only fetch if query is not empty
  const { data, error, isLoading } = useSWR<SearchResponse>(
    debouncedQuery ? `/api/search?q=${encodeURIComponent(debouncedQuery)}` : null,
    fetcher
  );

  return {
    query,
    setQuery,
    results: data?.results || [],
    total: data?.total || 0,
    isLoading,
    isError: error,
    took: data?.took
  };
}
