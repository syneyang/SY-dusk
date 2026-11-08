// 读：把一天自动排成杂志版。头图默认没有，你自己指定。

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

  // 拆成段落 / 图片
  const items = [];
  for (const block of entry.blocks) {
    if (block.type === 'image') {
      const record = await db.getImage(block.imageId);
      if (!record) continue;
      const url = URL.createObjectURL(record.blob);
      urls.push(url);
      items.push({ type: 'image', id: block.imageId, url, at: record.createdAt || null });
    } else if (block.type === 'text') {
      const text = block.text.trim();
      if (text) items.push({ type: 'text', text });
    }
  }

  const images = items.filter((i) => i.type === 'image');
  const hero = entry.coverImageId ? images.find((i) => i.id === entry.coverImageId) : null;

  const places = entry.places.map(placeName).filter(Boolean);
  const regions = entry.regions.map(placeName).filter(Boolean);
  let metaExpanded = false;

  // ---------- 浮动返回 ----------
  root.append(el('div', { class: 'read-bar' },
    el('a', { class: 'read-back', href: '#/list', 'aria-label': '返回' }, '‹'),
    el('a', { class: 'read-edit-top', href: `#/entry/${dateISO}` }, '编辑')
  ));

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
  const metaHost = el('div', { class: 'read-meta' });
  root.append(metaHost);

  function renderMeta() {
    metaHost.innerHTML = '';
    const head = [];
    if (entry.weather) head.push(el('span', { class: 'read-meta-weather' }, entry.weather));
    head.push(...places.slice(0, 1).map((text) => el('span', {}, text)));
    head.push(...regions.slice(0, 1).map((text) => el('span', {}, text)));
    metaHost.append(...head);

    const hidden = places.slice(1).concat(regions.slice(1));
    if (hidden.length && !metaExpanded) {
      metaHost.append(el('button', {
        class: 'read-meta-more',
        onclick: () => { metaExpanded = true; renderMeta(); }
      }, `+${hidden.length}`));
    } else if (metaExpanded) {
      metaHost.append(...hidden.map((text) => el('span', {}, text)));
      metaHost.append(el('button', {
        class: 'read-meta-more',
        onclick: () => { metaExpanded = false; renderMeta(); }
      }, '收起'));
    }
  }
  renderMeta();

  // ---------- 正文 ----------
  const texts = items.filter((i) => i.type === 'text');
  const firstText = texts[0] ? texts[0].text.trim() : '';
  const titleCandidate = texts.length > 1
    && firstText.length <= 24
    && !/[。！？!?…]$/.test(firstText)
    ? firstText
    : null;
  const ledeCandidate = !titleCandidate
    && texts.length > 1
    && firstText.length >= 40
    ? firstText
    : null;

  const body = el('div', { class: 'read-body' });
  let firstParagraph = true;
  let heroSkipped = !hero;

  for (const item of items) {
    if (item.type === 'image') {
      if (!heroSkipped && hero && item.id === hero.id) { heroSkipped = true; continue; }
      body.append(figure(item));
      continue;
    }
    if (firstParagraph && titleCandidate) {
      body.append(el('h2', { class: 'read-title' }, item.text.trim()));
    } else if (firstParagraph && ledeCandidate) {
      body.append(el('p', { class: 'read-lede' }, item.text));
    } else {
      body.append(el('p', {}, item.text));
    }
    firstParagraph = false;
  }

  // 只有照片没有文字
  if (!items.some((i) => i.type === 'text') && images.length) {
    body.append(el('div', { class: 'read-grid' },
      ...images.map((image) => el('img', { src: image.url, alt: '' }))
    ));
  }

  root.append(body);

  // ---------- 页脚 ----------
  const chars = plainText(entry).replace(/\s/g, '').length;
  root.append(el('div', { class: 'read-foot' },
    el('span', {}, `${fullCN(dateISO)} · ${chars} 字 · ${images.length} 张照片`),
    el('a', { href: `#/entry/${dateISO}`, class: 'read-edit' }, '编辑这篇 ›')
  ));

  const cleanup = () => urls.forEach(URL.revokeObjectURL);
  window.addEventListener('hashchange', cleanup, { once: true });

  function figure(image) {
    const isCover = entry.coverImageId === image.id;
    const coverBtn = el('button', {
      class: 'cover-btn' + (isCover ? ' on' : ''),
      onclick: async () => {
        const fresh = normalize(await db.getEntry(dateISO));
        fresh.coverImageId = isCover ? null : image.id;
        fresh.updatedAt = Date.now();
        await db.putEntry(fresh);
        toast(isCover ? '已取消封面' : '设为封面');
        cleanup();
        renderRead(root, dateISO);
      }
    }, isCover ? '✓ 封面' : '设为封面');

    return el('figure', { class: 'read-figure' },
      el('img', { src: image.url, alt: '', loading: 'lazy' }),
      el('figcaption', {}, el('span', {}, captionFor(image, entry)), coverBtn)
    );
  }
}

function captionFor(image, entry) {
  const time = image.at
    ? new Date(image.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '';
  const place = entry.places.map(placeName)[0] || '';
  return [time, place].filter(Boolean).join(' · ') || '照片';
}
