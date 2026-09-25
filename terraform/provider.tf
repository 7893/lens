terraform {
  required_version = "= 1.16.3"
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.30.0"
    }
  }
}

provider "cloudflare" {
  # api_token is automatically read from CLOUDFLARE_API_TOKEN environment variable
}
