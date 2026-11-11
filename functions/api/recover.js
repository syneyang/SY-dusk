// 找回账号密码：邮箱验证码 + 服务器托管的密钥。
// 路由：POST /api/recover  { action: 'start' | 'verify' | 'finish' | 'escrow' | 'status' }

const CODE_TTL = 10 * 60 * 1000;
const TOKEN_TTL = 10 * 60 * 1000;
const MAX_PER_HOUR = 5;

let schemaReady = false;

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json({ ok: false, error: '只支持 POST' }, 405);
  if (!env.DB) return json({ ok: false, error: '还没有绑定数据库', code: 'NO_DB' }, 501);

  await ensureSchema(env.DB);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '请求格式不对' }, 400);
  }

  const email = normalizeEmail(body.email);
  if (!email) return json({ ok: false, error: '邮箱不对' }, 400);

  try {
    if (body.action === 'status') return await status(env, email);
    if (body.action === 'start') return await start(env, email);
    if (body.action === 'verify') return await verify(env, email, body.code);
    if (body.action === 'finish') return await finish(env, email, body);
    if (body.action === 'escrow') return await escrow(env, email, body);
    return json({ ok: false, error: '未知操作' }, 400);
  } catch (error) {
    return json({ ok: false, error: error.message || String(error) }, 500);
  }
}

// ---------- 状态：这个账号能不能用邮箱找回 ----------

async function status(env, email) {
  const row = await env.DB.prepare('SELECT escrow FROM accounts WHERE email = ?').bind(email).first();
  if (!row) return json({ ok: true, exists: false, recoverable: false });
  return json({ ok: true, exists: true, recoverable: !!row.escrow });
}

// ---------- 发验证码 ----------

async function start(env, email) {
  const account = await env.DB.prepare('SELECT email FROM accounts WHERE email = ?').bind(email).first();
  if (!account) return json({ ok: false, error: '这个邮箱还没注册过' }, 404);

  const since = Date.now() - 60 * 60 * 1000;
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM recovery_codes WHERE email = ? AND created_at > ?'
  ).bind(email, since).first();
  if ((recent?.n || 0) >= MAX_PER_HOUR) {
    return json({ ok: false, error: '发得太频繁了，过一会儿再试' }, 429);
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await sha256(`code:${email}:${code}`);

  await env.DB.prepare(
    'INSERT INTO recovery_codes (email, code_hash, expires_at, tries, created_at) VALUES (?, ?, ?, 0, ?)'
  ).bind(email, codeHash, Date.now() + CODE_TTL, Date.now()).run();

  const sent = await sendMail(env, email, code);
  if (!sent.ok) return json(sent, 500);

  return json({ ok: true, sent: true });
}

// ---------- 校验验证码，换回主密钥 ----------

async function verify(env, email, code) {
  const clean = String(code || '').replace(/\D/g, '');
  if (clean.length !== 6) return json({ ok: false, error: '验证码是 6 位数字' }, 400);

  const row = await env.DB.prepare(
    'SELECT code_hash, expires_at, tries FROM recovery_codes WHERE email = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(email).first();

  if (!row) return json({ ok: false, error: '还没有发过验证码' }, 400);
  if (Date.now() > row.expires_at) return json({ ok: false, error: '验证码过期了，重新发一个' }, 400);
  if ((row.tries || 0) >= 5) return json({ ok: false, error: '试太多次了，重新发一个' }, 429);

  const expected = await sha256(`code:${email}:${clean}`);
  if (expected !== row.code_hash) {
    await env.DB.prepare('UPDATE recovery_codes SET tries = tries + 1 WHERE email = ?').bind(email).run();
    return json({ ok: false, error: '验证码不对' }, 400);
  }

  await env.DB.prepare('DELETE FROM recovery_codes WHERE email = ?').bind(email).run();

  const account = await env.DB.prepare('SELECT escrow FROM accounts WHERE email = ?').bind(email).first();
  if (!account || !account.escrow) {
    return json({ ok: false, error: '这个账号没有开启找回，数据找不回来了' }, 400);
  }

  const master = await decryptEscrow(env, email, account.escrow);
  const token = randomHex(24);
  await env.DB.prepare(
    'INSERT INTO recovery_tokens (email, token_hash, expires_at) VALUES (?, ?, ?)'
  ).bind(email, await sha256(`token:${token}`), Date.now() + TOKEN_TTL).run();

  return json({ ok: true, token, master });
}

// ---------- 用重置令牌写入新密码 ----------

async function finish(env, email, body) {
  const token = String(body.token || '');
  if (!token) return json({ ok: false, error: '缺少重置令牌' }, 400);

  const row = await env.DB.prepare(
    'SELECT token_hash, expires_at FROM recovery_tokens WHERE email = ? ORDER BY expires_at DESC LIMIT 1'
  ).bind(email).first();

  if (!row) return json({ ok: false, error: '请先验证邮箱' }, 400);
  if (Date.now() > row.expires_at) return json({ ok: false, error: '重置超时了，重新来一次' }, 400);
  if (row.token_hash !== await sha256(`token:${token}`)) {
    return json({ ok: false, error: '令牌不对' }, 401);
  }

  if (!body.salt || !body.authHash || !body.wrapped) {
    return json({ ok: false, error: '缺少参数' }, 400);
  }

  const iterations = body.iterations || 200000;
  await env.DB.prepare(
    'UPDATE accounts SET salt = ?, auth_hash = ?, wrapped = ?, iterations = ? WHERE email = ?'
  ).bind(body.salt, body.authHash, JSON.stringify(body.wrapped), iterations, email).run();

  await env.DB.prepare('DELETE FROM recovery_tokens WHERE email = ?').bind(email).run();
  return json({ ok: true });
}

// ---------- 上传托管密钥 ----------

async function escrow(env, email, body) {
  const account = await env.DB.prepare('SELECT auth_hash FROM accounts WHERE email = ?').bind(email).first();
  if (!account) return json({ ok: false, error: '账号不存在' }, 404);
  if (account.auth_hash !== body.authHash) return json({ ok: false, error: '密码不对' }, 401);
  if (!body.master) return json({ ok: false, error: '缺少密钥' }, 400);

  const sealed = await encryptEscrow(env, email, body.master);
  await env.DB.prepare('UPDATE accounts SET escrow = ? WHERE email = ?').bind(sealed, email).run();
  return json({ ok: true });
}

// ---------- 加解密托管密钥 ----------

async function escrowKey(env, email) {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(env.RECOVERY_SECRET), 'HKDF', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode(email), info: new TextEncoder().encode('dusk-escrow') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptEscrow(env, email, base64Master) {
  if (!env.RECOVERY_SECRET) throw new Error('服务器还没配置找回密钥');
  const key = await escrowKey(env, email);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = base64ToBytes(base64Master);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  return JSON.stringify({ iv: bytesToBase64(iv), ct: bytesToBase64(ct) });
}

async function decryptEscrow(env, email, sealed) {
  const key = await escrowKey(env, email);
  const { iv, ct } = JSON.parse(sealed);
  const data = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBytes(iv) }, key, base64ToBytes(ct)
  );
  return bytesToBase64(new Uint8Array(data));
}

// ---------- 发邮件（Brevo） ----------

async function sendMail(env, email, code) {
  if (!env.BREVO_API_KEY) return { ok: false, error: '还没有配置发信服务', code: 'NO_MAIL' };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || '朝夕' },
      to: [{ email }],
      subject: `朝夕 · 找回密码验证码 ${code}`,
      htmlContent: `
        <div style="font-family:-apple-system,'PingFang SC',sans-serif;max-width:420px;margin:0 auto;padding:24px">
          <div style="font-size:22px;font-family:Georgia,serif;margin-bottom:16px">朝夕</div>
          <p style="color:#444;line-height:1.7">你正在找回朝夕的账号密码，验证码是：</p>
          <div style="font-size:34px;letter-spacing:8px;font-weight:600;padding:14px 0">${code}</div>
          <p style="color:#888;font-size:13px;line-height:1.7">
            10 分钟内有效。如果不是你本人操作，忽略这封邮件即可，你的日记不会被别人打开。
          </p>
        </div>`
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    return { ok: false, error: '邮件没发出去：' + detail.slice(0, 120) };
  }
  return { ok: true };
}

// ---------- 小工具 ----------

async function ensureSchema(db) {
  if (schemaReady) return;
  await db.prepare(`CREATE TABLE IF NOT EXISTS recovery_codes (
    email TEXT NOT NULL, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
    tries INTEGER DEFAULT 0, created_at INTEGER NOT NULL)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS recovery_tokens (
    email TEXT NOT NULL, token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL)`).run();
  schemaReady = true;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function randomHex(bytes) {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
