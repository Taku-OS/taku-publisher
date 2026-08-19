import 'server-only';

import { and, desc, eq } from 'drizzle-orm';

import { getDb } from '@/db';
import { type TakuItemInsert, type TakuItemRow, takuItems } from '@/db/schema';

import type { TakuCollectionItem } from './types';

function parseJson<T>(input: string): T {
  return JSON.parse(input) as T;
}

function rowToItem<T>(row: TakuItemRow): TakuCollectionItem<T> {
  return {
    collection: row.collection,
    id: row.id,
    data: parseJson<T>(row.data),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCollection<T>(collection: string): Promise<Array<TakuCollectionItem<T>>> {
  const db = getDb();
  const rows = await db
    .select()
    .from(takuItems)
    .where(eq(takuItems.collection, collection))
    .orderBy(desc(takuItems.updatedAt))
    .all();
  return rows.map((r) => rowToItem<T>(r));
}

export async function getItem<T>(
  collection: string,
  id: string
): Promise<TakuCollectionItem<T> | null> {
  const db = getDb();
  const row = await db
    .select()
    .from(takuItems)
    .where(and(eq(takuItems.collection, collection), eq(takuItems.id, id)))
    .get();
  return row ? rowToItem<T>(row) : null;
}

export async function upsertItem<T>(params: {
  collection: string;
  id: string;
  data: T;
}): Promise<TakuCollectionItem<T>> {
  const db = getDb();
  const now = new Date();
  const values: TakuItemInsert = {
    collection: params.collection,
    id: params.id,
    data: JSON.stringify(params.data ?? null),
    createdAt: now,
    updatedAt: now,
  };

  // drizzle sqlite supports onConflictDoUpdate on better-sqlite3
  await db
    .insert(takuItems)
    .values(values)
    .onConflictDoUpdate({
      target: [takuItems.collection, takuItems.id],
      set: {
        data: values.data,
        updatedAt: now,
      },
    })
    .run();

  const saved = await getItem<T>(params.collection, params.id);
  if (!saved) throw new Error('Failed to load saved item');
  return saved;
}

export async function deleteItem(collection: string, id: string): Promise<boolean> {
  const db = getDb();
  const res = await db
    .delete(takuItems)
    .where(and(eq(takuItems.collection, collection), eq(takuItems.id, id)))
    .run();
  return Boolean((res as unknown as { changes?: number }).changes);
}
