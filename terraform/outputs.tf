output "d1_database_id" {
  value       = cloudflare_d1_database.db.id
  description = "D1 database ID for wrangler.toml"
}

output "queue_name" {
  value       = cloudflare_queue.ingestion.name
  description = "Queue name"
}

output "pages_subdomain" {
  value       = cloudflare_pages_project.web.subdomain
  description = "Pages subdomain"
}
