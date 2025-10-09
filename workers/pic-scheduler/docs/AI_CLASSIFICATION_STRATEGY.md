# 🤖 AI分类策略说明

## 📋 分类优先级（三级）

### 优先级1：AI自由分类 ⭐⭐⭐
- **使用4个非微软AI模型**（多数投票）
- **完全自由** - AI返回什么分类就用什么
- **无预设限制** - 不限制在固定的10个分类
- **格式规范** - 小写、空格转连字符

### 优先级2：图片自带分类 ⭐⭐
- 使用Unsplash API的 `topic_submissions`
- 或使用第一个 `tag`
- 格式统一为小写、连字符

### 优先级3：未分类 ⭐
- 如果AI和图片都无法提供分类
- 保留在 `uncategorized` 文件夹

## 🤖 使用的AI模型（4个）

| 模型 | 提供商 | 说明 |
|------|--------|------|
| Llama 3.1 8B | Meta | 最新版本 |
| Llama 3 8B | Meta | 稳定版本 |
| Mistral 7B | Mistral AI | 欧洲开源模型 |
| Gemma 7B | Google | 谷歌轻量模型 |

**投票机制：** 4个模型都尝试分类，返回最常见的结果

## 🔄 工作流程

### 新下载图片：
```
1. 下载图片 → 保存到 images/uncategorized/{id}.jpg
2. 调用4个AI模型进行分类
   ├─ 成功 → 使用AI分类（优先级1）
   └─ 失败 → 使用图片自带分类（优先级2）
3. 移动文件到 images/{category}/{id}.jpg
4. 写入数据库
```

### 历史数据迁移：
```
1. 读取数据库所有记录
2. 对每条记录：
   ├─ 调用AI重新分类（基于description）
   └─ AI失败 → 保持uncategorized
3. 移动R2文件到新路径
4. 更新数据库记录
```

## 📊 AI分类示例

### AI可能返回的分类（动态）：
```
自然类：nature, sunset, sunrise, landscape, wildlife, ocean, mountain
建筑类：architecture, building, interior, cityscape, urban
人物类：people, portrait, fashion, beauty, street-photography
艺术类：art, abstract, minimalist, vintage, 3d-renders
食物类：food, coffee, restaurant, cooking
科技类：technology, computer, phone, digital
运动类：sports, fitness, athletics
商务类：business, office, work
旅行类：travel, vacation, tourism
其他：wallpapers, textures-patterns, experimental, film...
```

**关键点：** 分类数量是动态的，由AI和图片内容决定

## 🎯 与旧逻辑的区别

### 旧逻辑（问题）：
```javascript
// 硬编码10个分类
validCategories = ['nature', 'architecture', 'people', ...]

// AI返回的分类必须在这10个里
if (validCategories.includes(aiResult)) {
  return aiResult;
} else {
  return fallback(); // 使用关键词匹配
}
```

### 新逻辑（正确）：
```javascript
// 无预设分类限制

// AI返回什么就用什么
const aiResult = await ai.classify(...);
if (aiResult) {
  return aiResult; // 可能是任何分类
} else {
  return photoCategory || 'uncategorized';
}
```

## 📈 预期效果

### 分类数量：
- **旧系统：** 27个混乱分类（中文+英文+各种格式）
- **新系统：** 20-40个动态分类（全英文，格式统一）

### 分类质量：
- **AI识别：** 70-80%（基于description和tags）
- **图片自带：** 15-20%（API提供）
- **未分类：** 5-10%（无法识别）

### 分类示例分布（预测）：
```
nature: 80-120张
architecture: 60-100张
people: 60-90张
sunset: 40-60张
portrait: 30-50张
street-photography: 30-50张
abstract: 30-50张
food: 20-40张
cityscape: 20-30张
minimalist: 15-25张
... 其他动态分类
uncategorized: 30-50张
```

## 🔧 AI Prompt设计

```
Classify this image into ONE category. 
Return only a single word or short phrase (lowercase, use hyphens for spaces).

Description: "{description}"
Tags: {tags}

Return only the category name 
(examples: nature, architecture, street-photography, sunset, portrait, abstract, food, technology):
```

**关键设计：**
- 不限制分类选项
- 给出示例引导格式
- 要求简短、小写、连字符

## ⚙️ 配置参数

```javascript
// AI模型配置
models: [
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/meta/llama-3-8b-instruct',
  '@cf/mistral/mistral-7b-instruct-v0.1',
  '@cf/google/gemma-7b-it'
]

// AI参数
max_tokens: 15      // 足够返回分类名
temperature: 0.1    // 低温度，更确定性
```

## 🎨 分类格式规范

### 格式化规则：
1. **小写** - `Nature` → `nature`
2. **空格转连字符** - `Street Photography` → `street-photography`
3. **去除特殊字符** - `Art & Design` → `art-design`
4. **长度限制** - 最多50字符

### 示例转换：
```
"Sunset" → "sunset"
"Street Photography" → "street-photography"
"3D Renders" → "3d-renders"
"Food & Drink" → "food-drink"
"Architecture Interior" → "architecture-interior"
```

## 📝 日志输出

```
Image abc123 classified as: sunset (source: ai)
Image def456 classified as: street-photography (source: photo)
Image ghi789 classified as: uncategorized (source: none)
```

**source字段说明：**
- `ai` - AI模型识别
- `photo` - 图片自带分类
- `none` - 无法分类

## 🚀 部署后效果

### 新下载的图片：
- 自动使用新的三级优先级策略
- 大部分由AI自由分类
- 少部分使用图片自带分类
- 极少数保持未分类

### 历史数据迁移：
- 795张图片重新AI分类
- 基于原始description
- 无法获取原始photo对象，只能依赖AI
- AI失败的保持uncategorized

## 💡 优势

1. **灵活性** - 分类随内容动态增长
2. **准确性** - 4个AI模型投票，更可靠
3. **可扩展** - 无需修改代码即可支持新分类
4. **标准化** - 统一的格式规范
5. **可追溯** - 记录分类来源（ai/photo/none）

## 🔍 监控建议

### 定期检查：
```bash
# 查看分类分布
curl "https://your-worker.workers.dev/api/category-stats"

# 查看uncategorized数量
wrangler d1 execute pic-db --remote --command \
  "SELECT COUNT(*) FROM downloads WHERE category = 'uncategorized'"

# 查看分类来源统计（需要添加字段）
# 可以通过R2 customMetadata的classificationSource字段统计
```

### 优化方向：
- 如果uncategorized过多 → 调整AI prompt
- 如果分类过于分散 → 考虑合并相似分类
- 如果AI失败率高 → 检查模型配额或切换模型

---

**总结：** 新策略让AI自由发挥，分类由内容决定，不再受限于预设列表。
