// Обновляет в docs/sw.js список файлов и версию (хеш содержимого). Запуск: npm run build:sw
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const skip = new Set(['sw.js', '.nojekyll']);
const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (!skip.has(e.name)) files.push(path.relative(root, p).split(path.sep).join('/'));
  }
})(root);

const hash = crypto.createHash('sha1');
for (const f of files) { hash.update(f); hash.update(fs.readFileSync(path.join(root, f))); }
const version = hash.digest('hex').slice(0, 10);

const swPath = path.join(root, 'sw.js');
const sw = fs.readFileSync(swPath, 'utf8');
const block = `/* BUILD:START */\nconst VERSION = '${version}';\nconst FILES = ${JSON.stringify(['./', ...files.map((f) => './' + f)], null, 2)};\n/* BUILD:END */`;
fs.writeFileSync(swPath, sw.replace(/\/\* BUILD:START \*\/[\s\S]*?\/\* BUILD:END \*\//, block));
console.log(`sw.js: версия ${version}, файлов в кеше: ${files.length + 1}`);
