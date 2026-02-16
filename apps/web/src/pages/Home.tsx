import { useSearch } from '../hooks/use-search';
import { Search } from 'lucide-react';

export default function Home() {
  const { query, setQuery, results, isLoading, took } = useSearch();

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      {/* Header & Search */}
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

      {/* Gallery Grid */}
      <div className="max-w-7xl mx-auto columns-1 sm:columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
        {results.map((img) => (
          <div key={img.id} className="break-inside-avoid bg-white rounded-xl shadow-sm overflow-hidden hover:shadow-md transition-shadow group">
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
              <div className="mt-2 flex flex-wrap gap-1">
                {img.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">#{tag}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {!isLoading && results.length === 0 && query && (
        <div className="text-center py-20 text-gray-400">
          No results found. Try a different query.
        </div>
      )}
      
      {/* Loading State */}
      {isLoading && (
        <div className="text-center py-20 text-blue-500">
          Searching...
        </div>
      )}
    </div>
  );
}
