// 时光：按年月分组的列表，可搜索。

import * as db from './db.js';
import { normalize, firstLine, imageIds, charCount, plainText, placeName } from './model.js';
import { el, monthTitle, weekdayCN, debounce } from './util.js';

export async function renderList(root) {
  const entries = (await db.allEntries()).map(normalize).sort((a, b) => b.date.localeCompare(a.date));

  root.innerHTML = '';
  root.append(el('h1', { class: 'page-title' }, '时光'));

  if (!entries.length) {
    root.append(el('div', { class: 'empty' },
      el('span', { class: 'big' }, '▤'),
      '还是一片空白。',
      el('br'),
      el('a', { href: '#/today', style: 'color:var(--dawn)' }, '去写第一篇 ›')
    ));
    return;
  }

  const search = el('input', {
    class: 'tl-search',
    type: 'search',
    placeholder: '搜一段记忆：字、地点、天气…',
    autocomplete: 'off'
  });
  const stat = el('div', { class: 'tl-stat' }, `一共 ${entries.length} 天有记录`);
  const listHost = el('div', {});

  root.append(search, stat, listHost);

  const render = (query) => {
    const q = (query || '').trim().toLowerCase();
    const hits = q
      ? entries.filter((entry) =>
          plainText(entry).toLowerCase().includes(q)
          || (entry.places || []).map(placeName).join(' ').toLowerCase().includes(q)
          || (entry.regions || []).map(placeName).join(' ').toLowerCase().includes(q)
          || (entry.weather || '').toLowerCase().includes(q))
      : entries;

    stat.textContent = q ? `找到 ${hits.length} 天` : `一共 ${entries.length} 天有记录`;
    listHost.innerHTML = '';

    if (!hits.length) {
      listHost.append(el('div', { class: 'empty' }, '没找到。', el('br'), '换个词，或者清空搜索框。'));
      return;
    }

    let lastMonth = '';
    for (const entry of hits) {
      const month = entry.date.slice(0, 7);
      if (month !== lastMonth) {
        lastMonth = month;
        const count = hits.filter((e) => e.date.startsWith(month)).length;
        listHost.append(el('div', { class: 'tl-month' },
          el('span', {}, monthTitle(month)),
          el('span', { class: 'tl-month-count' }, `${count} 篇`)
        ));
      }
      listHost.append(renderRow(entry));
    }
  };

  search.addEventListener('input', debounce((e) => render(e.target.value), 200));
  render('');
}

function renderRow(entry) {
  const day = Number(entry.date.slice(8, 10));
  const title = firstLine(entry) || (imageIds(entry).length ? '只有照片的一天' : '空白的一天');

  const meta = [`${day}日 ${weekdayCN(entry.date)}`];
  const sky = weatherSummary(entry);
  if (sky) meta.push(sky);
  const images = imageIds(entry).length;
  if (images) meta.push(`${images} 张`);
  const chars = charCount(entry);
  if (chars) meta.push(`${chars} 字`);

  const thumbHost = el('div', { class: 'tl-thumb-slot' });
  const ids = imageIds(entry);
  if (ids.length) {
    db.getImage(ids[0]).then((record) => {
      if (!record) return;
      const url = URL.createObjectURL(record.thumb || record.blob);
      thumbHost.append(el('img', { class: 'tl-thumb', src: url, alt: '', loading: 'lazy' }));
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    });
  }

  return el('a', { class: 'tl-row', href: `#/read/${entry.date}` },
    el('div', { class: 'tl-main' },
      el('div', { class: 'tl-title' }, title),
      el('div', { class: 'tl-meta' }, ...meta.map((text, index) =>
        el('span', { class: index === 1 && entry.weather ? 'tl-weather' : '' }, text)))
    ),
    thumbHost
  );
}
