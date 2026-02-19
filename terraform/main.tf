# Cloudflare Infrastructure for Lens

# 1. D1 Database (Metadata)
resource "cloudflare_d1_database" "db" {
  account_id = var.account_id
  name       = "lens-d1"
}

# 2. R2 Bucket (Asset Storage) - Import existing
resource "cloudflare_r2_bucket" "assets" {
  account_id = var.account_id
  name       = "lens-r2"
  location   = "APAC"
}

# 3. Queue (Ingestion Pipeline)
resource "cloudflare_queue" "ingestion" {
  account_id = var.account_id
  name       = "lens-queue"
}

# 4. Vectorize Index (Semantic Search) - managed via wrangler
# lens-vectors already exists with 18,035 vectors

# 5. Workers KV (Settings)
resource "cloudflare_workers_kv_namespace" "kv" {
  account_id = var.account_id
  title      = "lens-kv"
}

# 6. AI Gateway (managed via API, provider doesn't support yet)
# Name: lens-gateway
