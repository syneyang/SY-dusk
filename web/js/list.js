// 时光：全部日记，按「年-月」分组倒序。

import * as db from './db.js';
import { normalize, firstLine, imageIds, charCount, plainText } from './model.js';
import { el, monthTitle, weekdayCN, toast } from './util.js';

export async function renderList(root) {
  const entries = (await db.allEntries()).map(normalize).sort((a, b) => b.date.localeCompare(a.date));

  root.innerHTML = '';
  root.append(el('h1', { style: 'font-size:26px;margin:4px 0 2px' }, '时光'));

  if (!entries.length) {
    root.append(el('div', { class: 'empty' },
      el('span', { class: 'big' }, '▤'),
      '还是一片空白。',
      el('br'),
      el('a', { href: '#/today', style: 'color:var(--dawn)' }, '去写第一篇 ›')
    ));
    return;
  }

  root.append(el('div', { class: 'hint', style: 'margin-top:0' }, `一共 ${entries.length} 天有记录`));

  let lastMonth = '';
  for (const entry of entries) {
    const month = entry.date.slice(0, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      root.append(el('div', { class: 'list-month' }, monthTitle(month)));
    }
    root.append(await renderRow(entry));
  }
}

async function renderRow(entry) {
  const day = Number(entry.date.slice(8, 10));
  const title = firstLine(entry) || (imageIds(entry).length ? '（只有照片）' : '（空）');
  const meta = [];

  if (entry.weather) meta.push(entry.weather);
  if (entry.places?.length) meta.push(entry.places.join(' · '));
  const chars = charCount(entry);
  if (chars) meta.push(`${chars} 字`);
  if (imageIds(entry).length) meta.push(`${imageIds(entry).length} 张照片`);

  let thumb = null;
  const ids = imageIds(entry);
  if (ids.length) {
    const record = await db.getImage(ids[0]);
    if (record) {
      const url = URL.createObjectURL(record.thumb || record.blob);
      thumb = el('img', { class: 'thumb', src: url, alt: '', loading: 'lazy' });
      // 简单起见不回收，页面切换时整体释放
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
  }

  return el('a', { class: 'entry-row', href: `#/entry/${entry.date}` },
    el('div', { class: 'num' }, String(day), el('small', {}, weekdayCN(entry.date))),
    el('div', { class: 'body' },
      el('div', { class: 'title' }, title),
      el('div', { class: 'meta' }, meta.join(' · '))
    ),
    thumb
  );
}

export async function renderSearch(root, query) {
  const all = (await db.allEntries()).map(normalize);
  const q = (query || '').trim().toLowerCase();
  const hits = all.filter((entry) => {
    if (!q) return false;
    return (
      plainText(entry).toLowerCase().includes(q) ||
      (entry.places || []).join(' ').toLowerCase().includes(q) ||
      (entry.regions || []).join(' ').toLowerCase().includes(q) ||
      (entry.weather || '').toLowerCase().includes(q)
    );
  });
  root.innerHTML = '';
  root.append(el('div', { class: 'hint' }, `搜索「${query}」：找到 ${hits.length} 天`));
  for (const entry of hits.sort((a, b) => b.date.localeCompare(a.date))) {
    root.append(await renderRow(entry));
  }
  return hits.length;
}

export { toast };
