// 地点选择器：最近去过 / 附近 / 搜索，可一次勾选多个。

import { el, debounce, dateOf, isoOf } from './util.js';
import { placeName } from './model.js';
import * as db from './db.js';

const RECENT_DAYS = 45;

export function openPlacePicker({ existing = [], title = '选择地点' } = {}) {
  return new Promise((resolve) => {
    const chosen = new Map();
    const taken = new Set(existing);

    let cityShort = '';
    let district = '';
    let coords = null;
    let lastQuery = '';
    let recent = [];
    let nearby = [];
    let mode = 'browse';

    const list = el('div', { class: 'place-list' });
    const status = el('div', { class: 'sheet-status' }, '正在准备…');
    const search = el('input', {
      class: 'sheet-search',
      type: 'search',
      placeholder: '搜索：商场、小区、路名、店名…',
      autocomplete: 'off'
    });
    const doneBtn = el('button', { class: 'sheet-done' }, '完成');

    const panel = el('div', { class: 'sheet', onclick: (e) => e.stopPropagation() },
      el('div', { class: 'sheet-grip' }),
      el('div', { class: 'sheet-head' },
        el('div', { class: 'sheet-title' }, title),
        doneBtn
      ),
      search,
      status,
      list
    );

    const backdrop = el('div', { class: 'sheet-backdrop', onclick: () => close() }, panel);
    document.body.append(backdrop);
    requestAnimationFrame(() => backdrop.classList.add('show'));

    function close() {
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 200);
      resolve([...chosen.values()]);
    }

    doneBtn.addEventListener('click', close);

    // ---------- 最近去过 ----------
    async function loadRecent() {
      const cutoff = isoOf(new Date(Date.now() - RECENT_DAYS * 86400000));
      const entries = (await db.allEntries()).filter((e) => e.date >= cutoff);
      const map = new Map();

      for (const entry of entries) {
        for (const place of entry.places || []) {
          const name = placeName(place);
          if (!name) continue;
          const prev = map.get(name);
          if (!prev) {
            map.set(name, {
              name,
              district: place.district || '',
              lat: place.lat ?? null,
              lng: place.lng ?? null,
              lastDate: entry.date,
              count: 1
            });
          } else {
            prev.count += 1;
            if (entry.date > prev.lastDate) prev.lastDate = entry.date;
          }
        }
      }

      recent = [...map.values()]
        .sort((a, b) => (b.lastDate === a.lastDate ? b.count - a.count : b.lastDate.localeCompare(a.lastDate)))
        .slice(0, 12);
    }

    // ---------- 定位 + 附近 ----------
    function loadPosition() {
      if (!navigator.geolocation) {
        status.textContent = '不支持定位，可以搜索，或从「最近去过」里挑';
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          coords = { lat: position.coords.latitude, lng: position.coords.longitude };
          try {
            const response = await fetch(`/api/regeo?lat=${coords.lat}&lng=${coords.lng}`);
            const data = await response.json();
            if (data.ok) {
              cityShort = data.cityShort || '';
              district = data.district || '';
            }
          } catch {
            // 没有城市信息也能看附近
          }
          loadNearby();
        },
        () => {
          status.textContent = recent.length
            ? '没拿到定位，可以从「最近去过」里挑，或者搜索'
            : '没拿到定位，用搜索框找地点';
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    }

    async function loadNearby() {
      if (!coords) return;
      try {
        const response = await fetch(`/api/nearby?lat=${coords.lat}&lng=${coords.lng}&radius=2000`);
        const data = await response.json();
        if (!data.ok) {
          status.textContent = '附近地点拿不到，可以搜索或从「最近去过」里挑';
          return;
        }
        nearby = data.places || [];
        if (mode === 'browse') {
          status.textContent = `附近 ${nearby.length} 个 · ${[cityShort, district].filter(Boolean).join(' ')}`;
          renderBrowse();
        }
      } catch {
        status.textContent = '附近地点拿不到，可以搜索或从「最近去过」里挑';
      }
    }

    // ---------- 搜索 ----------
    const runSearch = debounce((q) => searchFor(q), 320);

    async function searchFor(q) {
      lastQuery = q;
      mode = 'search';
      status.textContent = '搜索中…';
      try {
        const limited = await fetchPlaces(q, true);
        if (limited.ok && limited.places.length) {
          status.textContent = `${cityShort || '本地'} · ${limited.places.length} 个结果`;
          renderResults(limited.places, true);
          return;
        }
        const wide = await fetchPlaces(q, false);
        if (wide.ok && wide.places.length) {
          status.textContent = `${cityShort || '本地'}没找到，以下是全国的`;
          renderResults(wide.places, true);
          return;
        }
        status.textContent = '高德没有收录，可以直接添加这个名字';
        renderResults([], true);
      } catch {
        status.textContent = '网络不太行，可以直接添加这个名字';
        renderResults([], true);
      }
    }

    async function fetchPlaces(q, inCity) {
      const params = new URLSearchParams({ q });
      if (inCity && cityShort) params.set('city', cityShort);
      return (await fetch(`/api/places?${params}`)).json();
    }

    search.addEventListener('input', () => {
      const q = search.value.trim();
      if (q) {
        runSearch(q);
      } else {
        mode = 'browse';
        lastQuery = '';
        renderBrowse();
        if (coords) status.textContent = `附近 ${nearby.length} 个 · ${[cityShort, district].filter(Boolean).join(' ')}`;
      }
    });

    // ---------- 渲染 ----------
    function toggle(place) {
      const name = placeName(place);
      if (taken.has(name)) return;
      if (chosen.has(name)) chosen.delete(name);
      else chosen.set(name, place);
      doneBtn.textContent = chosen.size ? `完成 (${chosen.size})` : '完成';
    }

    function placeRow(place, rerender) {
      const name = placeName(place);
      const isTaken = taken.has(name);
      const isChosen = chosen.has(name);
      return el('button', {
        class: 'place-item' + (isTaken ? ' taken' : '') + (isChosen ? ' chosen' : ''),
        onclick: () => {
          toggle(place);
          rerender();
        }
      },
        el('div', { class: 'place-text' },
          el('div', { class: 'place-name' }, name),
          el('div', { class: 'place-meta' }, metaLine(place, isTaken))
        ),
        el('div', { class: 'place-mark' }, isTaken ? '已添加' : (isChosen ? '✓' : '＋'))
      );
    }

    function renderBrowse() {
      list.innerHTML = '';

      if (recent.length) {
        list.append(el('div', { class: 'place-group' }, '最近去过'));
        for (const place of recent) list.append(placeRow(place, renderBrowse));
      }

      if (nearby.length) {
        list.append(el('div', { class: 'place-group' }, '附近'));
        for (const place of nearby) list.append(placeRow(place, renderBrowse));
      }

      if (!recent.length && !nearby.length) {
        list.append(el('div', { class: 'suggest-empty' }, '在搜索框里输入地名，或者等定位出来'));
      }
    }

    function renderResults(places, showManual) {
      list.innerHTML = '';
      for (const place of places) list.append(placeRow(place, () => renderResults(places, showManual)));

      if (showManual && lastQuery && !places.some((p) => p.manual) && !taken.has(lastQuery)) {
        const name = lastQuery;
        list.append(el('button', {
          class: 'place-item' + (chosen.has(name) ? ' chosen' : ''),
          onclick: () => {
            if (chosen.has(name)) chosen.delete(name);
            else chosen.set(name, { name });
            doneBtn.textContent = chosen.size ? `完成 (${chosen.size})` : '完成';
            renderResults(places, showManual);
          }
        },
          el('div', { class: 'place-text' },
            el('div', { class: 'place-name' }, `直接添加「${name}」`),
            el('div', { class: 'place-meta' }, '不关联地图，只记下这个名字')
          ),
          el('div', { class: 'place-mark' }, chosen.has(name) ? '✓' : '＋')
        ));
      }
    }

    // 先把「最近去过」显示出来，定位慢也不耽误
    (async () => {
      await loadRecent();
      renderBrowse();
      status.textContent = recent.length ? '正在定位…（也可以直接从最近去过的里挑）' : '正在定位…';
      loadPosition();
    })();
  });
}

function metaLine(place, taken) {
  if (taken) return '这一天已经有这个地点了';
  if (place.manual) return '直接添加这个地名';
  const bits = [];
  if (place.district) bits.push(place.district);
  if (place.address && place.address !== place.district) bits.push(place.address);
  if (place.lastDate && !place.address) {
    const d = dateOf(place.lastDate);
    bits.push(`${d.getMonth() + 1}月${d.getDate()}日去过`);
  }
  if (place.distance) bits.push(place.distance < 1000 ? `${place.distance}m` : `${(place.distance / 1000).toFixed(1)}km`);
  return bits.join(' · ');
}
