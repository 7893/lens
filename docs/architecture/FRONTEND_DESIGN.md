# Frontend Architecture

**Stack**: React 18 + Vite + Tailwind CSS + SWR + Lucide Icons

Bundled as static assets into the `pic` Worker (Hono serves API + static files).

## Structure

```
apps/web/src/
├── main.tsx          # Entry point
├── App.tsx           # Root component
├── index.css         # Tailwind imports
├── hooks/
│   └── use-search.ts # SWR-based search with 500ms debounce
└── pages/
    └── Home.tsx      # Gallery page with search + masonry grid
```

## How It Works

1. User types a query in the search box
2. `useSearch` hook debounces input (500ms), then fetches `/api/search?q=...` (same origin)
3. Results rendered in a CSS columns masonry layout
4. Images loaded via same Worker: `/image/display/{id}.jpg`

## Key Decisions

- **Same origin** — frontend and API served from the same Worker, no CORS needed
- **No router** — single page with search + gallery
- CSS `columns` layout instead of a masonry library
- `loading="lazy"` on all images
