# Universe Timeline

A zoomable timeline from the Big Bang to today. Zoomed out you see the landmarks
(Big Bang, Cambrian explosion, the Moon landing); zoom in and smaller events appear,
down to things only specialists know. Every event carries sources, and over time
photos, papers, refined dates and translations.

**This project is grown by AI agents** running on
[serverless-ai-agent-run](https://github.com/servles-com/serverless-ai-agent-run):
each run takes one task from the backlog ("find a new event in the Devonian",
"add a peer-reviewed source to X", "propose a quality criterion", "improve the zoom
on mobile"), makes a small change and opens a PR. CI is the gate. It is also the
long-horizon benchmark for that runtime: how often agents succeed, how they fail,
and whether the project actually gets better.

Live site: https://servles-com.github.io/universe-timeline/

## Data

One event = one file `data/events/<id>.json`:

```json
{
  "id": "cambrian-explosion",
  "title": { "en": "Cambrian explosion", "ru": "Кембрийский взрыв" },
  "time": { "ya": 538800000, "uncertainty": 2000000 },
  "level": 1,
  "category": "biology",
  "summary": { "en": "Most major animal phyla appear in the fossil record..." },
  "sources": [ { "type": "wikipedia", "url": "https://en.wikipedia.org/wiki/Cambrian_explosion", "title": "Cambrian explosion" } ],
  "images": [ { "url": "https://…", "license": "CC BY-SA 4.0", "credit": "Author / Wikimedia Commons" } ],
  "related": [ "ediacaran-biota" ]
}
```

- `time`: exactly one of `ya` (years ago, for anything older than 10,000 years; optional
  `uncertainty` in years) or `date` (`YYYY`, `YYYY-MM`, `YYYY-MM-DD`; negative year = BCE).
- `level` 1–6 — when the event appears while zooming: **1** cosmic/civilisational landmarks
  (max 25 in total), **2** major, **3** well known, **4** notable, **5** specialist, **6** niche.
- `category`: cosmology, geology, biology, human-evolution, history, science, technology, culture.
- `sources`: at least one, `https` only; type wikipedia, paper, book, museum, dataset, other.
- `images`: https URL + license + credit (prefer Wikimedia Commons).

`node scripts/validate.mjs` must pass — CI runs it on every PR.

## Site

Static files in `site/` (no build tools, no dependencies). `node scripts/build.mjs`
merges the events into `site/events.json`. Local preview:
`node scripts/build.mjs && python3 -m http.server -d site`.

## Rules for agents (and humans)

1. **One task per PR, small diffs.** Add or improve a handful of events, or one UI change.
2. **Never invent facts or URLs.** Every claim must be backed by a source you actually
   opened. If you are unsure of a date, set a wider `uncertainty` and say so in the PR.
3. Prefer primary/peer-reviewed sources for science; Wikipedia is fine as a start.
4. Keep `level` honest — do not promote events to level 1–2 to make them visible.
5. Don't delete or rewrite other events unless the task is about fixing them; explain why.
6. `node scripts/validate.mjs` must pass before you finish.
7. In the PR description: what you changed, which sources you used, what you were
   unsure about.

## Claude Code Instructions

- Data changes: only `data/events/*.json`. UI changes: only `site/`. Validation and
  schema: `scripts/` (change the schema and README together).
- Keep the site dependency-free and static (GitHub Pages).
