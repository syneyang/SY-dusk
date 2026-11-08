// 加密层：密码派生密钥、AES-GCM 加解密、恢复码。
// 设计：主密钥（MK）是随机 32 字节，用它加密所有数据；
// 密码和恢复码各自派生一把 KEK，分别把 MK 包起来存下。

const enc = new TextEncoder();
const dec = new TextDecoder();

const PBKDF2_ITERATIONS = 200000;

export function randomBytes(n) {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return bytes;
}

export function toB64(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function fromB64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function deriveKEK(passphrase, salt, iterations = PBKDF2_ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/** 用 KEK 把主密钥包起来（返回可存 JSON 的形状）。 */
export async function wrapMasterKey(masterRaw, kek) {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, kek, masterRaw);
  return { iv: toB64(iv), ct: toB64(ciphertext) };
}

export async function unwrapMasterKey(wrapped, kek) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(wrapped.iv) },
    kek,
    fromB64(wrapped.ct)
  );
  return new Uint8Array(plain);
}

export async function importMasterKey(masterRaw) {
  return crypto.subtle.importKey('raw', masterRaw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv: toB64(iv), ct: toB64(ciphertext) };
}

export async function decryptBytes(key, blob) {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(blob.iv) },
    key,
    fromB64(blob.ct)
  );
  return new Uint8Array(plain);
}

export async function encryptJSON(key, value) {
  return encryptBytes(key, enc.encode(JSON.stringify(value)));
}

export async function decryptJSON(key, blob) {
  const bytes = await decryptBytes(key, blob);
  return JSON.parse(dec.decode(bytes));
}

// ---------- 恢复码 ----------

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32，去掉易混的 I L O U

export function makeRecoveryCode() {
  const bytes = randomBytes(20);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out.match(/.{1,5}/g).join('-');
}

export function normalizeRecoveryCode(input) {
  return input
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/U/g, 'V');
}

export const KDF_ITERATIONS = PBKDF2_ITERATIONS;
