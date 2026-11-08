// 日记的数据结构：表头（日期/天气/地点/区域）+ 一串块（段落或照片）。

export function newEntry(date) {
  const now = Date.now();
  return {
    date,
    createdAt: now,
    updatedAt: now,
    weather: '',
    places: [],
    regions: [],
    blocks: [],
    aiSummary: null
  };
}

export function placeName(place) {
  if (!place) return '';
  return typeof place === 'string' ? place : (place.name || '');
}

export function normalize(entry) {
  if (!entry) return null;
  entry.weather = entry.weather || '';
  entry.places = Array.isArray(entry.places) ? entry.places : [];
  entry.regions = Array.isArray(entry.regions) ? entry.regions : [];
  entry.blocks = Array.isArray(entry.blocks) ? entry.blocks : [];
  return entry;
}

export function textBlocks(entry) {
  return entry.blocks.filter((b) => b.type === 'text' && b.text.trim());
}

export function plainText(entry) {
  return textBlocks(entry).map((b) => b.text.trim()).join('\n\n');
}

export function charCount(entry) {
  return textBlocks(entry).reduce((sum, b) => sum + b.text.replace(/\s/g, '').length, 0);
}

export function imageIds(entry) {
  return entry.blocks.filter((b) => b.type === 'image').map((b) => b.imageId);
}

export function imageCount(entry) {
  return imageIds(entry).length;
}

export function firstLine(entry, limit = 40) {
  const text = textBlocks(entry)[0]?.text.trim() || '';
  const line = text.split('\n')[0] || '';
  return line.length > limit ? line.slice(0, limit) + '…' : line;
}

export function isEmptyEntry(entry) {
  return charCount(entry) === 0 && imageCount(entry) === 0;
}

export function allPlaces(entries) {
  const map = new Map();
  for (const entry of entries) {
    for (const place of entry.places || []) {
      const name = typeof place === 'string' ? place : place.name;
      if (!name) continue;
      map.set(name, (map.get(name) || 0) + 1);
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

export function allRegions(entries) {
  const map = new Map();
  for (const entry of entries) {
    for (const region of entry.regions || []) {
      const name = typeof region === 'string' ? region : region.name;
      if (!name) continue;
      map.set(name, (map.get(name) || 0) + 1);
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

// ---- 照片处理 ----

const MAX_EDGE = 1600;
const THUMB_EDGE = 320;
const QUALITY = 0.82;

async function drawToBlob(source, maxEdge, quality) {
  let width = source.width || source.naturalWidth;
  let height = source.height || source.naturalHeight;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(source, 0, 0, w, h);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  return { blob, width: w, height: h };
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({ img, revoke: () => URL.revokeObjectURL(url) });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('这张图片浏览器读不了'));
    };
    img.src = url;
  });
}

/** 压缩成两张：展示用（长边 1600）和缩略图（长边 320）。HEIC 由 Safari 自己解码。 */
export async function compressImage(file) {
  try {
    let source = null;
    let revoke = null;

    if ('createImageBitmap' in window) {
      try {
        source = await createImageBitmap(file);
      } catch {
        source = null;
      }
    }

    if (!source) {
      const loaded = await loadImageFromFile(file);
      source = loaded.img;
      revoke = loaded.revoke;
    }

    try {
      const full = await drawToBlob(source, MAX_EDGE, QUALITY);
      if (!full.blob) throw new Error('canvas 编码失败');
      const thumb = await drawToBlob(source, THUMB_EDGE, 0.7);
      return { blob: full.blob, width: full.width, height: full.height, thumb: thumb.blob || full.blob };
    } finally {
      if (source && source.close) source.close();
      if (revoke) revoke();
    }
  } catch {
    // HEIC 之类浏览器解不了的格式：原样存下来，先保证能加进去
    return { blob: file, width: 0, height: 0, thumb: null, raw: true };
  }
}
