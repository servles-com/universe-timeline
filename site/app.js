// Zoomable log-scale timeline. The x axis is log10(years ago): the Big Bang is
// on the left, today on the right. Zooming in reveals events of higher
// `level` (1 = landmarks, 6 = specialist detail).
import { yearsAgo, UNIVERSE_AGE, nowYear } from './lib.mjs';

const svg = document.getElementById('timeline');
const pop = document.getElementById('cluster-pop');
const NS = 'http://www.w3.org/2000/svg';
const FULL = { hi: Math.log10(UNIVERSE_AGE * 1.08), lo: Math.log10(1) };   // hi = left edge, lo = right edge
let view = { ...FULL };
let events = [];
let lang = 'en';
const NOW = nowYear();
const searchInput = document.getElementById('search');

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const CLUSTER_GAP = 20;          // px: events closer than this are collapsed into one "+N" node
let popTimer, popPinned;

// Which levels are visible for a given zoom span (in decades of time).
function maxLevel(span) {
  if (span >= 8) return 1;
  if (span >= 5) return 2;
  if (span >= 3) return 3;
  if (span >= 1.6) return 4;
  if (span >= 0.8) return 5;
  return 6;
}

function formatAgo(ya) {
  if (ya >= 1e9) return `${+(ya / 1e9).toFixed(ya >= 1e10 ? 1 : 2)} bn years ago`;
  if (ya >= 1e6) return `${+(ya / 1e6).toFixed(ya >= 1e8 ? 0 : 1)} Myr ago`;
  if (ya >= 1e4) return `${Math.round(ya / 1e3)}k years ago`;
  const y = Math.round(NOW - ya);
  return y < 0 ? `${-y} BCE` : `${y} CE`;
}

function formatWhen(e) {
  if (e.time.date) {
    const [y, m, d] = String(e.time.date).match(/^(-?\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/).slice(1);
    const yr = Number(y) <= 0 ? `${1 - Number(y) - (Number(y) < 0 ? 1 : 0)} BCE` : String(Number(y));
    return [d, m && new Date(2000, Number(m) - 1).toLocaleString(lang, { month: 'long' }), yr].filter(Boolean).join(' ');
  }
  const unc = e.time.uncertainty ? ` ± ${formatAgo(e.time.uncertainty).replace(' ago', '')}` : '';
  return formatAgo(e.time.ya) + unc;
}

function render() {
  hideClusterPop();
  const W = svg.clientWidth, H = svg.clientHeight;
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.replaceChildren();
  const span = view.hi - view.lo;
  const x = L => (view.hi - L) / span * W;
  const baseY = H * 0.72;

  // Axis: a tick per power of ten, labelled in human units.
  const axis = el('g', { class: 'axis' }, svg);
  const step = Math.max(1, Math.ceil(110 / (W / span)));   // keep ≥110px between tick labels
  for (let p = Math.ceil(view.lo); p <= Math.floor(view.hi); p++) {
    if (p % step) continue;
    const px = x(p);
    el('line', { x1: px, x2: px, y1: 0, y2: H }, axis);
    const t = el('text', { x: px + 4, y: H - 28 }, axis);
    t.textContent = formatAgo(10 ** p);
  }
  el('line', { class: 'baseline', x1: 0, x2: W, y1: baseY, y2: baseY }, svg);

  // Events: visible levels only, laid out in rows so labels do not overlap.
  // When a view is so dense that not every event fits a label row, the leftovers
  // are collapsed into "+N" clusters (shown on hover / tap) instead of piling up.
  const lvl = maxLevel(span);
  const visible = events
    .filter(e => e.level <= lvl && e.L <= view.hi && e.L >= view.lo)
    .sort((a, b) => a.level - b.level || b.L - a.L);
  const rows = [];            // per row: right edge of the last label
  const rowH = 22;
  const maxRows = Math.max(3, Math.min(9, Math.floor((baseY - 16) / rowH)));
  const g = el('g', {}, svg);
  const packed = [];          // events that could not get a label row
  for (const e of visible) {
    const px = x(e.L);
    const label = e.title[lang] ?? e.title.en;
    const w = label.length * 7.2 + 14;
    const left = px + w > W ? px - w : px;
    let row = rows.findIndex(r => r < left);
    if (row === -1 && rows.length < maxRows) { row = rows.length; rows.push(-Infinity); }
    if (row === -1) { packed.push(e); continue; }
    rows[row] = left + w;
    const color = `var(--c-${e.category})`;
    const node = el('g', { class: `event l${e.level}`, tabindex: 0, role: 'button', 'aria-label': label }, g);
    el('circle', { cx: px, cy: baseY, r: e.level === 1 ? 6 : 4, fill: color }, node);
    const y = baseY - 18 - row * rowH;
    el('line', { class: 'stem', x1: px, x2: px, y1: baseY, y2: y + 4, stroke: color }, node);
    const flip = px + w > W;                       // near the right edge: label to the left
    const t = el('text', { x: flip ? px - 4 : px + 4, y, 'text-anchor': flip ? 'end' : 'start' }, node);
    t.textContent = label;
    node.addEventListener('click', () => open(e));
    node.addEventListener('keydown', k => { if (k.key === 'Enter') open(e); });
  }
  renderClusters(packed, { g, baseY });
  document.getElementById('range').textContent =
    `${formatAgo(10 ** view.hi)} → ${formatAgo(10 ** view.lo)} · detail ${lvl}/6 · ${visible.length} shown`;
}

// Collapse the events that had no room for a label into "+N" clusters. Nearby
// events (within CLUSTER_GAP px) share one cluster node; hovering or tapping it
// pops up the list of contained events.
function renderClusters(list, { g, baseY }) {
  if (!list.length) return;
  const W = svg.clientWidth, span = view.hi - view.lo;
  const px = L => (view.hi - L) / span * W;
  const groups = [[list[0]]];
  for (const e of list.slice(1)) {
    const last = groups[groups.length - 1];
    if (px(e.L) - px(last[last.length - 1].L) <= CLUSTER_GAP) last.push(e);
    else groups.push([e]);
  }
  for (const grp of groups) {
    const cx = grp.length > 1 ? px(grp.reduce((s, e) => s + e.L, 0) / grp.length) : px(grp[0].L);
    const label = grp.length > 1 ? `+${grp.length}` : grp[0].title[lang] ?? grp[0].title.en;
    const node = el('g', { class: 'event cluster', tabindex: 0, role: 'button', 'aria-label': grp.map(e => e.title.en).join(', ') }, g);
    el('circle', { cx, cy: baseY, r: grp.length > 1 ? 8 : 5, fill: grp.length > 1 ? 'var(--accent)' : `var(--c-${grp[0].category})` }, node);
    if (grp.length > 1) {
      const t = el('text', { x: cx, y: baseY - 13, 'text-anchor': 'middle' }, node);
      t.textContent = label;
    }
    node.addEventListener('pointerenter', () => showClusterPop(grp, cx, baseY));
    node.addEventListener('pointerleave', scheduleClusterHide);
    node.addEventListener('click', () => showClusterPop(grp, cx, baseY, true));
    node.addEventListener('keydown', k => {
      if (k.key === 'Enter') { k.preventDefault(); showClusterPop(grp, cx, baseY); }
      if (k.key === 'Escape') hideClusterPop();
    });
  }
}

function scheduleClusterHide() { if (popPinned) return; clearTimeout(popTimer); popTimer = setTimeout(hideClusterPop, 250); }

// `pinned` is set on click/tap so the list stays open for touch users; hover
// reveals it temporarily and hides again once the pointer leaves.
function showClusterPop(grp, cx, baseY, pinned = false) {
  if (svg.classList.contains('dragging')) return;
  clearTimeout(popTimer);
  popPinned = pinned;
  pop.innerHTML = grp.map(e =>
    `<button type="button" class="cp-item" data-id="${esc(e.id)}" style="--dot:var(--c-${esc(e.category)})">` +
    `<span class="cp-dot"></span><span class="cp-title">${esc(e.title[lang] ?? e.title.en)}</span>` +
    `<span class="cp-when">${esc(formatWhen(e))}</span></button>`).join('');
  pop.hidden = false;
  const W = svg.clientWidth;
  const left = Math.min(Math.max(cx, 110), Math.max(110, W - 110));
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(8, baseY - pop.offsetHeight - 14)}px`;
}

function hideClusterPop() { clearTimeout(popTimer); pop.hidden = true; popPinned = false; }
pop.addEventListener('pointerenter', () => clearTimeout(popTimer));
pop.addEventListener('pointerleave', scheduleClusterHide);
pop.addEventListener('click', ev => {
  const b = ev.target.closest('.cp-item');
  if (!b) return;
  const e = events.find(ev0 => ev0.id === b.dataset.id);
  if (e) { hideClusterPop(); open(e); }
});
pop.addEventListener('keydown', k => { if (k.key === 'Escape') hideClusterPop(); });
document.addEventListener('click', ev => {
  if (pop.hidden) return;
  if (ev.target.closest('#cluster-pop') || ev.target.closest('.cluster')) return;
  hideClusterPop();
});

function open(e) {
  const body = document.getElementById('panel-body');
  const imgs = (e.images ?? []).map(i =>
    `<img src="${esc(i.url)}" alt="" loading="lazy"><p class="credit">${esc(i.credit)} · ${esc(i.license)}</p>`).join('');
  const srcs = e.sources.map(s => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title ?? s.url)}</a> <small>(${esc(s.type)})</small></li>`).join('');
  body.innerHTML = `
     <span class="tag" style="background:var(--c-${esc(e.category)})">${esc(e.category)} · level ${e.level}</span>
     <h2>${esc(e.title[lang] ?? e.title.en)}</h2>
     <p class="when">${esc(formatWhen(e))}</p>
     ${imgs}
     <p>${esc(e.summary[lang] ?? e.summary.en)}</p>
     <h3>Sources</h3><ul>${srcs}</ul>`;
  document.getElementById('panel').hidden = false;
}

// --- interaction: wheel / pinch zoom around the pointer, drag to pan
function zoomAt(px, factor) {
  const W = svg.clientWidth, span = view.hi - view.lo;
  const at = view.hi - px / W * span;
  let newSpan = Math.min(Math.max(span * factor, 0.05), FULL.hi - FULL.lo);
  let hi = at + (view.hi - at) * newSpan / span;
  let lo = hi - newSpan;
  if (hi > FULL.hi) { hi = FULL.hi; lo = hi - newSpan; }
  if (lo < FULL.lo) { lo = FULL.lo; hi = lo + newSpan; }
  view = { hi, lo };
  render();
}
function panBy(dx) {
  const span = view.hi - view.lo, d = dx / svg.clientWidth * span;
  let hi = view.hi + d, lo = view.lo + d;
  if (hi > FULL.hi) { lo -= hi - FULL.hi; hi = FULL.hi; }
  if (lo < FULL.lo) { hi += FULL.lo - lo; lo = FULL.lo; }
  view = { hi, lo };
  render();
}
function focusOnEvent(e) {
  const W = svg.clientWidth;
  const span = view.hi - view.lo;
  const L = e.L;
  // Center the event in the view
  let hi = L + span / 2;
  let lo = L - span / 2;
  // Clamp to FULL
  if (hi > FULL.hi) {
    hi = FULL.hi;
    lo = hi - span;
  } else if (lo < FULL.lo) {
    lo = FULL.lo;
    hi = lo + span;
  }
  view = { hi, lo };
  render();
}
svg.addEventListener('wheel', ev => {
  ev.preventDefault();
  if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY)) return panBy(ev.deltaX);
  zoomAt(ev.offsetX, Math.exp(ev.deltaY * 0.0015));
}, { passive: false });

const pointers = new Map();
let pinchDist = 0;
svg.addEventListener('pointerdown', ev => { pointers.set(ev.pointerId, ev); svg.setPointerCapture(ev.pointerId); svg.classList.add('dragging'); });
svg.addEventListener('pointermove', ev => {
  if (!pointers.has(ev.pointerId)) return;
  const prev = pointers.get(ev.pointerId);
  pointers.set(ev.pointerId, ev);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinchDist) zoomAt((a.offsetX + b.offsetX) / 2, pinchDist / d);
    pinchDist = d;
  } else if (pointers.size === 1) {
    panBy(ev.clientX - prev.clientX);
  }
});
const up = ev => { pointers.delete(ev.pointerId); pinchDist = 0; if (!pointers.size) svg.classList.remove('dragging'); };
svg.addEventListener('pointerup', up);
svg.addEventListener('pointercancel', up);
window.addEventListener('resize', render);

document.getElementById('reset').onclick = () => { view = { ...FULL }; render(); };
document.getElementById('close').onclick = () => { document.getElementById('panel').hidden = true; };
document.getElementById('lang').onclick = ev => { lang = lang === 'en' ? 'ru' : 'en'; ev.target.textContent = lang === 'en' ? 'RU' : 'EN'; render(); };
document.getElementById('theme').onclick = () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch {}
};

const data = await (await fetch('events.json')).json();
events = data.events.map(e => ({ ...e, L: Math.log10(yearsAgo(e.time, NOW)) }));
document.getElementById('count').textContent = `${events.length} events`;
render();

// Search
searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    const term = searchInput.value.trim();
    if (term) {
      const found = events.find(e => 
        (e.title[lang] ?? e.title.en).toLowerCase().includes(term.toLowerCase())
      );
      if (found) {
        focusOnEvent(found);
        searchInput.value = '';
      } else {
        // Flash placeholder to indicate no match
        const originalPlaceholder = searchInput.placeholder;
        searchInput.placeholder = 'No match found';
        searchInput.value = '';
        setTimeout(() => {
          searchInput.placeholder = originalPlaceholder;
        }, 1500);
      }
    }
  }
});