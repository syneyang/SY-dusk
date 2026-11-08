// 记日记的主界面：表头 + 图文交替的正文。

import * as db from './db.js';
import {
  newEntry, normalize, compressImage, charCount, imageCount, placeName
} from './model.js';
import {
  el, toast, debounce, todayISO, prevISO, weekdayCN, monthDayCN, fullCN, daysBetween
} from './util.js';

let current = null;

export function flushSave() {
  if (current && current.saveNow) current.saveNow();
}

export async function renderEditor(root, dateISO) {
  const date = dateISO || todayISO();
  const stored = normalize(await db.getEntry(date));
  const entry = stored || newEntry(date);
  const journeyStart = await db.getMeta('journeyStart', '2027-01-01');
  const objectURLs = [];
  const isToday = date === todayISO();

  root.innerHTML = '';

  // ---------- 头部 ----------
  const dayIndex = daysBetween(journeyStart, date) + 1;

  const head = el('header', { class: 'entry-head' },
    el('div', {},
      el('div', { class: 'entry-date' }, monthDayCN(date)),
      el('div', { class: 'entry-sub' },
        `${weekdayCN(date)} · ${date.slice(0, 4)}` + (dayIndex > 0 ? ` · 第 ${dayIndex} 天` : '')
      )
    )
  );

  const dateInput = el('input', {
    type: 'date',
    value: date,
    max: todayISO(),
    onchange: (e) => { location.hash = `#/entry/${e.target.value}`; }
  });

  const datePill = el('div', { class: 'date-picker-wrap' },
    el('button', { class: 'ghost', style: 'padding:5px 12px;font-size:12px' }, fullCN(date) + ' ▾'),
    dateInput
  );

  // ---------- 天气 ----------
  const weatherInput = el('input', {
    type: 'text',
    value: entry.weather || '',
    placeholder: '晴 18~24℃',
    oninput: (e) => { entry.weather = e.target.value; scheduleSave(); }
  });
  const weatherHint = el('div', { class: 'hint', style: 'display:none' });

  // ---------- 地点 ----------
  const placesChips = el('div', { class: 'chips' });
  const placeInput = el('input', {
    type: 'text',
    placeholder: '+ 搜索地点，比如「丁桥」',
    autocomplete: 'off',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const value = e.target.value.trim();
      if (value) addPlace({ name: value });
      e.target.value = '';
      clearSuggestions();
    }
  });
  const placeSuggest = el('div', { class: 'suggest' });

  // ---------- 区域 ----------
  const regionChips = el('div', { class: 'chips' });
  const regionInput = el('input', {
    type: 'text',
    placeholder: '+ 区域，比如「拱墅区」',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const value = e.target.value.trim();
      if (value) addRegion(value);
      e.target.value = '';
    }
  });

  function addRegion(name) {
    const clean = (name || '').trim();
    if (!clean) return;
    if (!entry.regions.some((r) => placeName(r) === clean)) entry.regions.push(clean);
    renderRegions();
    scheduleSave();
  }

  function addPlace(place) {
    const name = placeName(place).trim();
    if (!name) return;
    if (!entry.places.some((p) => placeName(p) === name)) {
      entry.places.push({
        name,
        district: place.district || '',
        lat: place.lat ?? null,
        lng: place.lng ?? null
      });
    }
    if (place.district && !entry.regions.some((r) => placeName(r) === place.district)) {
      entry.regions.push(place.district);
      renderRegions();
    }
    renderPlaces();
    clearSuggestions();
    scheduleSave();
  }

  function renderPlaces() {
    placesChips.innerHTML = '';
    for (const place of entry.places) {
      const name = placeName(place);
      placesChips.append(el('button', {
        class: 'chip',
        onclick: () => {
          entry.places = entry.places.filter((p) => placeName(p) !== name);
          renderPlaces();
          scheduleSave();
        }
      }, name, el('span', { class: 'x' }, '×')));
    }
  }

  function renderRegions() {
    regionChips.innerHTML = '';
    for (const region of entry.regions) {
      const name = placeName(region);
      regionChips.append(el('button', {
        class: 'chip region',
        onclick: () => {
          entry.regions = entry.regions.filter((r) => placeName(r) !== name);
          renderRegions();
          scheduleSave();
        }
      }, name, el('span', { class: 'x' }, '×')));
    }
  }

  renderPlaces();
  renderRegions();

  function clearSuggestions() {
    placeSuggest.innerHTML = '';
    placeSuggest.classList.remove('open');
  }

  let searchSeq = 0;
  const runSearch = debounce(async (query) => {
    const q = query.trim();
    if (q.length < 2) {
      clearSuggestions();
      return;
    }
    const seq = ++searchSeq;
    try {
      const response = await fetch(`/api/places?q=${encodeURIComponent(q)}`);
      const data = await response.json();
      if (seq !== searchSeq) return;
      if (!data.ok) {
        if (data.code === 'NO_KEY') clearSuggestions();
        return;
      }
      placeSuggest.innerHTML = '';
      const list = (data.places || []).slice(0, 6);
      if (!list.length) {
        placeSuggest.append(el('div', { class: 'suggest-empty' }, '没找到，直接回车当手写地点'));
      }
      for (const place of list) {
        placeSuggest.append(el('button', {
          class: 'suggest-item',
          onclick: () => { addPlace(place); placeInput.value = ''; }
        },
          el('span', { class: 'suggest-name' }, place.name),
          el('span', { class: 'suggest-meta' }, metaLine(place))
        ));
      }
      placeSuggest.classList.add('open');
    } catch {
      clearSuggestions();
    }
  }, 300);

  placeInput.addEventListener('input', (e) => {
    runSearch(e.target.value);
  });

  // ---------- 正文 ----------
  const editor = el('div', {
    class: 'editor',
    contenteditable: 'true',
    spellcheck: 'false',
    'data-placeholder': '把今天的事写在这里。豆包整理好的文字可以直接粘进来。'
  });

  for (const block of entry.blocks) {
    if (block.type === 'image') {
      const url = await imageURL(block.imageId);
      if (!url) continue;
      objectURLs.push(url);
      editor.append(el('img', { src: url, dataset: { img: block.imageId }, alt: '' }));
    } else if (block.type === 'text') {
      editor.append(textToParagraph(block.text));
    }
  }
  if (!entry.blocks.length) editor.append(el('p', {}, el('br')));

  function updateEmptyState() {
    const hasText = editor.innerText.trim().length > 0;
    const hasImage = !!editor.querySelector('img');
    editor.classList.toggle('is-empty', !hasText && !hasImage);
  }

  editor.addEventListener('paste', (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text.trim()) return;
    const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/).filter((p) => p.trim());
    insertHTML(paragraphs.map((p) => `<p>${escapeLine(p)}</p>`).join(''));
    scheduleSave();
  });

  editor.addEventListener('input', () => {
    updateEmptyState();
    scheduleSave();
  });

  // ---------- 照片 ----------
  const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true });
  fileInput.addEventListener('change', async (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    for (const file of files) {
      try {
        const { blob, width, height, thumb } = await compressImage(file);
        const imageId = `${date}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        await db.putImage({ id: imageId, blob, thumb, width, height, date, createdAt: Date.now() });
        const url = URL.createObjectURL(blob);
        objectURLs.push(url);
        insertHTML(`<img src="${url}" data-img="${imageId}" alt=""><p><br></p>`);
        scheduleSave();
      } catch (error) {
        toast('有张照片没能处理：' + (error.message || '未知错误'));
      }
    }
  });

  const addPhotoBtn = el('button', { class: 'ghost', onclick: () => fileInput.click() }, '＋ 照片');
  const counter = el('span', { class: 'hint', style: 'margin:0' }, `${charCount(entry)} 字 · ${imageCount(entry)} 张`);
  const saveHint = el('div', { class: 'save-hint' }, el('span', {}, '写完自动保存'), el('span', {}, ''));

  // ---------- 组装 ----------
  root.append(
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap' },
      el('a', { class: 'back', href: '#/list', style: 'margin:0' }, '‹ 时光'),
      el('div', { style: 'display:flex;align-items:center;gap:6px' },
        isToday
          ? el('button', { class: 'ghost dawn', style: 'padding:5px 11px;font-size:12px', onclick: () => { location.hash = `#/entry/${prevISO(date)}`; } }, '补写昨天')
          : el('button', { class: 'ghost', style: 'padding:5px 11px;font-size:12px', onclick: () => { location.hash = '#/today'; } }, '回到今天'),
        datePill
      )
    ),
    head,
    el('div', { class: 'row' },
      el('span', { class: 'label' }, '天气'),
      el('div', { style: 'flex:1;display:flex;align-items:center;gap:8px' },
        weatherInput,
        el('button', {
          class: 'ghost',
          style: 'padding:4px 9px;font-size:12px;white-space:nowrap',
          title: '用当前位置查天气',
          onclick: () => requestWeather(true)
        }, '📍')
      )
    ),
    weatherHint,
    el('div', { class: 'row', style: 'align-items:flex-start' },
      el('span', { class: 'label' }, '地点'),
      el('div', { style: 'flex:1' }, placesChips, placeInput, placeSuggest)
    ),
    el('div', { class: 'row', style: 'align-items:flex-start' },
      el('span', { class: 'label' }, '区域'),
      el('div', { style: 'flex:1' }, regionChips, regionInput)
    ),
    editor,
    el('div', { class: 'toolbar-line' }, addPhotoBtn, counter),
    saveHint,
    fileInput
  );

  updateEmptyState();

  // ---------- 保存 ----------
  let saveDebounced = null;
  function scheduleSave() {
    if (!saveDebounced) saveDebounced = debounce(doSave, 700);
    saveDebounced();
  }

  function collect() {
    entry.blocks = readBlocks(editor);
    entry.weather = weatherInput.value;
    entry.updatedAt = Date.now();
    return entry;
  }

  async function doSave() {
    collect();
    if (!entry.blocks.length && !entry.places.length && !entry.regions.length && !entry.weather) return;
    await db.putEntry(entry);
    counter.textContent = `${charCount(entry)} 字 · ${imageCount(entry)} 张`;
    saveHint.lastChild.textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  current = { date, entry, saveNow: doSave, cleanup: () => objectURLs.forEach(URL.revokeObjectURL) };

  // ---------- 天气：自动填 / 手动点 📍 ----------
  let weatherBusy = false;
  if (isToday && !entry.weather.trim()) requestWeather(false);

  async function requestWeather(force) {
    if (weatherBusy) return;
    if (!force && entry.weather.trim()) return;

    if (!navigator.geolocation) {
      weatherHint.textContent = '这个浏览器不支持定位，手动填一下天气吧';
      weatherHint.style.display = 'block';
      return;
    }

    if (!force) {
      const cached = await db.getMeta(`weather:${date}`, null);
      if (cached && Date.now() - cached.ts < 30 * 60 * 1000) {
        applyWeather(cached);
        return;
      }
    }

    weatherBusy = true;
    weatherHint.style.display = 'block';
    weatherHint.textContent = '正在定位…';

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        weatherBusy = false;
        try {
          const { latitude, longitude } = position.coords;
          const response = await fetch(`/api/weather?lat=${latitude}&lng=${longitude}`);
          const data = await response.json();
          if (!data.ok || !data.weather) {
            weatherHint.textContent = '天气接口没返回结果，手动填一下';
            return;
          }
          const payload = { display: data.weather.display, district: data.district || '', ts: Date.now() };
          await db.setMeta(`weather:${date}`, payload);
          applyWeather(payload);
        } catch {
          weatherHint.textContent = '拿不到天气，手动填一下';
        }
      },
      (error) => {
        weatherBusy = false;
        weatherHint.style.display = 'block';
        if (error.code === 1) {
          weatherHint.textContent = '定位被拒绝了。去 iPhone 设置 → 隐私与安全性 → 定位服务 → 找到「Safari 网站」或「朝夕」，改成「使用 App 期间」。';
        } else if (error.code === 2) {
          weatherHint.textContent = '定位不可用（可能没开定位服务或没信号），手动填一下天气吧';
        } else {
          weatherHint.textContent = '定位超时了，再点一次 📍 试试';
        }
      },
      { timeout: 10000, maximumAge: 5 * 60 * 1000, enableHighAccuracy: false }
    );
  }

  function applyWeather(payload) {
    if (payload.display) {
      weatherInput.value = payload.display;
      entry.weather = payload.display;
    }
    if (payload.district && !entry.regions.some((r) => placeName(r) === payload.district)) {
      entry.regions.push(payload.district);
      renderRegions();
    }
    weatherHint.textContent = '已按定位自动填写，可以改';
    weatherHint.style.display = 'block';
    scheduleSave();
  }

  return current;
}

// ---------- 辅助 ----------

async function imageURL(imageId) {
  const record = await db.getImage(imageId);
  if (!record) return null;
  return URL.createObjectURL(record.blob);
}

function metaLine(place) {
  const district = place.district || '';
  const address = place.address || '';
  if (!district) return address;
  if (!address || address === district) return district;
  return `${district} · ${address}`;
}

function textToParagraph(text) {
  const p = document.createElement('p');
  text.split('\n').forEach((line, index) => {
    if (index > 0) p.append(document.createElement('br'));
    p.append(document.createTextNode(line));
  });
  if (!text) p.append(document.createElement('br'));
  return p;
}

function escapeLine(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\n', '<br>');
}

function insertHTML(html) {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) {
    document.execCommand('insertHTML', false, html);
    return;
  }
  const range = selection.getRangeAt(0);
  const fragment = range.createContextualFragment(html);
  const last = fragment.lastElementChild;
  range.deleteContents();
  range.insertNode(fragment);
  if (last) {
    const after = document.createRange();
    after.setStartAfter(last);
    after.collapse(true);
    selection.removeAllRanges();
    selection.addRange(after);
  }
}

function readBlocks(editor) {
  const blocks = [];
  for (const node of editor.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      if (text) blocks.push({ type: 'text', text });
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    if (node.nodeName === 'IMG') {
      if (node.dataset.img) blocks.push({ type: 'image', imageId: node.dataset.img });
      continue;
    }
    if (node.nodeName === 'BR') continue;
    const text = (node.innerText ?? node.textContent ?? '').replace(/\u00a0/g, ' ').trim();
    if (text) blocks.push({ type: 'text', text });
  }
  return blocks;
}

export function cleanupEditor() {
  if (current && current.cleanup) current.cleanup();
  current = null;
}
