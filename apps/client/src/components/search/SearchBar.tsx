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
    <div className="relative max-w-xl mx-auto group">
      <div className="relative">
        <input
          type="text"
          className="w-full pl-13 pr-12 py-4 rounded-3xl border border-gray-100 bg-white shadow-xl shadow-blue-500/5 focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500/30 outline-none transition-all text-gray-700 placeholder-gray-400"
          placeholder="Search for 'sad rainy day' or 'cyberpunk city'..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowSuggestions(true);
            setHighlightIdx(-1);
          }}
          onFocus={() => setShowSuggestions(true)}
          onKeyDown={handleKeyDown}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
        />
        <Search className="absolute left-5 top-4.5 text-blue-500 w-5 h-5 group-focus-within:scale-110 transition-transform" />
        
        {query && (
          <button 
            onClick={() => { setQuery(''); setShowSuggestions(false); }}
            className="absolute right-4 top-4 p-1 rounded-full text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestRef}
          className="absolute z-40 left-0 right-0 mt-2 bg-white/95 backdrop-blur-2xl rounded-2xl shadow-2xl border border-white/20 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-300"
        >
          {suggestions.map((s, i) => (
            <button
              key={s}
              className={`w-full text-left px-6 py-4 text-sm flex items-center gap-4 transition-all ${
                i === highlightIdx ? 'bg-blue-600 text-white pl-8' : 'text-gray-600 hover:bg-blue-50 hover:pl-8'
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(s);
              }}
              onMouseEnter={() => setHighlightIdx(i)}
            >
              <TrendingUp className={`w-3.5 h-3.5 ${i === highlightIdx ? 'text-blue-200' : 'text-blue-400'}`} />
              <span className="font-semibold">{s}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
