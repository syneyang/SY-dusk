// 录音 + 转写：把麦克风的声音变成文字。
// iOS 录出来是 m4a，安卓是 webm，百度只认 16k 单声道 WAV，所以这里统一转一遍。

// 麦克风只申请一次，之后一直复用：不会反复弹权限，也不会每次卡一下
let sharedStream = null;

async function ensureStream() {
  if (sharedStream && sharedStream.getAudioTracks().some((track) => track.readyState === 'live')) {
    return sharedStream;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('这台设备的浏览器不支持录音');
  }

  sharedStream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: 48000, echoCancellation: true, noiseSuppression: true }
  });
  return sharedStream;
}

/** 页面离开时把麦克风关掉（否则状态栏一直亮着） */
export function releaseMicrophone() {
  if (!sharedStream) return;
  sharedStream.getTracks().forEach((track) => track.stop());
  sharedStream = null;
}

/** 提前把麦克风准备好（第一次点按钮之前调用，省掉那一下卡顿） */
export function warmUpMicrophone() {
  ensureStream().catch(() => {});
}

/** 开始录音，返回 { stop: () => Promise<Blob>, cancel } */
export async function startRecording() {
  const stream = await ensureStream();

  const mime = pickMimeType();
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  const chunks = [];

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size) chunks.push(event.data);
  });

  recorder.start(200);

  const finish = () => new Promise((resolve) => {
    recorder.addEventListener('stop', () => {
      resolve(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
    }, { once: true });
    recorder.stop();
  });

  return {
    stop: finish,
    // 只停录音，不关麦克风（下次直接复用）
    cancel: () => {
      try { recorder.stop(); } catch {}
    }
  };
}

function pickMimeType() {
  const candidates = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

/** 任意音频 blob → 16k 单声道 WAV（Uint8Array）。 */
export async function toWav16k(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  } finally {
    ctx.close();
  }

  const mono = mixToMono(decoded);
  const resampled = resample(mono, decoded.sampleRate, 16000);
  return encodeWav(resampled, 16000);
}

function mixToMono(buffer) {
  const channels = buffer.numberOfChannels;
  if (channels === 1) return buffer.getChannelData(0);

  const length = buffer.length;
  const out = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i] += data[i] / channels;
  }
  return out;
}

function resample(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = input[index] || 0;
    const b = input[index + 1] || a;
    out[i] = a + (b - a) * fraction;
  }
  return out;
}

function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

const MAX_CHUNK_SECONDS = 55;
const SAMPLE_RATE = 16000;

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 把一段音频变成文字。超过 55 秒会自动切片，逐段识别再拼起来。 */
export async function transcribe(blob, onProgress = () => {}) {
  const wav = await toWav16k(blob);
  const samples = (wav.length - 44) / 2;
  const perChunk = MAX_CHUNK_SECONDS * SAMPLE_RATE;
  const total = Math.max(1, Math.ceil(samples / perChunk));

  const texts = [];
  for (let index = 0; index < total; index++) {
    onProgress({ index, total, text: '识别中…' });

    const start = index * perChunk * 2 + 44;
    const end = Math.min(wav.length, (index + 1) * perChunk * 2 + 44);
    const slice = wav.subarray(start, end);
    const part = await sendToServer(slice);
    if (part) texts.push(part);
  }

  return texts.join('');
}

async function sendToServer(wavBytes) {
  const response = await fetch('/api/asr', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      audio: bytesToBase64(wavBytes),
      len: wavBytes.length,
      rate: SAMPLE_RATE
    })
  });

  const data = await response.json().catch(() => ({ ok: false, error: '服务器没有响应' }));
  if (!data.ok) throw new Error(data.error || '识别失败');
  return (data.text || '').trim();
}
