// Получение картинки из буфера обмена, перетаскивания или ссылки.
import { timedFetch } from './enrich.js';

const IMG_URL = /^https?:\/\/\S+\.(png|jpe?g|webp|gif)(\?\S*)?$/i;
export const CORS_HINT = 'Сайт не разрешил скопировать картинку по ссылке. Нажмите на картинку правой кнопкой (на планшете — долгое нажатие) → «Копировать изображение» и вставьте сюда, либо сохраните файл и нажмите «Загрузить свою».';

/** Достаёт картинку из DataTransfer (paste или drop): файл либо ссылку. */
export function pickImage(dt) {
  if (!dt) return null;
  const file = [...(dt.files || [])].find((f) => f.type.startsWith('image/'))
    || [...(dt.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
  if (file) return { file };
  const html = dt.getData?.('text/html') || '';
  const fromHtml = /<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1];
  const plain = (dt.getData?.('text/plain') || dt.getData?.('text/uri-list') || '').trim().split('\n')[0];
  const url = fromHtml || (IMG_URL.test(plain) ? plain : null);
  return url ? { url } : null;
}

/** Превращает найденное в Blob. Ссылки на чужие сайты браузер часто не даёт скачать (CORS). */
export async function toBlob(found) {
  if (found.file) return found.file;
  const { url } = found;
  try {
    const res = url.startsWith('data:') ? await fetch(url) : await timedFetch(url, {}, 20000);
    if (!res.ok) throw new Error('bad status');
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) throw new Error('not image');
    return blob;
  } catch { throw new Error(CORS_HINT); }
}

/** Кнопка «Вставить из буфера»: читает картинку через Clipboard API (нужно разрешение браузера). */
export async function readClipboardImage() {
  if (!navigator.clipboard?.read) throw new Error('Этот браузер не умеет читать буфер кнопкой. Нажмите в серой области ниже и вставьте: Ctrl+V (на планшете — долгое нажатие → «Вставить»).');
  let items;
  try { items = await navigator.clipboard.read(); }
  catch { throw new Error('Нет доступа к буферу обмена. Разрешите его в браузере или вставьте в серой области ниже: Ctrl+V (на планшете — долгое нажатие → «Вставить»).'); }
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) return item.getType(type);
  }
  throw new Error('В буфере обмена нет картинки. Сначала скопируйте её на сайте: правая кнопка → «Копировать изображение».');
}
