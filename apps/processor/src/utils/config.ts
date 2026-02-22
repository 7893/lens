import { DBSystemConfig } from '@lens/shared';

export async function getConfig(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare('SELECT value FROM system_config WHERE key = ?').bind(key).first<DBSystemConfig>();
  return row?.value ?? null;
}

export async function setConfig(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(
      'INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .bind(key, value, Date.now())
    .run();
}
