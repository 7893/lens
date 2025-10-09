export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/photos') {
      const page = parseInt(url.searchParams.get('page')) || 1;
      const limit = parseInt(url.searchParams.get('limit')) || 30;
      const category = url.searchParams.get('category');
      const offset = (page - 1) * limit;

      let query = 'SELECT * FROM Photos';
      let params = [];

      if (category) {
        query += ' WHERE ai_category = ?';
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

    if (url.pathname === '/api/stats') {
      const [total, categories, recent, oldest, jobState, avgConfidence] = await Promise.all([
        env.DB.prepare('SELECT COUNT(*) as total FROM Photos').first(),
        env.DB.prepare('SELECT ai_category, COUNT(*) as count FROM Photos GROUP BY ai_category ORDER BY count DESC').all(),
        env.DB.prepare('SELECT downloaded_at FROM Photos ORDER BY downloaded_at DESC LIMIT 1').first(),
        env.DB.prepare('SELECT downloaded_at FROM Photos ORDER BY downloaded_at ASC LIMIT 1').first(),
        env.DB.prepare('SELECT value FROM JobState WHERE key = ?').bind('last_processed_page').first(),
        env.DB.prepare('SELECT AVG(ai_confidence) as avg FROM Photos').first()
      ]);

      return Response.json({
        total: total?.total || 0,
        categories: categories.results || [],
        lastDownload: recent?.downloaded_at || null,
        firstDownload: oldest?.downloaded_at || null,
        currentPage: jobState?.value || 0,
        avgConfidence: avgConfidence?.avg || 0
      });
    }

    if (url.pathname.startsWith('/image/')) {
      const key = url.pathname.slice(7);
      
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

    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html' }
      });
    }

    return new Response('Not Found', { status: 404 });
  }
};

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Pic</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fafafa; color: #333; line-height: 1.6; }
    .container { max-width: 1200px; margin: 0 auto; padding: 2rem 1rem; }
    header { text-align: center; margin-bottom: 2rem; }
    h1 { font-size: 1.5rem; font-weight: 400; color: #555; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1.5rem; margin: 2rem 0; }
    .stat { text-align: center; padding: 1rem; background: #fff; border: 1px solid #eee; border-radius: 4px; }
    .stat-value { font-size: 1.8rem; font-weight: 300; color: #333; }
    .stat-label { font-size: 0.8rem; color: #999; margin-top: 0.25rem; }
    .info-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem; margin: 2rem 0; }
    .info-card { background: #fff; border: 1px solid #eee; border-radius: 4px; padding: 1rem; }
    .info-card h3 { font-size: 0.875rem; color: #999; margin-bottom: 0.75rem; font-weight: 400; }
    .info-item { display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #f5f5f5; font-size: 0.875rem; }
    .info-item:last-child { border-bottom: none; }
    .info-label { color: #666; }
    .info-value { color: #333; font-weight: 500; }
    .categories { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; margin: 2rem 0; }
    .cat-tag { padding: 0.4rem 0.8rem; background: #f0f0f0; border-radius: 20px; font-size: 0.875rem; color: #666; }
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1.5rem; margin-top: 3rem; }
    .photo { background: #fff; border-radius: 4px; overflow: hidden; border: 1px solid #eee; }
    .photo img { width: 100%; height: 200px; object-fit: cover; display: block; }
    .photo-info { padding: 0.75rem; }
    .photo-meta { font-size: 0.875rem; color: #888; margin-bottom: 0.5rem; }
    .photo-details { font-size: 0.75rem; color: #aaa; display: flex; justify-content: space-between; margin-top: 0.5rem; }
    .loading { text-align: center; padding: 3rem; color: #ccc; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Pic</h1>
    </header>
    
    <div class="stats">
      <div class="stat">
        <div class="stat-value" id="total">-</div>
        <div class="stat-label">总图片数</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="categoryCount">-</div>
        <div class="stat-label">分类数</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="currentPage">-</div>
        <div class="stat-label">当前页码</div>
      </div>
      <div class="stat">
        <div class="stat-value" id="avgConfidence">-</div>
        <div class="stat-label">平均置信度</div>
      </div>
    </div>

    <div class="info-grid">
      <div class="info-card">
        <h3>系统信息</h3>
        <div class="info-item">
          <span class="info-label">最新下载</span>
          <span class="info-value" id="lastDownload">-</span>
        </div>
        <div class="info-item">
          <span class="info-label">首次下载</span>
          <span class="info-value" id="firstDownload">-</span>
        </div>
        <div class="info-item">
          <span class="info-label">数据源</span>
          <span class="info-value">Unsplash API</span>
        </div>
      </div>
      
      <div class="info-card">
        <h3>存储信息</h3>
        <div class="info-item">
          <span class="info-label">R2 存储桶</span>
          <span class="info-value">pic-r2</span>
        </div>
        <div class="info-item">
          <span class="info-label">D1 数据库</span>
          <span class="info-value">pic-d1</span>
        </div>
        <div class="info-item">
          <span class="info-label">Workflow</span>
          <span class="info-value">pic-wf</span>
        </div>
      </div>
      
      <div class="info-card">
        <h3>AI 模型</h3>
        <div class="info-item">
          <span class="info-label">Llama 3.2 3B</span>
          <span class="info-value">✓</span>
        </div>
        <div class="info-item">
          <span class="info-label">Llama 3.1 8B</span>
          <span class="info-value">✓</span>
        </div>
        <div class="info-item">
          <span class="info-label">Mistral 7B</span>
          <span class="info-value">✓</span>
        </div>
      </div>
    </div>

    <div class="info-card" style="margin: 1rem 0;">
      <h3>分类分布</h3>
      <div class="categories" id="categories"></div>
    </div>

    <div class="gallery" id="gallery">
      <div class="loading">加载中...</div>
    </div>
  </div>

  <script>
    function formatTime(isoString) {
      if (!isoString) return '-';
      const date = new Date(isoString);
      const now = new Date();
      const diff = Math.floor((now - date) / 1000);
      
      if (diff < 60) return \`\${diff}秒前\`;
      if (diff < 3600) return \`\${Math.floor(diff / 60)}分钟前\`;
      if (diff < 86400) return \`\${Math.floor(diff / 3600)}小时前\`;
      return date.toLocaleDateString('zh-CN');
    }

    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        
        document.getElementById('total').textContent = data.total;
        document.getElementById('categoryCount').textContent = data.categories.length;
        document.getElementById('currentPage').textContent = data.currentPage;
        document.getElementById('avgConfidence').textContent = data.avgConfidence ? (data.avgConfidence * 100).toFixed(1) + '%' : '-';
        document.getElementById('lastDownload').textContent = formatTime(data.lastDownload);
        document.getElementById('firstDownload').textContent = formatTime(data.firstDownload);
        
        document.getElementById('categories').innerHTML = data.categories
          .map(cat => \`<span class="cat-tag">\${cat.ai_category} (\${cat.count})</span>\`)
          .join('');
      } catch (e) {
        console.error(e);
      }
    }

    async function loadPhotos() {
      try {
        const res = await fetch('/api/photos?limit=30');
        const data = await res.json();
        
        const gallery = document.getElementById('gallery');
        if (data.photos.length === 0) {
          gallery.innerHTML = '<div class="loading">暂无图片</div>';
          return;
        }
        
        gallery.innerHTML = data.photos.map(photo => \`
          <div class="photo">
            <img src="/image/\${photo.r2_key}" alt="" loading="lazy">
            <div class="photo-info">
              <div class="photo-meta">\${photo.ai_category} · \${photo.photographer_name}</div>
              <div class="photo-details">
                <span>置信度: \${(photo.ai_confidence * 100).toFixed(1)}%</span>
                <span>\${photo.width}×\${photo.height}</span>
              </div>
            </div>
          </div>
        \`).join('');
      } catch (e) {
        console.error(e);
      }
    }

    loadStats();
    loadPhotos();
    setInterval(loadStats, 10000);
    setInterval(loadPhotos, 30000);
  </script>
</body>
</html>`;
