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
# Note: Using null_resource as Vectorize TF support might be limited/beta.
# We'll use Wrangler CLI for this part if TF provider is missing it, 
# but checking recent docs, cloudflare_vectorize_index is becoming available.
# For now, we will rely on a local-exec provisioner for Vectorize creation to be safe,
# or assume the user runs `wrangler vectorize create` manually as per SETUP.md.
# Here we define a placeholder resource to track it.

resource "null_resource" "vectorize_index" {
  triggers = {
    index_name = "pic-v6-${var.environment}-vectors"
  }

  provisioner "local-exec" {
    command = "npx wrangler vectorize create ${self.triggers.index_name} --dimensions=768 --metric=cosine || echo 'Index already exists'"
    environment = {
      CLOUDFLARE_API_TOKEN = var.cloudflare_api_token
      CLOUDFLARE_ACCOUNT_ID = var.account_id
    }
  }
}

# 5. Workers KV (Optional: System Config Cache)
# We decided to use D1 for config, so KV is skipped.
