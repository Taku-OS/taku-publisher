# Data and storage

Choose the capability that matches the data. Do not default to migrations or SQL.

| Need | Use | Scopes |
|---|---|---|
| A signed-in user's own small records (notes, tasks, bookmarks, settings) | `storage.personal` | `storage.personal.read`, `storage.personal.write` |
| Anonymous feedback / contact / sign-up form | `storage.submissions` | `storage.submissions.write` |
| Saved Airbnb stays | `storage.favorites` | `storage.favorites.read`, `storage.favorites.write` |
| Shared relational data | generic SQL + migrations | `storage.database.read`, `storage.database.write` |

`storage` in the manifest is always `{ "type": "turso", "migrations": <bool> }`. Only generic SQL with shipped migrations needs `migrations: true`.

## storage.personal

```js
const records = await taku.storage.personal.list('tasks');          // [{ key, value }]
await taku.storage.personal.put('tasks', taskId, { title, done });
await taku.storage.personal.delete('tasks', taskId);
```

The platform ties records to the verified Site session. Never send a user ID. Collection names match `[a-z][a-z0-9_-]{0,63}`, keys match `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`. Each value is JSON of at most 8 KiB, and each user can have at most 100 records per collection. It is not for large or public data. Auth must be `required`.

## storage.submissions (anonymous)

Manifest: `"auth": { "mode": "optional", "scopes": ["storage.submissions.write"] }`. The platform accepts exactly `{ name, email, message }`: name 1–100 characters, a valid email of 3–254 characters, message 1–4000 characters, and at most 8 KiB of JSON in total. Visitors cannot read submissions back. The owner reads them in Taku.

Browser-only:

```js
const receipt = await taku.storage.submissions.create({ name, email, message }, { requestId });
// { receiptId, receivedAt }: show success only after this resolves
```

If the Site must go through its own Worker route, the browser sends `POST /api/feedback` with `X-Taku-CSRF: 1`, `Idempotency-Key: <requestId>`, and the JSON body. The Worker validates a **clone** of the request and replies `307` with `Location: /__taku/storage/submissions`. The browser then replays the POST to the platform, which stores it and returns the real receipt. Never `fetch('/__taku/...')` from the Worker. Do not treat the 307 as success: show "received" only on a final 200/201 with `receiptId` and `receivedAt`. After a timeout, retry with the **same** requestId. If the write fails, is rate-limited, or is over quota, show an explicit "not submitted" state.

Never fake a receipt, a "seat reserved", or an "email sent" with timers, component state, `Map`s, or `localStorage`.

## storage.favorites

Only for real Airbnb listing snapshots: `{ listingId (numeric string), title, imageUrl (https), priceText, location, deepLink: "https://www.airbnb.com/rooms/<listingId>" }`. It cannot store arbitrary items. Disable saving when there is no real image URL. Use `list()` and `save(snapshot)` / `delete(listingId)`.

## Generic SQL

`taku.storage.query(sql, params)` and `taku.storage.batch([{ statement, params }])`, up to 20 statements. Always bind parameters. The browser builds these queries, so `WHERE user_id = ?` does **not** isolate users. Use `storage.personal` for per-user data. Migrations support simple `CREATE TABLE` / `CREATE INDEX` and literal seed inserts. `CHECK`, `ALTER`, `DROP`, and triggers are not supported. If you get `MIGRATION_UNSUPPORTED`, simplify the schema.
