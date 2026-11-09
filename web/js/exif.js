// 读照片自带的 EXIF：拍摄时间 + GPS。用来做「图注」，而不是拿上传时间凑数。

export async function readExif(file) {
  try {
    if (!/jpe?g/i.test(file.type) && !/\.jpe?g$/i.test(file.name || '')) return null;
    const buffer = await file.slice(0, 512 * 1024).arrayBuffer();
    const view = new DataView(buffer);
    if (view.getUint16(0) !== 0xffd8) return null;

    let offset = 2;
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) break;
      const marker = view.getUint8(offset + 1);
      if (marker === 0xffe1) {
        const length = view.getUint16(offset + 2);
        const start = offset + 4;
        if (readAscii(view, start, 4) === 'Exif') {
          return parseTiff(view, start + 6, start, length);
        }
        offset += 2 + length;
        continue;
      }
      if (marker === 0xffda || marker === 0xffd9) break;
      const length = view.getUint16(offset + 2);
      offset += 2 + length;
    }
  } catch {
    return null;
  }
  return null;
}

function readAscii(view, start, length) {
  let out = '';
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(start + i));
  return out;
}

function parseTiff(view, tiffStart, base, appLength) {
  const little = readAscii(view, tiffStart, 2) === 'II';
  const u16 = (pos) => view.getUint16(pos, little);
  const u32 = (pos) => view.getUint32(pos, little);

  if (u16(tiffStart + 2) !== 0x2a) return null;
  const ifd0 = tiffStart + u32(tiffStart + 4);

  const result = { takenAt: null, lat: null, lng: null };

  const readEntryValue = (entryOffset) => {
    const type = u16(entryOffset + 2);
    const count = u32(entryOffset + 4);
    const valueOffset = entryOffset + 8;
    const size = typeSize(type) * count;
    const at = size > 4 ? tiffStart + u32(valueOffset) : valueOffset;
    return { type, count, at };
  };

  const walk = (ifdOffset, handler) => {
    if (!ifdOffset || ifdOffset >= base + appLength) return;
    const count = u16(ifdOffset);
    for (let i = 0; i < count; i++) {
      const entry = ifdOffset + 2 + i * 12;
      handler(u16(entry), entry);
    }
  };

  let exifIfd = 0;
  let gpsIfd = 0;

  walk(ifd0, (tag, entry) => {
    if (tag === 0x8769) exifIfd = tiffStart + u32(entry + 8);
    if (tag === 0x8825) gpsIfd = tiffStart + u32(entry + 8);
  });

  if (exifIfd) {
    walk(exifIfd, (tag, entry) => {
      if (tag !== 0x9003) return;
      const { at, count } = readEntryValue(entry);
      const text = readAscii(view, at, count - 1);
      const match = text.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
      if (match) {
        result.takenAt = new Date(
          Number(match[1]), Number(match[2]) - 1, Number(match[3]),
          Number(match[4]), Number(match[5]), Number(match[6])
        ).getTime();
      }
    });
  }

  if (gpsIfd) {
    let latRef = 'N';
    let lngRef = 'E';
    let latParts = null;
    let lngParts = null;

    walk(gpsIfd, (tag, entry) => {
      if (tag === 0x0001) latRef = readAscii(view, entry + 8, 1);
      if (tag === 0x0003) lngRef = readAscii(view, entry + 8, 1);
      if (tag === 0x0002) latParts = readRationals(view, tiffStart, entry, u32);
      if (tag === 0x0004) lngParts = readRationals(view, tiffStart, entry, u32);
    });

    if (latParts) {
      const [d, m, s] = latParts;
      result.lat = d + m / 60 + s / 3600;
      if (latRef === 'S') result.lat = -result.lat;
    }
    if (lngParts) {
      const [d, m, s] = lngParts;
      result.lng = d + m / 60 + s / 3600;
      if (lngRef === 'W') result.lng = -result.lng;
    }
  }

  return result;
}

function readRationals(view, tiffStart, entry, u32) {
  const count = u32(entry + 4);
  if (count < 3) return null;
  const at = tiffStart + u32(entry + 8);
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const num = view.getUint32(at + i * 8, true);
    const den = view.getUint32(at + i * 8 + 4, true);
    parts.push(den ? num / den : 0);
  }
  return parts;
}

function typeSize(type) {
  switch (type) {
    case 1: case 2: case 6: case 7: return 1;
    case 3: case 8: return 2;
    case 4: case 9: return 4;
    case 5: case 10: return 8;
    default: return 1;
  }
}
