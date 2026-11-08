// 回望：这一年写了多少、去了哪、照片多少。

import * as db from './db.js';
import { normalize, charCount, imageCount, allPlaces, allRegions } from './model.js';
import { el, dateOf } from './util.js';

export async function renderReview(root) {
  const entries = (await db.allEntries()).map(normalize).sort((a, b) => a.date.localeCompare(b.date));
  const year = new Date().getFullYear();

  root.innerHTML = '';
  root.append(el('h1', { style: 'font-size:26px;margin:4px 0 2px' }, '回望'));

  if (!entries.length) {
    root.append(el('div', { class: 'empty' },
      el('span', { class: 'big' }, '◔'),
      '还没有可以回望的东西。',
      el('br'),
      '写满几天之后，这里会长出图表和关键词。'
    ));
    return;
  }

  const yearEntries = entries.filter((e) => e.date.startsWith(String(year)));
  const days = yearEntries.length;
  const chars = yearEntries.reduce((sum, e) => sum + charCount(e), 0);
  const photos = yearEntries.reduce((sum, e) => sum + imageCount(e), 0);
  const places = allPlaces(entries);
  const regions = allRegions(entries);

  root.append(
    el('div', { class: 'entry-sub', style: 'margin:6px 0 4px' }, `${year} 年，以及所有写过的日子`)
  );

  root.append(el('div', { class: 'stats' },
    stat(String(days), '写过天数'),
    stat(String(chars), '总字数'),
    stat(String(photos), '照片'),
    stat(String(places.length), '去过的地点')
  ));

  // 每月柱状图
  const monthly = new Array(12).fill(0);
  for (const entry of yearEntries) {
    const m = Number(entry.date.slice(5, 7)) - 1;
    monthly[m] += 1;
  }
  const max = Math.max(1, ...monthly);

  const bars = el('div', { style: 'display:flex;align-items:flex-end;gap:6px;height:100px;margin-top:10px' });
  monthly.forEach((count, index) => {
    const height = Math.max(3, Math.round((count / max) * 92));
    bars.append(el('div', { style: 'flex:1;display:flex;flex-direction:column;align-items:center;gap:4px' },
      el('div', { style: `width:100%;height:${height}px;border-radius:4px 4px 2px 2px;background:${count ? 'var(--dawn)' : 'var(--hairline)'}` }),
      el('div', { style: 'font-size:9px;color:var(--ink-soft)' }, String(index + 1))
    ));
  });

  root.append(el('div', { class: 'card' },
    el('h3', {}, '每月的笔迹'),
    bars,
    el('div', { class: 'hint' }, `${year} 年一共 ${days} 天有记录`)
  ));

  // 连续记录
  const { current, longest } = streaks(entries.map((e) => e.date));

  root.append(el('div', { class: 'stats', style: 'margin-top:10px' },
    stat(String(current), '当前连续'),
    stat(String(longest), '最长连续')
  ));

  if (places.length) {
    root.append(el('div', { class: 'card' },
      el('h3', {}, '常去的地方'),
      el('div', { class: 'chips' }, ...places.slice(0, 12).map(([name, count]) =>
        el('span', { class: 'chip' }, `${name} ×${count}`)))
    ));
  }

  if (regions.length) {
    root.append(el('div', { class: 'card' },
      el('h3', {}, '反复出现的区域'),
      el('div', { class: 'chips' }, ...regions.slice(0, 12).map(([name, count]) =>
        el('span', { class: 'chip region' }, `${name} ×${count}`)))
    ));
  }
}

function stat(value, label) {
  return el('div', { class: 'stat' }, el('div', { class: 'v' }, value), el('div', { class: 'k' }, label));
}

function streaks(dateStrings) {
  if (!dateStrings.length) return { current: 0, longest: 0 };
  const set = new Set(dateStrings);
  const sorted = [...set].sort();
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i++) {
    const diff = (dateOf(sorted[i]) - dateOf(sorted[i - 1])) / 86400000;
    run = diff === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
  }
  let current = 0;
  const cursor = new Date();
  if (!set.has(iso(cursor))) cursor.setDate(cursor.getDate() - 1);
  while (set.has(iso(cursor))) {
    current += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { current, longest };
}

function iso(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
