// Shared types for Pic v6.0

// D1 Photo Metadata
export interface PhotoMetadata {
  id: string;
  width: number;
  height: number;
  color: string;
  raw_key: string;
  display_key: string;
  meta_json: string; // JSON string from Unsplash
  ai_tags: string[]; // JSON string array
  ai_caption: string;
  created_at: number; // Timestamp
}

// API Search Response
export interface SearchResponse {
  results: {
    id: string;
    display_url: string;
    width: number;
    height: number;
    ai_caption: string;
    score?: number;
  }[];
  total?: number;
  page: number;
}
