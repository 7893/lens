import { createConnection } from 'mysql2/promise';

const MYSQL_DIALECT_SYMBOL = Symbol.for('lens.mysql.dialect');

export interface MysqlTaggedDatabase extends D1Database {
  readonly [MYSQL_DIALECT_SYMBOL]?: true;
}

export interface MysqlResultHeader {
  affectedRows?: number;
  insertId?: number;
}

export interface MysqlFieldPacket {
  name: string;
}

export interface MysqlClientConnection {
  query(
    sql: string | { sql: string; values?: unknown[]; rowsAsArray?: boolean },
    values?: unknown[],
  ): Promise<[unknown[] | MysqlResultHeader, MysqlFieldPacket[]]>;
  beginTransaction(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  end(): Promise<void>;
  destroy(): void;
}

export type ConnectionFactory = () => Promise<MysqlClientConnection>;

export function isMysqlDatabase(db: unknown): boolean {
  return Boolean(db && typeof db === 'object' && Reflect.get(db, MYSQL_DIALECT_SYMBOL) === true);
}

/**
 * Translates SQLite/D1 SQL idioms used in Lens into MySQL 8/9 compatible SQL.
 */
export function translateSqlForMysql(sql: string): string {
  let out = sql;

  // 1. SQLite INSERT OR IGNORE -> MySQL INSERT IGNORE
  out = out.replace(/\bINSERT\s+OR\s+IGNORE\s+INTO\b/gi, 'INSERT IGNORE INTO');

  // 2. SQLite strftime('%s','now')*1000 -> MySQL (UNIX_TIMESTAMP() * 1000)
  out = out.replace(/strftime\(\s*'%s'\s*,\s*'now'\s*\)\s*\*\s*1000/gi, '(UNIX_TIMESTAMP() * 1000)');

  // 3. Quote MySQL reserved word `key` on system_config & runtime_config
  if (/\bsystem_config\b/i.test(out)) {
    out = out.replace(/\(\s*key\s*,\s*value\s*,/gi, '(`key`, `value`,');
    out = out.replace(
      /\bSELECT\s+key\s*,\s*value\s+FROM\s+system_config\b/gi,
      'SELECT `key`, `value` FROM system_config',
    );
    out = out.replace(/\bWHERE\s+key\b/gi, 'WHERE `key`');
  }
  if (/\bruntime_config\b/i.test(out)) {
    out = out.replace(/\(\s*key\s*,\s*version\b/gi, '(`key`, version');
    out = out.replace(/\bSELECT\s+key\s*,\s*version\b/gi, 'SELECT `key`, version');
    out = out.replace(/\bWHERE\s+key\b/gi, 'WHERE `key`');
  }

  // 4. SQLite ON CONFLICT(...) DO UPDATE SET -> MySQL ON DUPLICATE KEY UPDATE
  if (/\bON\s+CONFLICT\s*\([^)]+\)\s+DO\s+UPDATE\s+SET\b/i.test(out)) {
    out = out.replace(/\bON\s+CONFLICT\s*\([^)]+\)\s+DO\s+UPDATE\s+SET\b/gi, 'ON DUPLICATE KEY UPDATE');
    out = out.replace(/\bexcluded\.([a-zA-Z0-9_`]+)/g, 'VALUES($1)');
  }

  return out;
}

function defaultHyperdriveConnectionFactory(hd: Hyperdrive): ConnectionFactory {
  return async () =>
    (await createConnection({
      host: hd.host,
      port: hd.port,
      user: hd.user,
      password: hd.password,
      database: hd.database,
      disableEval: true,
      connectTimeout: 12_000,
      supportBigNumbers: true,
      bigNumberStrings: false,
      decimalNumbers: true,
      timezone: 'Z',
    })) as unknown as MysqlClientConnection;
}

async function safeClose(conn: MysqlClientConnection): Promise<void> {
  try {
    await conn.end();
  } catch {
    conn.destroy();
  }
}

function buildD1Meta(changes = 0, lastRowId = 0): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

class MysqlPreparedStatement implements D1PreparedStatement {
  private readonly translatedSql: string;
  private readonly params: unknown[];

  constructor(
    private readonly openConnection: ConnectionFactory,
    rawSql: string,
    params: unknown[] = [],
  ) {
    this.translatedSql = translateSqlForMysql(rawSql);
    this.params = params.map((v) => (v === undefined ? null : v));
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new MysqlPreparedStatement(this.openConnection, this.translatedSql, values);
  }

  async executeOnConnection<T = Record<string, unknown>>(conn: MysqlClientConnection): Promise<D1Result<T>> {
    const [result] = await conn.query(this.translatedSql, this.params);
    if (Array.isArray(result)) {
      return {
        results: result as T[],
        success: true,
        meta: buildD1Meta(0, 0),
      };
    }
    return {
      results: [],
      success: true,
      meta: buildD1Meta(result.affectedRows ?? 0, result.insertId ?? 0),
    };
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const conn = await this.openConnection();
    try {
      return await this.executeOnConnection<T>(conn);
    } finally {
      await safeClose(conn);
    }
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return await this.all<T>();
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const res = await this.all<Record<string, unknown>>();
    const row = res.results[0];
    if (!row) return null;
    if (colName !== undefined) {
      const val = row[colName];
      return (val === undefined ? null : val) as T;
    }
    return row as unknown as T;
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const conn = await this.openConnection();
    try {
      const [rows, fields] = await conn.query({
        sql: this.translatedSql,
        values: this.params,
        rowsAsArray: true,
      });
      const arrRows = (Array.isArray(rows) ? rows : []) as T[];
      if (options?.columnNames) {
        const names = Array.isArray(fields) ? fields.map((f) => f.name) : [];
        return [names, ...arrRows];
      }
      return arrRows;
    } finally {
      await safeClose(conn);
    }
  }
}

export function createMysqlDatabase(hyperdriveOrFactory: Hyperdrive | ConnectionFactory): MysqlTaggedDatabase {
  const openConnection =
    typeof hyperdriveOrFactory === 'function'
      ? hyperdriveOrFactory
      : defaultHyperdriveConnectionFactory(hyperdriveOrFactory);

  const db: MysqlTaggedDatabase = {
    [MYSQL_DIALECT_SYMBOL]: true,

    prepare(query: string): D1PreparedStatement {
      return new MysqlPreparedStatement(openConnection, query);
    },

    async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
      if (statements.length === 0) return [];
      const conn = await openConnection();
      try {
        await conn.beginTransaction();
        const results: D1Result<T>[] = [];
        for (const stmt of statements) {
          if (stmt instanceof MysqlPreparedStatement) {
            results.push(await stmt.executeOnConnection<T>(conn));
          } else {
            results.push(await stmt.all<T>());
          }
        }
        await conn.commit();
        return results;
      } catch (err) {
        try {
          await conn.rollback();
        } catch {
          // ignore rollback error
        }
        throw err;
      } finally {
        await safeClose(conn);
      }
    },

    async exec(query: string): Promise<D1ExecResult> {
      const start = Date.now();
      const statements = query
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean);
      const conn = await openConnection();
      try {
        for (const stmt of statements) {
          await conn.query(translateSqlForMysql(stmt));
        }
        return {
          count: statements.length,
          duration: Date.now() - start,
        };
      } finally {
        await safeClose(conn);
      }
    },

    withSession(): D1DatabaseSession {
      return db as unknown as D1DatabaseSession;
    },

    async dump(): Promise<ArrayBuffer> {
      throw new Error('dump() is not supported on MySQL Hyperdrive adapter');
    },
  };

  return db;
}

/**
 * Injects the MySQL Hyperdrive D1-compatible adapter into `env.DB` whenever `env.HYPERDRIVE` is bound.
 * Falls back transparently to `env.DB` when `HYPERDRIVE` is absent (e.g. unit tests or D1 fallback).
 */
export function withDatabase<T extends { DB: D1Database; HYPERDRIVE?: Hyperdrive }>(env: T): T {
  if (!env.HYPERDRIVE || isMysqlDatabase(env.DB)) {
    return env;
  }
  return {
    ...env,
    DB: createMysqlDatabase(env.HYPERDRIVE),
  };
}
