// 读：把一天的结构自动排成杂志版。用户什么都不用管。

import * as db from './db.js';
import { normalize, plainText, placeName } from './model.js';
import { el, weekdayCN, monthDayCN, fullCN, toast } from './util.js';

export async function renderRead(root, dateISO) {
  const entry = normalize(await db.getEntry(dateISO));
  if (!entry || (!entry.blocks.length && !entry.places.length)) {
    location.hash = `#/entry/${dateISO}`;
    return;
  }

  const urls = [];
  root.innerHTML = '';

  // 拆成「段落」和「图片（带时间）」两种块
  const items = [];
  for (const block of entry.blocks) {
    if (block.type === 'image') {
      const record = await db.getImage(block.imageId);
      if (!record) continue;
      const url = URL.createObjectURL(record.blob);
      urls.push(url);
      items.push({ type: 'image', url, at: record.createdAt || null });
    } else if (block.type === 'text') {
      const text = block.text.trim();
      if (text) items.push({ type: 'text', text });
    }
  }

  const images = items.filter((i) => i.type === 'image');
  const paragraphs = items.filter((i) => i.type === 'text');
  const hero = images[0] || null;
  const flowImages = images.slice(1);

  const meta = [
    entry.weather,
    ...entry.places.map(placeName),
    ...entry.regions.map(placeName)
  ].filter(Boolean);

  // ---------- 头部 ----------
  if (hero) {
    root.append(el('div', { class: 'read-hero' },
      el('img', { class: 'read-hero-img', src: hero.url, alt: '' }),
      el('div', { class: 'read-hero-scrim' }),
      el('div', { class: 'read-hero-text' },
        el('div', { class: 'read-date' }, monthDayCN(dateISO)),
        el('div', { class: 'read-sub' }, `${weekdayCN(dateISO)} · ${dateISO.slice(0, 4)}`)
      )
    ));
  } else {
    root.append(el('div', { class: 'read-head' },
      el('div', { class: 'read-date plain' }, monthDayCN(dateISO)),
      el('div', { class: 'read-sub plain' }, `${weekdayCN(dateISO)} · ${dateISO.slice(0, 4)}`)
    ));
  }

  // ---------- 元信息 ----------
  if (meta.length) {
    root.append(el('div', { class: 'read-meta' },
      ...meta.map((text, index) => el('span', { class: index === 0 && entry.weather ? 'read-meta-weather' : '' }, text))
    ));
  }

  // ---------- 正文 ----------
  const body = el('div', { class: 'read-body' });
  let usedHero = false;
  let firstParagraph = true;

  // 按原始顺序走：段落正常排，图片当作插图（第一张已经变成头图，跳过）
  for (const item of items) {
    if (item.type === 'image') {
      if (!usedHero && hero && item === hero) { usedHero = true; continue; }
      body.append(figure(item, entry));
      continue;
    }
    const p = el('p', { class: firstParagraph ? 'read-lede' : '' }, item.text);
    firstParagraph = false;
    body.append(p);
  }

  // 只有照片没有文字：网格
  if (!paragraphs.length && flowImages.length) {
    body.append(el('div', { class: 'read-grid' },
      ...flowImages.map((image) => el('img', { src: image.url, alt: '' }))
    ));
  }

  root.append(body);

  // ---------- 页脚 ----------
  const chars = plainText(entry).replace(/\s/g, '').length;
  root.append(el('div', { class: 'read-foot' },
    el('span', {}, `${fullCN(dateISO)} · ${chars} 字 · ${images.length} 张照片`),
    el('a', { href: `#/entry/${dateISO}`, class: 'read-edit' }, '编辑这篇 ›')
  ));

  // 清理 objectURL
  const cleanup = () => urls.forEach(URL.revokeObjectURL);
  window.addEventListener('hashchange', cleanup, { once: true });

  function figure(image) {
    return el('figure', { class: 'read-figure' },
      el('img', { src: image.url, alt: '', loading: 'lazy' }),
      el('figcaption', {}, captionFor(image, entry, dateISO))
    );
  }
}

function captionFor(image, entry, dateISO) {
  const time = image.at
    ? new Date(image.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '';
  const place = entry.places.map(placeName)[0] || '';
  return [time, place].filter(Boolean).join(' · ') || '照片';
}

export { toast };
