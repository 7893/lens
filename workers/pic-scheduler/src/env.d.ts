// Type definitions for Cloudflare Workers environment and bindings

interface Env {
  // Bindings defined in wrangler.toml
  DB: D1Database;
  R2: R2Bucket;
  AI: Ai;
  PHOTO_WORKFLOW: Workflow;
  
  // Secrets
  UNSPLASH_API_KEY: string;
}

// Declaration for HTML files imported as raw text
declare module '*.html' {
  const content: string;
  export default content;
}
