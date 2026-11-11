// 账号：注册 / 登录 / 会话。密码派生登录凭证 + 包裹主密钥的钥匙。

import * as db from './db.js';
import { randomBytes, toB64, fromB64, wrapMasterKey, unwrapMasterKey, importMasterKey } from './crypto.js';

const ITERATIONS = 200000;
const SESSION_KEY = 'authSession';
const encoder = new TextEncoder();

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function passwordProblem(password) {
  if (!password || password.length < 8) return '密码至少 8 位';
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return '密码要有字母和数字';
  return null;
}

export async function deriveKeys(password, saltBytes, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    base,
    512
  );
  const bytes = new Uint8Array(bits);
  const authBytes = bytes.slice(0, 32);
  const wrapBytes = bytes.slice(32, 64);

  const digest = await crypto.subtle.digest('SHA-256', authBytes);
  const authHash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const wrapKey = await crypto.subtle.importKey('raw', wrapBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  return { authHash, wrapKey };
}

async function call(body) {
  const response = await fetch('/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({ ok: false, error: '服务器没响应' }));
  return data;
}

export async function fetchSalt(email) {
  return call({ action: 'salt', email: normalizeEmail(email) });
}

export async function register(email, password, masterRaw) {
  const clean = normalizeEmail(email);
  const salt = randomBytes(16);
  const { authHash, wrapKey } = await deriveKeys(password, salt, ITERATIONS);
  const wrapped = await wrapMasterKey(masterRaw, wrapKey);

  const data = await call({
    action: 'register',
    email: clean,
    salt: toB64(salt),
    authHash,
    wrapped,
    iterations: ITERATIONS
  });
  if (!data.ok) throw new Error(data.error || '注册失败');

  await db.setMeta(SESSION_KEY, { email: clean, authHash, salt: toB64(salt), iterations: ITERATIONS });
  return { email: clean, authHash };
}

export async function login(email, password) {
  const clean = normalizeEmail(email);
  const saltData = await fetchSalt(clean);
  if (!saltData.ok) throw new Error(saltData.error || '登录失败');

  const salt = fromB64(saltData.salt);
  const { authHash, wrapKey } = await deriveKeys(password, salt, saltData.iterations || ITERATIONS);
  const data = await call({ action: 'login', email: clean, authHash });
  if (!data.ok) throw new Error(data.error || '邮箱或密码不对');

  const masterRaw = await unwrapMasterKey(data.wrapped, wrapKey);
  await db.setMeta(SESSION_KEY, { email: clean, authHash, salt: saltData.salt, iterations: saltData.iterations || ITERATIONS });
  return { masterRaw, email: clean };
}

export async function getSession() {
  const stored = await db.getMeta(SESSION_KEY, null);
  if (stored) return stored;

  // 老版本把会话放在 localStorage，升级后要能接上
  try {
    const legacy = localStorage.getItem(SESSION_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (parsed && parsed.email && parsed.authHash) {
        await db.setMeta(SESSION_KEY, parsed);
        localStorage.removeItem(SESSION_KEY);
        return parsed;
      }
    }
  } catch {}

  return null;
}

export async function signOut() {
  await db.deleteMeta(SESSION_KEY);
}

export function accountHeaders(session) {
  return {
    authorization: `Bearer ${session.authHash}`,
    'x-dusk-account': session.email
  };
}

export async function importSessionMasterKey(masterRaw) {
  return importMasterKey(masterRaw);
}
