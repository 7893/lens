// ==========================================
// 1. Database Schema Types (D1)
// ==========================================

export interface DBImage {
  id: string; // Unsplash ID
  width: number;
  height: number;
  color: string | null;

  // Storage Keys (R2)
  raw_key: string;
  display_key: string;

  // Metadata (Stored as JSON string in DB)
  meta_json: string; // Serialized UnsplashPhoto

  // AI Analysis (Stored as JSON string in DB)
  ai_tags: string; // Serialized string[]
  ai_caption: string | null;

  created_at: number; // Unix timestamp
}

export interface DBSystemConfig {
  key: string;
  value: string;
  updated_at: number;
}

// ==========================================
// 2. Queue Message Types
// ==========================================

export interface IngestionTask {
  type: 'process-photo';
  photoId: string;
  downloadUrl: string;
  displayUrl?: string;
  photographer: string;
  source: 'unsplash';
  meta?: UnsplashPhoto;
}

// ==========================================
// 3. API Response Types
// ==========================================

export interface ImageResult {
  id: string;
  url: string; // Display URL
  width: number;
  height: number;
  caption: string | null;
  tags: string[];
  score?: number; // Vector search score
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
}

export interface SearchResponse {
  results: ImageResult[];
  total: number;
  page?: number;
  took: number; // ms
}

export interface ImageDetailResponse {
  id: string;
  urls: {
    raw: string;
    display: string;
  };
  metadata: {
    photographer: string;
    location?: string;
    exif?: Record<string, string | number>;
  };
  ai: {
    caption: string | null;
    tags: string[];
  };
}

// ==========================================
// 4. External API Types (Unsplash subset)
// ==========================================

export interface UnsplashPhoto {
  id: string;
  created_at: string;
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
}
