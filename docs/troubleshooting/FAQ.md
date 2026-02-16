# FAQ & Troubleshooting

## Deployment Issues

### `wrangler deploy` fails with "No such file"
- Run from `workers/pic-scheduler/` or use `npm run deploy` from project root.
- Verify `wrangler.toml` exists.

### `D1 database not found`
- Run `wrangler d1 create pic-d1`.
- Copy the `database_id` into `wrangler.toml`.

### CI fails with "Unable to locate executable file: pnpm"
- Ensure there is no `pnpm-lock.yaml` in the project. The project uses npm.
- `wrangler-action` auto-detects package manager from lock files.

### Workflow not triggering
1. Check logs: `wrangler tail pic`
2. Check Cloudflare Dashboard → Workers → pic → Workflows for execution history.
3. If stuck in `Pending`/`Queued`, this may be a Cloudflare-side issue (common in beta).

## Runtime Errors

### Unsplash API 403 Forbidden
- Verify secret: `wrangler secret list` should show `UNSPLASH_API_KEY`.
- Check quota: free tier is 50 requests/hour. View usage at Unsplash developer dashboard.
- Reduce cron frequency if needed.

### R2 errors (404/500)
- Verify bucket name in `wrangler.toml` matches actual bucket: `wrangler r2 bucket list`.
- Check R2 key format: `{category}/{unsplash_id}.jpg`.

### AI classification inaccurate
- The default model may have limited accuracy for certain scenes.
- Classification logic is in `src/services/ai-classifier.ts` and `src/tasks/classify-with-model.ts`.

## Monitoring

### Real-time logs

```bash
wrangler tail pic --format=pretty
```

### Manual data cleanup

```bash
# Clear all photos
wrangler d1 execute pic-d1 --remote --command "DELETE FROM Photos; UPDATE GlobalStats SET total_photos = 0;"

# Clear R2 — use Cloudflare Dashboard or the utility script:
npx tsx workers/pic-scheduler/scripts/clear-r2-bucket.ts
```

## Getting Help

1. Check [GitHub Issues](https://github.com/your-username/pic/issues).
2. When filing an issue, include: `wrangler --version`, error logs, and reproduction steps.
