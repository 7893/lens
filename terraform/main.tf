# R2 Bucket — use existing "pic-r2" (managed outside Terraform)

# D1 Database
resource "cloudflare_d1_database" "db" {
  account_id = var.account_id
  name       = "pic-db"
}

# Queue
resource "cloudflare_queue" "ingestion" {
  account_id = var.account_id
  name       = "pic-ingestion"
}

# Vectorize Index (not natively supported by Terraform, use local-exec)
resource "null_resource" "vectorize_index" {
  triggers = {
    index_name = "pic-vectors"
  }

  provisioner "local-exec" {
    command = "npx wrangler vectorize create ${self.triggers.index_name} --dimensions=768 --metric=cosine || echo 'Index already exists'"
  }
}

# Cloudflare Pages Project (Frontend)
resource "cloudflare_pages_project" "web" {
  account_id        = var.account_id
  name              = "pic"
  production_branch = "main"

  build_config {
    build_command   = "npm run build"
    destination_dir = "dist"
    root_dir        = "apps/web"
  }
}
