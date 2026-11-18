// User guide screen (v3.37.0): the step-by-step guide in js/guide.js, with a contents list, a search box and
// buttons that open the page each step talks about. Available with or without a job open.
import { S } from '../app/state.js';
import { defineView } from '../app/nav.js';
import { onAction } from '../app/actions.js';
import { GUIDE, GUIDE_VERSION } from '../guide.js';
import { $ } from '../ui.js';
import { esc as h } from '../util.js';

/** [[view|Label]] → a button that opens the page (with a job open), else the label in bold. */
const NO_JOB_OK = new Set(['jobs', 'dash', 'reg', 'guide']);
const links = (html) => html.replace(/\[\[([^|\]]+)\|([^\]]+)\]\]/g, (_, v, l) => (S.job || NO_JOB_OK.has(v) ? `<button class="linkbtn gd-go" data-go="${h(v)}">${l}</button>` : `<b>${l}</b>`));
const plain = (s) => (s.title + ' ' + s.html).replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1').replace(/<[^>]+>/g, ' ').toLowerCase();

function viewGuide() {
  return `<div class="page guide-page"><div class="page-head"><div><h1>User guide</h1>
    <p class="muted">How the app is meant to be used, step by step, with tips. Written for v${GUIDE_VERSION}; it is updated with every release.</p></div>
    <div class="acts"><button class="btn" data-act="guide-print">Print</button></div></div>
    <div class="toolbar"><input type="search" class="search" placeholder="Search the guide…" value="${h(S.guideQ || '')}" data-act="guide-search"><span class="muted small" id="guideCount"></span></div>
    <nav class="card gd-toc"><b>Contents</b><ol>${GUIDE.map((s) => `<li><a href="#gd-${s.id}" data-gd="${s.id}">${h(s.title)}</a></li>`).join('')}</ol></nav>
    <div id="guideBody">${GUIDE.map((s) => `<section class="card gd-sec" id="gd-${s.id}" data-gd-sec="${s.id}"><h2>${h(s.title)}</h2>${links(s.html)}</section>`).join('')}</div></div>`;
}
function filter() {
  const q = String(S.guideQ || '').trim().toLowerCase(); let n = 0;
  for (const s of GUIDE) { const show = !q || plain(s).includes(q); n += show; const el = document.querySelector(`[data-gd-sec="${s.id}"]`); if (el) el.hidden = !show; }
  const c = $('#guideCount'); if (c) c.textContent = q ? `${n} of ${GUIDE.length} sections` : '';
}
defineView('guide', viewGuide, filter);

document.addEventListener('input', (e) => { if (e.target.dataset?.act === 'guide-search') { S.guideQ = e.target.value; filter(); } });
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('[data-gd]'); if (a) { e.preventDefault(); document.getElementById('gd-' + a.dataset.gd)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
});

/* Print: the guide alone, in a plain page, so it can be handed out. */
onAction({ 'guide-print': async () => { const w = window.open(''); if (!w) return; w.document.write(`<title>Tank Floor Inspector — User guide</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:780px;margin:24px auto;padding:0 16px}h2{margin-top:28px}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}.muted{color:#666}</style><h1>Tank Floor Inspector — User guide</h1><p class="muted">For v${GUIDE_VERSION}</p>${GUIDE.map((s) => `<h2>${h(s.title)}</h2>${s.html.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '<b>$1</b>')}`).join('')}`); w.document.close(); w.focus(); w.print(); } });
