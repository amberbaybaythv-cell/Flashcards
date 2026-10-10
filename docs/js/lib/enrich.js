// Транскрипция (IPA) и ассоциативные картинки: запросы идут напрямую из браузера, нужен интернет.
const KEY = 'settings';

export function getSettings() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* приватный режим */ }
}

export function imageProviderName() {
  const s = getSettings();
  if (s.imageProvider) return s.imageProvider;
  if (s.hfToken) return 'huggingface';
  if (s.openaiKey) return 'openai';
  return 'pollinations';
}

export function imageConfigured() {
  const s = getSettings(), p = imageProviderName();
  if (p === 'openai') return !!s.openaiKey;
  if (p === 'huggingface') return !!s.hfToken;
  return true;
}

export async function timedFetch(url, opts = {}, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('превышено время ожидания');
    throw new Error('нет связи с сервисом: проверьте интернет (или сервис не принимает запросы из браузера)');
  } finally { clearTimeout(t); }
}

/* ---------- IPA ---------- */
export async function lookupIpa(term) {
  const word = term.trim();
  if (!word || /\d/.test(word) || word.length > 60) return null;
  const res = await timedFetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {}, 8000);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Словарь вернул ${res.status}`);
  const data = await res.json();
  const entry = Array.isArray(data) ? data[0] : null;
  return entry?.phonetic || entry?.phonetics?.find((p) => p.text)?.text || null;
}

/* ---------- Картинки ---------- */
export function buildPrompt(term, definition) {
  const def = String(definition).replace(/\s+/g, ' ').slice(0, 200);
  return `A simple illustration that helps remember the concept "${term}" (meaning: ${def}). One clear central object or visual metaphor, minimalist flat colorful style, plain background. No text, no letters, no words.`;
}

function httpError(name, res, hint) {
  if ([401, 402, 403].includes(res.status)) return new Error(`${name} требует ключ или оплату (код ${res.status}). ${hint}`);
  if (res.status === 429) return new Error(`${name}: слишком много запросов (429), попробуйте позже`);
  return new Error(`${name} вернул ${res.status}`);
}
const HINT = 'Проверьте ключ в разделе «Настройки» или выберите другого провайдера.';

async function imageBlob(res, name) {
  const blob = await res.blob();
  if (!blob.type.startsWith('image/')) throw new Error(`${name} вернул не изображение`);
  return blob;
}

const providers = {
  async pollinations(prompt, s) {
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=512&height=512&nologo=true&seed=${Math.floor(Math.random() * 1e6)}`;
    const res = await timedFetch(url, { headers: s.pollinationsToken ? { Authorization: `Bearer ${s.pollinationsToken}` } : {} }, 60000);
    if (!res.ok) throw httpError('Pollinations', res, HINT);
    return imageBlob(res, 'Pollinations');
  },
  async openai(prompt, s) {
    if (!s.openaiKey) throw new Error('Не задан ключ OpenAI в настройках');
    const res = await timedFetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.openaiKey}` },
      body: JSON.stringify({ model: s.openaiModel || 'gpt-image-1', prompt, size: '1024x1024', n: 1 }),
    }, 120000);
    if (!res.ok) throw httpError('OpenAI', res, HINT);
    const item = (await res.json()).data?.[0];
    if (item?.b64_json) {
      const bin = atob(item.b64_json), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: 'image/png' });
    }
    if (item?.url) return imageBlob(await timedFetch(item.url, {}, 60000), 'OpenAI');
    throw new Error('OpenAI не вернул изображение');
  },
  async huggingface(prompt, s) {
    if (!s.hfToken) throw new Error('Не задан токен Hugging Face в настройках');
    const model = s.hfModel || 'black-forest-labs/FLUX.1-schnell';
    const res = await timedFetch(`https://router.huggingface.co/hf-inference/models/${model}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.hfToken}` },
      body: JSON.stringify({ inputs: prompt }),
    }, 120000);
    if (!res.ok) throw httpError('Hugging Face', res, HINT + ' У токена должно быть право «Make calls to Inference Providers».');
    return imageBlob(res, 'Hugging Face');
  },
};

export async function generateImage(prompt) {
  const gen = providers[imageProviderName()];
  if (!gen) throw new Error(`Неизвестный провайдер картинок: ${imageProviderName()}`);
  return gen(prompt, getSettings());
}

/** Уменьшает картинку до JPEG-миниатюры (чтобы не забивать память устройства). Возвращает data-URL. */
export async function toJpegDataUrl(blob, max = 480, quality = 0.8) {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', quality);
}
