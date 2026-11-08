// 云同步：来回传的都是密文，服务器看不到内容。

import * as db from './db.js';
import { randomBytes, toB64 } from './crypto.js';

const TOKEN_KEY = 'syncToken';
const PUSH_KEY = 'syncPushAt';
const PULL_KEY = 'syncPullAt';
const IMG_PUSH_KEY = 'syncImgPushAt';
const IMG_PULL_KEY = 'syncImgPullAt';

export async function getToken() {
  return db.getMeta(TOKEN_KEY, null);
}

export async function enableSync() {
  const existing = await getToken();
  if (existing) return existing;
  const token = toB64(randomBytes(32)).replace(/[^A-Za-z0-9]/g, '').slice(0, 43);
  await db.setMeta(TOKEN_KEY, token);
  return token;
}

async function authHeaders() {
  const token = await getToken();
  return { authorization: `Bearer ${token}` };
}

/**
 * 同步一次：先推本地新改动，再拉云端新改动。
 * progress(text) 用来在界面上显示进度。
 */
export async function syncNow(progress = () => {}) {
  const token = await getToken();
  if (!token) throw new Error('还没有开启云同步');

  const headers = await authHeaders();
  const summary = { pushed: 0, pulled: 0, imagesUp: 0, imagesDown: 0 };

  // ---------- 1. 推本地日记 ----------
  const pushFrom = await db.getMeta(PUSH_KEY, 0);
  const localEntries = (await db.rawEntries()).filter((r) => (r.updatedAt || 0) > pushFrom);
  if (localEntries.length) {
    progress(`上传 ${localEntries.length} 篇…`);
    const response = await fetch('/api/sync', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        entries: localEntries.map((record) => ({
          date: record.date,
          updatedAt: record.updatedAt || 0,
          deleted: !!record.deleted,
          blob: record.blob || null
        }))
      })
    });
    const data = await response.json();
    if (!data.ok) throw new Error(data.error || '上传失败');
    summary.pushed = localEntries.length;
    await db.setMeta(PUSH_KEY, Date.now());
  }

  // ---------- 2. 拉云端日记 ----------
  const pullFrom = await db.getMeta(PULL_KEY, 0);
  progress('检查云端更新…');
  const pullResponse = await fetch(`/api/sync?since=${pullFrom}`, { headers });
  const pullData = await pullResponse.json();
  if (!pullData.ok) throw new Error(pullData.error || '拉取失败');

  for (const remote of pullData.entries || []) {
    if (!remote.blob && !remote.deleted) continue;
    const local = (await db.rawEntries()).find((r) => r.date === remote.date);
    if (local && (local.updatedAt || 0) >= remote.updatedAt) continue;
    await db.putRawEntry({
      date: remote.date,
      updatedAt: remote.updatedAt,
      blob: remote.blob || null,
      deleted: remote.deleted ? 1 : 0,
      v: 2
    });
    summary.pulled += 1;
  }
  await db.setMeta(PULL_KEY, Date.now());

  // ---------- 3. 推本地照片 ----------
  const imgPushFrom = await db.getMeta(IMG_PUSH_KEY, 0);
  const localImages = (await db.rawImages()).filter((r) => (r.createdAt || 0) > imgPushFrom);
  if (localImages.length) {
    progress(`上传 ${localImages.length} 张照片…`);
    for (const image of localImages) {
      const response = await fetch(`/api/images?id=${encodeURIComponent(image.id)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(image)
      });
      if (!response.ok) continue;
      summary.imagesUp += 1;
    }
    const manifest = await fetch('/api/images', {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({
        images: localImages.map((image) => ({
          id: image.id,
          date: image.date,
          updatedAt: image.createdAt || 0,
          meta: { width: image.width, height: image.height }
        }))
      })
    });
    const manifestData = await manifest.json();
    if (!manifestData.ok) throw new Error(manifestData.error || '照片清单上传失败');
    await db.setMeta(IMG_PUSH_KEY, Date.now());
  }

  // ---------- 4. 拉云端照片 ----------
  const imgPullFrom = await db.getMeta(IMG_PULL_KEY, 0);
  const manifestResponse = await fetch(`/api/images?since=${imgPullFrom}`, { headers });
  const manifestData = await manifestResponse.json();
  if (!manifestData.ok) throw new Error(manifestData.error || '照片清单拉取失败');

  for (const remote of manifestData.images || []) {
    if (await db.hasImage(remote.id)) continue;
    progress('下载照片…');
    const blobResponse = await fetch(`/api/images?id=${encodeURIComponent(remote.id)}`, { headers });
    if (!blobResponse.ok) continue;
    const record = await blobResponse.json();
    await db.putRawImage(record);
    summary.imagesDown += 1;
  }
  await db.setMeta(IMG_PULL_KEY, Date.now());
  await db.setMeta('syncLastAt', Date.now());

  return summary;
}

export async function syncStatus() {
  const token = await getToken();
  return {
    enabled: !!token,
    lastAt: await db.getMeta('syncLastAt', 0)
  };
}
