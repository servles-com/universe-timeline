// Progress metrics for the dataset (used by the dogfood reports).
import { readdirSync, readFileSync } from 'node:fs';
const ev = readdirSync('data/events').filter(f => f.endsWith('.json')).map(f => JSON.parse(readFileSync(`data/events/${f}`, 'utf8')));
const by = (k) => ev.reduce((a, e) => (a[k(e)] = (a[k(e)] ?? 0) + 1, a), {});
console.log(JSON.stringify({
  events: ev.length,
  by_level: by(e => e.level), by_category: by(e => e.category),
  with_ru_title: ev.filter(e => e.title.ru).length,
  with_images: ev.filter(e => e.images?.length).length,
  with_2plus_sources: ev.filter(e => e.sources.length >= 2).length,
  with_paper_source: ev.filter(e => e.sources.some(s => s.type === 'paper')).length,
  with_uncertainty: ev.filter(e => e.time.uncertainty !== undefined || e.time.date).length,
}, null, 2));
