terraform {
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
