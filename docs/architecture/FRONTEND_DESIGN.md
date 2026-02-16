# Frontend Architecture

**Stack**: React 18 + Vite + Tailwind CSS + SWR + Lucide Icons + BlurHash

Bundled as static assets into the `pic` Worker (Hono serves API + static files).

## Structure

```
apps/web/src/
├── main.tsx          # Entry point
├── App.tsx           # Root component
├── index.css         # Tailwind imports
├── hooks/
│   └── use-search.ts # SWR search with debounce + client-side progressive render
└── pages/
    └── Home.tsx      # Search + masonry grid + image modal
```

## How It Works

1. User types a query — search bar is centered on page
2. `useSearch` hook debounces input (500ms), fetches `/api/search?q=...`
3. Search bar animates up, skeleton loader shows during fetch
4. Results rendered in CSS columns masonry layout with BlurHash placeholders
5. Images fade in (500ms opacity transition) as they load
6. Infinite scroll via IntersectionObserver (client-side, 20 per batch)
7. Click image → detail modal with full metadata (EXIF, AI description, stats)
8. Clear search → results clear, search bar slides back to center

## Key Decisions

- **Same origin** — frontend and API served from the same Worker, no CORS needed
- **Client-side pagination** — API returns all results (topK=100), frontend progressively renders
- **BlurHash placeholders** — decoded from Unsplash blur_hash, avoids layout shift
- **Inter font** — loaded from Google Fonts for clean typography
- CSS `columns` layout instead of a masonry library
- `loading="lazy"` on all images
