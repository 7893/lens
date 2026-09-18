import { SuggestResponse, ImageResult } from '@lens/shared';
import useSWR from 'swr';
import { useState, useEffect, useCallback } from 'react';

const fetcher = (url: string) => fetch(url).then((res) => res.json());
const PAGE_SIZE = 20;

export function useSearch() {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);

  const [streamResults, setStreamResults] = useState<ImageResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [took, setTook] = useState<number | undefined>();
  const [total, setTotal] = useState(0);

  // Faster 250ms debounce for responsive typing
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(handler);
  }, [query]);

  useEffect(() => {
    setVisible(PAGE_SIZE);
  }, [debouncedQuery]);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setStreamResults([]);
      setTotal(0);
      setTook(undefined);
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);

    async function streamSearch() {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&stream=true`, {
          headers: { Accept: 'text/event-stream' },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          // Fallback to non-streaming json fetch
          const fallbackData = await response.json();
          setStreamResults(fallbackData.results || []);
          setTotal(fallbackData.total || 0);
          setTook(fallbackData.took);
          setIsLoading(false);
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() || '';

          for (const part of parts) {
            const lines = part.split('\n');
            let event = 'message';
            let dataStr = '';

            for (const line of lines) {
              if (line.startsWith('event:')) {
                event = line.replace('event:', '').trim();
              } else if (line.startsWith('data:')) {
                dataStr += line.replace('data:', '').trim();
              }
            }

            if (dataStr) {
              try {
                const data = JSON.parse(dataStr);
                if (data.results) {
                  setStreamResults(data.results);
                  setTotal(data.total ?? data.results.length);
                  setTook(data.took);
                }
                if (data.stage === 'complete' || event === 'done') {
                  setIsLoading(false);
                }
              } catch {
                // Ignore parse errors on partial chunks
              }
            }
          }
        }
      } catch (err: unknown) {
        if ((err as Error)?.name !== 'AbortError') {
          console.error('Search stream failed:', err);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    streamSearch();

    return () => {
      controller.abort();
    };
  }, [debouncedQuery]);

  const results = streamResults.slice(0, visible);
  const hasMore = visible < streamResults.length;

  // Instantly apply a suggestion without debounce
  const selectSuggestion = useCallback((suggestion: string) => {
    setQuery(suggestion);
    setDebouncedQuery(suggestion);
    setVisible(PAGE_SIZE);
  }, []);

  return {
    query,
    setQuery,
    selectSuggestion,
    results,
    total: total || streamResults.length,
    isLoading,
    isSearching: !!debouncedQuery,
    hasMore,
    loadMore: useCallback(() => setVisible((v) => v + PAGE_SIZE), []),
    took,
  };
}

export function useSuggestions(query: string) {
  const [debouncedQ, setDebouncedQ] = useState('');

  useEffect(() => {
    if (query.trim().length < 2) {
      setDebouncedQ('');
      return;
    }
    const handler = setTimeout(() => setDebouncedQ(query), 200);
    return () => clearTimeout(handler);
  }, [query]);

  const url = debouncedQ ? `/api/suggest?q=${encodeURIComponent(debouncedQ)}` : null;

  const { data } = useSWR<SuggestResponse>(url, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: false,
  });

  return {
    suggestions: data?.suggestions || [],
    dismiss: useCallback(() => setDebouncedQ(''), []),
  };
}
