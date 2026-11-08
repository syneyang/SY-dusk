// GET /api/nearby?lat=30.27&lng=120.15&radius=1200&q=商场
// 高德「周边搜索」：拿当前位置附近的地点。

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const radius = url.searchParams.get('radius') || '1500';
  const q = (url.searchParams.get('q') || '').trim();

  if (!lat || !lng) return json({ ok: false, error: '缺少经纬度' }, 400);
  if (!env.AMAP_KEY) return json({ ok: false, error: '未配置高德 key', code: 'NO_KEY' }, 501);

  try {
    const params = new URLSearchParams({
      key: env.AMAP_KEY,
      location: `${lng},${lat}`,
      radius,
      offset: '25',
      page: '1',
      extensions: 'base',
      sortrule: 'distance'
    });
    if (q) params.set('keywords', q);

    const response = await (await fetch(`https://restapi.amap.com/v3/place/around?${params}`)).json();
    if (response.status !== '1') throw new Error(response.info || '周边搜索失败');

    const places = (response.pois || []).map((poi) => {
      const [lng2, lat2] = (poi.location || '').split(',').map(Number);
      return {
        name: poi.name,
        address: typeof poi.address === 'string' ? poi.address : '',
        district: poi.adname || '',
        city: poi.cityname || '',
        type: poi.type || '',
        distance: Number(poi.distance) || null,
        lat: lat2,
        lng: lng2
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
