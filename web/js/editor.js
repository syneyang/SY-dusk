// 记日记的主界面：表头 + 图文交替的正文。

import * as db from './db.js';
import {
  newEntry, normalize, compressImage, charCount, imageCount
} from './model.js';
import {
  el, toast, debounce, todayISO, prevISO, weekdayCN, monthDayCN, fullCN, daysBetween, isoOf
} from './util.js';

let current = null; // { date, entry, editor, saveNow }

export function flushSave() {
  if (current && current.saveNow) current.saveNow();
}

export async function renderEditor(root, dateISO) {
  const date = dateISO || todayISO();
  const stored = normalize(await db.getEntry(date));
  const entry = stored || newEntry(date);
  const journeyStart = await db.getMeta('journeyStart', '2027-01-01');
  const objectURLs = [];

  root.innerHTML = '';

  // ---------- 头部 ----------
  const isToday = date === todayISO();
  const dayIndex = daysBetween(journeyStart, date) + 1;

  const head = el('header', { class: 'entry-head' },
    el('div', {},
      el('div', { class: 'entry-date' }, monthDayCN(date)),
      el('div', { class: 'entry-sub' },
        `${weekdayCN(date)} · ${date.slice(0, 4)}` + (dayIndex > 0 ? ` · 第 ${dayIndex} 天` : '')
      )
    )
  );

  // ---------- 日期切换 ----------
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

  // ---------- 表头字段 ----------
  const weatherInput = el('input', {
    type: 'text',
    value: entry.weather || '',
    placeholder: '晴 18~24℃（以后会自动填）',
    oninput: (e) => { entry.weather = e.target.value; scheduleSave(); }
  });

  const placesWrap = el('div', { class: 'chips' });
  const regionsWrap = el('div', { class: 'chips' });

  function renderChips() {
    placesWrap.innerHTML = '';
    for (const place of entry.places) {
      placesWrap.append(el('button', {
        class: 'chip',
        onclick: () => { entry.places = entry.places.filter((p) => p !== place); renderChips(); scheduleSave(); }
      }, place, el('span', { class: 'x' }, '×')));
    }
    placesWrap.append(el('input', {
      type: 'text',
      placeholder: '+ 地点',
      style: 'width:auto;min-width:80px;flex:1',
      onkeydown: (e) => {
        if (e.key !== 'Enter') return;
        const value = e.target.value.trim();
        if (!value) return;
        if (!entry.places.includes(value)) entry.places.push(value);
        e.target.value = '';
        renderChips();
        scheduleSave();
      }
    }));

    regionsWrap.innerHTML = '';
    for (const region of entry.regions) {
      regionsWrap.append(el('button', {
        class: 'chip region',
        onclick: () => { entry.regions = entry.regions.filter((r) => r !== region); renderChips(); scheduleSave(); }
      }, region, el('span', { class: 'x' }, '×')));
    }
    regionsWrap.append(el('input', {
      type: 'text',
      placeholder: '+ 区域（丁桥、拱墅…）',
      style: 'width:auto;min-width:100px;flex:1',
      onkeydown: (e) => {
        if (e.key !== 'Enter') return;
        const value = e.target.value.trim();
        if (!value) return;
        if (!entry.regions.includes(value)) entry.regions.push(value);
        e.target.value = '';
        renderChips();
        scheduleSave();
      }
    }));
  }
  renderChips();

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

  // 粘贴：只取纯文本，按空行分段
  editor.addEventListener('paste', (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!text.trim()) return;
    const paragraphs = text.replace(/\r\n/g, '\n').split(/\n{2,}/).filter((p) => p.trim());
    const html = paragraphs
      .map((p) => `<p>${escapeLine(p)}</p>`)
      .join('');
    insertHTML(html);
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
  const pasteHint = el('span', { class: 'hint', style: 'margin:0' }, `${charCount(entry)} 字 · ${imageCount(entry)} 张`);

  const saveHint = el('div', { class: 'save-hint' },
    el('span', {}, '写完自动保存'),
    el('span', {}, '')
  );

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
    el('div', { class: 'row' }, el('span', { class: 'label' }, '天气'), weatherInput),
    el('div', { class: 'row', style: 'align-items:flex-start' }, el('span', { class: 'label' }, '地点'), placesWrap),
    el('div', { class: 'row', style: 'align-items:flex-start' }, el('span', { class: 'label' }, '区域'), regionsWrap),
    editor,
    el('div', { class: 'toolbar-line' }, addPhotoBtn, pasteHint),
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
    if (!entry.blocks.length && !entry.places.length && !entry.regions.length && !entry.weather) {
      // 全空的就不落库
      return;
    }
    await db.putEntry(entry);
    pasteHint.textContent = `${charCount(entry)} 字 · ${imageCount(entry)} 张`;
    saveHint.lastChild.textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }

  current = { date, entry, saveNow: doSave, cleanup: () => objectURLs.forEach(URL.revokeObjectURL) };

  // 首次进来就清掉空段落
  if (!entry.blocks.length && !editor.textContent.trim() && !editor.querySelector('img')) {
    editor.innerHTML = '<p><br></p>';
  }

  return current;
}

// ---------- 辅助 ----------

async function imageURL(imageId) {
  const record = await db.getImage(imageId);
  if (!record) return null;
  return URL.createObjectURL(record.blob);
}

function textToParagraph(text) {
  const p = document.createElement('p');
  const lines = text.split('\n');
  lines.forEach((line, index) => {
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
