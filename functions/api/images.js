// 照片同步：清单放 D1，密文放 R2。
// GET  ?since=0         → 列出清单
// POST { images: [...] } → 上报清单
// PUT  ?id=xxx          → 上传密文（body 为二进制）
// GET  ?id=xxx&blob=1   → 下载密文

let schemaReady = false;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (!env.DB) return json({ ok: false, error: '还没有绑定 D1 数据库', code: 'NO_DB' }, 501);
  await ensureSchema(env.DB);

  const account = await resolveAccount(env, request);
  if (!account) return json({ ok: false, error: '登录已失效，请重新登录' }, 401);

  const id = url.searchParams.get('id');

  const store = env.IMAGES || env.PHOTOS || null;

  if (request.method === 'PUT' && id) {
    if (!store) return json({ ok: false, error: '还没有绑定照片存储（R2 或 KV）', code: 'NO_STORE' }, 501);
    const bytes = await request.arrayBuffer();
    await store.put(`${account}/${id}`, bytes);
    return json({ ok: true });
  }

  if (request.method === 'GET' && id) {
    if (!store) return json({ ok: false, error: '还没有绑定照片存储（R2 或 KV）', code: 'NO_STORE' }, 501);
    const key = `${account}/${id}`;

    if (env.IMAGES) {
      const object = await env.IMAGES.get(key);
      if (!object) return json({ ok: false, error: '没有这张照片' }, 404);
      return new Response(object.body, {
        headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' }
      });
    }

    const buffer = await env.PHOTOS.get(key, 'arrayBuffer');
    if (!buffer) return json({ ok: false, error: '没有这张照片' }, 404);
    return new Response(buffer, {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' }
    });
  }

  if (request.method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    const rows = await env.DB.prepare(
      'SELECT id, date, updated_at, meta FROM images WHERE account = ? AND updated_at > ? ORDER BY updated_at ASC'
    ).bind(account, since).all();
    return json({ ok: true, images: (rows.results || []).map((row) => ({
      id: row.id,
      date: row.date,
      updatedAt: row.updated_at,
      meta: row.meta ? JSON.parse(row.meta) : {}
    })) });
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const images = Array.isArray(body.images) ? body.images : [];
    if (!images.length) return json({ ok: true, saved: 0 });

    const statement = env.DB.prepare(
      `INSERT INTO images (account, id, date, updated_at, meta)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(account, id) DO UPDATE SET
         date = excluded.date,
         updated_at = excluded.updated_at,
         meta = excluded.meta
       WHERE excluded.updated_at > images.updated_at`
    );
    const batch = images.map((image) => statement.bind(
      account, image.id, image.date || '', image.updatedAt || Date.now(), JSON.stringify(image.meta || {})
    ));
    await env.DB.batch(batch);
    return json({ ok: true, saved: images.length });
  }

  return json({ ok: false, error: '不支持的方法' }, 405);
}

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS images (
       account TEXT NOT NULL,
       id TEXT NOT NULL,
       date TEXT,
       updated_at INTEGER NOT NULL,
       meta TEXT,
       PRIMARY KEY (account, id)
     )`
  ).run();
  schemaReady = true;
}


async function resolveAccount(env, request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  const email = (request.headers.get('x-dusk-account') || '').trim().toLowerCase();
  if (!token || !email) return null;
  const row = await env.DB.prepare('SELECT auth_hash FROM accounts WHERE email = ?').bind(email).first();
  if (!row || row.auth_hash !== token) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
