// 望：周 / 月 / 年三档。一眼看形状，不看字。

import * as db from './db.js';
import { normalize, charCount, imageCount, allPlaces } from './model.js';
import { el, dateOf, isoOf, todayISO } from './util.js';

export async function renderReview(root) {
  const entries = (await db.allEntries()).map(normalize).filter((entry) => !isEmptyEntry(entry));
  const chars = new Map();
  for (const entry of entries) {
    chars.set(entry.date, (chars.get(entry.date) || 0) + charCount(entry));
  }

  const today = todayISO();
  let mode = 'month';
  let cursor = dateOf(today);

  root.innerHTML = '';
  root.append(el('h1', { class: 'page-title' }, '回望'));

  const switcher = el('div', { class: 'seg' });
  const body = el('div', {});

  for (const [key, label] of [['week', '周'], ['month', '月'], ['year', '年']]) {
    switcher.append(el('button', {
      class: 'seg-btn' + (mode === key ? ' on' : ''),
      onclick: () => {
        mode = key;
        cursor = dateOf(today);
        paintSwitcher();
        render();
      }
    }, label));
  }

  function paintSwitcher() {
    [...switcher.children].forEach((btn, index) => {
      btn.classList.toggle('on', ['week', 'month', 'year'][index] === mode);
    });
  }

  root.append(switcher, renderStats(), body);

  function render() {
    body.innerHTML = '';
    if (!entries.length) {
      body.append(el('div', { class: 'empty' },
        el('span', { class: 'big' }, '◔'),
        '还没有可以回望的东西。',
        el('br'),
        '写几天，这里就会长出形状。'));
      return;
    }

    if (mode === 'week') body.append(renderWeek());
    else if (mode === 'month') body.append(renderMonth());
    else body.append(renderYear());

    body.append(renderFooter());
  }

  // ---------- 周 ----------
  function renderWeek() {
    const start = mondayOf(cursor);
    const days = [...Array(7)].map((_, i) => {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      return isoOf(d);
    });
    const counts = days.map((d) => chars.get(d) || 0);
    const max = Math.max(1, ...counts);
    const total = counts.reduce((a, b) => a + b, 0);

    const wrap = el('div', { class: 'card' });
    wrap.append(el('div', { class: 'wk-head' },
      el('div', {},
        el('div', { class: 'wk-title' }, `第 ${weekNumber(start)} 周`),
        el('div', { class: 'wk-range' }, `${md(days[0])} – ${md(days[6])}`)),
      navButtons(() => { cursor = addDays(cursor, -7); render(); }, () => { cursor = addDays(cursor, 7); render(); })
    ));

    for (let i = 0; i < 7; i++) {
      const iso = days[i];
      const count = counts[i];
      const width = count ? Math.max(4, Math.round((count / max) * 100)) : 0;
      wrap.append(el('a', {
        class: 'wk-row' + (count ? '' : ' empty') + (iso === today ? ' today' : ''),
        href: count ? `#/read/${iso}` : 'javascript:void 0',
        onclick: (event) => { if (!count) event.preventDefault(); }
      },
        el('span', { class: 'wk-day' }, `周${'一二三四五六日'[i]}`),
        el('span', { class: 'wk-track' }, el('span', { class: 'wk-bar', style: `width:${width}%` })),
        el('span', { class: 'wk-num' }, count ? String(count) : '—')
      ));
    }

    wrap.append(el('div', { class: 'wk-foot' },
      `这一周 ${total} 字 · ${counts.filter(Boolean).length} 天有记录`));
    return wrap;
  }

  // ---------- 月 ----------
  function renderMonth() {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const offset = (new Date(year, month, 1).getDay() + 6) % 7; // 周一开头
    const days = new Date(year, month + 1, 0).getDate();

    const values = [];
    for (let d = 1; d <= days; d++) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      values.push({ iso, day: d, count: chars.get(iso) || 0 });
    }
    const max = Math.max(1, ...values.map((v) => v.count));
    const written = values.filter((v) => v.count).length;
    const total = values.reduce((a, b) => a + b.count, 0);

    const wrap = el('div', { class: 'card' });
    wrap.append(el('div', { class: 'wk-head' },
      el('div', {},
        el('div', { class: 'wk-title' }, `${year} 年 ${month + 1} 月`),
        el('div', { class: 'wk-range' }, `${written} 天有记录 · ${total} 字`)),
      navButtons(() => { cursor = new Date(year, month - 1, 1); render(); }, () => { cursor = new Date(year, month + 1, 1); render(); })
    ));

    const grid = el('div', { class: 'mo-grid' });
    for (const w of ['一', '二', '三', '四', '五', '六', '日']) {
      grid.append(el('div', { class: 'mo-wd' }, w));
    }
    for (let i = 0; i < offset; i++) grid.append(el('div', { class: 'mo-cell blank' }));

    for (const v of values) {
      const depth = v.count ? 0.18 + (v.count / max) * 0.72 : 0;
      grid.append(el('a', {
        class: 'mo-cell' + (v.count ? ' has' : '') + (v.iso === today ? ' today' : ''),
        href: v.count ? `#/read/${v.iso}` : 'javascript:void 0',
        onclick: (event) => { if (!v.count) event.preventDefault(); },
        style: v.count ? `background: rgba(205,111,58,${depth.toFixed(2)})` : ''
      }, el('span', { class: 'mo-day' }, String(v.day))));
    }

    wrap.append(grid);
    return wrap;
  }

  // ---------- 年 ----------
  function renderYear() {
    const year = cursor.getFullYear();
    const monthly = new Array(12).fill(0);
    const dots = new Map();

    for (const entry of entries) {
      if (!entry.date.startsWith(String(year))) continue;
      const m = Number(entry.date.slice(5, 7)) - 1;
      monthly[m] += charCount(entry);
      dots.set(entry.date, charCount(entry));
    }

    const max = Math.max(1, ...monthly);
    const total = monthly.reduce((a, b) => a + b, 0);
    const written = dots.size;

    const wrap = el('div', { class: 'card' });
    wrap.append(el('div', { class: 'wk-head' },
      el('div', {},
        el('div', { class: 'wk-title' }, `${year} 年`),
        el('div', { class: 'wk-range' }, `${written} 天 · ${total} 字`)),
      navButtons(() => { cursor = new Date(year - 1, 0, 1); render(); }, () => { cursor = new Date(year + 1, 0, 1); render(); })
    ));

    const bars = el('div', { class: 'yr-bars' });
    for (let m = 0; m < 12; m++) {
      const h = monthly[m] ? Math.max(6, Math.round((monthly[m] / max) * 100)) : 2;
      bars.append(el('div', { class: 'yr-col', title: `${m + 1} 月 ${monthly[m]} 字` },
        el('div', { class: 'yr-bar', style: `height:${h}%` }),
        el('span', { class: 'yr-label' }, String(m + 1))
      ));
    }
    wrap.append(bars);

    const matrix = el('div', { class: 'yr-matrix' });
    for (let m = 0; m < 12; m++) {
      const row = el('div', { class: 'yr-row' }, el('span', { class: 'yr-mlabel' }, String(m + 1)));
      const daysInMonth = new Date(year, m + 1, 0).getDate();
      for (let d = 1; d <= 31; d++) {
        if (d > daysInMonth) { row.append(el('span', { class: 'yr-dot blank' })); continue; }
        const iso = `${year}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const count = dots.get(iso) || 0;
        row.append(el('span', {
          class: 'yr-dot' + (count ? ' on' : ''),
          style: count ? `opacity:${(0.35 + Math.min(1, count / 400) * 0.65).toFixed(2)}` : ''
        }));
      }
      matrix.append(row);
    }
    wrap.append(matrix);

    const places = allPlaces(entries.filter((e) => e.date.startsWith(String(year))));
    if (places.length) {
      wrap.append(el('div', { class: 'yr-places' },
        el('div', { class: 'hint', style: 'margin:0 0 6px' }, '常去的地方'),
        el('div', { class: 'chips', style: 'margin:0' },
          ...places.slice(0, 8).map(([name, count]) => el('span', { class: 'chip' }, `${name} ×${count}`)))
      ));
    }
    return wrap;
  }

  function renderStats() {
    const daySet = new Set(entries.map((e) => e.date));
    const sorted = [...daySet].sort();
    let longest = 0;
    let run = 0;
    let prev = null;
    for (const iso of sorted) {
      run = prev && (dateOf(iso) - dateOf(prev)) === 86400000 ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = iso;
    }
    let current = 0;
    const cursorDay = dateOf(today);
    if (!daySet.has(today)) cursorDay.setDate(cursorDay.getDate() - 1);
    while (daySet.has(isoOf(cursorDay))) {
      current += 1;
      cursorDay.setDate(cursorDay.getDate() - 1);
    }
    const totalChars = [...chars.values()].reduce((a, b) => a + b, 0);
    const photos = entries.reduce((sum, e) => sum + imageCount(e), 0);
    const places = allPlaces(entries).length;

    const tile = (value, label) => el('div', { class: 'st' },
      el('div', { class: 'st-v' }, String(value)),
      el('div', { class: 'st-k' }, label));

    return el('div', { class: 'st-row' },
      tile(`${current}`, '连续天数'),
      tile(`${longest}`, '最长连续'),
      tile(`${entries.length}`, '写过天数'),
      tile(`${totalChars}`, '总字数'),
      tile(`${photos}`, '照片'),
      tile(`${places}`, '地点')
    );
  }

  function renderFooter() {
    const photos = entries.reduce((sum, e) => sum + imageCount(e), 0);
    const totalChars = [...chars.values()].reduce((a, b) => a + b, 0);
    return el('div', { class: 'hint', style: 'text-align:center;margin-top:18px' },
      `全部：${entries.length} 天 · ${totalChars} 字 · ${photos} 张照片`);
  }

  function navButtons(onPrev, onNext) {
    return el('div', { class: 'wk-nav' },
      el('button', { class: 'seg-btn', onclick: onPrev }, '‹'),
      el('button', { class: 'seg-btn', onclick: onNext }, '›'));
  }

  paintSwitcher();
  render();
}

// ---------- 小工具 ----------

function mondayOf(date) {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, delta) {
  const d = new Date(date);
  d.setDate(d.getDate() + delta);
  return d;
}

function md(iso) {
  return `${Number(iso.slice(5, 7))}.${Number(iso.slice(8, 10))}`;
}

function weekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
