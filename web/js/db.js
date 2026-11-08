// 本地库：一天一篇，照片单独存。写入前一律加密。

import { encryptJSON, decryptJSON, encryptBytes, decryptBytes } from './crypto.js';

const DB_NAME = 'dusk';
const DB_VERSION = 1;
let dbPromise = null;
let masterKey = null;

/** 解锁后把主密钥交给这一层，之后所有读写都会自动加密 / 解密。 */
export function setMasterKey(key) {
  masterKey = key;
}

export function hasMasterKey() {
  return !!masterKey;
}

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) {
        const entries = db.createObjectStore('entries', { keyPath: 'date' });
        entries.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('本地数据库被另一个标签页占用'));
  });
  return dbPromise;
}

async function withStore(name, mode, fn) {
  const db = await openDB();
  const tx = db.transaction(name, mode);
  const store = tx.objectStore(name);

  const done = new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('事务被中止'));
  });

  const result = await new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  await done;
  return result;
}

// ---------- 日记 ----------

export async function getEntry(date) {
  const record = await withStore('entries', 'readonly', (s) => s.get(date));
  if (!record) return null;
  if (record.blob && masterKey) {
    try {
      return await decryptJSON(masterKey, record.blob);
    } catch {
      return null;
    }
  }
  return record; // 旧的明文记录
}

export async function putEntry(entry) {
  if (!masterKey) throw new Error('还没有解锁');
  const blob = await encryptJSON(masterKey, entry);
  return withStore('entries', 'readwrite', (s) => s.put({
    date: entry.date,
    updatedAt: entry.updatedAt || Date.now(),
    blob,
    v: 2
  }));
}

export function deleteEntry(date) {
  return withStore('entries', 'readwrite', (s) => s.delete(date));
}

export async function allEntries() {
  const records = await withStore('entries', 'readonly', (s) => s.getAll());
  const out = [];
  for (const record of records) {
    if (record.blob && masterKey) {
      try {
        out.push(await decryptJSON(masterKey, record.blob));
      } catch {
        // 解不开的跳过
      }
    } else {
      out.push(record);
    }
  }
  return out;
}

export async function entryCount() {
  return withStore('entries', 'readonly', (s) => s.count());
}

/** 只拿「哪几天有记录 + 更新时间」，不解密正文，用于列表和同步比对。 */
export async function entryIndex() {
  const records = await withStore('entries', 'readonly', (s) => s.getAll());
  return records.map((r) => ({ date: r.date, updatedAt: r.updatedAt || 0 }));
}

// ---------- 照片 ----------

export async function putImage(record) {
  if (!masterKey) throw new Error('还没有解锁');
  const payload = {
    id: record.id,
    date: record.date || '',
    createdAt: record.createdAt || Date.now(),
    width: record.width || 0,
    height: record.height || 0,
    mime: record.blob.type || 'image/jpeg',
    blob: await encryptBytes(masterKey, await record.blob.arrayBuffer()),
    v: 2
  };
  if (record.thumb) {
    payload.thumb = await encryptBytes(masterKey, await record.thumb.arrayBuffer());
    payload.thumbMime = record.thumb.type || 'image/jpeg';
  }
  return withStore('images', 'readwrite', (s) => s.put(payload));
}

export async function getImage(id) {
  const record = await withStore('images', 'readonly', (s) => s.get(id));
  if (!record) return null;

  if (!record.blob) return record; // 旧明文

  const bytes = await decryptBytes(masterKey, record.blob);
  const blob = new Blob([bytes], { type: record.mime || 'image/jpeg' });
  let thumb = null;
  if (record.thumb) {
    const thumbBytes = await decryptBytes(masterKey, record.thumb);
    thumb = new Blob([thumbBytes], { type: record.thumbMime || 'image/jpeg' });
  }
  return { ...record, blob, thumb };
}

export function deleteImage(id) {
  return withStore('images', 'readwrite', (s) => s.delete(id));
}

export async function allImages() {
  const records = await withStore('images', 'readonly', (s) => s.getAll());
  const out = [];
  for (const record of records) {
    if (!record.blob) {
      out.push(record);
      continue;
    }
    try {
      const bytes = await decryptBytes(masterKey, record.blob);
      const blob = new Blob([bytes], { type: record.mime || 'image/jpeg' });
      let thumb = null;
      if (record.thumb) {
        const thumbBytes = await decryptBytes(masterKey, record.thumb);
        thumb = new Blob([thumbBytes], { type: record.thumbMime || 'image/jpeg' });
      }
      out.push({ ...record, blob, thumb });
    } catch {
      // 跳过解不开的
    }
  }
  return out;
}

// ---------- 设置 ----------

export async function getMeta(key, fallback = null) {
  const row = await withStore('meta', 'readonly', (s) => s.get(key));
  return row === undefined ? fallback : row.value;
}

export function setMeta(key, value) {
  return withStore('meta', 'readwrite', (s) => s.put({ key, value }));
}

export async function deleteMeta(key) {
  return withStore('meta', 'readwrite', (s) => s.delete(key));
}

export async function clearAll() {
  const db = await openDB();
  const tx = db.transaction(['entries', 'images', 'meta'], 'readwrite');
  tx.objectStore('entries').clear();
  tx.objectStore('images').clear();
  tx.objectStore('meta').clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function storageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    return navigator.storage.estimate();
  }
  return null;
}
