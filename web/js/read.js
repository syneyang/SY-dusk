// 读：把一天自动排成杂志版。头图默认没有，你自己指定。

import * as db from './db.js';
import { normalize, plainText, placeName, dedupeRegions } from './model.js';
import { el, weekdayCN, monthDayCN, fullCN, toast } from './util.js';
import { weatherPoints, weatherSummary } from './model.js';
import { renderDayImage, STYLE_LABELS } from './longimage.js';

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
      items.push({
        type: 'image',
        id: block.imageId,
        url,
        takenAt: record.takenAt || null,
        place: record.place || ''
      });
    } else if (block.type === 'text') {
      const text = block.text.trim();
      if (text) items.push({ type: 'text', text });
    }
  }

  const images = items.filter((i) => i.type === 'image');
  let hero = entry.coverImageId ? images.find((i) => i.id === entry.coverImageId) : null;

  // 封面可能是一张不在正文里的照片
  if (entry.coverImageId && !hero) {
    const record = await db.getImage(entry.coverImageId);
    if (record) {
      const url = URL.createObjectURL(record.blob);
      urls.push(url);
      hero = { type: 'image', id: entry.coverImageId, url, at: record.createdAt || null, coverOnly: true };
    }
  }

  const places = entry.places.map(placeName).filter(Boolean);
  const regions = dedupeRegions(entry.regions.map(placeName));

  const sky = weatherSummary(entry);
  const metaList = [sky, ...places, ...regions].filter(Boolean);

  // ---------- 浮动返回 ----------
  root.append(el('div', { class: 'read-bar' },
    el('a', { class: 'read-back', href: '#/list', 'aria-label': '返回' }, '‹'),
    el('div', { style: 'display:flex;gap:8px' },
      el('button', { class: 'read-edit-top', onclick: () => openMenu(items, metaList, dateISO, entry) }, '⋯'),
      el('a', { class: 'read-edit-top', href: `#/entry/${dateISO}` }, '编辑')
    )
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

    if (places.length) {
      metaHost.append(el('div', { class: 'read-meta-line' },
        el('span', { class: 'read-meta-key' }, '去了'),
        el('span', { class: 'read-meta-val' }, places.join(' · '))
      ));
    }

    if (regions.length) {
      metaHost.append(el('div', { class: 'read-meta-line' },
        el('span', { class: 'read-meta-key' }, '在'),
        el('span', { class: 'read-meta-val' }, regions.join(' · '))
      ));
    }

    const points = weatherPoints(entry);
    if (points.length) {
      metaHost.append(el('div', { class: 'read-meta-line' },
        el('span', { class: 'read-meta-key' }, '天气'),
        el('span', { class: 'read-meta-val' }, sky || entry.weather || '')
      ));
      if (points.length > 1) metaHost.append(weatherTrend(points));
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

    const caption = captionFor(image);
    return el('figure', { class: 'read-figure' },
      el('img', { src: image.url, alt: '', loading: 'lazy' }),
      el('figcaption', {}, el('span', {}, caption), coverBtn)
    );
  }
}

function captionFor(image) {
  const time = image.takenAt
    ? new Date(image.takenAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : '';
  const place = image.place || '';
  return [time, place].filter(Boolean).join(' · ');
}

// ---------- 分享菜单 ----------

function plainTextOf(items, meta, dateISO) {
  const lines = [`${monthDayCN(dateISO)} ${weekdayCN(dateISO)}`];
  if (meta.length) lines.push(meta.join(' · '));
  lines.push('');
  for (const item of items) {
    if (item.type === 'text') lines.push(item.text);
  }
  return lines.join('\n');
}

function markdownOf(items, meta, dateISO) {
  const lines = [`## ${monthDayCN(dateISO)} ${weekdayCN(dateISO)}`, ''];
  if (meta.length) lines.push(`> ${meta.join(' · ')}`, '');
  let photo = 0;
  for (const item of items) {
    if (item.type === 'text') {
      lines.push(item.text, '');
    } else {
      photo += 1;
      lines.push(`![照片 ${photo}](photo-${photo}.jpg)`, '');
    }
  }
  return lines.join('\n').trim() + '\n';
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('已复制');
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.append(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    toast('已复制');
  }
}

function openMenu(items, meta, dateISO, entry) {
  const text = plainTextOf(items, meta, dateISO);
  const markdown = markdownOf(items, meta, dateISO);

  const panel = el('div', { class: 'sheet', onclick: (event) => event.stopPropagation() },
    el('div', { class: 'sheet-grip' }),
    el('div', { class: 'sheet-head' }, el('div', { class: 'sheet-title' }, '这一天')),
    el('div', { class: 'share-list' },
      el('button', { class: 'share-item', onclick: () => { close(); copy(text); } }, '复制文字'),
      el('button', { class: 'share-item', onclick: () => { close(); copy(markdown); } }, '复制 Markdown'),
      el('button', {
        class: 'share-item',
        onclick: () => {
          close();
          pickStyleThenShare(entry, dateISO);
        }
      }, '生成长图'),
      el('button', {
        class: 'share-item',
        onclick: async () => {
          close();
          if (navigator.share) {
            try {
              await navigator.share({ title: `${monthDayCN(dateISO)} 朝夕`, text });
            } catch {}
          } else {
            copy(text);
          }
        }
      }, '分享给…')
    )
  );

  const backdrop = el('div', { class: 'sheet-backdrop', onclick: close }, panel);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));

  function close() {
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 200);
  }
}

// ---------- 生成长图 ----------

function pickStyleThenShare(entry, dateISO) {
  const panel = el('div', { class: 'sheet', onclick: (event) => event.stopPropagation() },
    el('div', { class: 'sheet-grip' }),
    el('div', { class: 'sheet-head' }, el('div', { class: 'sheet-title' }, '用什么样式')),
    el('div', { class: 'share-list' },
      ...Object.entries(STYLE_LABELS).map(([key, label]) => el('button', {
        class: 'share-item',
        onclick: () => { close(); shareImage(entry, dateISO, key); }
      }, label))
    )
  );

  const backdrop = el('div', { class: 'sheet-backdrop', onclick: close }, panel);
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add('show'));

  function close() {
    backdrop.classList.remove('show');
    setTimeout(() => backdrop.remove(), 200);
  }
}

async function shareImage(entry, dateISO, style) {
  toast('正在生成…');
  try {
    const blobs = await renderDayImage(entry, dateISO, style);
    if (!blobs.length) throw new Error('没生成出图片');

    const files = blobs.map((blob, index) => new File(
      [blob],
      `朝夕-${dateISO}${blobs.length > 1 ? `-${index + 1}` : ''}.jpg`,
      { type: 'image/jpeg' }
    ));

    // 微信不吃网页分享出来的文件，所以先给预览，让用户长按存相册
    showPreview(blobs, dateISO, files);
    return;

    for (const file of files) {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 20000);
    }
    toast('已保存');
  } catch (error) {
    toast('生成失败：' + (error.message || error));
  }
}

// ---------- 长图预览 ----------

function showPreview(blobs, dateISO, files) {
  const urls = blobs.map((blob) => URL.createObjectURL(blob));

  const bar = el('div', { class: 'preview-bar' },
    el('button', { class: 'preview-btn', onclick: close }, '完成'),
    el('div', { class: 'preview-title' }, `长按图片保存到相册`),
    el('button', {
      class: 'preview-btn',
      onclick: async () => {
        if (navigator.canShare && navigator.canShare({ files })) {
          try {
            await navigator.share({ files });
          } catch {}
        } else {
          toast('这台设备不支持系统分享，请长按图片保存');
        }
      }
    }, '分享')
  );

  const body = el('div', { class: 'preview-body' },
    ...urls.map((url) => el('img', { class: 'preview-img', src: url, alt: '' }))
  );

  const backdrop = el('div', { class: 'preview-backdrop', onclick: (event) => { if (event.target === backdrop) close(); } },
    bar,
    body
  );

  document.body.append(backdrop);

  function close() {
    backdrop.remove();
    urls.forEach(URL.revokeObjectURL);
  }
}

/** 一天的天气趋势：一条温度折线，下面标时间和天气。 */
function weatherTrend(points) {
  const W = 320;
  const H = 46;
  const pad = 10;

  const temps = points.map((p) => p.temp).filter((t) => t != null);
  const min = temps.length ? Math.min(...temps) : 0;
  const max = temps.length ? Math.max(...temps) : 1;
  const span = max - min || 1;

  const step = points.length > 1 ? (W - pad * 2) / (points.length - 1) : 0;
  const dots = points.map((point, index) => {
    const x = pad + step * index;
    const y = point.temp == null ? H / 2 : H - pad - ((point.temp - min) / span) * (H - pad * 2);
    return { x, y, point };
  });

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'sky-trend');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 6}`);
  svg.setAttribute('preserveAspectRatio', 'none');

  // 相邻两点之间画一段线；换城市的地方用虚线（不是同一个地方的连续变化）
  for (let i = 0; i < dots.length - 1; i++) {
    const a = dots[i];
    const b = dots[i + 1];
    const crossing = a.point.city && b.point.city && a.point.city !== b.point.city;

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', a.x);
    line.setAttribute('y1', a.y);
    line.setAttribute('x2', b.x);
    line.setAttribute('y2', b.y);
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-linecap', 'round');
    if (crossing) line.setAttribute('stroke-dasharray', '3 4');
    svg.append(line);
  }

  for (const dot of dots) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', dot.x);
    circle.setAttribute('cy', dot.y);
    circle.setAttribute('r', '2.6');
    circle.setAttribute('fill', 'currentColor');
    svg.append(circle);
  }

  const labels = el('div', { class: 'sky-labels' },
    ...dots.map((dot, index) => {
      const prev = dots[index - 1] ? dots[index - 1].point : null;
      const city = dot.point.city && (!prev || prev.city !== dot.point.city) ? dot.point.city : '';
      return el('span', {},
        el('b', {}, dot.point.time),
        el('span', {}, [city, dot.point.sky, dot.point.temp == null ? '' : `${dot.point.temp}℃`].filter(Boolean).join(' '))
      );
    })
  );

  return el('div', { class: 'read-meta-line sky-line' },
    el('span', { class: 'read-meta-key' }, ''),
    el('div', { class: 'sky-box' }, svg, labels)
  );
}
