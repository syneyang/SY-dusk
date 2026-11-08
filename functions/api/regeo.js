// GET /api/regeo?lat=30.27&lng=120.15
// 逆地理编码：把坐标换成城市 / 区县，用来限定搜索范围。

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');

  if (!lat || !lng) return json({ ok: false, error: '缺少经纬度' }, 400);
  if (!env.AMAP_KEY) return json({ ok: false, error: '未配置高德 key', code: 'NO_KEY' }, 501);

  try {
    const target = `https://restapi.amap.com/v3/geocode/regeo?key=${env.AMAP_KEY}&location=${lng},${lat}&extensions=base`;
    const data = await (await fetch(target)).json();
    if (data.status !== '1') throw new Error(data.info || '逆地理失败');

    const comp = data.regeocode?.addressComponent || {};
    const city = typeof comp.city === 'string' && comp.city ? comp.city : comp.province;

    return json({
      ok: true,
      province: comp.province || '',
      city: city || '',
      cityShort: (city || '').replace(/市$/, ''),
      district: comp.district || '',
      adcode: comp.adcode || ''
    });
  } catch (error) {
    return json({ ok: false, error: String(error.message || error) }, 502);
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
