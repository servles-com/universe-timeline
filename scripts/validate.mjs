// Validates every data/events/*.json. This is the quality gate for agent PRs:
// CI fails on any error. Run: node scripts/validate.mjs
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, SOURCE_TYPES, DATE_RE, UNIVERSE_AGE, nowYear } from './lib.mjs';

const DIR = 'data/events';
const ALLOWED_KEYS = new Set(['id', 'title', 'time', 'level', 'category', 'summary', 'sources', 'images', 'related', 'notes']);
const LEVEL1_MAX = 25;   // level 1 = visible at full zoom-out; keep it for true landmarks
const errors = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const isStr = (v, min = 1, max = Infinity) => typeof v === 'string' && v.trim().length >= min && v.length <= max;
const isHttps = v => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };

const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
const ids = new Set(), titles = new Map();
let level1 = 0;

for (const f of files) {
  let e;
  try { e = JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch (x) { err(f, `invalid JSON: ${x.message}`); continue; }
  for (const k of Object.keys(e)) if (!ALLOWED_KEYS.has(k)) err(f, `unknown key "${k}"`);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id ?? '')) err(f, 'id must be kebab-case');
  if (`${e.id}.json` !== f) err(f, `file name must be "${e.id}.json"`);
  if (ids.has(e.id)) err(f, `duplicate id ${e.id}`); ids.add(e.id);

  if (!isStr(e.title?.en, 3, 120)) err(f, 'title.en required (3..120 chars)');
  if (e.title?.ru !== undefined && !isStr(e.title.ru, 3, 120)) err(f, 'title.ru must be 3..120 chars');
  const norm = String(e.title?.en ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (titles.has(norm)) err(f, `same title as ${titles.get(norm)}`); else titles.set(norm, f);

  const t = e.time ?? {};
  const hasYa = t.ya !== undefined, hasDate = t.date !== undefined;
  if (hasYa === hasDate) err(f, 'time must have exactly one of "ya" (years ago) or "date" (YYYY[-MM[-DD]])');
  if (hasYa && !(typeof t.ya === 'number' && t.ya > 0 && t.ya <= UNIVERSE_AGE * 1.01)) err(f, 'time.ya must be > 0 and ≤ age of the universe');
  if (hasYa && t.ya < 10000) err(f, 'events younger than 10,000 years must use time.date');
  if (hasDate) {
    const m = DATE_RE.exec(String(t.date));
    if (!m) err(f, 'time.date must be YYYY, YYYY-MM or YYYY-MM-DD (negative year = BCE)');
    else if (Number(m[1]) > nowYear()) err(f, 'time.date is in the future');
  }
  if (t.uncertainty !== undefined && !(typeof t.uncertainty === 'number' && t.uncertainty >= 0)) err(f, 'time.uncertainty must be a number ≥ 0 (years)');

  if (!(Number.isInteger(e.level) && e.level >= 1 && e.level <= 6)) err(f, 'level must be an integer 1..6');
  if (e.level === 1) level1++;
  if (!CATEGORIES.includes(e.category)) err(f, `category must be one of ${CATEGORIES.join(', ')}`);
  if (!isStr(e.summary?.en, 10, 600)) err(f, 'summary.en required (10..600 chars)');

  if (!Array.isArray(e.sources) || e.sources.length === 0) err(f, 'at least one source required');
  for (const [i, s] of (e.sources ?? []).entries()) {
    if (!isHttps(s.url)) err(f, `sources[${i}].url must be https`);
    if (!SOURCE_TYPES.includes(s.type)) err(f, `sources[${i}].type must be one of ${SOURCE_TYPES.join(', ')}`);
  }
  for (const [i, im] of (e.images ?? []).entries()) {
    if (!isHttps(im.url)) err(f, `images[${i}].url must be https`);
    if (!isStr(im.license)) err(f, `images[${i}].license required`);
    if (!isStr(im.credit)) err(f, `images[${i}].credit required`);
  }
  for (const r of e.related ?? []) if (typeof r !== 'string') err(f, 'related must be a list of event ids');
}
if (level1 > LEVEL1_MAX) errors.push(`level 1 is for true landmarks: ${level1} events, max ${LEVEL1_MAX}`);
// related ids must exist
for (const f of files) {
  try { for (const r of JSON.parse(readFileSync(join(DIR, f), 'utf8')).related ?? []) if (!ids.has(r)) err(f, `related id "${r}" does not exist`); } catch {}
}

if (errors.length) { console.error(errors.join('\n')); console.error(`\n✗ ${errors.length} error(s) in ${files.length} events`); process.exit(1); }
console.log(`✓ ${files.length} events valid (level 1: ${level1}/${LEVEL1_MAX})`);
