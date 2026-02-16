output "d1_database_id" {
  value = cloudflare_d1_database.db.id
  description = "Copy this ID into wrangler.toml under 'database_id'"
}

output "r2_bucket_name" {
  value = cloudflare_r2_bucket.assets.name
  description = "R2 bucket name"
}

output "queue_name" {
  value = cloudflare_queue.ingestion.name
  description = "Queue name"
}
