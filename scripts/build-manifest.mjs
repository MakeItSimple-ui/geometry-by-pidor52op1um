#!/usr/bin/env node
/**
 * Собирает manifest.json из трёх источников:
 *   1) папка ggb/     — твои .ggb файлы (подпапки = разделы сайта)
 *   2) GeoGebra       — публичные чертежи твоего аккаунта, подтягиваются сами
 *   3) links.json     — чертежи, добавленные руками (в т.ч. «shared with link»,
 *                       которые GeoGebra наружу не отдаёт)
 *
 * Запуск:  node scripts/build-manifest.mjs
 * В GitHub Actions запускается при каждом пуше и по расписанию.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const GGB_DIR = path.join(ROOT, 'ggb');
const THUMB_DIR = path.join(ROOT, 'thumbs');
const API = 'https://api.geogebra.org/v1.0';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

// ── транслитерация для красивых ссылок ──────────────────────────────────────
const MAP = {
  а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',
  м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',
  щ:'sch',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya'
};
const slugify = s => s.toLowerCase().split('').map(c => (c in MAP ? MAP[c] : c)).join('')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
function uniq(slug, seen) {
  let s = slug, n = 2;
  while (seen.has(s)) s = `${slug}-${n++}`;
  seen.add(s);
  return s;
}
const iso = unix => (unix ? new Date(unix * 1000).toISOString() : null);

// ── GeoGebra API ────────────────────────────────────────────────────────────
async function api(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function listMaterials(userId, folderId) {
  const out = [];
  for (let off = 0; off < 2000; off += 100) {
    const q = new URLSearchParams({
      type: 'created_by,shared_with', offset: String(off), order: '-modified', limit: '100',
    });
    if (folderId) q.set('folder_id', folderId);
    const page = await api(`${API}/users/${userId}/materials?${q}`);
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < 100) break;
  }
  return out;
}

/** всё, что GeoGebra отдаёт наружу: публичные чертежи + их раздел */
async function fetchFromGeoGebra() {
  const byId = new Map(), folderOf = new Map();
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sources.json'), 'utf8')); } catch { return { byId, folderOf }; }
  if (!cfg || !cfg.userId) return { byId, folderOf };

  for (const f of cfg.folders || []) {
    try {
      for (const m of await listMaterials(cfg.userId, f.id)) {
        byId.set(m.id, m);
        folderOf.set(m.id, f.name);
      }
    } catch (e) { console.warn(`! раздел ${f.name}: ${e.message}`); }
  }
  try {
    for (const m of await listMaterials(cfg.userId, null)) if (!byId.has(m.id)) byId.set(m.id, m);
  } catch (e) { console.warn(`! общий список: ${e.message}`); }
  return { byId, folderOf };
}

/** добор одного чертежа по id — работает и для «shared with link» */
async function fetchOne(id) {
  try { return await api(`${API}/materials/${id}`); } catch { return null; }
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
  try {
    const png = execFileSync('unzip', ['-p', absGgb, 'geogebra_thumbnail.png'],
      { maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    if (png && png.length > 8 && png.subarray(0, 4).toString('latin1') === '\x89PNG') {
      fs.mkdirSync(THUMB_DIR, { recursive: true });
      fs.writeFileSync(path.join(THUMB_DIR, `${slug}.png`), png);
      return `thumbs/${slug}.png`;
    }
  } catch {}
  return null;
}

// ════════════════════════════════════════════════════════════════════════════
const seen = new Set();
const items = [];

// 1. локальные .ggb
for (const f of walk(GGB_DIR)) {
  const title = f.file.replace(/\.ggb$/i, '').trim();
  const slug = uniq(slugify(title), seen);
  const rel = path.relative(ROOT, f.abs).split(path.sep).join('/');
  items.push({
    slug, title, folder: f.folder, kind: 'file', file: rel,
    thumb: extractThumb(f.abs, slug), date: gitDate(rel), ord: -1,
  });
}

// 2. чертежи из GeoGebra + ручные из links.json
const { byId, folderOf } = await fetchFromGeoGebra();
console.log(`GeoGebra отдала ${byId.size} чертежей`);

let links = [];
try { links = JSON.parse(fs.readFileSync(path.join(ROOT, 'links.json'), 'utf8')); } catch {}

const manual = new Map();
for (const [ord, l] of (Array.isArray(links) ? links : []).entries()) {
  if (!l) continue;
  const raw = String(l.id || l.url || l).trim();
  const id = (raw.match(/(?:\/m\/|\/material\/|^)([a-z0-9]{6,12})(?:[/?#]|$)/i) || [])[1] || raw;
  if (id) manual.set(id, { ...l, id, ord });
}

// ручные, которых нет в выдаче API (обычно «shared with link») — доберём по одному
for (const id of manual.keys()) {
  if (byId.has(id)) continue;
  const m = await fetchOne(id);
  if (m && !m.deleted) byId.set(id, m);
}

const order = new Map();
for (const id of [...byId.keys(), ...manual.keys()]) {
  if (order.has(id)) continue;
  order.set(id, order.size);
  const m = byId.get(id) || {};
  const l = manual.get(id) || {};
  const title = (m.title || l.title || id).trim();
  items.push({
    slug: uniq(slugify(l.slug || title), seen),
    title,
    folder: folderOf.get(id) ?? l.folder ?? '',
    kind: 'material',
    material: id,
    thumb: m.thumbUrl || l.thumb || null,
    date: iso(m.date_modified || m.date_created) || l.date || null,
    ord: l.ord ?? 1000 + order.get(id),
    ...(l.perspective ? { perspective: l.perspective } : {}),
  });
}

// ── порядок разделов: как в sources.json, потом остальные, «без раздела» в конец ──
let pinned = [];
try { pinned = (JSON.parse(fs.readFileSync(path.join(ROOT, 'sources.json'), 'utf8')).folders || []).map(f => f.name); } catch {}
const rest = [...new Set(items.map(i => i.folder))]
  .filter(f => f && !pinned.includes(f)).sort((a, b) => a.localeCompare(b, 'ru'));
const folders = [...pinned.filter(f => items.some(i => i.folder === f)), ...rest];
if (items.some(i => !i.folder)) folders.push('');

// свежее — сверху
items.sort((a, b) =>
  folders.indexOf(a.folder) - folders.indexOf(b.folder) ||
  (b.date || '').localeCompare(a.date || '') ||
  a.ord - b.ord ||
  a.title.localeCompare(b.title, 'ru'));
for (const i of items) delete i.ord;

fs.writeFileSync(path.join(ROOT, 'manifest.json'),
  JSON.stringify({ generated: new Date().toISOString(), folders, items }, null, 2) + '\n');
console.log(`manifest.json: ${items.length} чертежей, разделов: ${folders.length}`);
