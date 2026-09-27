// Merges data/events/*.json into site/events.json for the static site.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
const events = readdirSync('data/events').filter(f => f.endsWith('.json')).sort()
  .map(f => JSON.parse(readFileSync(`data/events/${f}`, 'utf8')));
writeFileSync('site/events.json', JSON.stringify({ generated: new Date().toISOString(), count: events.length, events }));
import { copyFileSync } from 'node:fs';
copyFileSync('scripts/lib.mjs', 'site/lib.mjs');
console.log(`site/events.json: ${events.length} events`);
