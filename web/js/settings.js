// 设置：开始日期、备份、导出、清空。

import * as db from './db.js';
import { normalize, plainText, imageIds, charCount, placeName } from './model.js';
import { el, toast, fullCN, weekdayCN, todayISO, confirmAction, APP_VERSION } from './util.js';
import { lockNow, faceEnabled, enableFaceFlow, disableFace, faceSupported } from './lock.js';
import { syncNow, syncStatus } from './sync.js';
import { signOut } from './auth.js';

export async function renderSettings(root) {
  const journeyStart = await db.getMeta('journeyStart', '2027-01-01');
  const lastBackup = await db.getMeta('lastBackup', null);
  const entries = (await db.allEntries()).map(normalize);
  const estimate = await db.storageEstimate();

  root.innerHTML = '';
  root.append(el('h1', { style: 'font-size:26px;margin:4px 0 12px' }, '设置'));

  // 旅程
  const startInput = el('input', {
    type: 'date',
    value: journeyStart,
    onchange: async (e) => {
      await db.setMeta('journeyStart', e.target.value || '2027-01-01');
      toast('已保存');
    }
  });

  root.append(el('div', { class: 'card' },
    el('h3', {}, '旅程'),
    el('div', { class: 'row', style: 'margin:0' }, el('span', { class: 'label' }, '开始日'), startInput),
    el('div', { class: 'hint' }, '「第几天」按这个日期算。默认 2027 年 1 月 1 日。')
  ));

  // 导出
  const exportJsonBtn = el('button', { class: 'primary', style: 'margin-top:6px' }, '导出 JSON 备份（含照片）');
  exportJsonBtn.addEventListener('click', async () => {
    exportJsonBtn.disabled = true;
    exportJsonBtn.textContent = '正在打包…';
    try {
      await exportJSON();
      toast('已开始下载');
    } catch (error) {
      toast('导出失败：' + (error.message || error));
    } finally {
      exportJsonBtn.disabled = false;
      exportJsonBtn.textContent = '导出 JSON 备份（含照片）';
    }
  });

  const exportHtmlBtn = el('button', { class: 'ghost', style: 'width:100%;margin-top:8px;padding:12px' }, '导出 HTML 单文件（可直接阅读）');
  exportHtmlBtn.addEventListener('click', async () => {
    exportHtmlBtn.disabled = true;
    exportHtmlBtn.textContent = '正在生成…';
    try {
      await exportHTML();
      toast('已开始下载');
    } catch (error) {
      toast('导出失败：' + (error.message || error));
    } finally {
      exportHtmlBtn.disabled = false;
      exportHtmlBtn.textContent = '导出 HTML 单文件（可直接阅读）';
    }
  });

  root.append(el('div', { class: 'card' },
    el('h3', {}, '备份与导出'),
    exportJsonBtn,
    exportHtmlBtn,
    el('div', { class: 'hint' },
      `目前 ${entries.length} 天有记录` +
      (lastBackup ? `，上次备份：${daysAgo(lastBackup)} 天前` : '，还没有备份过') +
      '。JSON 可以原样导回；HTML 是给人看的，任何设备都能打开。')
  ));

  // 导入
  const importInput = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  importInput.addEventListener('change', async (event) => {
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

  root.append(el('div', { class: 'card' },
    el('h3', {}, '导入'),
    el('button', { class: 'ghost', style: 'width:100%;padding:12px', onclick: () => importInput.click() }, '从备份恢复…'),
    el('div', { class: 'hint' }, '同一天以「更新过的时间」更晚的那份为准，不会重复。'),
    importInput
  ));

  // 存储
  let storageText = '占用空间：—';
  if (estimate) {
    storageText = `占用空间：约 ${(estimate.usage / 1048576).toFixed(1)} MB`;
  }
  root.append(el('div', { class: 'card' },
    el('h3', {}, '存储'),
    el('div', { class: 'hint', style: 'margin-top:0' }, storageText),
    el('div', { class: 'hint' },
      '数据只存在这台设备的浏览器里。清空浏览器的网站数据会一起清掉，换手机之前一定先导出。')
  ));

  // 账号
  const sync = await syncStatus();
  const accountCard = el('div', { class: 'card' }, el('h3', {}, '账号'));

  if (!sync.enabled) {
    accountCard.append(el('div', { class: 'hint', style: 'margin-top:0' }, '还没有登录。'));
  } else {
    const statusLine = el('div', { class: 'hint', style: 'margin-top:8px' },
      sync.lastAt ? `上次同步：${new Date(sync.lastAt).toLocaleString('zh-CN')}` : '还没同步过');

    accountCard.append(
      el('div', { class: 'hint', style: 'margin-top:0' }, `已登录：${sync.email}`),
      el('button', {
        class: 'primary',
        style: 'margin-top:10px',
        onclick: async () => {
          statusLine.textContent = '正在同步…';
          try {
            const summary = await syncNow((text) => { statusLine.textContent = text; });
            statusLine.textContent = `完成：上传 ${summary.pushed} 篇，拉取 ${summary.pulled} 篇，照片 ↑${summary.imagesUp} ↓${summary.imagesDown}`;
          } catch (error) {
            statusLine.textContent = '同步失败：' + (error.message || error);
          }
        }
      }, '立即同步'),
      statusLine,
      el('button', {
        class: 'ghost',
        style: 'width:100%;padding:11px;margin-top:8px',
        onclick: async () => {
          if (!confirmAction('退出登录？日记还在本机，重新登录就能同步。')) return;
          await signOut();
          location.reload();
        }
      }, '退出登录'),
      el('div', { class: 'hint' }, '日记和照片加密后才上传，服务器看不到内容。')
    );
  }
  root.append(accountCard);

  // 隐私
  root.append(el('div', { class: 'card' },
    el('h3', {}, '隐私'),
    el('div', { class: 'hint', style: 'margin-top:0' }, '日记和照片都是用你的密码加密后存在本机的，没有密码谁也读不出来。'),
    el('button', {
      class: 'ghost',
      style: 'width:100%;padding:12px;margin-top:10px',
      onclick: () => lockNow()
    }, '立即锁定'),
    await faceToggleRow()
  ));

  // 危险
  root.append(el('div', { class: 'card' },
    el('h3', {}, '危险操作'),
    el('button', {
      class: 'danger',
      onclick: async () => {
        if (!confirmAction('清空全部日记和照片？这个操作无法撤销。')) return;
        await db.clearAll();
        toast('已清空');
        location.hash = '#/today';
      }
    }, '清空全部数据')
  ));

  root.append(el('div', { class: 'hint', style: 'text-align:center;margin-top:22px' },
    `朝夕 v${APP_VERSION} · 只给自己用的日记本`));
}

async function faceToggleRow() {
  if (!(await faceSupported())) {
    return el('div', { class: 'hint' }, '这台设备不支持 Face ID，只能用密码。');
  }
  const on = await faceEnabled();
  return el('button', {
    class: 'ghost',
    style: 'width:100%;padding:12px;margin-top:8px',
    onclick: async (event) => {
      if (on) {
        await disableFace();
        toast('已关闭 Face ID');
        location.reload();
      } else {
        await enableFaceFlow(document.getElementById('view'));
        location.reload();
      }
    }
  }, on ? '关闭 Face ID 快捷解锁' : '开启 Face ID 快捷解锁');
}

function daysAgo(timestamp) {
  return Math.max(0, Math.round((Date.now() - timestamp) / 86400000));
}

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
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  download(blob, `朝夕备份-${todayISO()}.json`);
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
    existing ? updated++ : added++;
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

async function exportHTML() {
  const entries = (await db.allEntries()).map(normalize).sort((a, b) => a.date.localeCompare(b.date));
  const parts = [];

  for (const entry of entries) {
    const imagesByBlock = [];
    for (const id of imageIds(entry)) {
      const record = await db.getImage(id);
      if (record) imagesByBlock.push([id, await blobToDataURL(record.blob)]);
    }
    const imageMap = new Map(imagesByBlock);

    const body = entry.blocks.map((block) => {
      if (block.type === 'image') {
        const data = imageMap.get(block.imageId);
        return data ? `<img src="${data}" alt="">` : '';
      }
      const paragraphs = block.text.split('\n').filter(Boolean)
        .map((line) => `<p>${escapeHTML(line)}</p>`).join('');
      return paragraphs;
    }).join('');

    const metaBits = [entry.weather, ...(entry.places || []).map(placeName)].filter(Boolean).join(' · ');

    parts.push(`<article>
      <h2>${fullCN(entry.date)} <small>${weekdayCN(entry.date)}</small></h2>
      ${metaBits ? `<p class="meta">${escapeHTML(metaBits)}</p>` : ''}
      ${body}
    </article>`);
  }

  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>朝夕 · 全部日记</title>
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

  download(new Blob([html], { type: 'text/html' }), `朝夕-全部日记-${todayISO()}.html`);
  await db.setMeta('lastBackup', Date.now());
}

function escapeHTML(text) {
  return String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export { charCount, plainText };
