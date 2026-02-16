# 常见问题与故障排查 (FAQ & Troubleshooting)

本文档汇集了 Pic 项目开发和部署过程中可能遇到的问题及其解决方案。

## 🔴 部署与启动问题

### 1. `wrangler deploy` 失败：`Error: No such file or directory`

**可能原因**：
- 未在正确的目录下运行命令。
- `wrangler.toml` 文件缺失或路径错误。

**解决方案**：
- 确保你在 `workers/pic-scheduler` 目录下运行 `wrangler deploy`，或者在项目根目录下运行 `npm run deploy`。
- 检查 `wrangler.toml` 是否存在。

### 2. `D1 database not found`

**可能原因**：
- 未创建 D1 数据库。
- `wrangler.toml` 中的 `database_id` 未正确填写。

**解决方案**：
- 运行 `wrangler d1 create pic-d1`。
- 将输出的 ID 复制到 `wrangler.toml` 的 `database_id` 字段。

### 3. Workflow 无法触发

**症状**：
- 手动触发 API 返回成功，但没有图片入库。
- Cron Trigger 无反应。

**排查步骤**：
1.  **检查日志**：`wrangler tail pic` 查看实时日志。
2.  **检查 Workflows 面板**：在 Cloudflare Dashboard -> Workers & Pages -> pic -> Workflows 中查看执行历史。
    - 如果状态一直为 `Pending` 或 `Queued`，可能是 Cloudflare 侧资源紧张（Beta 阶段常见）。
    - 如果状态为 `Error`，点击查看具体错误信息。

---

## 🟡 运行时错误

### 1. Unsplash API 403 Forbidden

**症状**：
- 日志中出现 `FetchError: 403 Forbidden`。
- Workflow 第一步下载图片失败。

**原因**：
- API Key 无效或未设置。
- API 调用次数超限（Demo 应用每小时 50 次）。

**解决方案**：
- 确认 `wrangler secret list` 中包含 `UNSPLASH_API_KEY`。
- 登录 Unsplash 开发者后台查看应用状态。
- 降低 Cron 频率（例如改为每 2 小时一次）。

### 2. R2 存储相关错误 (404/500)

**症状**：
- 图片上传失败。
- 前端图片加载失败（404）。

**原因**：
- R2 Bucket 名称不匹配。
- 权限不足（虽然单体 Worker通常自动拥有权限）。

**解决方案**：
- 检查 `wrangler.toml` 中的 `bucket_name` 是否与实际创建的 Bucket 一致（默认为 `pic-r2`）。
- 确保 Bucket 已创建：`wrangler r2 bucket list`。

### 3. AI 分类结果不准确

**症状**：
- 风景图被识别为 "person"。

**原因**：
- 使用的 AI 模型（如 ResNet-50）对特定场景识别能力有限。
- 图片压缩过度导致细节丢失。

**优化建议**：
- 尝试更换更高级的模型（如 ViT，注意成本）。
- 在 `src/workflows/data-pipeline.js` 中调整 AI 调用参数。

---

## 🟢 性能与监控

### 如何查看实时日志？

```bash
wrangler tail pic
# 或者格式化输出
wrangler tail pic --format=pretty
```

### 如何手动清理数据？

如果需要清空所有数据重新开始：

1.  **清空数据库**：
    ```bash
    wrangler d1 execute pic-d1 --remote --command "DELETE FROM Photos; DELETE FROM GlobalStats;"
    ```
2.  **清空 R2**（需谨慎）：
    - 建议在 Cloudflare Dashboard 中操作 R2 Bucket 删除文件。
    - 或使用脚本遍历删除。

---

## 🔵 寻求帮助

如果以上方法无法解决你的问题：

1.  请检查 [GitHub Issues](https://github.com/your-username/pic/issues) 是否有类似问题。
2.  提交 Issue 时，请提供：
    - `wrangler version`
    - 错误日志截图或文本
    - 复现步骤
