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
      const [globalStats, apiQuota, categoryStats, recentWorkflows] = await Promise.all([
        env.DB.prepare('SELECT * FROM GlobalStats WHERE id = 1').first(),
        env.DB.prepare('SELECT * FROM ApiQuota ORDER BY api_name').all(),
        env.DB.prepare('SELECT * FROM CategoryStats ORDER BY photo_count DESC LIMIT 10').all(),
        env.DB.prepare('SELECT * FROM WorkflowRuns ORDER BY started_at DESC LIMIT 5').all()
      ]);

      return Response.json({
        global: globalStats || {},
        apiQuota: apiQuota.results || [],
        categories: categoryStats.results || [],
        recentWorkflows: recentWorkflows.results || []
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
  <title>Pic - AI Photo Gallery</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #fafafa; color: #333; line-height: 1.6; }
    .container { max-width: 1400px; margin: 0 auto; padding: 2rem 1rem; }
    header { text-align: center; margin-bottom: 2rem; }
    h1 { font-size: 2rem; font-weight: 300; color: #333; margin-bottom: 0.5rem; }
    .subtitle { color: #999; font-size: 0.9rem; }
    
    .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 2rem 0; }
    .stat-card { background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 1.5rem; text-align: center; }
    .stat-value { font-size: 2rem; font-weight: 300; color: #333; margin-bottom: 0.25rem; }
    .stat-label { font-size: 0.85rem; color: #999; }
    .stat-sub { font-size: 0.75rem; color: #bbb; margin-top: 0.5rem; }
    
    .section { background: #fff; border: 1px solid #eee; border-radius: 8px; padding: 1.5rem; margin: 1.5rem 0; }
    .section-title { font-size: 1rem; font-weight: 500; color: #666; margin-bottom: 1rem; border-bottom: 1px solid #f0f0f0; padding-bottom: 0.5rem; }
    
    .api-quota { display: grid; gap: 1rem; }
    .quota-item { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: #fafafa; border-radius: 4px; }
    .quota-name { font-weight: 500; color: #333; }
    .quota-bar { flex: 1; margin: 0 1rem; height: 8px; background: #f0f0f0; border-radius: 4px; overflow: hidden; }
    .quota-fill { height: 100%; background: linear-gradient(90deg, #4CAF50, #8BC34A); transition: width 0.3s; }
    .quota-text { font-size: 0.85rem; color: #666; min-width: 120px; text-align: right; }
    .quota-reset { font-size: 0.75rem; color: #999; }
    
    .categories { display: flex; gap: 0.5rem; flex-wrap: wrap; }
    .cat-tag { padding: 0.5rem 1rem; background: #f5f5f5; border-radius: 20px; font-size: 0.85rem; color: #666; display: flex; align-items: center; gap: 0.5rem; }
    .cat-count { background: #fff; padding: 0.2rem 0.5rem; border-radius: 10px; font-weight: 500; }
    
    .workflow-list { display: grid; gap: 0.75rem; }
    .workflow-item { display: flex; justify-content: space-between; align-items: center; padding: 0.75rem; background: #fafafa; border-radius: 4px; font-size: 0.85rem; }
    .workflow-status { padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.75rem; font-weight: 500; }
    .status-success { background: #e8f5e9; color: #4CAF50; }
    .status-failed { background: #ffebee; color: #f44336; }
    .status-running { background: #e3f2fd; color: #2196F3; }
    
    .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; margin-top: 2rem; }
    .photo { background: #fff; border-radius: 8px; overflow: hidden; border: 1px solid #eee; transition: transform 0.2s; }
    .photo:hover { transform: translateY(-4px); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
    .photo img { width: 100%; height: 220px; object-fit: cover; display: block; }
    .photo-info { padding: 1rem; }
    .photo-category { display: inline-block; padding: 0.25rem 0.75rem; background: #f0f0f0; border-radius: 12px; font-size: 0.75rem; color: #666; margin-bottom: 0.5rem; }
    .photo-meta { font-size: 0.85rem; color: #666; margin: 0.5rem 0; }
    .photo-author { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.75rem; padding-top: 0.75rem; border-top: 1px solid #f5f5f5; }
    .photo-author-name { font-size: 0.85rem; color: #333; font-weight: 500; }
    .photo-details { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 0.75rem; font-size: 0.75rem; color: #999; }
    .loading { text-align: center; padding: 3rem; color: #ccc; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>📸 Pic Gallery</h1>
      <div class="subtitle">AI-Powered Photo Collection from Unsplash</div>
    </header>
    
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value" id="totalPhotos">-</div>
        <div class="stat-label">总图片数</div>
        <div class="stat-sub" id="totalStorage">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="totalCategories">-</div>
        <div class="stat-label">分类数</div>
        <div class="stat-sub" id="avgConfidence">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="totalWorkflows">-</div>
        <div class="stat-label">Workflow执行</div>
        <div class="stat-sub" id="workflowSuccess">-</div>
      </div>
      <div class="stat-card">
        <div class="stat-value" id="totalDownloads">-</div>
        <div class="stat-label">下载统计</div>
        <div class="stat-sub" id="downloadSuccess">-</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">API 配额状态</div>
      <div class="api-quota" id="apiQuota"></div>
    </div>

    <div class="section">
      <div class="section-title">分类分布 (Top 10)</div>
      <div class="categories" id="categories"></div>
    </div>

    <div class="section">
      <div class="section-title">最近 Workflow 执行</div>
      <div class="workflow-list" id="workflows"></div>
    </div>

    <div class="gallery" id="gallery">
      <div class="loading">加载中...</div>
    </div>
  </div>

  <script>
    function formatBytes(bytes) {
      if (!bytes) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    function formatTime(isoString) {
      if (!isoString) return '-';
      const date = new Date(isoString);
      const now = new Date();
      const diff = Math.floor((now - date) / 1000);
      
      if (diff < 60) return \`\${diff}秒前\`;
      if (diff < 3600) return \`\${Math.floor(diff / 60)}分钟前\`;
      if (diff < 86400) return \`\${Math.floor(diff / 3600)}小时前\`;
      return date.toLocaleDateString('zh-CN') + ' ' + date.toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'});
    }

    async function loadStats() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        const g = data.global;
        
        document.getElementById('totalPhotos').textContent = g.total_photos || 0;
        document.getElementById('totalStorage').textContent = formatBytes(g.total_storage_bytes);
        document.getElementById('totalCategories').textContent = g.total_categories || 0;
        document.getElementById('avgConfidence').textContent = 'AI置信度 ' + ((g.total_photos > 0 ? (g.successful_downloads / g.total_photos * 100) : 0).toFixed(1)) + '%';
        document.getElementById('totalWorkflows').textContent = g.total_workflows || 0;
        document.getElementById('workflowSuccess').textContent = \`成功 \${g.successful_workflows || 0} / 失败 \${g.failed_workflows || 0}\`;
        document.getElementById('totalDownloads').textContent = g.total_downloads || 0;
        document.getElementById('downloadSuccess').textContent = \`成功 \${g.successful_downloads || 0} / 跳过 \${g.skipped_downloads || 0}\`;
        
        // API Quota
        document.getElementById('apiQuota').innerHTML = data.apiQuota.map(api => {
          const percent = (api.calls_used / api.quota_limit * 100).toFixed(1);
          const resetTime = formatTime(api.next_reset_at);
          return \`
            <div class="quota-item">
              <div class="quota-name">\${api.api_name}</div>
              <div class="quota-bar">
                <div class="quota-fill" style="width: \${percent}%"></div>
              </div>
              <div class="quota-text">
                <div>\${api.calls_used} / \${api.quota_limit} (\${percent}%)</div>
                <div class="quota-reset">重置: \${resetTime}</div>
              </div>
            </div>
          \`;
        }).join('');
        
        // Categories
        document.getElementById('categories').innerHTML = data.categories.map(cat => \`
          <div class="cat-tag">
            <span>\${cat.category}</span>
            <span class="cat-count">\${cat.photo_count}</span>
          </div>
        \`).join('');
        
        // Workflows
        document.getElementById('workflows').innerHTML = data.recentWorkflows.map(wf => {
          const statusClass = wf.status === 'success' ? 'status-success' : wf.status === 'failed' ? 'status-failed' : 'status-running';
          return \`
            <div class="workflow-item">
              <div>
                <span class="workflow-status \${statusClass}">\${wf.status}</span>
                <span style="margin-left: 1rem;">Page \${wf.page}</span>
                <span style="margin-left: 1rem; color: #999;">\${wf.photos_success} 成功 / \${wf.photos_failed} 失败 / \${wf.photos_skipped} 跳过</span>
              </div>
              <div style="color: #999;">\${formatTime(wf.started_at)}</div>
            </div>
          \`;
        }).join('');
        
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
              <span class="photo-category">\${photo.ai_category}</span>
              <div class="photo-meta">
                \${photo.alt_description || photo.description || '无描述'}
              </div>
              <div class="photo-author">
                <div class="photo-author-name">📷 \${photo.photographer_name}</div>
              </div>
              <div class="photo-details">
                <div>📐 \${photo.width}×\${photo.height}</div>
                <div>❤️ \${photo.likes} likes</div>
                <div>\${photo.exif_make || '未知相机'}</div>
                <div>\${photo.photo_location_country || '未知地点'}</div>
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
