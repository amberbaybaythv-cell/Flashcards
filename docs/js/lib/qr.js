// Рисует QR-код в canvas (библиотека qrcode-generator, MIT, лежит в vendor/).
import qrcode from '../vendor/qrcode.js';

export function drawQr(canvas, text, { size = 360, margin = 4 } = {}) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  const cell = Math.max(2, Math.floor(size / (n + margin * 2)));
  const px = cell * (n + margin * 2);
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
  return n;
}
