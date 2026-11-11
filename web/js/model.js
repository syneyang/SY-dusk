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

/** 去掉被更精确项覆盖的短区域，比如「上城区」被「上城区丁兰街道」覆盖。 */
export function dedupeRegions(names) {
  const list = [...new Set(names.filter(Boolean))];
  return list.filter((name) => !list.some((other) => other !== name && other.startsWith(name)));
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
  entry.coverImageId = entry.coverImageId || null;
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

const MAX_EDGE = 1280;
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

/** 把「07:19 / 雾 7℃」拆成 { time, sky, temp }。 */
export function weatherPoints(entry) {
  const readings = Array.isArray(entry.weatherReadings) ? entry.weatherReadings : [];
  const points = readings.map((reading) => {
    const text = String(reading.display || '').trim();
    const match = text.match(/^(.*?)\s*(-?\d+)\s*(?:℃|°C|度)?\s*$/);
    return {
      time: reading.time || '',
      sky: (match ? match[1] : text).trim(),
      temp: match && match[2] != null ? Number(match[2]) : null,
      city: reading.city || '',
      ts: reading.ts || 0
    };
  }).filter((point) => point.sky || point.temp != null);

  if (!points.length && entry.weather) {
    const text = String(entry.weather).trim();
    const match = text.match(/^(.*?)\s*(-?\d+)\s*(?:℃|°C|度)?\s*$/);
    points.push({
      time: '',
      sky: (match ? match[1] : text).trim(),
      temp: match && match[2] != null ? Number(match[2]) : null,
      ts: 0
    });
  }
  return points;
}

/** 一天的天气一句话：雾转晴 7~16℃ */
export function weatherSummary(entry) {
  const points = weatherPoints(entry);
  if (!points.length) return '';

  // 一天跑了几个城市，就按城市分开写
  const segments = [];
  for (const point of points) {
    const city = point.city || '';
    const last = segments[segments.length - 1];
    if (last && last.city === city) last.points.push(point);
    else segments.push({ city, points: [point] });
  }

  const describe = (segment) => {
    const skies = [];
    for (const point of segment.points) {
      if (point.sky && skies[skies.length - 1] !== point.sky) skies.push(point.sky);
    }
    const temps = segment.points.map((p) => p.temp).filter((t) => t != null);
    const min = temps.length ? Math.min(...temps) : null;
    const max = temps.length ? Math.max(...temps) : null;

    const skyText = skies.length === 0
      ? ''
      : skies.length === 1
        ? skies[0]
        : `${skies[0]}转${skies[skies.length - 1]}`;
    const tempText = min == null ? '' : min === max ? `${min}℃` : `${min}~${max}℃`;

    return [segment.city, [skyText, tempText].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  };

  const texts = segments.map(describe).filter(Boolean);
  if (segments.length === 1) {
    // 一整天都在一个城市，城市名没意义，去掉
    const only = texts[0];
    const city = segments[0].city;
    return city && only.startsWith(city) ? only.slice(city.length).trim() : only;
  }
  return texts.join(' · ');
}
