// ==========================================
// 1. Database Schema Types (D1)
// ==========================================

export interface DBImage {
  id: string;
  width: number;
  height: number;
  color: string | null;
  raw_key: string;
  display_key: string;
  meta_json: string;
  ai_tags: string;
  ai_caption: string | null;
  ai_model: string | null;
  ai_quality_score: number | null;
  entities_json: string | null;
  created_at: number;
}

export interface DBSystemConfig {
  key: string;
  value: string;
  updated_at: number;
}

// ==========================================
// 2. Queue Message Types
// ==========================================

export type IngestionTask =
  | {
      type: 'process-photo';
      photoId: string;
      downloadUrl: string;
      displayUrl?: string;
      photographer: string;
      source: 'unsplash';
      meta?: UnsplashPhoto;
    }
  | {
      type: 'refresh-photo';
      photoId: string;
    };

// ==========================================
// 3. API Response Types
// ==========================================

export interface ImageResult {
  id: string;
  url: string;
  width: number;
  height: number;
  caption: string | null;
  tags: string[];
  score?: number;
  photographer?: string;
  blurHash?: string;
  color?: string | null;
  location?: string | null;
  description?: string | null;
  exif?: {
    camera: string | null;
    aperture: string | null;
    exposure: string | null;
    focalLength: string | null;
    iso: number | null;
  } | null;
  topics?: string[];
  ai_model?: string | null;
  ai_quality_score?: number | null;
  entities?: string[];
}

export interface SearchResponse {
  results: ImageResult[];
  total: number;
  page?: number;
  took: number;
}

// ==========================================
// 4. External API Types (Unsplash subset)
// ==========================================

export interface UnsplashPhoto {
  id: string;
  created_at: string;
  promoted_at: string | null;
  width: number;
  height: number;
  color: string;
  description: string | null;
  alt_description: string | null;
  urls: {
    raw: string;
    full: string;
    regular: string;
    small: string;
    thumb: string;
  };
  links: {
    self: string;
    html: string;
    download: string;
    download_location: string;
  };
  user: {
    id: string;
    username: string;
    name: string;
    portfolio_url: string | null;
  };
  exif?: {
    make: string;
    model: string;
    exposure_time: string;
    aperture: string;
    focal_length: string;
    iso: number;
  };
  location?: {
    name: string;
    city: string;
    country: string;
  };
  sponsorship?: unknown;
}

// ==========================================
// 5. System Settings (KV)
// ==========================================

export interface IngestionSettings {
  backfill_enabled: boolean;
  backfill_max_pages: number;
  daily_evolution_limit_usd: number;
}

export interface D1EvolutionRecord {
  id: string;
  meta_json: string;
}
