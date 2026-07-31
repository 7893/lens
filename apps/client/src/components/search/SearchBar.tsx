import { ListBox, ListBoxItem } from '@heroui/react';
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
      {/* Custom input with icon — v3 Input is bare RAC input, use div wrapper */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-500 pointer-events-none" />
        <input
          type="text"
          placeholder="Search for 'sad rainy day' or 'cyberpunk city'..."
          value={query}
          className="w-full pl-11 pr-10 py-3 rounded-full border border-gray-200 shadow-sm focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 outline-none transition-all text-gray-700 placeholder-gray-400 bg-white"
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
            setHighlightIdx(-1);
          }}
          onFocus={() => setShowSuggestions(true)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
          onKeyDown={handleKeyDown}
        />
        {query && (
          <button
            onClick={() => {
              setQuery('');
              setShowSuggestions(false);
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestRef}
          className="absolute z-40 left-0 right-0 mt-2 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-100 overflow-hidden animate-fade-in"
        >
          <ListBox aria-label="Search suggestions" className="p-1">
            {suggestions.map((s, i) => (
              <ListBoxItem
                key={s}
                textValue={s}
                className={`rounded-xl px-4 py-3 text-sm cursor-pointer outline-none transition-colors ${
                  i === highlightIdx ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'
                }`}
                onMouseEnter={() => setHighlightIdx(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(s);
                }}
              >
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                  <span className="font-medium">{s}</span>
                </div>
              </ListBoxItem>
            ))}
          </ListBox>
        </div>
      )}
    </div>
  );
}
