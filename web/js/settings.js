// 设置：账号与同步、隐私、日记、备份、存储。

import * as db from './db.js';
import { normalize, plainText, imageIds, charCount, placeName } from './model.js';
import { el, toast, fullCN, weekdayCN, todayISO, confirmAction, APP_VERSION } from './util.js';
import { lockNow, changePasscodeFlow } from './lock.js';
import { syncNow, syncStatus } from './sync.js';
import { signOut } from './auth.js';
import { createZip } from './zip.js';

export async function renderSettings(root) {
  const entriesAll = (await db.allEntries()).map(normalize);
  const earliest = entriesAll.map((e) => e.date).sort()[0];
  const journeyStart = await db.getMeta('journeyStart', earliest || todayISO());
  const lastBackup = await db.getMeta('lastBackup', null);
  const sync = await syncStatus();
  const usage = await dataUsage();
  const orphans = await countOrphans();
  const estimate = await db.storageEstimate();

  root.innerHTML = '';
  root.append(el('h1', { class: 'page-title' }, '设置'));

  // ---------- 账号 ----------
  const syncStatusLine = el('div', { class: 'set-note' },
    sync.enabled
      ? (sync.lastAt ? `上次同步：${new Date(sync.lastAt).toLocaleString('zh-CN')}` : '还没同步过')
      : '还没有登录账号，日记只在这台设备上。');

  const accountRows = [];
  if (sync.enabled) {
    accountRows.push(row({ label: '账号', value: sync.email }));
    accountRows.push(row({
      label: '立即同步',
      onClick: async () => {
        syncStatusLine.textContent = '正在同步…';
        try {
          const summary = await syncNow((text) => { syncStatusLine.textContent = text; });
          syncStatusLine.textContent = `完成：上传 ${summary.pushed} 篇，拉取 ${summary.pulled} 篇，照片 ↑${summary.imagesUp || 0} ↓${summary.imagesDown || 0}`;
        } catch (error) {
          syncStatusLine.textContent = '同步失败：' + (error.message || error);
        }
      }
    }));
    accountRows.push(row({
      label: '退出登录',
      danger: true,
      onClick: async () => {
        if (!confirmAction('退出登录？日记还在本机，重新登录就能同步。')) return;
        await signOut();
        location.reload();
      }
    }));
  } else {
    accountRows.push(row({ label: '登录 / 注册', value: '重启 App 后可选', disabled: true }));
  }

  root.append(group('账号', accountRows, syncStatusLine));

  // ---------- 隐私 ----------
  root.append(group('隐私', [
    row({
      label: '修改 6 位密码',
      onClick: async () => {
        const changed = await changePasscodeFlow(root);
        if (changed) {
          toast('已更新 6 位密码');
          await renderSettings(root);
        }
      }
    }),
    row({ label: '立即锁定', onClick: () => lockNow() }),
    row({ label: 'Face ID 快捷解锁', value: '稍后支持', disabled: true })
  ], el('div', { class: 'set-note' }, '日记和照片用你的密码加密后才存下来，没有密码谁也读不出来。')));

  // ---------- 日记 ----------
  const dateInput = el('input', {
    type: 'date',
    value: journeyStart,
    onchange: async (e) => {
      await db.setMeta('journeyStart', e.target.value || '2027-01-01');
      toast('已保存');
    }
  });
  const dayIndex = Math.floor((Date.parse(todayISO()) - Date.parse(journeyStart)) / 86400000) + 1;

  root.append(group('日记', [
    row({
      label: '旅程开始',
      value: `${journeyStart.slice(0, 4)}年${Number(journeyStart.slice(5, 7))}月${Number(journeyStart.slice(8, 10))}日`,
      picker: dateInput
    })
  ], el('div', { class: 'set-note' },
    dayIndex > 0
      ? `今天是第 ${dayIndex} 天。默认从你创建账号那天算，点上面那行可以改。`
      : '默认从创建账号那天算，点上面那行可以改。')));

  // ---------- 备份 ----------
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json' });
  fileInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const result = await importJSON(file);
      toast(`导入完成：新增 ${result.added} 天，更新 ${result.updated} 天`);
    } catch (error) {
      toast('导入失败：' + (error.message || error));
    }
  });

  root.append(group('备份与恢复', [
    row({
      label: '导出 JSON 备份',
      value: '含照片',
      onClick: async () => {
        try {
          await exportJSON();
          toast('已开始下载');
        } catch (error) {
          toast('导出失败：' + (error.message || error));
        }
      }
    }),
    row({
      label: '导出 ZIP（按月）',
      value: 'HTML + 照片',
      onClick: () => pickMonthThenExport()
    }),
    row({
      label: '导出全部（仅文字）',
      value: '单个 HTML',
      onClick: async () => {
        try {
          await exportTextOnly();
          toast('已开始下载');
        } catch (error) {
          toast('导出失败：' + (error.message || error));
        }
      }
    }),
    row({ label: '从备份恢复', value: '选择文件', file: fileInput })
  ], el('div', { class: 'set-note' },
    lastBackup
      ? `上次备份：${daysAgo(lastBackup)} 天前。JSON 可以原样导回；HTML 是给人看的。`
      : '还没有备份过。JSON 可以原样导回；HTML 是给人看的。')));

  // ---------- 存储 ----------
  root.append(group('存储', [
    row({
      label: `${usage.entries} 篇日记 · ${usage.images} 张照片`,
      value: `约 ${(usage.bytes / 1048576).toFixed(1)} MB`
    }),
    row({
      label: '清理没用到的照片',
      value: orphans > 0 ? `${orphans} 张` : '没有',
      onClick: async () => {
        const count = await cleanupOrphans();
        if (count) location.reload();
      }
    })
  ], el('div', { class: 'set-note' },
    estimate
      ? `浏览器报告的占用是 ${(estimate.usage / 1048576).toFixed(1)} MB，包含缓存和已删除但没回收的空间，会偏大。`
      : '')));

  // ---------- 危险 ----------
  root.append(group('危险', [
    row({
      label: '清空全部日记和照片',
      danger: true,
      onClick: async () => {
        if (!confirmAction('清空全部日记和照片？这个操作无法撤销。')) return;
        await db.clearAll();
        toast('已清空');
        location.hash = '#/today';
        location.reload();
      }
    })
  ]));

  root.append(el('div', { class: 'set-note', style: 'text-align:center;margin-top:24px' },
    `朝夕 v${APP_VERSION} · 只给自己用的日记本`));
}

// ---------- 小组件 ----------

function group(title, rows, note) {
  return el('div', { class: 'set-group' },
    el('div', { class: 'set-title' }, title),
    el('div', { class: 'set-card' }, ...rows, note || null)
  );
}

function row({ label, value, onClick, danger, disabled, picker, file }) {
  const isStatic = disabled || (!onClick && !picker && !file);
  const node = el(isStatic ? 'div' : 'button', {
    class: 'set-row' + (danger ? ' danger' : '') + (disabled ? ' disabled' : ''),
    onclick: onClick || null,
    type: isStatic ? null : 'button'
  },
    el('span', { class: 'set-label' }, label),
    value ? el('span', { class: 'set-value' }, value) : null,
    isStatic ? null : el('span', { class: 'set-chev' }, '›')
  );

  // 原生日期/文件控件：透明铺满整行，点哪都落到它身上
  const hidden = picker || file;
  if (hidden) {
    node.classList.add('with-picker');
    hidden.className = 'row-picker';
    node.append(hidden);
  }
  return node;
}

// ---------- 数据统计 ----------

async function dataUsage() {
  const entries = await db.rawEntries();
  const images = await db.rawImages();
  let chars = 0;
  for (const entry of entries) chars += (entry.blob && entry.blob.ct ? entry.blob.ct.length : 0);
  for (const image of images) {
    chars += (image.blob && image.blob.ct ? image.blob.ct.length : 0);
    chars += (image.thumb && image.thumb.ct ? image.thumb.ct.length : 0);
  }
  return { bytes: Math.round(chars * 0.75), entries: entries.length, images: images.length };
}

async function orphanCounts() {
  const entries = await db.allEntries();
  const ref = new Set();
  for (const entry of entries) {
    for (const block of entry.blocks || []) {
      if (block.type === 'image' && block.imageId) ref.add(block.imageId);
    }
  }
  const images = await db.rawImages();
  return { total: images.length, orphans: images.filter((image) => !ref.has(image.id)) };
}

async function countOrphans() {
  try {
    return (await orphanCounts()).orphans.length;
  } catch {
    return 0;
  }
}

async function cleanupOrphans() {
  const { orphans } = await orphanCounts();
  if (!orphans.length) {
    toast('没有可清理的照片');
    return 0;
  }
  if (!confirmAction(`清理 ${orphans.length} 张没挂到日记上的照片？`)) return 0;
  for (const image of orphans) await db.deleteImage(image.id);
  toast(`已清理 ${orphans.length} 张`);
  return orphans.length;
}

function daysAgo(timestamp) {
  return Math.max(0, Math.round((Date.now() - timestamp) / 86400000));
}

// ---------- 导出 / 导入 ----------

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataURLToBlob(dataURL) {
  const [head, body] = dataURL.split(',');
  const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function exportJSON() {
  const entries = await db.allEntries();
  const images = await db.allImages();
  const packedImages = [];
  for (const image of images) {
    packedImages.push({
      id: image.id,
      date: image.date,
      width: image.width,
      height: image.height,
      createdAt: image.createdAt,
      data: await blobToDataURL(image.blob)
    });
  }
  const payload = {
    app: 'com.syneyang.dusk',
    format: 'dusk-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
    images: packedImages
  };
  download(new Blob([JSON.stringify(payload)], { type: 'application/json' }), `朝夕备份-${todayISO()}.json`);
  await db.setMeta('lastBackup', Date.now());
}

async function importJSON(file) {
  const text = await file.text();
  const payload = JSON.parse(text);
  if (!payload || !Array.isArray(payload.entries)) throw new Error('这不是朝夕的备份文件');

  let added = 0;
  let updated = 0;

  for (const raw of payload.entries) {
    const entry = normalize(raw);
    if (!entry.date) continue;
    const existing = await db.getEntry(entry.date);
    if (existing && existing.updatedAt >= entry.updatedAt) continue;
    await db.putEntry(entry);
    if (existing) updated += 1;
    else added += 1;
  }

  for (const image of payload.images || []) {
    if (!image.id || !image.data) continue;
    await db.putImage({
      id: image.id,
      blob: dataURLToBlob(image.data),
      thumb: null,
      width: image.width || 0,
      height: image.height || 0,
      date: image.date || '',
      createdAt: image.createdAt || Date.now()
    });
  }

  return { added, updated };
}

function buildHTML(entries, imageMap) {
  const parts = [];

  for (const entry of entries) {
    const body = entry.blocks.map((block) => {
      if (block.type === 'image') {
        const src = imageMap ? imageMap.get(block.imageId) : null;
        return src ? `<img src="${src}" alt="">` : '';
      }
      return block.text.split('\n').filter(Boolean).map((line) => `<p>${escapeHTML(line)}</p>`).join('');
    }).join('');

    const metaBits = [entry.weather, ...(entry.places || []).map(placeName)].filter(Boolean).join(' · ');

    parts.push(`<article>
      <h2>${fullCN(entry.date)} <small>${weekdayCN(entry.date)}</small></h2>
      ${metaBits ? `<p class="meta">${escapeHTML(metaBits)}</p>` : ''}
      ${body}
    </article>`);
  }

  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>朝夕 · ${entries.length} 天</title>
<style>
  body{max-width:680px;margin:40px auto;padding:0 20px;background:#f9f4ec;color:#2b2620;
       font-family:-apple-system,"PingFang SC",sans-serif;line-height:1.85;font-size:16px}
  h1{font-family:"Songti SC",serif;font-size:30px;margin-bottom:4px}
  .sub{color:#6b625a;font-size:13px;margin-bottom:36px}
  article{border-top:1px solid #e2dcd1;padding:22px 0}
  h2{font-family:"Songti SC",serif;font-size:21px;margin:0 0 6px}
  h2 small{font-family:inherit;font-size:12px;color:#6b625a;font-weight:400;margin-left:6px}
  .meta{color:#6b625a;font-size:12px;margin:0 0 12px}
  img{max-width:100%;border-radius:10px;margin:8px 0}
  @media (prefers-color-scheme:dark){body{background:#141210;color:#eae5da}h2 small,.meta,.sub{color:#a49a8c}article{border-color:#34302a}}
</style>
<h1>朝夕</h1>
<div class="sub">${entries.length} 天 · 导出于 ${todayISO()}</div>
${parts.join('\n')}
</html>`;
}

/** 按月份打包：index.html + images/，一个月通常 50-70MB，手机上稳稳能打。 */
async function exportMonthZip(monthKey) {
  const entries = (await db.allEntries())
    .map(normalize)
    .filter((entry) => entry.date.startsWith(monthKey))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!entries.length) throw new Error('这个月还没有日记');

  const imageMap = new Map();
  const files = [];
  let index = 0;

  for (const entry of entries) {
    for (const id of imageIds(entry)) {
      if (imageMap.has(id)) continue;
      const record = await db.getImage(id);
      if (!record) continue;
      const ext = (record.mime || 'image/jpeg').includes('png') ? 'png' : 'jpg';
      const name = `images/${String(++index).padStart(3, '0')}.${ext}`;
      imageMap.set(id, name);
      files.push({ name, data: new Uint8Array(await record.blob.arrayBuffer()) });
    }
  }

  files.unshift({
    name: 'index.html',
    data: new TextEncoder().encode(buildHTML(entries, imageMap))
  });

  download(createZip(files), `朝夕-${monthKey}.zip`);
  await db.setMeta('lastBackup', Date.now());
}

async function pickMonthThenExport() {
  const entries = (await db.allEntries()).map(normalize);
  const counts = new Map();
  for (const entry of entries) {
    const key = entry.date.slice(0, 7);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const months = [...counts.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, count]) => ({ key, count }));

  if (!months.length) {
    toast('还没有日记');
    return;
  }

  openSheet('导出哪个月', months.map((month) => ({
    label: `${month.key.slice(0, 4)} 年 ${Number(month.key.slice(5, 7))} 月`,
    value: `${month.count} 篇`,
    onPick: async () => {
      try {
        toast('正在打包…');
        await exportMonthZip(month.key);
      } catch (error) {
        toast('导出失败：' + (error.message || error));
      }
    }
  })));
}

function openSheet(title, options) {
  const panel = el('div', { class: 'sheet', onclick: (event) => event.stopPropagation() },
    el('div', { class: 'sheet-grip' }),
    el('div', { class: 'sheet-head' }, el('div', { class: 'sheet-title' }, title)),
    el('div', { class: 'share-list' },
      ...options.map((option) => el('button', {
        class: 'share-item',
        style: 'display:flex;justify-content:space-between;align-items:center',
        onclick: () => { close(); option.onPick(); }
      },
        el('span', {}, option.label),
        el('span', { style: 'color:var(--ink-soft);font-size:13px' }, option.value || '')
      ))
    )
  );

  const backdrop = el('div', { class: 'sheet-backdrop', onclick: close }, panel);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));

  function close() {
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 200);
  }
}

/** 全部日记，只有文字，单个 HTML，很小。 */
async function exportTextOnly() {
  const entries = (await db.allEntries()).map(normalize).sort((a, b) => a.date.localeCompare(b.date));
  download(new Blob([buildHTML(entries, null)], { type: 'text/html' }), `朝夕-全部日记-${todayISO()}.html`);
  await db.setMeta('lastBackup', Date.now());
}

function escapeHTML(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export { charCount, plainText };
