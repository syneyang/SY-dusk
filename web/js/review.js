// 分析：连续记录、统计、每月笔迹、日历、常去的地方。

import * as db from './db.js';
import { normalize, charCount, imageCount, allPlaces } from './model.js';
import { el, dateOf, isoOf, todayISO, monthTitle, WEEKDAYS } from './util.js';

export async function renderReview(root) {
  const entries = (await db.allEntries()).map(normalize).sort((a, b) => a.date.localeCompare(b.date));
  const today = todayISO();
  const year = Number(today.slice(0, 4));

  root.innerHTML = '';
  root.append(el('h1', { style: 'font-size:26px;margin:4px 0 2px' }, '分析'));

  if (!entries.length) {
    root.append(el('div', { class: 'empty' },
      el('span', { class: 'big' }, '◔'),
      '还没有可以分析的东西。',
      el('br'),
      '写满几天之后，这里会长出连续记录和日历。'
    ));
    return;
  }

  const all = computeStats(entries, today);
  const yearEntries = entries.filter((e) => e.date.startsWith(String(year)));

  // ---------- 连续记录 ----------
  root.append(el('div', { class: 'hint', style: 'margin-top:10px' }, '连续纪录'));
  root.append(el('div', { class: 'streak-grid' },
    el('div', { class: 'streak-main' },
      el('div', { class: 'streak-label' }, '当前连续记录'),
      el('div', { class: 'streak-value' }, String(all.currentDays)),
      el('div', { class: 'streak-unit' }, '天'),
      el('div', { class: 'streak-note' },
        all.currentDays > 0
          ? `从 ${shortDate(all.currentFrom)} 开始，坚持到今天`
          : '今天还没写，去写一句就能接上')
    ),
    el('div', { class: 'streak-side' },
      streakTile(String(all.longestDays), '天', '最长每日连续'),
      streakTile(String(all.longestWeeks), '周', '最长每周连续')
    )
  ));

  // ---------- 统计 ----------
  root.append(el('div', { class: 'hint', style: 'margin-top:22px' }, '统计数据'));

  const monthly = new Array(12).fill(0);
  for (const entry of yearEntries) monthly[Number(entry.date.slice(5, 7)) - 1] += 1;
  const max = Math.max(1, ...monthly);

  root.append(el('div', { class: 'stat-hero' },
    el('div', {},
      el('div', { class: 'stat-hero-value' }, String(yearEntries.length)),
      el('div', { class: 'stat-hero-label' }, `${year} 年 · 篇`)
    ),
    el('div', { class: 'mini-bars' },
      ...monthly.map((count, index) => el('div', { class: 'mini-bar-col' },
        el('div', {
          class: 'mini-bar',
          style: `height:${count ? Math.max(6, Math.round((count / max) * 46)) : 2}px;opacity:${count ? 1 : 0.25}`
        }),
        el('span', {}, String(index + 1))
      ))
    )
  ));

  root.append(el('div', { class: 'quad' },
    quad(String(all.daysAll), '已写手记', '天'),
    quad(String(all.photosAll), '照片', '张'),
    quad(String(all.placesCount), '去过地点', '处'),
    quad(String(all.charsAll), '已写', '字')
  ));

  root.append(el('div', { class: 'card', style: 'display:flex;align-items:flex-end;justify-content:space-between;text-align:center' },
    el('div', { style: 'flex:1.4' },
      el('div', { style: 'font-family:\'Songti SC\',serif;font-size:30px;line-height:1.1' }, String(all.charsAll)),
      el('div', { class: 'k' }, '总字数')),
    el('div', { style: 'flex:1' },
      el('div', { style: 'font-size:18px' }, String(all.charsYear)),
      el('div', { class: 'k' }, '今年')),
    el('div', { style: 'flex:1' },
      el('div', { style: 'font-size:18px' }, String(all.charsMonth)),
      el('div', { class: 'k' }, '本月'))
  ));

  // ---------- 日历 ----------
  root.append(el('div', { class: 'hint', style: 'margin-top:22px' }, '日历'));
  const calendarHost = el('div', { class: 'card' });
  root.append(calendarHost);

  let cursor = new Date(year, Number(today.slice(5, 7)) - 1, 1);
  const hasEntry = new Set(entries.map((e) => e.date));

  function renderCalendar() {
    calendarHost.innerHTML = '';
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const first = new Date(y, m, 1);
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const offset = first.getDay();

    const header = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:10px' },
      el('div', { style: 'font-size:15px;font-weight:600' }, `${y}年${m + 1}月`),
      el('div', { style: 'display:flex;gap:14px' },
        el('button', { class: 'cal-nav', onclick: () => { cursor = new Date(y, m - 1, 1); renderCalendar(); } }, '‹'),
        el('button', { class: 'cal-nav', onclick: () => { cursor = new Date(y, m + 1, 1); renderCalendar(); } }, '›')
      )
    );

    const grid = el('div', { class: 'cal' });
    for (const name of WEEKDAYS) grid.append(el('div', { class: 'wd' }, name.replace('周', '')));

    for (let i = 0; i < offset; i++) grid.append(el('div', { class: 'day blank' }));

    for (let d = 1; d <= daysInMonth; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const classes = ['day'];
      if (hasEntry.has(iso)) classes.push('has');
      if (iso === today) classes.push('today');
      if (iso > today) classes.push('future');
      grid.append(el('a', { class: classes.join(' '), href: `#/entry/${iso}` }, String(d)));
    }

    calendarHost.append(header, grid);
  }
  renderCalendar();

  // ---------- 常去的地方 ----------
  if (all.places.length) {
    root.append(el('div', { class: 'hint', style: 'margin-top:22px' }, '去过的地方'));
    root.append(el('div', { class: 'card' },
      el('div', { class: 'chips', style: 'margin:0' },
        ...all.places.slice(0, 14).map(([name, count]) =>
          el('span', { class: 'chip' }, `${name} ×${count}`))
      ),
      el('div', { class: 'hint' }, '接上高德之后，这里会按餐厅、商店、医院这样自动分类。')
    ));
  }
}

// ---------- 小部件 ----------

function streakTile(value, unit, label) {
  return el('div', { class: 'streak-tile' },
    el('div', { class: 'streak-tile-value' }, value, el('small', {}, unit)),
    el('div', { class: 'streak-tile-label' }, label)
  );
}

function quad(value, label, unit) {
  return el('div', { class: 'quad-item' },
    el('div', { class: 'quad-value' }, value),
    el('div', { class: 'quad-label' }, label, unit ? ` · ${unit}` : '')
  );
}

function shortDate(iso) {
  if (!iso) return '';
  return `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日`;
}

// ---------- 计算 ----------

function computeStats(entries, today) {
  const days = entries.map((e) => e.date);
  const daySet = new Set(days);
  const sorted = [...daySet].sort();

  // 连续天数
  let longestDays = 0;
  let run = 0;
  let prev = null;
  for (const iso of sorted) {
    run = prev && (dateOf(iso) - dateOf(prev)) === 86400000 ? run + 1 : 1;
    longestDays = Math.max(longestDays, run);
    prev = iso;
  }

  let currentDays = 0;
  let currentFrom = null;
  const cursor = dateOf(today);
  if (!daySet.has(today)) cursor.setDate(cursor.getDate() - 1);
  while (daySet.has(isoOf(cursor))) {
    currentDays += 1;
    currentFrom = isoOf(cursor);
    cursor.setDate(cursor.getDate() - 1);
  }

  // 连续周
  const weekSet = new Set(days.map(weekStart));
  const weeks = [...weekSet].sort();
  let longestWeeks = 0;
  let weekRun = 0;
  let prevWeek = null;
  for (const week of weeks) {
    weekRun = prevWeek && (dateOf(week) - dateOf(prevWeek)) === 7 * 86400000 ? weekRun + 1 : 1;
    longestWeeks = Math.max(longestWeeks, weekRun);
    prevWeek = week;
  }

  const thisMonth = today.slice(0, 7);
  const thisYear = today.slice(0, 4);

  return {
    daysAll: entries.length,
    charsAll: entries.reduce((sum, e) => sum + charCount(e), 0),
    charsMonth: entries.filter((e) => e.date.startsWith(thisMonth)).reduce((s, e) => s + charCount(e), 0),
    charsYear: entries.filter((e) => e.date.startsWith(thisYear)).reduce((s, e) => s + charCount(e), 0),
    photosAll: entries.reduce((sum, e) => sum + imageCount(e), 0),
    places: allPlaces(entries),
    placesCount: allPlaces(entries).length,
    currentDays,
    currentFrom,
    longestDays,
    longestWeeks
  };
}

function weekStart(iso) {
  const d = dateOf(iso);
  const day = d.getDay(); // 0=周日
  const diff = day === 0 ? -6 : 1 - day; // 回到周一
  d.setDate(d.getDate() + diff);
  return isoOf(d);
}

export { monthTitle };
