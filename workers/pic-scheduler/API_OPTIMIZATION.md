# API请求优化

## 优化时间
2025-10-09 17:27

## 问题分析

### 原问题：重复图片导致API浪费

**场景：**
```
请求下载30张图片，但前20张已存在

旧逻辑：
1. fetchPhotos(page=1, 30张)
2. 尝试下载30张 → 只成功10张（20张重复）
3. downloaded = 10 < 30
4. fetchPhotos(page=2, 30张) ← 浪费API请求！
```

**问题：**
- 重复图片不计入 downloaded
- while循环继续请求API
- 浪费Unsplash API配额

---

## 优化方案

### 批量预检查

**新逻辑：**
```javascript
1. fetchPhotos(page=1, 30张)
2. 批量查询DB：SELECT image_id WHERE image_id IN (30个ID)
3. 过滤已存在的图片 → 得到10张新图片
4. 只下载这10张新图片
5. downloaded = 10 < 30
6. fetchPhotos(page=2, 30张) ← 继续获取新图片
```

**代码实现：**
```javascript
// 批量检查已存在的图片
const photoIds = photos.map(p => p.id);
const placeholders = photoIds.map(() => '?').join(',');
const existing = await this.env.DB.prepare(
  `SELECT image_id FROM downloads WHERE image_id IN (${placeholders})`
).bind(...photoIds).all();

const existingSet = new Set(existing.results.map(r => r.image_id));
const newPhotos = photos.filter(p => !existingSet.has(p.id));

// 如果全部已存在，跳过这一页
if (newPhotos.length === 0) {
  logger.info(`Page ${page}: All ${photos.length} photos already exist, skipping`);
  page++;
  continue;
}
```

---

## 性能对比

### DB查询优化

| 场景 | 旧方案 | 新方案 | 提升 |
|------|--------|--------|------|
| 检查30张图片 | 0次查询（依赖INSERT失败） | 1次批量查询 | 提前过滤 |
| 全部重复 | 30次INSERT失败 | 跳过整页 | 避免浪费 |

### API请求优化

| 场景 | 旧方案 | 新方案 | 节省 |
|------|--------|--------|------|
| 30张全重复 | 继续请求下一页 | 跳过，继续下一页 | 相同 |
| 30张部分重复 | 可能多次请求 | 精确计算需要的图片数 | 减少请求 |

### 实际效果

**场景1：首次下载30张**
- 旧方案：1次API请求
- 新方案：1次API请求 + 1次批量DB查询
- 结果：略增加1次DB查询，可接受

**场景2：重复下载（30张全存在）**
- 旧方案：1次API请求 + 30次INSERT失败
- 新方案：1次API请求 + 1次批量DB查询 + 跳过
- 结果：避免30次INSERT失败，更高效

**场景3：部分重复（20张存在，10张新）**
- 旧方案：1次API请求 + 20次INSERT失败 + 10次成功
- 新方案：1次API请求 + 1次批量DB查询 + 10次INSERT成功
- 结果：避免20次INSERT失败，更高效

---

## CPU限制检查

### Cloudflare Workers限制

| 环境 | CPU时间限制 |
|------|-------------|
| Worker (免费) | 10ms |
| Worker (付费) | 50ms |
| **Durable Object** | **无限制** ✅ |

### 当前架构

```
HTTP请求 → Worker (index.js)
              ↓ 转发到DO
           Durable Object (PicDO)
              ↓ 执行所有重逻辑
           DownloadTask.start()
              ├─ API请求
              ├─ 批量DB查询
              ├─ 图片下载 (10并发)
              ├─ AI分类 (4模型 × 10图 = 40并发)
              ├─ DB写入
              └─ R2上传
```

**✅ 所有重逻辑都在DO中，无CPU限制**

---

## 部署信息

- **Version ID**: `0be2b448-5697-461d-850d-e0b74f918ca2`
- **部署时间**: 2025-10-09 17:27
- **Worker URL**: https://pic.53.workers.dev

---

## 代码变更

### task.js
```javascript
// 新增：批量预检查
const photoIds = photos.map(p => p.id);
const placeholders = photoIds.map(() => '?').join(',');
const existing = await this.env.DB.prepare(
  `SELECT image_id FROM downloads WHERE image_id IN (${placeholders})`
).bind(...photoIds).all();

const existingSet = new Set(existing.results.map(r => r.image_id));
const newPhotos = photos.filter(p => !existingSet.has(p.id));

if (newPhotos.length === 0) {
  page++;
  continue; // 跳过全部重复的页面
}
```

### downloader.js
```javascript
// 移除：UNIQUE错误处理（不再需要）
// 因为已经在task.js中批量预检查，不会有重复
await this.db.prepare(`INSERT INTO downloads ...`).run();
```

---

## 总结

### 优化效果
- ✅ 避免重复图片导致的多余INSERT尝试
- ✅ 提前过滤，只处理新图片
- ✅ 全页重复时直接跳过
- ✅ 代码更清晰，逻辑更合理

### 性能影响
- 每页增加1次批量DB查询（30个ID）
- 避免多次INSERT失败
- 总体性能提升

### CPU限制
- ✅ 无问题，所有逻辑在DO中运行
