export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // API: 获取图片列表
    if (url.pathname === '/api/photos') {
      const page = parseInt(url.searchParams.get('page')) || 1;
      const limit = parseInt(url.searchParams.get('limit')) || 30;
      const category = url.searchParams.get('category');
      const offset = (page - 1) * limit;

      let query = 'SELECT * FROM Photos';
      let params = [];

      if (category) {
        query += ' WHERE primary_category = ?';
        params.push(category);
      }

      query += ' ORDER BY downloaded_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);

      const photos = await env.DB.prepare(query).bind(...params).all();

      return Response.json({
        photos: photos.results,
        page,
        limit
      });
    }

    // API: 获取统计信息
    if (url.pathname === '/api/stats') {
      const categories = await env.DB.prepare(`
        SELECT primary_category, COUNT(*) as count
        FROM Photos
        GROUP BY primary_category
        ORDER BY count DESC
      `).all();

      const total = await env.DB.prepare('SELECT COUNT(*) as total FROM Photos').first();

      return Response.json({
        total: total.total,
        categories: categories.results
      });
    }

    // 图片代理
    if (url.pathname.startsWith('/image/')) {
      const key = url.pathname.slice(7); // 移除 '/image/'
      
      const object = await env.R2.get(key);
      if (!object) {
        return new Response('Image not found', { status: 404 });
      }

      return new Response(object.body, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000'
        }
      });
    }

    // 首页 HTML
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pic - Photo Gallery</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; }
    header { background: #fff; padding: 1rem 2rem; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
    h1 { font-size: 1.5rem; }
    .stats { padding: 1rem 2rem; background: #fff; margin: 1rem 0; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; padding: 2rem; }
    .photo { background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
    .photo img { width: 100%; height: 200px; object-fit: cover; }
    .photo-info { padding: 1rem; }
    .category { display: inline-block; background: #e3f2fd; color: #1976d2; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.875rem; }
    .loading { text-align: center; padding: 2rem; }
  </style>
</head>
<body>
  <header>
    <h1>📸 Pic Gallery</h1>
  </header>
  
  <div class="stats">
    <div id="stats">Loading stats...</div>
  </div>

  <div class="gallery" id="gallery">
    <div class="loading">Loading photos...</div>
  </div>

  <script>
    async function loadStats() {
      const res = await fetch('/api/stats');
      const data = await res.json();
      document.getElementById('stats').innerHTML = \`
        <strong>Total Photos:</strong> \${data.total} | 
        <strong>Categories:</strong> \${data.categories.length}
      \`;
    }

    async function loadPhotos() {
      const res = await fetch('/api/photos?limit=30');
      const data = await res.json();
      
      const gallery = document.getElementById('gallery');
      gallery.innerHTML = data.photos.map(photo => \`
        <div class="photo">
          <img src="/image/\${photo.r2_key}" alt="\${photo.description || 'Photo'}" loading="lazy">
          <div class="photo-info">
            <span class="category">\${photo.primary_category}</span>
            <p style="margin-top: 0.5rem; font-size: 0.875rem; color: #666;">
              by \${photo.photographer_name}
            </p>
          </div>
        </div>
      \`).join('');
    }

    loadStats();
    loadPhotos();
  </script>
</body>
</html>`;
