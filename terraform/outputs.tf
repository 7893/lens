output "d1_database_id" {
  value       = cloudflare_d1_database.db.id
  description = "D1 database ID"
}

output "r2_bucket_name" {
  value       = cloudflare_r2_bucket.assets.name
  description = "R2 bucket name"
}

output "queue_id" {
  value       = cloudflare_queue.ingestion.id
  description = "Queue ID"
}

output "kv_namespace_id" {
  value       = cloudflare_workers_kv_namespace.kv.id
  description = "KV namespace ID"
}
