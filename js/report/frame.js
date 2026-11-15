// The report frame (report improvements R1): chapters in a configurable order, numbered sections, tables and
// figures, the cover, document control, contents, value-type key, running header and footer, page set-up and the
// draft mark. Content is supplied by report.js; the frame only numbers and assembles it. No browser APIs.
import { escText as h } from '../util.js';

/** Chapters in their default order (decided 15 Nov 2026: the plan's order; the user can reorder them). */
export const CHAPTERS = [
  ['exec', 'Executive summary'],
  ['tank', 'Tank identification and design'],
  ['personnel', 'Personnel, equipment and calibration'],
  ['floor', 'Floor — MFL inspection'],
  ['shell', 'Shell'],
  ['roof', 'Roof'],
  ['nozzles', 'Nozzles'],
  ['settle', 'Foundation and settlement'],
  ['findings', 'Inspection findings by component'],
  ['defs', 'Deficiencies and recommendations'],
];
/** Appendices in their default order. */
export const APPENDICES = [
  ['plates', 'Plate register'],
  ['floorphotos', 'Floor indication photographs'],
];
/** Front matter, always in this order; each can be switched off. */
export const FRONT = [['cover', 'Cover page'], ['control', 'Document control'], ['contents', 'Contents'], ['key', 'Value types and abbreviations']];

/** The report options that are about the layout, with their defaults. */
export const LAYOUT_DEFAULTS = { order: CHAPTERS.map(([k]) => k), appOrder: APPENDICES.map(([k]) => k), off: ['plates'], drawOrient: 'landscape', drawPaper: 'report' };

/** Sections switched off. A saved layout decides; without one, today's switches do (exec, defs, sections, plates). */
function offSet(opts) {
  if (Array.isArray(opts.layout?.off)) return new Set(opts.layout.off);
  const off = new Set();
  if (opts.exec === false) off.add('exec');
  if (opts.defs === false) off.add('defs');
  if (opts.sections === false) off.add('findings');
  if (!opts.plates) off.add('plates');
  return off;
}

/** Put a saved order right: unknown ids dropped, every known one exactly once (a new one joins at its default
 *  place). */
export function settleOrder(list, defs) {
  const known = defs.map(([k]) => k), out = [...new Set((list || []).filter((k) => known.includes(k)))];
  known.forEach((k, i) => { if (!out.includes(k)) out.splice(Math.min(i, out.length), 0, k); });
  return out;
}

/** The front matter, chapters and appendices in the order chosen, with whether each is switched on. */
export function layoutOf(opts = {}) {
  const L = opts.layout || {}, off = offSet(opts);
  const item = (defs) => (k) => ({ id: k, title: defs.find(([x]) => x === k)[1], on: !off.has(k) });
  return {
    front: FRONT.map(([k]) => k).map(item(FRONT)),
    chapters: settleOrder(L.order, CHAPTERS).map(item(CHAPTERS)),
    appendices: settleOrder(L.appOrder, APPENDICES).map(item(APPENDICES)),
    drawOrient: L.drawOrient === 'portrait' ? 'portrait' : 'landscape',
    drawPaper: L.drawPaper === 'tabloid' ? 'tabloid' : 'report',
  };
}

/** Numbering for one report: chapter and section numbers, tables and figures numbered by chapter (Table 5-3,
 *  Figure A-1). Content calls sub(), table() and figure() while it is built. */
export function numbering() {
  let ch = '', s = 0, nt = 0, nf = 0;
  const toc = [], tables = [], figures = [];
  const slug = (x) => String(x).replace(/[^A-Za-z0-9]+/g, '-');
  return {
    toc, tables, figures,
    chapter(no) { ch = String(no); s = 0; nt = 0; nf = 0; },
    get chapterNo() { return ch; },
    /** A numbered section heading (5.2 Indications). */
    sub(title) {
      const no = `${ch}.${++s}`, id = 'sec-' + slug(no);
      toc.push({ level: 2, no, title, id });
      return `<h3 class="rp-s" id="${id}"><span class="rp-no">${no}</span>${h(title)}</h3>`;
    },
    /** A numbered table title, placed above the table. */
    table(title) {
      const no = `${ch}-${++nt}`, id = 'tbl-' + slug(no);
      tables.push({ no, title, id });
      return `<div class="rp-tcap" id="${id}"><b>Table ${no}</b> ${h(title)}</div>`;
    },
    /** A numbered figure caption, placed below the figure. */
    figure(title) {
      const no = `${ch}-${++nf}`, id = 'fig-' + slug(no);
      figures.push({ no, title, id });
      return `<div class="rp-fcap" id="${id}"><b>Figure ${no}</b> ${h(title)}</div>`;
    },
  };
}

const css = (s) => `"${String(s ?? '').replace(/[\\"]/g, (c) => '\\' + c).replace(/[\n\r]+/g, ' ').replace(/</g, '\\3c ')}"`;

/** Paper sizes in inches (portrait). */
export const PAPER = { letter: [8.5, 11, 'letter'], a4: [8.27, 11.69, 'A4'], tabloid: [11, 17, ''] }; // tabloid: sized in inches below
const DRAW_MARGIN = 0.6;

/** The printable area of a drawing page, in inches: [width, height]. */
export function drawArea(paper, orient) {
  const [w, h] = PAPER[paper] || PAPER.letter, [W, H] = orient === 'portrait' ? [w, h] : [h, w];
  return [W - 2 * DRAW_MARGIN, H - 2 * DRAW_MARGIN];
}

/** Page set-up and running header / footer for print, carried inside the report so an issued report keeps them.
 *  Drawing pages are named pages: 'drawing' at the report's paper size, 'drawing-lg' on 11 × 17 when that option is
 *  chosen for the floor, shell and roof drawings; landscape unless the option says portrait. Each drawing page is
 *  given the exact height of its printable area, so the drawing can fill what its heading, legend and notes leave. */
export function pageCSS({ size = 'letter', company = '', tankId = '', reportNo = '', revText = '', status = '', drawOrient = 'landscape', drawPaper = 'report' }) {
  const paper = size === 'a4' ? 'a4' : 'letter', S = PAPER[paper][2], o = drawOrient === 'portrait' ? 'portrait' : 'landscape';
  const font = 'font: 8pt Arial, Helvetica, sans-serif; color: #5b6470;';
  const right = [tankId && 'Tank ' + tankId, reportNo && 'Report ' + reportNo].filter(Boolean).join(' · ');
  const boxes = `@top-left { content: ${css(company)}; ${font} } @top-right { content: ${css(right)}; ${font} }
      @bottom-left { content: ${css([revText, status].filter(Boolean).join(' · '))}; ${font} }
      @bottom-right { content: "Page " counter(page) " of " counter(pages); ${font} }`;
  const big = drawPaper === 'tabloid' ? 'tabloid' : paper;
  const [, hs] = drawArea(paper, o), [, hb] = drawArea(big, o);
  return `@media print {
    @page { size: ${S} portrait; margin: 0.75in 0.6in 0.7in; ${boxes} }
    @page cover { size: ${S} portrait; margin: 0.75in 0.6in; @top-left { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-right { content: none; } }
    @page drawing { size: ${S} ${o}; margin: ${DRAW_MARGIN}in; ${boxes} }
    @page drawing-lg { size: ${big === 'tabloid' ? (o === 'landscape' ? '17in 11in' : '11in 17in') : PAPER[big][2] + ' ' + o}; margin: ${DRAW_MARGIN}in; ${boxes} }
    .report .rp-draw { height: ${(hs - 0.05).toFixed(2)}in; }
    .report .rp-draw.lg { height: ${(hb - 0.05).toFixed(2)}in; }
  }`;
}

/** Styles for the frame, carried inside the report. */
export const FRAME_CSS = `
.report .rp-cover { min-height: 9in; display: flex; flex-direction: column; gap: 18px; }
.report .rp-cover .logo { max-height: 70px; max-width: 220px; }
.report .rp-cover .co { font-size: 11px; color: #5b6470; }
.report .rp-cover .co b { color: #1d232b; font-size: 13px; }
.report .rp-cover h1 { font-size: 26px; margin: 1.4in 0 4px; letter-spacing: 0; }
.report .rp-cover .sub { font-size: 13px; color: #3a434e; }
.report .rp-cover .tank { font-size: 34px; font-weight: 700; margin-top: 18px; }
.report .rp-cover table.kv { max-width: 4.8in; margin-top: 18px; }
.report .rp-cover .status { display: inline-block; margin-top: 10px; padding: 3px 10px; border: 1.5px solid #1d232b; font-weight: 700; letter-spacing: .08em; }
.report .rp-front h2, .report h2.rp-ch { font-size: 16px; text-transform: none; letter-spacing: 0; border-bottom: 2px solid #1d232b; padding-bottom: 4px; margin: 0 0 10px; }
.report h2.rp-ch .rp-no { display: inline-block; min-width: 1.8em; }
.report h3.rp-s { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid #1d232b; padding-bottom: 2px; margin: 16px 0 8px; }
.report h3.rp-s .rp-no { display: inline-block; min-width: 3.2em; color: #3a434e; }
.report .rp-tcap { font-size: 10.5px; margin: 10px 0 4px; color: #1d232b; }
.report .rp-fcap { font-size: 10.5px; margin: 4px 0 10px; text-align: center; color: #1d232b; }
.report .rp-tcap b, .report .rp-fcap b { margin-right: 6px; }
.report .rp-toc { width: 100%; border-collapse: collapse; font-size: 11px; }
.report .rp-toc td { padding: 2px 0; vertical-align: top; }
.report .rp-toc td.no { width: 3.6em; color: #3a434e; }
.report .rp-toc.rp-lot td.no { width: 6.2em; white-space: nowrap; }
.report .rp-toc tr.l1 td { font-weight: 700; padding-top: 7px; }
.report .rp-toc tr.l2 td.t { padding-left: 1.2em; }
.report .rp-toc a { color: inherit; text-decoration: none; }
.report .rp-key td.mk { font-weight: 700; text-align: center; width: 3em; }
.report .rp-draw .map-wrap svg, .report .rp-draw .ro-print svg, .report .rp-draw .roof-print svg { max-height: none; }
.report .rp-draft { display: none; }
@media print {
  .report .rp-cover { page: cover; min-height: 0; }
  .report .rp-front, .report .rp-chap, .report .rp-app { break-before: page; }
  .report .rp-draw { page: drawing; break-before: page; break-after: page; display: flex; flex-direction: column; overflow: hidden; }
  .report .rp-draw.lg { page: drawing-lg; }
  .report .rp-draw > * { flex: 0 0 auto; }
  .report .rp-draw h3.rp-s { margin-top: 0; }
  .report .rp-draw .map-wrap, .report .rp-draw .ro-print, .report .rp-draw .roof-print, .report .rp-draw .set-print { flex: 1 1 0; min-height: 0; }
  .report .rp-draw .map-wrap svg, .report .rp-draw .ro-print svg, .report .rp-draw .roof-print svg { width: 100%; height: 100%; max-height: none; max-width: none; margin: 0; }
  .report .rp-draw .set-print { display: grid; grid-template-columns: 1fr 1.6fr; grid-template-rows: 100%; align-items: stretch; }
  .report .rp-draw.port .set-print { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
  .report .rp-draw .set-print > div { min-height: 0; } .report .rp-draw .set-print svg { width: 100%; height: 100%; }
  .report .rp-draw .legend { margin: 4px 0; }
  .report .rp-draw .note { margin: 2px 0 0; }
  /* every table fits the page width: a table wider than the page makes the browser shrink the whole report */
  .report .grid { width: 100%; max-width: 100%; }
  .report .grid th, .report .grid td { white-space: normal; overflow-wrap: break-word; }
  .report .grid td.n { white-space: nowrap; overflow-wrap: normal; }
  .report .grid th { font-size: 8.5px; padding: 3px 3px; } .report .grid.small td { font-size: 9.5px; padding: 3px 3px; }
  .report h2.rp-ch, .report h3.rp-s, .report .rp-tcap { break-after: avoid; }
  .report .rp-fcap { break-before: avoid; }
  .report .rp-draft { display: block; position: fixed; top: 42%; left: 0; right: 0; text-align: center; font: 700 110px Arial, sans-serif; color: rgba(0, 0, 0, .06); transform: rotate(-30deg); pointer-events: none; z-index: 0; }
}`;

/** The value-type key and abbreviations (front matter). Marks are applied to values from stage R6. */
export function keyHTML() {
  const rows = [['M', 'Measured', 'A reading taken on the tank and entered or loaded.'], ['C', 'Calculated', 'Worked out by the app from measured, entered and table values.'], ['E', 'Estimated', 'An inferred or screening value, not a direct measurement (e.g. MFL % loss).'], ['O', 'Inspector observation', 'What the inspector saw and recorded.'], ['A', 'Engineering assessment', 'A judgement entered by the engineer.']];
  const abbr = [['API', 'American Petroleum Institute'], ['CP', 'Cathodic protection'], ['CZ', 'Critical zone'], ['MFL', 'Magnetic flux leakage'], ['MRT', 'Minimum remaining thickness'], ['NDE', 'Non-destructive examination'], ['Oᵣ', 'Years to the next internal inspection'], ['RPB', 'Release prevention barrier'], ['RTbc / RTip', 'Minimum remaining thickness, soil side / product side'], ['StPr / UPr', 'Product-side / soil-side corrosion rate'], ['t-min', 'Minimum required thickness'], ['UT', 'Ultrasonic thickness testing'], ['VT', 'Visual testing']];
  return `<table class="grid small rp-key"><thead><tr><th>Mark</th><th>Value type</th><th>Meaning</th></tr></thead><tbody>${rows.map(([m, t, d]) => `<tr><td class="mk">${m}</td><td>${t}</td><td>${d}</td></tr>`).join('')}</tbody></table>
    <p class="note">Values without a mark are specified data (design, set-up and limits entered for the job) or labels. Calculated pass / fail results are compared with the limits configured in this job; they are not an engineering assessment.</p>
    <table class="grid small"><thead><tr><th>Abbreviation</th><th>Meaning</th></tr></thead><tbody>${abbr.map(([a, d]) => `<tr><td><b>${a}</b></td><td>${d}</td></tr>`).join('')}</tbody></table>`;
}

/** Contents: chapters with their numbered sections, appendices, then lists of tables and figures. */
export function contentsHTML(items, num) {
  const rows = [];
  for (const it of items) {
    rows.push(`<tr class="l1"><td class="no">${h(it.label)}</td><td class="t"><a href="#${it.id}">${h(it.title)}</a></td></tr>`);
    for (const s of it.subs || []) rows.push(`<tr class="l2"><td class="no">${h(s.no)}</td><td class="t"><a href="#${s.id}">${h(s.title)}</a></td></tr>`);
  }
  const list = (title, arr, word) => (arr.length ? `<h3 class="rp-h3">${title}</h3><table class="rp-toc rp-lot">${arr.map((x) => `<tr><td class="no">${word} ${h(x.no)}</td><td class="t"><a href="#${x.id}">${h(x.title)}</a></td></tr>`).join('')}</table>` : '');
  return `<table class="rp-toc">${rows.join('')}</table>${list('Tables', num.tables, 'Table')}${list('Figures', num.figures, 'Figure')}`;
}

const STAGE_TXT = { upcoming: 'Upcoming', inspection: 'Inspection ongoing', reporting: 'Reporting', review: 'Peer review', complete: 'Complete' };
const dateOf = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');

/** Who prepared, reviewed and approved the report, and the revisions it has been through. history: [{ rev, at, by, note }]
 *  (file saves and issues, newest last), given by the caller; without it, the current revision only. */
function controlHTML(job, history) {
  const I = job.info || {}, St = job.status || {};
  const revs = (history && history.length ? history : job.rev ? [{ rev: job.rev, at: job.savedAt, note: 'Saved to a job file' }] : []);
  const kv = (rows) => `<table class="kv">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  return `${kv([['Report number', h(I.reportNo || '—')], ['Work order', h(I.workOrder || '—')], ['Job stage', h(STAGE_TXT[St.stage] || '—')], ['Current revision', job.rev ? `Rev ${job.rev}, saved ${h(dateOf(job.savedAt))}${(job.updated || 0) > (job.savedAt || 0) ? ' — <b>includes changes made after Rev ' + job.rev + '</b>' : ''}` : 'Not yet saved to a job file']])}
    <h3 class="rp-h3">Revision history</h3>
    <table class="grid small"><thead><tr><th>Rev</th><th>Date</th><th>By</th><th>Description</th></tr></thead><tbody>${revs.map((r) => `<tr><td>${h(r.rev ?? '')}</td><td>${h(dateOf(r.at))}</td><td>${h(r.by || '')}</td><td>${h(r.note || '')}</td></tr>`).join('') || '<tr><td colspan="4">No revisions saved to a job file yet.</td></tr>'}</tbody></table>
    <h3 class="rp-h3">Approval</h3>
    <table class="sig"><tr>${[['Prepared by', I.inspector || St.inspector], ['Peer reviewed by', St.reviewer], ['Approved by', '']].map(([r, n]) => `<td><div class="line"></div><b>${h(n || '')}</b><br>${r} · Signature and date</td>`).join('')}</tr></table>`;
}

function coverHTML(job, company, scopeText, issued) {
  const I = job.info || {};
  const kv = (rows) => `<table class="kv">${rows.filter(([, v]) => v).map(([k, v]) => `<tr><th>${k}</th><td>${h(v)}</td></tr>`).join('')}</table>`;
  return `<section class="rp-cover">
    <div>${company.logo ? `<img class="logo" src="${company.logo}" alt="">` : ''}<div class="co"><b>${h(company.name || '')}</b><br>${h(company.details || '').replace(/\n/g, '<br>')}</div></div>
    <div><h1>Storage Tank Inspection Report</h1><div class="sub">API 653 — ${h(scopeText)}</div>
      <div class="tank">${h(I.tankId || 'Tank')}</div>
      ${kv([['Client', I.client], ['Facility / site', I.site], ['Product', I.product], ['Inspection date', I.inspDate], ['Report number', I.reportNo], ['Work order', I.workOrder], ['Revision', job.rev ? `Rev ${job.rev} (${dateOf(job.savedAt)})` : 'Not yet saved to a job file']])}
      <div class="status">${issued ? 'ISSUED' : 'DRAFT'}</div></div>
  </section>`;
}

/** Put the report together: front matter, then the chapters and appendices that have content, numbered in the
 *  order chosen. */
export function assembleReport({ job, company, opts, layout, N, chapterBody, appendixBody, footer }) {
  const I = job.info || {}, issued = job.status?.stage === 'complete';
  const items = [], chapters = [], apps = [];
  let no = 0;
  for (const c of layout.chapters) {
    if (!c.on || !chapterBody[c.id]) continue;
    N.chapter(no + 1);
    const from = N.toc.length, body = chapterBody[c.id]() || '';
    if (!body.trim()) { N.toc.length = from; continue; }
    no++;
    const id = 'ch-' + c.id;
    items.push({ label: String(no), title: c.title, id, subs: N.toc.slice(from) });
    chapters.push(`<div class="rp-chap" id="${id}"><h2 class="rp-ch"><span class="rp-no">${no}</span>${h(c.title)}</h2>${body}</div>`);
  }
  let ai = 0;
  for (const a of layout.appendices) {
    if (!a.on || !appendixBody[a.id]) continue;
    const L = String.fromCharCode(65 + ai);
    N.chapter(L);
    const from = N.toc.length, body = appendixBody[a.id]() || '';
    if (!body.trim()) { N.toc.length = from; continue; }
    ai++;
    const id = 'app-' + a.id;
    items.push({ label: 'Appendix ' + L, title: a.title, id, subs: N.toc.slice(from) });
    apps.push(`<div class="rp-app" id="${id}"><h2 class="rp-ch"><span class="rp-no">${L}</span>${h(a.title)}</h2>${body}</div>`);
  }
  const on = (k) => layout.front.find((f) => f.id === k)?.on;
  const scopeText = chapters.length ? layout.chapters.filter((c) => c.on && ['floor', 'shell', 'roof', 'nozzles', 'settle'].includes(c.id) && items.some((x) => x.id === 'ch-' + c.id)).map((c) => ({ floor: 'floor', shell: 'shell', roof: 'roof', nozzles: 'nozzles', settle: 'foundation and settlement' })[c.id]).join(', ') : '';
  const front = [];
  if (on('cover')) front.push(coverHTML(job, company, scopeText || 'inspection', issued));
  else front.push(`<header class="rp-head">${company.logo ? `<img class="logo" src="${company.logo}" alt="">` : ''}<div class="co"><b>${h(company.name || '')}</b><br>${h(company.details || '').replace(/\n/g, '<br>')}</div><div class="rp-title"><h1>Storage Tank Inspection Report</h1><div>API 653 — ${h(scopeText || 'inspection')}</div><div class="meta">${I.reportNo ? 'Report ' + h(I.reportNo) + ' · ' : ''}${h(I.inspDate || '')}</div></div></header>`);
  if (on('control')) front.push(`<section class="rp-front"><h2>Document control</h2>${controlHTML(job, opts.history)}</section>`);
  if (on('contents')) front.push(`<section class="rp-front"><h2>Contents</h2>${contentsHTML(items, N)}</section>`);
  if (on('key')) front.push(`<section class="rp-front"><h2>Value types and abbreviations</h2>${keyHTML()}</section>`);
  const revText = job.rev ? `Rev ${job.rev} · ${dateOf(job.savedAt)}` : 'Not saved to a job file';
  const style = FRAME_CSS + pageCSS({ size: company.pageSize, company: company.name, tankId: I.tankId, reportNo: I.reportNo, revText, status: issued ? 'ISSUED' : 'DRAFT', drawOrient: layout.drawOrient, drawPaper: layout.drawPaper });
  return `<article class="report rp2"><style>${style}</style>${issued ? '' : '<div class="rp-draft" aria-hidden="true">DRAFT</div>'}
  ${front.join('\n')}
  ${chapters.join('\n')}
  ${apps.join('\n')}
  ${footer}
</article>`;
}
