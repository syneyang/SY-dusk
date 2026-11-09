// 云同步：来回传的都是密文，服务器看不到内容。

import * as db from './db.js';
import { getSession, accountHeaders } from './auth.js';

const PUSH_KEY = 'syncPushAt';
const PULL_KEY = 'syncPullAt';
const IMG_PUSH_KEY = 'syncImgPushAt';
const IMG_PULL_KEY = 'syncImgPullAt';

async function authHeaders() {
  const session = await getSession();
  if (!session) throw new Error('请先登录账号');
  return accountHeaders(session);
}

/**
 * 同步一次：先推本地新改动，再拉云端新改动。
 * progress(text) 用来在界面上显示进度。
 */
export async function syncNow(progress = () => {}) {
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
  // 只传真被日记引用的照片，孤儿照片（试插没保存成功的）不往云上传
  const imgPushFrom = await db.getMeta(IMG_PUSH_KEY, 0);
  const referenced = new Set();
  for (const entry of await db.allEntries()) {
    if (entry.coverImageId) referenced.add(entry.coverImageId);
    for (const block of entry.blocks || []) {
      if (block.type === 'image' && block.imageId) referenced.add(block.imageId);
    }
  }
  const localImages = (await db.rawImages())
    .filter((r) => (r.createdAt || 0) > imgPushFrom && referenced.has(r.id));
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
  const session = await getSession();
  return {
    enabled: !!session,
    email: session ? session.email : '',
    lastAt: await db.getMeta('syncLastAt', 0)
  };
}
