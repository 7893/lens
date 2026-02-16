# R2 Bucket — use existing "lens-r2" (managed outside Terraform)

# D1 Database
resource "cloudflare_d1_database" "db" {
  account_id = var.account_id
  name       = "lens-db"
}

# Queue
resource "cloudflare_queue" "ingestion" {
  account_id = var.account_id
  name       = "lens-queue"
}

# Vectorize Index (not natively supported by Terraform, use local-exec)
resource "null_resource" "vectorize_index" {
  triggers = {
    index_name = "lens-vectors-v2"
  }

  provisioner "local-exec" {
    command = "npx wrangler vectorize create ${self.triggers.index_name} --dimensions=1024 --metric=cosine || echo 'Index already exists'"
  }
}
