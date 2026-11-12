// 记日记：表头 + 块编辑器（段落块 / 图片块），图片是独立块，可插在任意位置。

import * as db from './db.js';
import { newEntry, normalize, compressImage, charCount, imageCount, placeName, dedupeRegions } from './model.js';
import {
  el, toast, debounce, todayISO, prevISO, weekdayCN, monthDayCN, fullCN, daysBetween
} from './util.js';
import { openPlacePicker } from './placepicker.js';
import { scheduleSync } from './sync.js';
import { startRecording, transcribe, warmUpMicrophone, releaseMicrophone } from './voice.js';
import { readExif } from './exif.js';

let current = null;

export function flushSave() {
  if (current && current.saveNow) return current.saveNow();
  return Promise.resolve();
}

export async function renderEditor(root, dateISO) {
  const date = dateISO || todayISO();
  const stored = normalize(await db.getEntry(date));
  const entry = stored || newEntry(date);
  const journeyStart = await db.getMeta('journeyStart', '2027-01-01');
  const objectURLs = [];
  const isToday = date === todayISO();

  entry.blocks = Array.isArray(entry.blocks) ? entry.blocks.map((b) => ({ ...b })) : [];
  if (!entry.blocks.length) entry.blocks = [{ type: 'text', text: '' }];

  root.innerHTML = '';
  root.classList.add('view-editor');

  // ---------- 头部 ----------
  const dayIndex = daysBetween(journeyStart, date) + 1;
  const head = el('header', { class: 'entry-head' },
    el('div', {},
      el('div', { class: 'entry-date' }, monthDayCN(date)),
      el('div', { class: 'entry-sub' },
        `${weekdayCN(date)} · ${date.slice(0, 4)}` + (dayIndex > 0 ? ` · 第 ${dayIndex} 天` : ''))
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
  const weatherLog = el('div', { class: 'weather-log' });
  entry.weatherReadings = Array.isArray(entry.weatherReadings) ? entry.weatherReadings : [];

  function renderWeatherLog() {
    weatherLog.innerHTML = '';
    for (const reading of entry.weatherReadings) {
      weatherLog.append(el('span', { class: 'chip tiny' }, `${reading.time} ${reading.display}`));
    }
  }
  renderWeatherLog();

  // ---------- 地点 / 区域 ----------
  const placesChips = el('div', { class: 'chips' });
  const regionChips = el('div', { class: 'chips' });
  const addPlaceBtn = el('button', {
    class: 'ghost',
    style: 'padding:6px 12px;font-size:13px;margin-top:8px',
    onclick: async () => {
      const picked = await openPlacePicker({ existing: entry.places.map(placeName) });
      if (!picked.length) return;
      for (const place of picked) addPlace(place);
      renderPlaces();
      renderRegions();
    }
  }, '＋ 添加地点');

  const regionInput = el('input', {
    type: 'text',
    placeholder: '+ 区域，比如「拱墅区」',
    onkeydown: (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const value = e.target.value.trim();
      if (value) { addRegionOnce(value); renderRegions(); scheduleSave(); }
      e.target.value = '';
    }
  });

  function addRegionOnce(name) {
    const clean = (name || '').trim();
    if (!clean) return;
    if (!entry.regions.some((r) => placeName(r) === clean)) entry.regions.push(clean);
    dedupeRegions();
  }

  /** 「上城区」和「上城区丁兰街道」同时存在时，只留更精确的那个。 */
  function dedupeRegions() {
    const names = entry.regions.map(placeName);
    entry.regions = entry.regions.filter((region) => {
      const name = placeName(region);
      return !names.some((other) => other !== name && other.startsWith(name));
    });
  }

  async function addPlace(place) {
    const name = placeName(place).trim();
    if (!name) return;

    // 从「最近去过」里挑的老地点没存坐标，补查一次，不然反查不到区县
    if (place.lat == null || place.lng == null) {
      const found = await lookupPlace(name);
      if (found) {
        place = {
          ...place,
          district: place.district || found.district || '',
          lat: found.lat,
          lng: found.lng
        };
      }
    }

    const existing = entry.places.find((p) => placeName(p) === name);
    if (existing) {
      if (existing.lat == null && place.lat != null) {
        existing.lat = place.lat;
        existing.lng = place.lng;
        existing.district = existing.district || place.district || '';
      }
    } else {
      entry.places.push({ name, district: place.district || '', lat: place.lat ?? null, lng: place.lng ?? null });
    }
    if (place.district) addRegionOnce(place.district);
    renderPlaces();
    renderRegions();
    refineRegion(place);
    scheduleSave();
  }

  /** 只知道名字时，用高德搜一次补坐标和区县。 */
  async function lookupPlace(name) {
    try {
      const response = await fetch(`/api/places?q=${encodeURIComponent(name)}`);
      const data = await response.json();
      if (!data.ok || !Array.isArray(data.places) || !data.places.length) return null;
      const exact = data.places.find((p) => p.name === name) || data.places[0];
      return exact && exact.lat != null ? exact : null;
    } catch {
      return null;
    }
  }

  async function refineRegion(place) {
    if (!place.lat || !place.lng) return;
    try {
      const response = await fetch(`/api/regeo?lat=${place.lat}&lng=${place.lng}`);
      const data = await response.json();
      if (!data.ok) return;
      const district = data.district || place.district || '';
      const township = data.township || '';
      const label = township ? `${district}${township}` : district;
      if (!label) return;
      addRegionOnce(label);
      renderRegions();
      scheduleSave();
    } catch {
      // 拿不到街道就保留区县
      renderRegions();
    }
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
      }, el('span', { class: 'chip-label', title: name }, name), el('span', { class: 'x' }, '×')));
    }
  }

  function renderRegions() {
    const names = entry.regions.map(placeName).filter(Boolean);
    // 「上城区」和「上城区丁兰街道」同时存在时，只留更精确的那个
    const kept = names.filter((name) => !names.some((other) => other !== name && other.startsWith(name)));
    entry.regions = kept;

    regionChips.innerHTML = '';
    for (const name of kept) {
      regionChips.append(el('button', {
        class: 'chip region',
        onclick: () => {
          entry.regions = entry.regions.filter((r) => placeName(r) !== name);
          renderRegions();
          scheduleSave();
        }
      }, el('span', { class: 'chip-label', title: name }, name), el('span', { class: 'x' }, '×')));
    }
  }
  renderPlaces();
  renderRegions();

  // ---------- 封面 ----------
  const coverHost = el('div', { class: 'cover-slot' });
  const coverInput = el('input', { type: 'file', accept: 'image/*', class: 'native-file cover-input' });
  coverInput.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const image = await storePhoto(file);
      entry.coverImageId = image.id;
      renderCover();
      scheduleSave();
      toast('封面已设置');
    } catch (error) {
      toast('封面没设上：' + (error.message || '未知错误'));
    }
  });

  function renderCover() {
    coverHost.innerHTML = '';
    const coverId = entry.coverImageId;
    if (!coverId) {
      coverHost.append(el('div', { class: 'cover-empty' },
        el('span', {}, '封面（可选）'),
        coverInput
      ));
      return;
    }
    const holder = el('div', { class: 'cover-thumb' });
    db.getImage(coverId).then((record) => {
      if (!record) return;
      const url = URL.createObjectURL(record.thumb || record.blob);
      objectURLs.push(url);
      holder.append(el('img', { src: url, alt: '' }));
    });
    coverHost.append(el('div', { class: 'cover-set' },
      holder,
      el('div', { class: 'cover-actions' },
        el('span', { class: 'hint', style: 'margin:0' }, '封面不会出现在正文里'),
        coverInput,
        el('button', { class: 'ghost', style: 'padding:4px 10px;font-size:12px', onclick: () => { entry.coverImageId = null; renderCover(); scheduleSave(); } }, '移除')
      )
    ));
  }
  renderCover();

  // ---------- 照片输入 ----------
  const photoInput = el('input', { type: 'file', accept: 'image/*', multiple: true, class: 'native-file photo-input' });
  let insertAfter = -1;

  photoInput.addEventListener('change', async (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (!files.length) return;
    const at = insertAfter >= 0 ? insertAfter : entry.blocks.length - 1;
    insertAfter = -1;
    let index = at;
    let firstNew = null;
    for (const file of files) {
      try {
        const image = await storePhoto(file);
        index += 1;
        entry.blocks.splice(index, 0, { type: 'image', imageId: image.id });
        if (firstNew == null) firstNew = index;
      } catch (error) {
        toast('有张照片没加上：' + (error.message || '未知错误'));
      }
    }
    if (photoHome) photoRow.append(photoHome);  // 先放回底部，否则会被重新渲染销毁
    renderBlocks(firstNew);
    await doSave();
  });

  async function storePhoto(file) {
    const { blob, width, height, thumb } = await compressImage(file);
    if (!blob) throw new Error('这张图读不出来');

    const exif = await readExif(file);
    // HEIC 读不出 EXIF 时，用文件的修改时间兜底（通常就是拍照时间）
    const takenAt = exif?.takenAt
      || (file.lastModified ? new Date(file.lastModified).toISOString() : null);
    let place = '';
    let gps = null;
    if (exif && exif.lat != null && exif.lng != null) {
      gps = { lat: exif.lat, lng: exif.lng };
      try {
        const data = await (await fetch(`/api/regeo?lat=${gps.lat}&lng=${gps.lng}`)).json();
        if (data.ok) place = [data.district, data.township].filter(Boolean).join('');
      } catch {
        // 拿不到地点就只显示时间
      }
    }

    const id = `${date}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await db.putImage({
      id, blob, thumb, width, height, date,
      createdAt: Date.now(),
      takenAt,
      gps,
      place
    });
    return { id, blob };
  }

  // ---------- 语音输入 ----------
  let lastFocusedBlock = null;
  let lastCaret = null;
  let recordTimer = null;
  let recordStartedAt = 0;
  let recorder = null;
  let recording = false;
  let voiceBusy = false;

  const voiceHint = el('span', { class: 'voice-hint', style: 'display:none' });
  const pushBtn = el('button', { class: 'ghost voice-btn voice-push' },
    el('span', { class: 'voice-ico', html: '<svg viewBox="0 0 34 24" width="26" height="19" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M3 12h1.6M8 8.4v7.2M12.4 5v14M16.8 8v8M21.2 3.4v17.2M25.6 7v10M30 10.2v3.6"/></svg>' }),
    el('span', { class: 'voice-label' }, '按住说话'));
  const longBtn = el('button', { class: 'ghost voice-btn voice-long' },
    el('span', { class: 'voice-ico', html: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6"/></svg>' }),
    el('span', { class: 'voice-label' }, '录音转录'));

  const voiceRow = el('div', { class: 'voice-row' }, pushBtn, longBtn, voiceHint);
  const pushLabel = pushBtn.querySelector('.voice-label');
  const longLabel = longBtn.querySelector('.voice-label');

  function clockText() {
    const seconds = Math.max(0, Math.floor((Date.now() - recordStartedAt) / 1000));
    const m = Math.floor(seconds / 60);
    const s = String(seconds % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function startClock(label) {
    recordStartedAt = Date.now();
    clearInterval(recordTimer);
    const tick = () => { if (label) label.textContent = `停止录音 ${clockText()}`; };
    tick();
    recordTimer = setInterval(tick, 500);
  }

  function stopClock() {
    clearInterval(recordTimer);
    recordTimer = null;
  }

  // 长按时不要弹出「选择文字 / 拷贝」菜单（只拦按住说话，别把点击也拦掉）
  pushBtn.addEventListener('contextmenu', (event) => event.preventDefault());
  pushBtn.addEventListener('touchstart', (event) => event.preventDefault(), { passive: false });
  pushBtn.addEventListener('selectstart', (event) => event.preventDefault());
  longBtn.addEventListener('contextmenu', (event) => event.preventDefault());
  longBtn.addEventListener('selectstart', (event) => event.preventDefault());

  function insertSpeech(text) {
    const clean = (text || '').trim();
    if (!clean) {
      toast('没听清，再说一次');
      return;
    }

    const target = lastFocusedBlock != null ? entry.blocks[lastFocusedBlock] : null;

    // 有正在写的段落 → 插到光标处，不另起一段
    if (target && target.type === 'text') {
      const text0 = target.text || '';
      const position = Math.min(lastCaret == null ? text0.length : lastCaret, text0.length);
      const needsSpace = position > 0 && !/\s$/.test(text0.slice(0, position));
      target.text = text0.slice(0, position) + (needsSpace ? ' ' : '') + clean + text0.slice(position);
      lastCaret = position + clean.length + (needsSpace ? 1 : 0);
      renderBlocks(lastFocusedBlock);
      scheduleSave();
      toast('已插入');
      return;
    }

    // 没有在写的段落 → 新起一段，放在最后
    entry.blocks.push({ type: 'text', text: clean });
    lastFocusedBlock = entry.blocks.length - 1;
    lastCaret = clean.length;
    renderBlocks(lastFocusedBlock);
    scheduleSave();
    toast('已插入');
  }

  async function runTranscribe(blob) {
    voiceBusy = true;
    pushBtn.disabled = true;
    longBtn.disabled = true;
    try {
      const text = await transcribe(blob, ({ index, total }) => {
        if (total > 1 && pushLabel) pushLabel.textContent = `识别中 ${index + 1}/${total}…`;
      });
      insertSpeech(text);
    } catch (error) {
      toast(error.message || '识别失败');
    } finally {
      voiceBusy = false;
      pushBtn.disabled = false;
      longBtn.disabled = false;
        if (pushLabel) pushLabel.textContent = '按住说话';
    }
  }

  // 按住说话：按下开始，松开结束
  let pending = false;

  const beginPush = async (event) => {
    event.preventDefault();
    if (voiceBusy || recording || pending) return;
    pending = true;
    pushBtn.classList.add('on');
    if (pushLabel) pushLabel.textContent = '准备中…';
    try {
      recorder = await startRecording();
      recording = true;
      if (pushLabel) pushLabel.textContent = '放开结束';
    } catch (error) {
      pushBtn.classList.remove('on');
      if (pushLabel) pushLabel.textContent = '按住说话';
      toast(error.message || '录不了音');
    } finally {
      pending = false;
    }
  };

  const endPush = async () => {
    if (!recording || !recorder) return;
    recording = false;
    pushBtn.classList.remove('on');
    if (pushLabel) pushLabel.textContent = '识别中…';
    const device = recorder;
    recorder = null;
    try {
      const blob = await device.stop();
      await runTranscribe(blob);
    } catch (error) {
        toast(error.message || '录音失败');
    }
  };

  warmUpMicrophone();
  window.addEventListener('pagehide', releaseMicrophone, { once: true });

  pushBtn.addEventListener('pointerdown', beginPush);
  pushBtn.addEventListener('pointerup', endPush);
  pushBtn.addEventListener('pointercancel', endPush);
  pushBtn.addEventListener('pointerleave', endPush);

  // 整段录音：点一下开始，再点一下结束
  longBtn.addEventListener('click', async () => {
    if (voiceBusy) return;

    if (!recording) {
      try {
        recorder = await startRecording();
        recording = true;
        longBtn.classList.add('on');
        startClock(longLabel);
      } catch (error) {
        toast(error.message || '录不了音');
      }
      return;
    }

    recording = false;
    stopClock();
    longBtn.classList.remove('on');
    if (longLabel) longLabel.textContent = '正在识别…';
    const device = recorder;
    recorder = null;
    try {
      const blob = await device.stop();
      await runTranscribe(blob);
    } catch (error) {
        toast(error.message || '录音失败');
    }
  });

  // ---------- 块列表 ----------
  const blockList = el('div', { class: 'blocks' });

  function blockImageURL(block, host) {
    db.getImage(block.imageId).then((record) => {
      if (!record) return;
      const url = URL.createObjectURL(record.thumb || record.blob);
      objectURLs.push(url);
      host.src = url;
    });
  }

  function renderBlocks(anchorIndex = null) {
    blockList.innerHTML = '';

    entry.blocks.forEach((block, index) => {
      const card = el('div', { class: 'blk' });

      if (block.type === 'text') {
        const ta = el('textarea', { class: 'blk-text', placeholder: '写点什么…' });
        ta.value = block.text || '';
        const grow = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; };
        ta.addEventListener('focus', () => { lastFocusedBlock = index; lastCaret = ta.selectionStart; });
        for (const type of ['input', 'keyup', 'click', 'blur']) {
          ta.addEventListener(type, () => {
            lastFocusedBlock = index;
            try { lastCaret = ta.selectionStart; } catch {}
          });
        }
        ta.addEventListener('input', () => { block.text = ta.value; grow(); scheduleSave(); });
        ta.addEventListener('paste', (event) => {
          const raw = event.clipboardData?.getData('text/plain') || '';
          if (!raw) return;
          event.preventDefault();

          const start = ta.selectionStart;
          const before = ta.value.slice(0, start);
          const after = ta.value.slice(ta.selectionEnd);
          const { text, paragraphs, guessedDate } = cleanPasted(raw);

          if (guessedDate && guessedDate !== entry.date) {
            toast(`这段写的是 ${guessedDate}，日期没改，要改的话点上面的日期`);
          }

          if (paragraphs.length <= 1) {
            ta.value = before + text + after;
            block.text = ta.value;
            grow();
            scheduleSave();
            return;
          }
          toast(`已粘入 ${paragraphs.length} 段`);
          block.text = before + paragraphs[0];
          const rest = paragraphs.slice(1).map((p) => ({ type: 'text', text: p }));
          if (after.trim()) rest.push({ type: 'text', text: after.trim() });
          entry.blocks.splice(index + 1, 0, ...rest);
          renderBlocks();
          scheduleSave();
        });
        card.append(ta);
        requestAnimationFrame(grow);
      } else {
        const img = el('img', { class: 'blk-img', alt: '' });
        blockImageURL(block, img);
        card.append(img);
      }

      card.append(el('div', { class: 'blk-bar' },
        block.type === 'text'
          ? el('button', { class: 'blk-btn', onclick: () => {
          insertAfter = index;
          const bar = card.querySelector('.blk-bar');
          if (photoHome) {
            bar.append(el('span', { class: 'insert-hint' }, '选照片 →'));
            bar.append(photoHome);
            photoHome.scrollIntoView({ block: 'nearest' });
          }
        } }, '＋图')
          : el('button', { class: 'blk-btn', onclick: () => { entry.coverImageId = block.imageId; renderCover(); scheduleSave(); toast('已设为封面'); } }, '封面'),
        block.type === 'text'
          ? el('button', { class: 'blk-btn', onclick: () => { entry.blocks.splice(index + 1, 0, { type: 'text', text: '' }); renderBlocks(); scheduleSave(); } }, '＋段')
          : null,
        el('button', { class: 'blk-btn', disabled: index === 0, onclick: () => moveBlock(index, -1) }, '↑'),
        el('button', { class: 'blk-btn', disabled: index === entry.blocks.length - 1, onclick: () => moveBlock(index, 1) }, '↓'),
        el('button', { class: 'blk-btn danger', onclick: () => removeBlock(index) }, '删')
      ));

      blockList.append(card);
    });

    if (!entry.blocks.length) {
      blockList.append(el('div', { class: 'hint' }, '还没有内容，下面加一段。'));
    }

    if (anchorIndex != null) {
      requestAnimationFrame(() => {
        const node = blockList.children[anchorIndex];
        node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      });
    }
  }

  function moveBlock(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= entry.blocks.length) return;
    const [block] = entry.blocks.splice(index, 1);
    entry.blocks.splice(target, 0, block);
    renderBlocks(target);
    scheduleSave();
  }

  function removeBlock(index) {
    entry.blocks.splice(index, 1);
    renderBlocks(Math.max(0, Math.min(index, entry.blocks.length - 1)));
    scheduleSave();
  }

  renderBlocks();

  // ---------- 底部工具 ----------
  const addTextBtn = el('button', {
    class: 'ghost',
    onclick: () => {
      entry.blocks.push({ type: 'text', text: '' });
      renderBlocks();
      scheduleSave();
      const areas = blockList.querySelectorAll('textarea');
      areas[areas.length - 1]?.focus();
    }
  }, '＋ 段落');

  const photoRow = el('div', { class: 'photo-row' },
    el('span', { class: 'photo-row-label' }, '加照片')
  );
  const photoHome = el('span', { class: 'photo-home' }, photoInput);
  photoRow.append(photoHome);

  const counter = el('span', { class: 'hint', style: 'margin:0' },
    `${charCount(entry)} 字 · ${imageCount(entry)} 张`);
  const saveHint = el('div', { class: 'save-hint' }, el('span', {}, '改完自动保存'), el('span', {}, ''));

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
    coverHost,
    el('div', { class: 'row' }, el('span', { class: 'label' }, '天气'),
      el('div', { style: 'flex:1' },
        el('div', { style: 'display:flex;align-items:center;gap:8px' },
          weatherInput,
          isToday
            ? el('button', { class: 'ghost icon-btn', onclick: () => requestWeather(true), title: '定位取天气' },
              el('span', { html: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s6.5-5.6 6.5-10.2A6.5 6.5 0 0 0 5.5 10.8C5.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.6" r="2.3"/></svg>' }))
            : null),
        weatherLog)),
    weatherHint,
    el('div', { class: 'row', style: 'align-items:flex-start' },
      el('span', { class: 'label' }, '地点'),
      el('div', { style: 'flex:1' }, placesChips, addPlaceBtn)),
    el('div', { class: 'row', style: 'align-items:flex-start' },
      el('span', { class: 'label' }, '区域'),
      el('div', { style: 'flex:1' }, regionChips, regionInput)),
    blockList,
    voiceRow,
    el('div', { class: 'toolbar-line' }, addTextBtn, photoRow,
      el('a', { class: 'read-link', href: `#/read/${date}` }, '看一眼 ›')),
    el('div', { class: 'toolbar-line', style: 'margin-top:4px' }, counter),
    saveHint
  );

  // ---------- 保存 ----------
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { doSave(); }, 600);
  }

  async function doSave() {
    scheduleSync();
    // 注意：只在存盘时过滤空段落，不能改动 entry.blocks 本身，
    // 否则「刚点 ＋段落、还没打字」的空块会被永久丢掉。
    const blocksToSave = entry.blocks.filter((b) => b.type === 'image' || (b.text && b.text.trim()));
    if (!blocksToSave.length && !entry.places.length && !entry.regions.length && !entry.weather && !entry.coverImageId) return;
    entry.updatedAt = Date.now();
    try {
      await db.putEntry({ ...entry, blocks: blocksToSave });
      counter.textContent = `${charCount(entry)} 字 · ${imageCount(entry)} 张`;
      saveHint.lastChild.textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    } catch (error) {
      toast('保存失败：' + (error.message || error));
    }
  }

  current = { date, entry, saveNow: doSave, cleanup: () => objectURLs.forEach(URL.revokeObjectURL) };

  // ---------- 天气 ----------
  let weatherBusy = false;
  if (isToday && !entry.weather.trim()) requestWeather(false);
  if (!isToday && !entry.weather.trim()) {
    weatherHint.textContent = '过去的日子查不到当时的天气，手动写一句吧';
    weatherHint.style.display = 'block';
  }

  async function requestWeather(force) {
    if (weatherBusy) return;
    if (!force && entry.weather.trim()) return;
    if (!navigator.geolocation) return;

    if (!force) {
      const cached = await db.getMeta(`weather:${date}`, null);
      if (cached && Date.now() - cached.ts < 30 * 60 * 1000) { applyWeather(cached); return; }
    }

    weatherBusy = true;
    weatherHint.style.display = 'block';
    weatherHint.textContent = '正在定位…';

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        weatherBusy = false;
        try {
          const { latitude, longitude } = position.coords;
          const data = await (await fetch(`/api/weather?lat=${latitude}&lng=${longitude}`)).json();
          if (!data.ok || !data.weather) { weatherHint.textContent = '天气接口没返回结果，手动填一下'; return; }
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
        weatherHint.textContent = error.code === 1
          ? '定位被拒绝了，去设置里允许「Safari 网站」使用定位'
          : '定位不可用，手动填一下天气';
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    );
  }

  function applyWeather(payload) {
    if (!payload.display) return;
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const readings = entry.weatherReadings;
    const last = readings[readings.length - 1];
    if (last && Date.now() - last.ts < 10 * 60 * 1000) {
      last.time = time;
      last.display = payload.display;
      last.ts = Date.now();
      if (payload.city) last.city = payload.city;
    } else {
      readings.push({ time, display: payload.display, ts: Date.now(), city: payload.city || '' });
    }
    if (!weatherInput.value.trim()) { weatherInput.value = payload.display; entry.weather = payload.display; }
    if (payload.district) { addRegionOnce(payload.district); renderRegions(); }
    renderWeatherLog();
    weatherHint.textContent = '天气会随手记下每次的时间和温度，可以改';
    weatherHint.style.display = 'block';
    scheduleSave();
  }

  return current;
}

export function cleanupEditor() {
  if (current && current.cleanup) current.cleanup();
  current = null;
}

// ---------- 粘贴清洗 ----------

/** 豆包粘过来的东西：去掉开头的「# 日期 日记」和结尾的提问，再按段落切开。 */
export function cleanPasted(raw) {
  let text = raw.replace(/\r\n/g, '\n').trim();
  let guessedDate = null;

  const lines = text.split('\n');
  if (lines.length > 1) {
    const first = lines[0].trim();
    if (looksLikeTitle(first)) {
      const match = first.match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
      if (match) {
        guessedDate = `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
      }
      lines.shift();
      text = lines.join('\n').trim();
    }
  }

  let paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  while (paragraphs.length && looksLikeAssistantTail(paragraphs[paragraphs.length - 1])) paragraphs.pop();

  // 整篇只有单换行时，也按行切开（每行不长才切，避免把一句话切碎）
  if (paragraphs.length === 1 && paragraphs[0].includes('\n')) {
    const byLine = paragraphs[0].split('\n').map((l) => l.trim()).filter(Boolean);
    if (byLine.length > 1 && byLine.every((l) => l.length < 120)) paragraphs = byLine;
  }

  return { text: paragraphs.join('\n\n'), paragraphs, guessedDate };
}

function looksLikeTitle(line) {
  if (line.length > 30) return false;
  if (/^#{1,6}\s/.test(line)) return true;
  if (/日记$/.test(line)) return true;
  if (/^\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(line)) return true;
  return false;
}

function looksLikeAssistantTail(paragraph) {
  return /^(要不要我|需要我|我还可以|如果你需要|需要的话|要不要帮你|还要我|我可以再|如果 你)/.test(paragraph.trim());
}
