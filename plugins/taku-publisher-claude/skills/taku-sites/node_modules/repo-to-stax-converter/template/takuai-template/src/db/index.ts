import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

type DrizzleDb = ReturnType<typeof drizzle>;

function resolveDbFilePath(): string {
  const envPath = String(process.env.DB_FILE_NAME ?? '').trim();
  if (envPath) return envPath;

  // Default: keep app data under a dedicated writable folder.
  // Avoid polluting project root and avoid browser-localStorage split-brain.
  return path.join(process.cwd(), '.taku', 'data', 'db.sqlite');
}

let sqlite: Database.Database | null = null;
let db: DrizzleDb | null = null;

function isSqliteBusy(err: unknown): boolean {
  const code = (err as any)?.code;
  if (code === 'SQLITE_BUSY') return true;
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.toLowerCase().includes('database is locked');
}

function initDbOnce(): DrizzleDb {
  if (db) return db;

  const dbFilePath = resolveDbFilePath();
  // Helpful diagnostics: make it obvious which DB file this subapp instance is using.
  // (If you see different paths across subapps, you're effectively using multiple DB files.)
  // biome-ignore lint/suspicious/noConsole: template diagnostics
  console.log('\x1b[36m%s\x1b[0m', '[TAKUAI-DB]', `dbFile=${dbFilePath}`);

  fs.mkdirSync(path.dirname(dbFilePath), { recursive: true });

  sqlite = new Database(dbFilePath);

  // SQLite busy timeout (ms): mitigate transient lock contention on startup/build overlap.
  sqlite.pragma('busy_timeout = 5000');
  // Enable WAL for better concurrency
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');

  // Minimal schema bootstrap (no migrations configured in the template)
  // NOTE: keep in sync with `src/db/schema.ts`
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS taku_items (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (collection, id)
    );
    CREATE INDEX IF NOT EXISTS idx_taku_items_collection_updated_at ON taku_items(collection, updated_at);
    CREATE INDEX IF NOT EXISTS idx_taku_items_collection_created_at ON taku_items(collection, created_at);
  `);

  db = drizzle(sqlite);
  return db;
}

/**
 * 获取 Drizzle DB（懒加载）。
 *
 * 重要：避免在模块 import 阶段就打开 sqlite（Next build/route bundling 可能触发 import），
 * 否则在 preview/edit 并发、或 build 阶段收集数据时容易遇到 SQLITE_BUSY。
 */
export function getDb(): DrizzleDb {
  // Best-effort retry (sync). better-sqlite3 APIs are sync.
  const maxAttempts = 3;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return initDbOnce();
    } catch (err) {
      lastErr = err;
      if (!isSqliteBusy(err) || attempt === maxAttempts) break;
      // Small backoff (blocking): avoid depending on async in init path
      const end = Date.now() + 200 * attempt;
      while (Date.now() < end) {
        // spin
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr ?? 'Failed to init DB'));
}

export function closeDb(): void {
  try {
    sqlite?.close();
  } catch {
    // ignore
  } finally {
    sqlite = null;
    db = null;
  }
}
