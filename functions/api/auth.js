// 账号：注册 / 登录 / 改密码 / 注销。
// 服务器只存「登录凭证的哈希」和「被密码锁住的主密钥」，读不到日记。

let schemaReady = false;

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) return json({ ok: false, error: '还没有绑定 D1 数据库', code: 'NO_DB' }, 501);
  await ensureSchema(env.DB);

  if (request.method !== 'POST') return json({ ok: false, error: '只支持 POST' }, 405);

  const body = await request.json().catch(() => null);
  if (!body || !body.action) return json({ ok: false, error: '缺少 action' }, 400);

  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return json({ ok: false, error: '邮箱不对' }, 400);

  if (body.action === 'salt') {
    const row = await env.DB.prepare('SELECT salt, iterations FROM accounts WHERE email = ?').bind(email).first();
    if (!row) return json({ ok: false, error: '这个邮箱还没注册' }, 404);
    return json({ ok: true, salt: row.salt, iterations: row.iterations });
  }

  if (body.action === 'register') {
    const exists = await env.DB.prepare('SELECT email FROM accounts WHERE email = ?').bind(email).first();
    if (exists) return json({ ok: false, error: '这个邮箱已经注册过了' }, 409);
    await env.DB.prepare(
      'INSERT INTO accounts (email, salt, auth_hash, wrapped, iterations, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(email, body.salt, body.authHash, JSON.stringify(body.wrapped), body.iterations || 200000, Date.now()).run();
    return json({ ok: true });
  }

  if (body.action === 'login') {
    const row = await env.DB.prepare(
      'SELECT salt, auth_hash, wrapped, iterations FROM accounts WHERE email = ?'
    ).bind(email).first();
    if (!row || row.auth_hash !== body.authHash) return json({ ok: false, error: '邮箱或密码不对' }, 401);
    return json({ ok: true, salt: row.salt, wrapped: JSON.parse(row.wrapped), iterations: row.iterations });
  }

  if (body.action === 'change') {
    const row = await env.DB.prepare('SELECT auth_hash FROM accounts WHERE email = ?').bind(email).first();
    if (!row || row.auth_hash !== body.oldAuthHash) return json({ ok: false, error: '原密码不对' }, 401);
    await env.DB.prepare('UPDATE accounts SET salt = ?, auth_hash = ?, wrapped = ?, iterations = ? WHERE email = ?')
      .bind(body.salt, body.newAuthHash, JSON.stringify(body.wrapped), body.iterations || 200000, email).run();
    return json({ ok: true });
  }

  if (body.action === 'wipe') {
    const row = await env.DB.prepare('SELECT auth_hash FROM accounts WHERE email = ?').bind(email).first();
    if (!row || row.auth_hash !== body.authHash) return json({ ok: false, error: '密码不对' }, 401);
    const account = await accountId(email);
    await env.DB.prepare('DELETE FROM entries WHERE account = ?').bind(account).run();
    await env.DB.prepare('DELETE FROM images WHERE account = ?').bind(account).run();
    return json({ ok: true });
  }

  return json({ ok: false, error: '未知操作' }, 400);
}

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS accounts (
       email TEXT PRIMARY KEY,
       salt TEXT NOT NULL,
       auth_hash TEXT NOT NULL,
       wrapped TEXT NOT NULL,
       iterations INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     )`
  ).run();
  schemaReady = true;
}

export async function accountId(email) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
