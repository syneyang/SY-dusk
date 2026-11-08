// GET /api/places?q=丁桥&city=杭州
// 高德 POI 搜索，返回名称/地址/区县/经纬度。

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const city = (url.searchParams.get('city') || '').trim();

  if (!q) return json({ ok: false, error: '缺少关键词' }, 400);
  if (!env.AMAP_KEY) {
    return json({ ok: false, error: '未配置高德 key', code: 'NO_KEY' }, 501);
  }

  try {
    const params = new URLSearchParams({
      key: env.AMAP_KEY,
      keywords: q,
      offset: '10',
      page: '1',
      extensions: 'base'
    });
    const cityName = city || env.AMAP_CITY || '';
    if (cityName) {
      params.set('city', cityName);
      params.set('citylimit', 'true');
    }

    const response = await (await fetch(`https://restapi.amap.com/v3/place/text?${params}`)).json();
    if (response.status !== '1') throw new Error(response.info || '搜索失败');

    const places = (response.pois || []).map((poi) => {
      const [lng, lat] = (poi.location || '').split(',').map(Number);
      return {
        name: poi.name,
        address: typeof poi.address === 'string' ? poi.address : '',
        district: poi.adname || '',
        city: poi.cityname || '',
        type: poi.type || '',
        lat,
        lng
      };
    });

    return json({ ok: true, places });
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
