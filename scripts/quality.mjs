#!/usr/bin/env node
// quality.mjs - scores every event in data/events/*.json against a documented
// quality rubric and prints a markdown report ranked weakest-first. This is a
// REPORT ONLY - it never fails CI (see .github/workflows/ci.yml). The rubric is
// defined in the README: extra sources, peer-reviewed papers, explicit
// time.uncertainty / precise dates, images, Russian translations and fuller
// summaries all raise the score.
//
// Run: node scripts/quality.mjs [--out report.md]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'data/events';
const DATE_RE = /^(-?\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? fallback);
};

// --- rubric (see README for the documented version) ---------------------------
// sources 35 (1 source 0, 2 sources 12, 3+ 20; paper +10; 2+ types +5)
// time 15 (ya with uncertainty or day-precise date 15; ya alone / year date 8)
// image 10, title.ru 8, summary.ru 12, summary.en length 20. Total = 100.
const MAX_SCORE = 100;

function scoreSources(e) {
  const n = e.sources?.length ?? 0;
  const count = n >= 3 ? 20 : n === 2 ? 12 : 0;
  const paper = e.sources?.some(s => s.type === 'paper') ? 10 : 0;
  const types = new Set((e.sources ?? []).map(s => s.type)).size;
  return {
    points: count + paper + (types >= 2 ? 5 : 0), n, hasPaper: paper > 0,
    hints: [n < 2 && 'add a second source', n === 2 && 'add a third source', !paper && 'no peer-reviewed paper source'].filter(Boolean),
  };
}

function scoreTime(e) {
  const t = e.time ?? {};
  if (typeof t.ya === 'number') {
    return { points: t.uncertainty !== undefined ? 15 : 8, hints: t.uncertainty === undefined ? ['no time.uncertainty'] : [] };
  }
  const m = DATE_RE.exec(String(t.date ?? ''));
  return { points: m?.[3] ? 15 : m?.[2] ? 12 : 8, hints: [] }; // day / month / year precision
}

function scoreSummary(e) {
  const len = (e.summary?.en ?? '').trim().length;
  return {
    points: len >= 150 ? 20 : len >= 100 ? 15 : len >= 60 ? 10 : len >= 30 ? 5 : 0,
    hints: len < 100 ? ['short summary.en'] : [],
  };
}

function scoreEvent(e) {
  const s = scoreSources(e);
  const t = scoreTime(e);
  const z = scoreSummary(e);
  const flags = {
    isYa: typeof e.time?.ya === 'number',
    hasSecondSource: s.n >= 2, hasPaper: s.hasPaper, hasImage: (e.images?.length ?? 0) > 0,
    hasUncertainty: typeof e.time?.ya === 'number' && e.time?.uncertainty !== undefined,
    hasSummaryRu: !!e.summary?.ru,
  };
  const parts = {
    sources: s.points, time: t.points, image: flags.hasImage ? 10 : 0,
    ru_title: e.title?.ru ? 8 : 0, ru_summary: flags.hasSummaryRu ? 12 : 0, summary_len: z.points,
  };
  const hints = [...s.hints, ...t.hints, ...z.hints];
  if (!flags.hasImage) hints.push('no image');
  if (!e.title?.ru) hints.push('no title.ru');
  if (!flags.hasSummaryRu) hints.push('no summary.ru');
  return {
    id: e.id, title: e.title?.en ?? e.id, level: e.level,
    total: Object.values(parts).reduce((a, b) => a + b, 0), flags, hints,
  };
}

// --- gather everything ---------------------------------------------------------
const events = [];
for (const f of readdirSync(DIR).filter(f => f.endsWith('.json')).sort()) {
  let e;
  try { e = JSON.parse(readFileSync(join(DIR, f), 'utf8')); } catch { continue; }
  events.push(scoreEvent(e));
}
events.sort((a, b) => a.total - b.total || a.id.localeCompare(b.id));
const mean = (events.reduce((a, r) => a + r.total, 0) / (events.length || 1)).toFixed(1);
const median = events[Math.floor(events.length / 2)]?.total;

const bands = {};
for (const r of events) {
  const b = r.total >= 80 ? '80+ (strong)' : r.total >= 60 ? '60–79 (solid)' : r.total >= 40 ? '40–59 (basic)' : '<40 (weak)';
  bands[b] = (bands[b] ?? 0) + 1;
}

const gapRows = [
  ['second source (2+ sources)', r => !r.flags.hasSecondSource],
  ['peer-reviewed paper source', r => !r.flags.hasPaper],
  ['image with license + credit', r => !r.flags.hasImage],
  ['time.uncertainty on ya events', r => r.flags.isYa && !r.flags.hasUncertainty],
  ['summary.ru', r => !r.flags.hasSummaryRu],
];
const gaps = gapRows.map(([label, f]) => {
  const n = events.filter(f).length;
  return `| ${n} (${Math.round(n / events.length * 100)}%) | ${label} |`;
}).join('\n');

const rows = events.map((r, i) =>
  `| ${i + 1} | \`${r.id}\` | **${r.total}** | ${r.hints.length ? r.hints.join(', ') : '—'} |`).join('\n');

let report = `# Event quality report

Scored **${events.length}** events in \`data/events/*.json\` on **${new Date().toISOString().slice(0, 10)}**
against the rubric in the README (extra sources, peer-reviewed papers, \`time.uncertainty\` /
precise dates, images, Russian translations, summary length). Ranked weakest-first — a report
only, never a CI gate.

## Summary
Mean **${mean}** / ${MAX_SCORE} · median **${median}** · weakest \`${events[0].id}\` (**${events[0].total}**)
· strongest \`${events.at(-1).id}\` (**${events.at(-1).total}**)

| Events | Band |
|---|---|
| ${bands['80+ (strong)'] ?? 0} | 80+ (strong) |
| ${bands['60–79 (solid)'] ?? 0} | 60–79 (solid) |
| ${bands['40–59 (basic)'] ?? 0} | 40–59 (basic) |
| ${bands['<40 (weak)'] ?? 0} | <40 (weak) |

## Ranked list (weakest first)
| # | Event | Score | Missing |
|---|---|---|---|
${rows}

## Dataset-wide gaps
| Missing in | Factor |
|---|---|
${gaps}

> Rubric: see README → "Quality reporting". Re-run locally: \`node scripts/quality.mjs\`.
`;

if (flag('out')) { writeFileSync(flag('out'), report); console.log(`report written to ${flag('out')}`); }
console.log(report.trim());