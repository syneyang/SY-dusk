// 语音识别：把音频转成文字（百度短语音识别）。
// POST /api/asr { audio: base64(wav 16k 单声道), len, rate }

let cached = { token: '', expires: 0 };

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: '请求格式不对' }, 400);
  }

  if (!body.audio) return json({ ok: false, error: '缺少音频' }, 400);

  const key = await config(env, 'BAIDU_ASR_KEY');
  const secret = await config(env, 'BAIDU_ASR_SECRET');
  if (!key || !secret) {
    return json({ ok: false, error: '还没有配置语音识别', code: 'NO_KEY' }, 501);
  }

  try {
    const token = await getToken(key, secret);
    const payload = {
      format: 'wav',
      rate: body.rate || 16000,
      channel: 1,
      cuid: 'dusk',
      token,
      speech: body.audio,
      len: body.len || 0
    };

    const response = await fetch('https://vop.baidu.com/server_api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (data.err_no !== 0) {
      return json({ ok: false, error: explain(data.err_no, data.err_msg), code: data.err_no }, 400);
    }

    return json({ ok: true, text: (data.result || []).join('').trim() });
  } catch (error) {
    return json({ ok: false, error: error.message || String(error) }, 500);
  }
}

async function getToken(key, secret) {
  const now = Date.now();
  if (cached.token && cached.expires > now + 60_000) return cached.token;

  const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${encodeURIComponent(key)}&client_secret=${encodeURIComponent(secret)}`;
  const data = await (await fetch(url)).json();
  if (!data.access_token) throw new Error('取不到识别服务的凭证');

  cached = { token: data.access_token, expires: now + (data.expires_in || 2592000) * 1000 };
  return cached.token;
}

/** 环境变量优先，没有就读数据库里的配置。 */
async function config(env, name) {
  if (env[name]) return env[name];
  if (!env.DB) return '';
  try {
    const row = await env.DB.prepare('SELECT value FROM config WHERE name = ?').bind(name).first();
    return row ? row.value : '';
  } catch {
    return '';
  }
}

function explain(code, message) {
  const table = {
    3301: '音频质量太差，换个安静的地方再说一次',
    3302: '音频格式不对',
    3303: '音频太长，切成小段再试',
    3304: '没有听清，再说一次',
    3305: '识别次数用完了',
    3307: '音频为空',
    3308: '音频格式不支持',
    3309: '音频采样率不对'
  };
  return table[code] || `识别失败（${code}${message ? ' ' + message : ''}）`;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
