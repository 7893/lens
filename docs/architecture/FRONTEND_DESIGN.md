# Frontend Architecture

**Stack**: React 18 + Vite + Tailwind CSS + SWR + Lucide Icons

Deployed on Cloudflare Pages (`pic`).

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
2. `useSearch` hook debounces input (500ms), then fetches `https://pic-api.53.workers.dev/api/search?q=...`
3. Results rendered in a CSS columns masonry layout
4. Images loaded via API Worker proxy: `https://pic-api.53.workers.dev/image/display/{id}.jpg`

## Key Decisions

- **API base URL** is hardcoded to `https://pic-api.53.workers.dev` (cross-origin, CORS enabled with `*`)
- **No router** — single page with search + gallery
- **No shadcn/ui** — plain Tailwind for simplicity
- **No admin dashboard** — not implemented yet
- CSS `columns` layout instead of a masonry library
- `loading="lazy"` on all images
