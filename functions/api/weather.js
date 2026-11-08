// GET /api/weather?lat=30.27&lng=120.15
// 用高德逆地理拿到区县，再查当天天气。key 存在 Pages 的环境变量里。

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');

  if (!lat || !lng) {
    return json({ ok: false, error: '缺少经纬度' }, 400);
  }
  if (!env.AMAP_KEY) {
    return json({ ok: false, error: '未配置高德 key', code: 'NO_KEY' }, 501);
  }

  try {
    const location = `${lng},${lat}`;
    const regeoUrl = `https://restapi.amap.com/v3/geocode/regeo?key=${env.AMAP_KEY}&location=${location}&extensions=base`;
    const regeo = await (await fetch(regeoUrl)).json();
    if (regeo.status !== '1') throw new Error(regeo.info || '逆地理失败');

    const comp = regeo.regeocode?.addressComponent || {};
    const adcode = comp.adcode;
    const city = typeof comp.city === 'string' && comp.city ? comp.city : comp.province;
    const district = comp.district || '';

    const weatherUrl = `https://restapi.amap.com/v3/weather/weatherInfo?key=${env.AMAP_KEY}&city=${adcode}&extensions=base`;
    const weather = await (await fetch(weatherUrl)).json();
    const live = weather.lives?.[0];

    if (!live) {
      return json({ ok: true, city, district, adcode, weather: null });
    }

    return json({
      ok: true,
      city,
      district,
      adcode,
      weather: {
        text: live.weather,
        temperature: live.temperature,
        wind: `${live.winddirection}风 ${live.windpower}级`,
        humidity: live.humidity,
        reportTime: live.reporttime,
        display: `${live.weather} ${live.temperature}℃`
      }
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
