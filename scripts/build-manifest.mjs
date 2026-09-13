#!/usr/bin/env node
/**
 * Собирает manifest.json из двух источников:
 *   1) папка ggb/  — твои .ggb файлы (подпапки = разделы сайта)
 *   2) links.json  — чертежи, которые лежат на geogebra.org (по material id)
 *
 * Запуск:  node scripts/build-manifest.mjs
 * В GitHub Actions запускается сам при каждом пуше.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const GGB_DIR = path.join(ROOT, 'ggb');
const THUMB_DIR = path.join(ROOT, 'thumbs');

// ── транслитерация для красивых ссылок ──────────────────────────────────────
const MAP = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',
  м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',
  щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'
};
function slugify(s) {
  const out = s.toLowerCase().split('').map(c => (c in MAP ? MAP[c] : c)).join('')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out || 'item';
}
function uniq(slug, seen) {
  let s = slug, n = 2;
  while (seen.has(s)) s = `${slug}-${n++}`;
  seen.add(s);
  return s;
}

// ── дата последнего изменения файла (из git, если есть) ─────────────────────
function gitDate(rel) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', rel],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (out) return out;
  } catch {}
  try { return fs.statSync(path.join(ROOT, rel)).mtime.toISOString(); } catch {}
  return null;
}

// ── рекурсивный обход ggb/ ──────────────────────────────────────────────────
function walk(dir, base = '') {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.name.startsWith('.')) return [];
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) return walk(abs, base ? `${base}/${e.name}` : e.name);
    if (!e.name.toLowerCase().endsWith('.ggb')) return [];
    return [{ abs, folder: base, file: e.name }];
  });
}

// ── превью вытаскиваем прямо из .ggb (это zip с geogebra_thumbnail.png) ─────
function extractThumb(absGgb, slug) {
  const out = path.join(THUMB_DIR, `${slug}.png`);
  try {
    const png = execFileSync('unzip', ['-p', absGgb, 'geogebra_thumbnail.png'],
      { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    if (png && png.length > 8 && png.subarray(0, 4).toString('latin1') === '\x89PNG') {
      fs.mkdirSync(THUMB_DIR, { recursive: true });
      fs.writeFileSync(out, png);
      return `thumbs/${slug}.png`;
    }
  } catch {}
  return null;
}

const seen = new Set();
const items = [];

// 1. локальные .ggb
for (const f of walk(GGB_DIR)) {
  const title = f.file.replace(/\.ggb$/i, '').trim();
  const slug = uniq(slugify(title), seen);
  const rel = path.relative(ROOT, f.abs).split(path.sep).join('/');
  items.push({
    slug, title,
    folder: f.folder,
    kind: 'file',
    file: rel,
    thumb: extractThumb(f.abs, slug),
    date: gitDate(rel),
    ord: -1,
  });
}

// 2. чертежи с geogebra.org
let links = [];
try { links = JSON.parse(fs.readFileSync(path.join(ROOT, 'links.json'), 'utf8')); }
catch { links = []; }

for (const [ord, l] of links.entries()) {
  if (!l) continue;
  // принимаем и голый id, и любую ссылку вида geogebra.org/m/xxxx
  const raw = String(l.id || l.url || l).trim();
  const id = (raw.match(/(?:\/m\/|\/material\/|^)([a-z0-9]{6,12})(?:[/?#]|$)/i) || [])[1] || raw;
  if (!id) continue;
  const title = (l.title || id).trim();
  const slug = uniq(slugify(l.slug || title), seen);
  items.push({
    slug, title,
    folder: l.folder || '',
    kind: 'material',
    material: id,
    thumb: l.thumb || null,
    date: l.date || null,
    ord,
    ...(l.perspective ? { perspective: l.perspective } : {}),
  });
}

// ── порядок: разделы по алфавиту, «без раздела» в конец ─────────────────────
const folders = [...new Set(items.map(i => i.folder))]
  .sort((a, b) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'ru')));

// свежие .ggb сверху, чертежи с geogebra.org — в том порядке, в каком лежат в links.json
items.sort((a, b) =>
  folders.indexOf(a.folder) - folders.indexOf(b.folder) ||
  (b.date || '').localeCompare(a.date || '') ||
  a.ord - b.ord ||
  a.title.localeCompare(b.title, 'ru'));
for (const i of items) delete i.ord;

const manifest = { generated: new Date().toISOString(), folders, items };
fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest.json: ${items.length} чертежей, разделов: ${folders.length}`);
