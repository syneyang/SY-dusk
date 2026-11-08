// 地点选择器：先看附近有什么，也可以搜。搜索会优先限定在当前城市。

import { el, debounce } from './util.js';

export function openPlacePicker({ existing = [], title = '选择地点' } = {}) {
  return new Promise((resolve) => {
    const chosen = new Map();
    const taken = new Set(existing);

    let cityShort = '';
    let cityFull = '';
    let district = '';
    let coords = null;
    let lastQuery = '';

    const list = el('div', { class: 'place-list' });
    const status = el('div', { class: 'sheet-status' }, '正在定位…');
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

    // ---------- 定位 ----------
    function loadPosition() {
      if (!navigator.geolocation) {
        status.textContent = '这个浏览器不支持定位，用上面的搜索框找地点';
        return;
      }
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          coords = { lat: position.coords.latitude, lng: position.coords.longitude };
          try {
            const response = await fetch(`/api/regeo?lat=${coords.lat}&lng=${coords.lng}`);
            const data = await response.json();
            if (data.ok) {
              cityFull = data.city || '';
              cityShort = data.cityShort || '';
              district = data.district || '';
            }
          } catch {
            // 拿不到城市也能用附近
          }
          loadNearby();
        },
        (error) => {
          status.textContent = error.code === 1
            ? '没拿到定位（权限被拒），用上面的搜索框找地点'
            : '定位超时，用上面的搜索框找地点';
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
      );
    }

    async function loadNearby() {
      if (!coords) return;
      status.textContent = `正在找附近的地点${placeLabel()}…`;
      try {
        const response = await fetch(`/api/nearby?lat=${coords.lat}&lng=${coords.lng}&radius=2000`);
        const data = await response.json();
        if (!data.ok) {
          status.textContent = '附近地点拿不到，用搜索框找吧';
          return;
        }
        const places = data.places || [];
        status.textContent = `附近 ${places.length} 个地点 · ${placeLabel()}`;
        if (!lastQuery) render(places);
      } catch {
        status.textContent = '附近地点拿不到，用搜索框找吧';
      }
    }

    function placeLabel() {
      return [cityShort, district].filter(Boolean).join(' ');
    }

    // ---------- 搜索（先限城市，找不到再全国） ----------
    const runSearch = debounce((q) => searchFor(q), 320);

    async function searchFor(q) {
      lastQuery = q;
      status.textContent = '搜索中…';
      try {
        const limited = await fetchPlaces(q, true);
        if (limited.ok && limited.places.length) {
          status.textContent = `${cityShort || '本地'} · ${limited.places.length} 个结果`;
          render(limited.places, true);
          return;
        }
        const wide = await fetchPlaces(q, false);
        if (wide.ok && wide.places.length) {
          status.textContent = `${cityShort || '本地'}没找到，以下是全国的`;
          render(wide.places, true);
          return;
        }
        status.textContent = '高德没有收录，可以直接添加这个名字';
        render([], true);
      } catch {
        status.textContent = '网络不太行，可以直接添加这个名字';
        render([], true);
      }
    }

    async function fetchPlaces(q, inCity) {
      const params = new URLSearchParams({ q });
      if (inCity && cityShort) params.set('city', cityShort);
      const response = await fetch(`/api/places?${params}`);
      return response.json();
    }

    search.addEventListener('input', () => {
      const q = search.value.trim();
      if (q) runSearch(q);
      else if (coords) { lastQuery = ''; loadNearby(); }
      else list.innerHTML = '';
    });

    // ---------- 渲染 ----------
    function render(places, showManual = false) {
      list.innerHTML = '';

      for (const place of places) {
        const name = place.name || '';
        if (!name) continue;
        const isTaken = taken.has(name);
        const isChosen = chosen.has(name);

        list.append(el('button', {
          class: 'place-item' + (isTaken ? ' taken' : '') + (isChosen ? ' chosen' : ''),
          onclick: () => {
            if (isTaken) return;
            if (chosen.has(name)) chosen.delete(name);
            else chosen.set(name, place);
            doneBtn.textContent = chosen.size ? `完成 (${chosen.size})` : '完成';
            render(places, showManual);
          }
        },
          el('div', { class: 'place-text' },
            el('div', { class: 'place-name' }, name),
            el('div', { class: 'place-meta' }, metaLine(place, isTaken))
          ),
          el('div', { class: 'place-mark' }, isTaken ? '已添加' : (isChosen ? '✓' : '＋'))
        ));
      }

      if (showManual && lastQuery && !places.some((p) => p.manual) && !taken.has(lastQuery)) {
        const name = lastQuery;
        const isChosen = chosen.has(name);
        list.append(el('button', {
          class: 'place-item' + (isChosen ? ' chosen' : ''),
          onclick: () => {
            if (chosen.has(name)) chosen.delete(name);
            else chosen.set(name, { name });
            doneBtn.textContent = chosen.size ? `完成 (${chosen.size})` : '完成';
            render(places, showManual);
          }
        },
          el('div', { class: 'place-text' },
            el('div', { class: 'place-name' }, `直接添加「${name}」`),
            el('div', { class: 'place-meta' }, '不关联地图，只记下这个名字')
          ),
          el('div', { class: 'place-mark' }, isChosen ? '✓' : '＋')
        ));
      }
    }

    loadPosition();
  });
}

function metaLine(place, taken) {
  if (taken) return '这一天已经有这个地点了';
  if (place.manual) return '直接添加这个地名';
  const bits = [];
  if (place.district) bits.push(place.district);
  if (place.address && place.address !== place.district) bits.push(place.address);
  if (place.distance) bits.push(place.distance < 1000 ? `${place.distance}m` : `${(place.distance / 1000).toFixed(1)}km`);
  return bits.join(' · ');
}
