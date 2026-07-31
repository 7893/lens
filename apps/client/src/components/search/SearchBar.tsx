import { Input, Listbox, ListboxItem } from '@heroui/react';
import { Search, X, TrendingUp } from 'lucide-react';
import React, { useState, useRef } from 'react';

interface SearchBarProps {
  query: string;
  setQuery: (q: string) => void;
  suggestions: string[];
  onSelectSuggestion: (s: string) => void;
}

export function SearchBar({ query, setQuery, suggestions, onSelectSuggestion }: SearchBarProps) {
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const suggestRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
      handleSelect(suggestions[highlightIdx]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleSelect = (s: string) => {
    onSelectSuggestion(s);
    setShowSuggestions(false);
    setHighlightIdx(-1);
  };

  return (
    <div className="relative max-w-xl mx-auto">
      <Input
        type="text"
        placeholder="Search for 'sad rainy day' or 'cyberpunk city'..."
        value={query}
        size="lg"
        radius="full"
        classNames={{
          base: 'w-full',
          inputWrapper: 'shadow-lg shadow-blue-500/10 border border-gray-100 bg-white hover:border-blue-200',
          input: 'text-gray-700 placeholder:text-gray-400',
        }}
        startContent={<Search className="w-4 h-4 text-blue-500 shrink-0" />}
        endContent={
          query ? (
            <button
              onClick={() => { setQuery(''); setShowSuggestions(false); }}
              className="p-1 rounded-full text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-all"
            >
              <X className="w-4 h-4" />
            </button>
          ) : null
        }
        onChange={(e) => {
          setQuery(e.target.value);
          setShowSuggestions(true);
          setHighlightIdx(-1);
        }}
        onFocus={() => setShowSuggestions(true)}
        onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        onKeyDown={handleKeyDown}
      />

      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestRef}
          className="absolute z-40 left-0 right-0 mt-2 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-fade-in"
        >
          <Listbox
            aria-label="Search suggestions"
            onAction={(key) => handleSelect(String(key))}
            classNames={{ base: 'p-1', list: 'gap-0' }}
          >
            {suggestions.map((s, i) => (
              <ListboxItem
                key={s}
                startContent={<TrendingUp className="w-3.5 h-3.5 text-blue-400" />}
                className={`rounded-xl px-4 py-3 text-sm text-gray-600 ${i === highlightIdx ? 'bg-blue-50 text-blue-700' : ''}`}
                onMouseEnter={() => setHighlightIdx(i)}
              >
                {s}
              </ListboxItem>
            ))}
          </Listbox>
        </div>
      )}
    </div>
  );
}
