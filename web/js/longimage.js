// 把一天渲染成长图（canvas 手绘，不依赖任何库）。
// 两种风格：杂志（和「读」页一致）、便签（白底纯文字）。

import * as db from './db.js';
import { monthDayCN, weekdayCN } from './util.js';
import { plainText } from './model.js';

const WIDTH = 1080;
const PAD = 84;
const CONTENT = WIDTH - PAD * 2;
const MAX_PAGE_HEIGHT = 14000;

const STYLES = {
  magazine: {
    bg: '#F9F4EC',
    ink: '#2B2620',
    soft: '#6B635A',
    accent: '#CD6F3A',
    dateFont: '600 84px "Songti SC", "STSong", serif',
    subFont: '28px "PingFang SC", sans-serif',
    metaFont: '26px "PingFang SC", sans-serif',
    bodyFont: '34px "PingFang SC", sans-serif',
    ledeFont: '500 38px "PingFang SC", sans-serif',
    capFont: '22px "PingFang SC", sans-serif',
    lineHeight: 64,
    ledeLineHeight: 68,
    paragraphGap: 34,
    dateGap: 64,
    showImages: true
  },
  note: {
    bg: '#FFFFFF',
    ink: '#1F1F1F',
    soft: '#8A8A8E',
    accent: '#CD6F3A',
    dateFont: '600 60px "Songti SC", "STSong", serif',
    subFont: '26px "PingFang SC", sans-serif',
    metaFont: '24px "PingFang SC", sans-serif',
    bodyFont: '32px "PingFang SC", sans-serif',
    ledeFont: '32px "PingFang SC", sans-serif',
    capFont: '22px "PingFang SC", sans-serif',
    lineHeight: 58,
    ledeLineHeight: 58,
    paragraphGap: 26,
    dateGap: 48,
    showImages: false
  }
};

export const STYLE_LABELS = {
  magazine: '杂志风（带照片）',
  note: '便签风（纯文字）'
};

function measureContext() {
  const canvas = document.createElement('canvas');
  return canvas.getContext('2d');
}

function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const char of paragraph) {
      const next = line + char;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines.length ? lines : [''];
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** 收集这一天要画的东西。 */
async function prepare(entry, dateISO) {
  const items = [];

  for (const block of entry.blocks || []) {
    if (block.type === 'text') {
      const text = (block.text || '').trim();
      if (text) items.push({ type: 'text', text });
    } else if (block.type === 'image') {
      const record = await db.getImage(block.imageId);
      if (!record) continue;
      const url = URL.createObjectURL(record.blob);
      const img = await loadImage(url);
      URL.revokeObjectURL(url);
      if (!img) continue;
      items.push({ type: 'image', img, caption: block.caption || '' });
    }
  }

  return items;
}

export async function renderDayImage(entry, dateISO, styleName = 'magazine') {
  const style = STYLES[styleName] || STYLES.magazine;
  const items = await prepare(entry, dateISO);
  const measure = measureContext();

  // ---------- 排版：先算高度 ----------
  const blocks = [];
  const push = (block) => blocks.push(block);

  measure.font = style.dateFont;
  push({ type: 'text', lines: [monthDayCN(dateISO)], font: style.dateFont, color: style.ink, lineHeight: 100, height: 100, gapAfter: 8 });

  measure.font = style.subFont;
  push({ type: 'text', lines: [`${weekdayCN(dateISO)} · ${dateISO.slice(0, 4)}`], font: style.subFont, color: style.soft, lineHeight: 42, height: 42, gapAfter: 22 });

  const meta = [entry.weather, ...(entry.places || []).map((p) => (typeof p === 'string' ? p : p.name))].filter(Boolean).join(' · ');
  if (meta) {
    measure.font = style.metaFont;
    const lines = wrap(measure, meta, CONTENT);
    const height = lines.length * 38;
    push({ type: 'text', lines, font: style.metaFont, color: style.accent, lineHeight: 38, height, gapAfter: 30 });
  }

  push({ type: 'rule', height: 2, gapAfter: 40 });

  let firstParagraph = true;

  for (const item of items) {
    if (item.type === 'text') {
      const isLede = firstParagraph && styleName === 'magazine';
      const font = isLede ? style.ledeFont : style.bodyFont;
      const lineHeight = isLede ? style.ledeLineHeight : style.lineHeight;
      measure.font = font;
      const lines = wrap(measure, item.text, CONTENT);
      push({ type: 'text', lines, font, color: style.ink, lineHeight, height: lines.length * lineHeight, gapAfter: style.paragraphGap });
      firstParagraph = false;
      continue;
    }

    if (!style.showImages) continue;

    const ratio = item.img.height / item.img.width;
    const height = Math.min(Math.round(CONTENT * ratio), 1200);
    push({ type: 'image', img: item.img, height, gapAfter: item.caption ? 10 : 34 });
    if (item.caption) {
      measure.font = style.capFont;
      push({ type: 'text', lines: [item.caption], font: style.capFont, color: style.soft, lineHeight: 34, height: 34, gapAfter: 34 });
    }
  }

  // 页脚
  const chars = plainText(entry).replace(/\s/g, '').length;
  measure.font = style.capFont;
  push({ type: 'text', lines: [`${dateISO} · ${chars} 字 · 朝夕`], font: style.capFont, color: style.soft, lineHeight: 36, height: 36, gapAfter: 0 });

  // ---------- 分页 ----------
  const pages = [];
  let current = [];
  let height = PAD * 2;

  for (const block of blocks) {
    const need = block.height + block.gapAfter;
    if (height + need > MAX_PAGE_HEIGHT && current.length) {
      pages.push(current);
      current = [];
      height = PAD * 2;
    }
    current.push(block);
    height += need;
  }
  if (current.length) pages.push(current);

  // ---------- 画 ----------
  const blobs = [];
  for (const pageBlocks of pages) {
    const pageHeight = PAD * 2 + pageBlocks.reduce((sum, b) => sum + b.height + b.gapAfter, 0);
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = pageHeight;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = style.bg;
    ctx.fillRect(0, 0, WIDTH, pageHeight);

    let y = PAD;
    for (const block of pageBlocks) {
      if (block.type === 'text') {
        ctx.font = block.font;
        ctx.fillStyle = block.color;
        ctx.textBaseline = 'top';
        block.lines.forEach((line, index) => {
          ctx.fillText(line, PAD, y + index * block.lineHeight + (block.lineHeight - parseInt(block.font, 10)) / 2);
        });
      } else if (block.type === 'rule') {
        ctx.fillStyle = style.soft + '55';
        ctx.fillRect(PAD, y, CONTENT, 1);
      } else if (block.type === 'image') {
        const scale = Math.min(CONTENT / block.img.width, block.height / block.img.height);
        const drawW = block.img.width * scale;
        const drawH = block.img.height * scale;
        ctx.save();
        roundRect(ctx, PAD + (CONTENT - drawW) / 2, y, drawW, drawH, 20);
        ctx.clip();
        ctx.drawImage(block.img, PAD + (CONTENT - drawW) / 2, y, drawW, drawH);
        ctx.restore();
      }
      y += block.height + block.gapAfter;
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
    if (blob) blobs.push(blob);
  }

  return blobs;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
