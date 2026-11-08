// 本地库：一天一篇（keyPath: date），照片单独存成 Blob，避免把二进制塞进日记对象。

const DB_NAME = 'dusk';
const DB_VERSION = 1;
let dbPromise = null;

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

/**
 * 在一个事务里跑一次请求。
 * fn 必须返回 IDBRequest（不是 Promise）——事务的 complete 事件要在发请求之前挂好，
 * 否则只读事务可能在 await 之后已经结束，Promise 就永远挂着。
 */
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

// ---- 日记 ----

export function getEntry(date) {
  return withStore('entries', 'readonly', (s) => s.get(date));
}

export function putEntry(entry) {
  return withStore('entries', 'readwrite', (s) => s.put(entry));
}

export function deleteEntry(date) {
  return withStore('entries', 'readwrite', (s) => s.delete(date));
}

export function allEntries() {
  return withStore('entries', 'readonly', (s) => s.getAll());
}

export function entryCount() {
  return withStore('entries', 'readonly', (s) => s.count());
}

// ---- 照片 ----

export function putImage(record) {
  return withStore('images', 'readwrite', (s) => s.put(record));
}

export function getImage(id) {
  return withStore('images', 'readonly', (s) => s.get(id));
}

export function deleteImage(id) {
  return withStore('images', 'readwrite', (s) => s.delete(id));
}

export function allImages() {
  return withStore('images', 'readonly', (s) => s.getAll());
}

// ---- 设置 ----

export async function getMeta(key, fallback = null) {
  const row = await withStore('meta', 'readonly', (s) => s.get(key));
  return row === undefined ? fallback : row.value;
}

export function setMeta(key, value) {
  return withStore('meta', 'readwrite', (s) => s.put({ key, value }));
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
