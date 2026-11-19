import { describe, it, expect, vi } from 'vitest';
import { Logger, createTrace } from '@lens/shared';
import {
  createMysqlDatabase,
  isMysqlDatabase,
  type MysqlClientConnection,
  translateSqlForMysql,
  withDatabase,
} from '../src/platform/cloudflare/mysql';
import { FtsCandidateSource } from '../src/modules/retrieval/sources/fts';
import { normalizeSearchSpec } from '../src/modules/retrieval/SearchService';

describe('MySQL Hyperdrive Adapter & SQL Translator', () => {
  it('translates SQLite idioms (INSERT OR IGNORE, ON CONFLICT, strftime, reserved key) into MySQL', () => {
    expect(translateSqlForMysql('INSERT OR IGNORE INTO consumed_events (consumer, event_id) VALUES (?, ?)')).toBe(
      'INSERT IGNORE INTO consumed_events (consumer, event_id) VALUES (?, ?)',
    );

    const upsert = translateSqlForMysql(
      'INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    );
    expect(upsert).toContain('INSERT INTO system_config (`key`, `value`, updated_at)');
    expect(upsert).toContain('ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)');

    const statsSql = translateSqlForMysql(
      "SELECT SUM(CASE WHEN created_at > strftime('%s','now')*1000 - 86400000 THEN 1 ELSE 0 END) FROM images",
    );
    expect(statsSql).toContain('(UNIX_TIMESTAMP() * 1000) - 86400000');

    const cfgSelect = translateSqlForMysql("SELECT key, value FROM system_config WHERE key IN ('last_seen_id')");
    expect(cfgSelect).toBe("SELECT `key`, `value` FROM system_config WHERE `key` IN ('last_seen_id')");
  });

  it('executes queries, first(), run(), and transactional batch() while closing connections cleanly', async () => {
    const queryMock = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT')) {
        return [[{ id: 'img-1', caption: 'alpine peak' }], []];
      }
      return [{ affectedRows: 1, insertId: 42 }, []];
    });
    const beginMock = vi.fn().mockResolvedValue(undefined);
    const commitMock = vi.fn().mockResolvedValue(undefined);
    const rollbackMock = vi.fn().mockResolvedValue(undefined);
    const endMock = vi.fn().mockResolvedValue(undefined);

    const fakeConn = {
      query: queryMock,
      beginTransaction: beginMock,
      commit: commitMock,
      rollback: rollbackMock,
      end: endMock,
      destroy: vi.fn(),
    } as unknown as MysqlClientConnection;

    const db = createMysqlDatabase(async () => fakeConn);
    expect(isMysqlDatabase(db)).toBe(true);

    const row = await db.prepare('SELECT id, caption FROM images WHERE id = ?').bind('img-1').first<{ id: string }>();
    expect(row?.id).toBe('img-1');
    expect(endMock).toHaveBeenCalledTimes(1);

    const col = await db.prepare('SELECT id, caption FROM images WHERE id = ?').bind('img-1').first<string>('caption');
    expect(col).toBe('alpine peak');

    const batchRes = await db.batch([
      db.prepare('INSERT OR IGNORE INTO assets (id) VALUES (?)').bind('ast_1'),
      db.prepare('UPDATE images SET vectorize_synced = 1 WHERE id = ?').bind('img-1'),
    ]);
    expect(batchRes).toHaveLength(2);
    expect(beginMock).toHaveBeenCalledTimes(1);
    expect(commitMock).toHaveBeenCalledTimes(1);
    expect(rollbackMock).not.toHaveBeenCalled();
  });

  it('routes FtsCandidateSource to MySQL FULLTEXT for English and LIKE for CJK when MySQL adapter is active', async () => {
    const queryMock = vi.fn().mockResolvedValue([[{ id: 'p1' }, { id: 'p2' }], []]);
    const fakeConn = {
      query: queryMock,
      end: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn(),
    } as unknown as MysqlClientConnection;

    const db = createMysqlDatabase(async () => fakeConn);
    const fts = new FtsCandidateSource(db, new Logger(createTrace('FTS_MYSQL_TEST')));

    const enMatches = await fts.recall(normalizeSearchSpec('mountain lake'));
    expect(enMatches).toHaveLength(2);
    expect(queryMock.mock.calls[0][0]).toContain('MATCH(ai_caption, ai_tags, photographer, location, alt_description)');
    expect(queryMock.mock.calls[0][1]).toEqual(['mountain lake']);

    const cjkMatches = await fts.recall(normalizeSearchSpec('富士山'));
    expect(cjkMatches).toHaveLength(2);
    expect(queryMock.mock.calls[1][0]).toContain('ai_caption LIKE ?');
    expect(queryMock.mock.calls[1][1]).toEqual(['%富士山%', '%富士山%', '%富士山%', '%富士山%', '%富士山%']);
  });

  it('withDatabase injects MySQL adapter only when HYPERDRIVE binding is present', () => {
    const legacyD1 = { prepare: vi.fn() } as unknown as D1Database;
    const withoutHd = withDatabase({ DB: legacyD1 });
    expect(withoutHd.DB).toBe(legacyD1);
    expect(isMysqlDatabase(withoutHd.DB)).toBe(false);

    const withHd = withDatabase({
      DB: legacyD1,
      HYPERDRIVE: {
        connectionString: 'mysql://u:p@h:3306/lens',
        host: 'h',
        port: 3306,
        user: 'u',
        password: 'p',
        database: 'lens',
      } as unknown as Hyperdrive,
    });
    expect(isMysqlDatabase(withHd.DB)).toBe(true);
  });
});
