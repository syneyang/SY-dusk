// 地点选择器：先看附近有什么，也可以搜；可一次勾选多个。

import { el, debounce } from './util.js';

export function openPlacePicker({ existing = [], title = '选择地点' } = {}) {
  return new Promise((resolve) => {
    const chosen = new Map();
    const taken = new Set(existing);

    const list = el('div', { class: 'place-list' });
    const status = el('div', { class: 'sheet-status' }, '');
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

    let nearbyPlaces = [];
    let searchResults = [];
    let geoState = 'loading'; // loading | ok | denied | unsupported

    function close() {
      backdrop.classList.remove('show');
      setTimeout(() => backdrop.remove(), 200);
      resolve([...chosen.values()]);
    }

    doneBtn.addEventListener('click', close);
    search.addEventListener('input', () => {
      if (search.value.trim()) runSearch(search.value);
      else render(nearbyPlaces, '');
    });

    const runSearch = debounce(async (query) => {
      const q = query.trim();
      if (q.length < 2) return;
      status.textContent = '搜索中…';
      try {
        const response = await fetch(`/api/places?q=${encodeURIComponent(q)}`);
        const data = await response.json();
        if (!data.ok) {
          status.textContent = '搜索不可用，可以直接添加这个地名';
          render([{ name: q, manual: true }], `「${q}」`);
          return;
        }
        searchResults = data.places || [];
        if (!searchResults.length) {
          status.textContent = '没搜到';
          render([{ name: q, manual: true }], `「${q}」`);
          return;
        }
        status.textContent = `${searchResults.length} 个结果`;
        render(searchResults, '搜索结果');
      } catch {
        status.textContent = '网络不太行，可以直接添加这个地名';
        render([{ name: q, manual: true }], `「${q}」`);
      }
    }, 320);

    async function loadNearby() {
      if (!navigator.geolocation) {
        geoState = 'unsupported';
        status.textContent = '这个浏览器不支持定位，用上面的搜索框找地点';
        return;
      }
      status.textContent = '正在定位，找附近的地点…';
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          geoState = 'ok';
          try {
            const { latitude, longitude } = position.coords;
            const response = await fetch(`/api/nearby?lat=${latitude}&lng=${longitude}&radius=1500`);
            const data = await response.json();
            if (!data.ok) {
              status.textContent = '附近地点拿不到，用搜索框找吧';
              return;
            }
            nearbyPlaces = data.places || [];
            status.textContent = `附近 ${nearbyPlaces.length} 个地点`;
            if (!search.value.trim()) render(nearbyPlaces, '');
          } catch {
            status.textContent = '附近地点拿不到，用搜索框找吧';
          }
        },
        () => {
          geoState = 'denied';
          status.textContent = '没拿到定位，用上面的搜索框找地点';
        },
        { timeout: 8000, maximumAge: 5 * 60 * 1000 }
      );
    }

    function render(places, label) {
      list.innerHTML = '';
      if (label) list.append(el('div', { class: 'place-group' }, label));

      for (const place of places) {
        const name = place.name || '';
        if (!name) continue;
        const isTaken = taken.has(name);
        const isChosen = chosen.has(name);

        const row = el('button', {
          class: 'place-item' + (isTaken ? ' taken' : '') + (isChosen ? ' chosen' : ''),
          onclick: () => {
            if (isTaken) return;
            if (chosen.has(name)) chosen.delete(name);
            else chosen.set(name, place);
            doneBtn.textContent = chosen.size ? `完成 (${chosen.size})` : '完成';
            render(places, label);
          }
        },
          el('div', { class: 'place-text' },
            el('div', { class: 'place-name' }, name),
            el('div', { class: 'place-meta' }, metaLine(place, isTaken))
          ),
          el('div', { class: 'place-mark' }, isTaken ? '已添加' : (isChosen ? '✓' : '＋'))
        );

        list.append(row);
      }
    }

    loadNearby();
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

