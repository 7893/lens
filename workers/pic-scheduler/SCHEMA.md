# Database Schema

## Photos Table

Based on actual Unsplash API data from 30 photos analysis.

### Core Fields
- `unsplash_id` TEXT PRIMARY KEY - Unsplash photo ID
- `slug` TEXT - URL-friendly slug
- `r2_key` TEXT NOT NULL - R2 storage key (format: `{category}/{id}.jpg`)
- `downloaded_at` TEXT NOT NULL - ISO timestamp when downloaded

### Photo Metadata
- `description` TEXT - User-provided description (nullable)
- `alt_description` TEXT - AI-generated alt text
- `blur_hash` TEXT - BlurHash for placeholder
- `width` INTEGER NOT NULL - Original width in pixels
- `height` INTEGER NOT NULL - Original height in pixels
- `color` TEXT - Dominant color (hex format)
- `likes` INTEGER - Number of likes

### Timestamps
- `created_at` TEXT NOT NULL - When photo was uploaded to Unsplash
- `updated_at` TEXT - Last update timestamp
- `promoted_at` TEXT - When photo was promoted (nullable)

### Photographer Info
- `photographer_id` TEXT NOT NULL - Unsplash user ID
- `photographer_username` TEXT NOT NULL - Username
- `photographer_name` TEXT NOT NULL - Display name
- `photographer_bio` TEXT - Bio text (nullable)
- `photographer_location` TEXT - Location (nullable)
- `photographer_portfolio_url` TEXT - Portfolio URL (nullable)
- `photographer_instagram` TEXT - Instagram username (nullable)
- `photographer_twitter` TEXT - Twitter username (nullable)

### Photo Location
- `photo_location_name` TEXT - Location name (e.g., "Tokyo, Japan")
- `photo_location_city` TEXT - City name
- `photo_location_country` TEXT - Country name
- `photo_location_latitude` REAL - GPS latitude
- `photo_location_longitude` REAL - GPS longitude

### EXIF Data (from Unsplash API)
- `exif_make` TEXT - Camera manufacturer (e.g., "SONY", "Apple")
- `exif_model` TEXT - Camera model (e.g., "ILCE-7RM5", "iPhone 11 Pro")
- `exif_name` TEXT - Full camera name
- `exif_exposure_time` TEXT - Exposure time (e.g., "1/400")
- `exif_aperture` TEXT - Aperture value (e.g., "4.0")
- `exif_focal_length` TEXT - Focal length (e.g., "50.0")
- `exif_iso` INTEGER - ISO value

### Tags
- `tags` TEXT - JSON array of tag strings

### AI Classification
- `ai_category` TEXT NOT NULL - Primary category from AI
- `ai_confidence` REAL NOT NULL - Confidence score (0-1)
- `ai_model_scores` TEXT NOT NULL - JSON object with all model scores

## Indexes
- `idx_ai_category` - For category filtering
- `idx_downloaded_at` - For chronological sorting
- `idx_photographer_username` - For photographer queries
- `idx_location_country` - For location-based queries
- `idx_exif_make` - For camera-based queries

## JobState Table
- `key` TEXT PRIMARY KEY - State key
- `value` INTEGER NOT NULL - State value

Current keys:
- `last_processed_page` - Last processed Unsplash page number

## Data Sources

### Unsplash API
- List endpoint: `/photos?order_by=latest&per_page=30&page={page}`
- Detail endpoint: `/photos/{id}` (includes EXIF and location)
- Image URL: `photo.urls.raw` (original maximum quality)

### AI Classification
- 4 models: Llama 3.2 3B, Llama 3.1 8B, Llama 3 8B, Mistral 7B
- Confidence-weighted voting system
- Categories are lowercase with hyphens (e.g., "street-photography")
