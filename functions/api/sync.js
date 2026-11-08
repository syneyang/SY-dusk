// 日记同步：只收密文。账号 = 同步码的 SHA-256，服务器不知道同步码原文。

let schemaReady = false;

export async function onRequest(context) {
  const { request, env } = context;

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token || token.length < 24) return json({ ok: false, error: '缺少同步码' }, 401);
  if (!env.DB) return json({ ok: false, error: '还没有绑定 D1 数据库', code: 'NO_DB' }, 501);

  const account = await sha256(token);
  await ensureSchema(env.DB);

  if (request.method === 'GET') {
    const since = Number(new URL(request.url).searchParams.get('since') || 0);
    const rows = await env.DB.prepare(
      'SELECT date, updated_at, iv, ct, deleted FROM entries WHERE account = ? AND updated_at > ? ORDER BY updated_at ASC'
    ).bind(account, since).all();
    return json({ ok: true, entries: (rows.results || []).map((row) => ({
      date: row.date,
      updatedAt: row.updated_at,
      deleted: !!row.deleted,
      blob: row.iv ? { iv: row.iv, ct: row.ct } : null
    })) });
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const entries = Array.isArray(body.entries) ? body.entries : [];
    if (!entries.length) return json({ ok: true, saved: 0 });

    const statement = env.DB.prepare(
      `INSERT INTO entries (account, date, updated_at, iv, ct, deleted)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(account, date) DO UPDATE SET
         updated_at = excluded.updated_at,
         iv = excluded.iv,
         ct = excluded.ct,
         deleted = excluded.deleted
       WHERE excluded.updated_at > entries.updated_at`
    );

    const batch = entries.map((entry) => statement.bind(
      account,
      entry.date,
      entry.updatedAt || Date.now(),
      entry.blob ? entry.blob.iv : null,
      entry.blob ? entry.blob.ct : null,
      entry.deleted ? 1 : 0
    ));

    await env.DB.batch(batch);
    return json({ ok: true, saved: entries.length });
  }

  return json({ ok: false, error: '只支持 GET / POST' }, 405);
}

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS entries (
       account TEXT NOT NULL,
       date TEXT NOT NULL,
       updated_at INTEGER NOT NULL,
       iv TEXT,
       ct TEXT,
       deleted INTEGER DEFAULT 0,
       PRIMARY KEY (account, date)
     )`
  ).run();
  schemaReady = true;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
