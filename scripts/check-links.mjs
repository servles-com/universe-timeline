#!/usr/bin/env node
// check-links.mjs - checks every source/image URL in data/events/*.json and
// writes a markdown report of dead links. Dead links (HTTP 4xx/5xx, DNS, TLS,
// timeout) exit 1; HTTP 403 may just be bot-blocking and is only reported as a
// "verify manually" warning. Used by .github/workflows/links.yml.
//
// Run: node scripts/check-links.mjs [--out report.md] [--concurrency 2] [--delay-ms 300]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'data/events';
const UA = 'universe-timeline-link-check/1.0 (https://github.com/servles-com/universe-timeline)';
const DEFAULT = { concurrency: 2, delayMs: 300, timeoutMs: 15000, maxRetries: 2 };

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};
const num = (v, fallback) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : fallback; };
const OPT = {
  out: flag('out', null),
  concurrency: Math.max(1, num(flag('concurrency', DEFAULT.concurrency), DEFAULT.concurrency)),
  delayMs: Math.max(0, num(flag('delay-ms', DEFAULT.delayMs), DEFAULT.delayMs)),
  timeoutMs: Math.max(1000, num(flag('timeout-ms', DEFAULT.timeoutMs), DEFAULT.timeoutMs)),
  maxRetries: Math.max(0, num(flag('max-retries', DEFAULT.maxRetries), DEFAULT.maxRetries)),
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

// --- collect URLs together with the events that reference them ---------------
const refsByUrl = new Map(); // url -> [{ id, kind, title }]
let sourceCount = 0, imageCount = 0;

for (const file of readdirSync(DIR).filter(f => f.endsWith('.json')).sort()) {
  let e;
  try { e = JSON.parse(readFileSync(join(DIR, file), 'utf8')); } catch { continue; }
  const add = (url, kind, title) => {
    if (!/^https:\/\//i.test(url ?? '')) return; // validate.mjs already rejects non-https
    (refsByUrl.get(url) ?? refsByUrl.set(url, []).get(url)).push({ id: e.id, kind, title });
  };
  for (const s of e.sources ?? []) { sourceCount++; add(s.url, 'source', s.title); }
  for (const im of e.images ?? []) { imageCount++; add(im.url, 'image', im.credit); }
}
const urls = [...refsByUrl.keys()].sort();

// --- polite, rate-limited request --------------------------------------------
let lastStart = 0;
async function throttle() {
  const waitFor = lastStart + OPT.delayMs - Date.now();
  lastStart = Date.now() + OPT.delayMs;
  if (waitFor > 0) await sleep(waitFor);
}
async function request(method, url) {
  await throttle();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), OPT.timeoutMs);
  const err = new Error();
  try {
    const res = await fetch(url, {
      method, redirect: 'follow',
      headers: { 'user-agent': UA, accept: '*/*' },
      signal: ac.signal,
    });
    await res.body?.cancel?.();
    return res;
  } catch (x) {
    err.message = x.name === 'AbortError' ? `timeout after ${OPT.timeoutMs}ms` : (x.cause?.message ?? x.message);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// --- probe one URL, classifying the outcome ----------------------------------
async function attempt(url, method) {
  let res;
  try { res = await request(method, url); } catch (x) { return { kind: 'transient', error: x.message }; }
  const s = res.status;
  if (s >= 200 && s < 300) return { kind: 'ok', status: s };
  if (method === 'HEAD' && [400, 403, 405, 501].includes(s)) return { kind: 'head-not-allowed', status: s };
  if (s === 429 || s >= 500) return { kind: 'transient', status: s, retryAfter: res.headers.get('retry-after') };
  if (s === 403) return { kind: 'blocked', status: s };
  return { kind: 'dead', status: s };
}

function backoff(attemptNo, retryAfter) {
  if (retryAfter) {
    const sec = Number(retryAfter);
    if (Number.isFinite(sec) && sec > 0) return Math.min(sec * 1000, 30000);
  }
  return Math.min(500 * 2 ** attemptNo, 10000);
}

async function checkUrl(url) {
  let last = null, lastStatus = null;
  for (let n = 0; n <= OPT.maxRetries; n++) {
    let r = await attempt(url, 'HEAD');
    if (r.kind === 'head-not-allowed') r = await attempt(url, 'GET');
    if (r.kind === 'ok') return { ok: true, status: r.status };
    if (r.kind === 'dead') return { ok: false, error: `HTTP ${r.status}` };
    if (r.kind === 'blocked') return { blocked: true, error: 'HTTP 403' };
    last = r.error ?? `HTTP ${r.status}`;
    lastStatus = r.status;
    await sleep(backoff(n, r.retryAfter));
  }
  if (lastStatus === 429) return { blocked: true, error: 'HTTP 429 (rate-limited)' };
  return { ok: false, error: last };
}

// --- run with limited concurrency ---------------------------------------------
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (true) {
      const k = i++;
      if (k >= items.length) return;
      out[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const started = Date.now();
const results = await mapLimit(urls, OPT.concurrency, checkUrl);

// --- report --------------------------------------------------------------------
const dead = [], blocked = [];
for (let k = 0; k < urls.length; k++) {
  const r = results[k];
  const entry = { url: urls[k], ...r, refs: refsByUrl.get(urls[k]) };
  if (r.blocked) blocked.push(entry);
  else if (!r.ok) dead.push(entry);
}
const when = new Date().toISOString().slice(0, 10);
const refText = refs =>
  refs.map(r => `\`${r.id}\` (${r.kind}${r.title ? `: “${r.title}”` : ''})`).join(', ');
const table = rows => `| # | URL | Error | Referenced by |\n|---|-----|-------|---------------|\n${rows.join('\n')}`;
const rows = entries => entries.map((b, i) => `| ${i + 1} | \`${b.url}\` | ${b.error} | ${refText(b.refs)} |`);

let report;
if (dead.length === 0) {
  let hdr = `Weekly check of source and image URLs in \`data/events/*.json\`.\n\nChecked **${urls.length}** unique URLs (${sourceCount} sources, ${imageCount} images) on **${when}** — no dead links.`;
  if (blocked.length) {
    hdr += `\n\n**${blocked.length}** URL(s) blocked automated checks (HTTP 403)` +
      ` = likely bot-blocking, verify by hand:\n\n${table(rows(blocked))}`;
    report = `## Link check OK (${blocked.length} blocked — verify manually)\n\n${hdr}\n`;
  } else {
    report = `## Link check OK\n\n${hdr}\n`;
  }
} else {
  report = `## Broken links found\n\nWeekly check of source and image URLs in \`data/events/*.json\` (run **${when}**): **${dead.length}/${urls.length}** URLs are dead.\n\n${table(rows(dead))}`;
  if (blocked.length) {
    report += `\n\nAdditionally **${blocked.length}** URL(s) returned HTTP 403 (likely bot-blocking, verify by hand):\n\n${table(rows(blocked))}`;
  }
  report += `\n\n> \`HTTP 403\`/\`429\` often means bot-blocking rather than a dead page — verify by hand.\n> Re-run locally: \`node scripts/check-links.mjs\`.\n`;
}

if (OPT.out) { writeFileSync(OPT.out, report); console.log(`report written to ${OPT.out}`); }
console.log(report.trim());

const secs = ((Date.now() - started) / 1000).toFixed(1);
if (dead.length) {
  console.error(`\n✗ ${dead.length} dead link(s) among ${urls.length} URLs in ${secs}s`);
  process.exit(1);
}
console.log(`✓ ${urls.length} URLs checked in ${secs}s`);