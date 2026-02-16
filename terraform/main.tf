# 1. R2 Bucket (Storage)
resource "cloudflare_r2_bucket" "assets" {
  account_id = var.account_id
  name       = "pic-v6-${var.environment}-assets"
  location   = "APAC" # Optional: adjust region
}

# 2. D1 Database (Metadata)
resource "cloudflare_d1_database" "db" {
  account_id = var.account_id
  name       = "pic-v6-${var.environment}-db"
}

# 3. Queue (Ingestion Pipeline)
resource "cloudflare_queue" "ingestion" {
  account_id = var.account_id
  name       = "pic-v6-${var.environment}-ingestion"
}

# 4. Vectorize Index (Semantic Search)
resource "null_resource" "vectorize_index" {
  triggers = {
    index_name = "pic-v6-${var.environment}-vectors"
  }

  provisioner "local-exec" {
    command = "npx wrangler vectorize create ${self.triggers.index_name} --dimensions=768 --metric=cosine || echo 'Index already exists'"
    # CLOUDFLARE_API_TOKEN is inherited from the shell environment
  }
}
