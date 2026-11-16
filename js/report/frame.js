// The report frame (report improvements R1): chapters in a configurable order, numbered sections, tables and
// figures, the cover, document control, contents, value-type key, running header and footer, page set-up and the
// draft mark. Content is supplied by report.js; the frame only numbers and assembles it. No browser APIs.
import { escText as h } from '../util.js';
import { personName } from '../personnel.js';

/** Chapters in their default order (decided 15 Nov 2026: the plan's order; the user can reorder them). */
export const CHAPTERS = [
  ['exec', 'Executive summary'],
  ['tank', 'Tank identification and design'],
  ['scope', 'Inspection scope and limitations'],
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
  ['floorinds', 'Floor indication register'],
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
    /** A numbered section with no visible heading (a drawing sheet shows its title in the title block): an anchor
     *  for the contents. */
    anchor(title) {
      const no = `${ch}.${++s}`, id = 'sec-' + slug(no);
      toc.push({ level: 2, no, title, id });
      return `<a class="rp-anchor" id="${id}"></a>`;
    },
    /** A figure number without a caption (drawing sheets carry it in their title block). */
    figureRef(title) {
      const no = `${ch}-${++nf}`, id = 'fig-' + slug(no);
      figures.push({ no, title, id });
      return { no, id };
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
/* ------------------------------------------------------------ page header and footer ---
   Each company sets the text in the six margin positions (header and footer, left / centre / right) from
   placeholders, where the logo goes, the rule lines and the colour. Kept in the company settings (meta 'company',
   key hf). An unset setting prints the original header and footer. */
export const HF_DEFAULTS = Object.freeze({
  hl: '{company}', hc: '', hr: 'Tank {tank} · Report {report}',
  fl: '{rev} · {status}', fc: '', fr: 'Page {page} of {pages}',
  logo: 'none', rule: false, color: '#5b6470', size: 8,
});
export const HF_TOKENS = [
  ['company', 'Company name'], ['client', 'Client'], ['site', 'Site'], ['tank', 'Tank ID'], ['report', 'Report number'],
  ['rev', 'Revision and date'], ['status', 'DRAFT or ISSUED'], ['date', 'Inspection date'], ['inspector', 'Inspector'],
  ['title', 'Report title'], ['page', 'Page number'], ['pages', 'Page count'],
];
export function hfOf(company) {
  const o = { ...HF_DEFAULTS, ...(company?.hf || {}) };
  o.size = Math.min(11, Math.max(6, +o.size || 8));
  if (!/^#[0-9a-f]{6}$/i.test(o.color)) o.color = HF_DEFAULTS.color;
  if (!['none', 'left', 'centre', 'right'].includes(o.logo)) o.logo = 'none';
  return o;
}
/** Splits a template into pieces: text, or {page}/{pages}. Parts between " · " whose placeholders are all empty are
 *  dropped, so "Tank {tank} · Report {report}" with no tank number prints "Report 7". */
export function hfPieces(tpl, vals) {
  const out = [];
  const parts = String(tpl || '').split(' · ').filter((part) => {
    const toks = [...part.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).filter((k) => k in vals || k === 'page' || k === 'pages');
    return !toks.length || toks.some((k) => k === 'page' || k === 'pages' || String(vals[k] ?? '').trim());
  });
  parts.forEach((part, i) => {
    if (i) out.push(' · ');
    for (const bit of part.split(/(\{\w+\})/)) {
      const m = /^\{(\w+)\}$/.exec(bit);
      if (m && (m[1] === 'page' || m[1] === 'pages')) out.push({ counter: m[1] });
      else if (m) out.push(m[1] in vals ? String(vals[m[1]] ?? '') : bit);
      else if (bit) out.push(bit);
    }
  });
  return out;
}
const hfContent = (pieces, logo) => {
  const merged = [];
  for (const p of pieces) { if (typeof p === 'string' && typeof merged[merged.length - 1] === 'string') merged[merged.length - 1] += p; else merged.push(p); }
  const v = merged.map((p) => (typeof p === 'string' ? css(p) : `counter(${p.counter})`));
  if (logo) v.unshift(`url(${css(logo)})`, ...(v.length ? ['"  "'] : []));
  return v.length ? v.join(' ') : '""';
};
/** The logo wrapped in an SVG of a fixed printed size, so the page header shows it at a set height whatever its
 *  pixel size. */
function hfLogo(src, align) {
  if (!src) return '';
  const a = align === 'right' ? 'xMaxYMid' : align === 'centre' ? 'xMidYMid' : 'xMinYMid';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="110" height="26" viewBox="0 0 110 26"><image width="110" height="26" preserveAspectRatio="${a} meet" xlink:href="${src}" href="${src}"/></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}
/** The text of the six positions, for previews: [[hl, hc, hr], [fl, fc, fr]] with sample page numbers. */
export function hfPreview(company, vals) {
  const o = hfOf(company), t = (k) => hfPieces(o[k], vals).map((p) => (typeof p === 'string' ? p : p.counter === 'page' ? '3' : '24')).join('');
  return [[t('hl'), t('hc'), t('hr')], [t('fl'), t('fc'), t('fr')]];
}

export function pageCSS({ size = 'letter', company = '', tankId = '', reportNo = '', revText = '', status = '', drawOrient = 'landscape', drawPaper = 'report', hf = null, vals = null }) {
  const paper = size === 'a4' ? 'a4' : 'letter', S = PAPER[paper][2], o = drawOrient === 'portrait' ? 'portrait' : 'landscape';
  const H = hfOf(hf ? { hf, logo: hf.logoSrc } : null);
  vals = { ...(vals || {}), company, tank: tankId, report: reportNo, rev: revText, status };
  const font = `font: ${H.size}pt Arial, Helvetica, sans-serif; color: ${H.color};`;
  const logo = H.logo !== 'none' && hf?.logoSrc ? hfLogo(hf.logoSrc, H.logo) : '';
  const box = (pos, key, edge) => {
    const pieces = hfPieces(H[key], vals), withLogo = logo && edge === 'top' && pos === H.logo;
    const rule = H.rule ? (edge === 'top' ? `border-bottom: 0.75pt solid ${H.color}; padding-bottom: 3pt;` : `border-top: 0.75pt solid ${H.color}; padding-top: 3pt;`) : '';
    if (!pieces.length && !withLogo && !rule) return '';
    const align = pos === 'left' ? 'left' : pos === 'right' ? 'right' : 'center';
    return `@${edge}-${pos === 'centre' ? 'center' : pos} { content: ${hfContent(pieces, withLogo ? logo : '')}; ${font} text-align: ${align}; vertical-align: ${edge === 'top' ? 'bottom' : 'top'}; width: 33.3%; ${rule} }`;
  };
  const boxes = ['left', 'centre', 'right'].map((p, i) => box(p, ['hl', 'hc', 'hr'][i], 'top')).concat(['left', 'centre', 'right'].map((p, i) => box(p, ['fl', 'fc', 'fr'][i], 'bottom'))).filter(Boolean).join('\n      ');
  const big = drawPaper === 'tabloid' ? 'tabloid' : paper;
  const [, hs] = drawArea(paper, o), [, hb] = drawArea(big, o);
  return `@media print {
    @page { size: ${S} portrait; margin: 0.75in 0.6in 0.7in; ${boxes} }
    @page cover { size: ${S} portrait; margin: 0.75in 0.6in; @top-left { content: none; } @top-center { content: none; } @top-right { content: none; } @bottom-left { content: none; } @bottom-center { content: none; } @bottom-right { content: none; } }
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
  .report .grid:has(th:nth-child(12)) th, .report .grid:has(th:nth-child(12)) td { font-size: 8.5px; padding: 2px 2px; }
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
  const I = job.info || {}, St = job.status || {}, D = job.docctl || {};
  const revs = (history && history.length ? history : job.rev ? [{ rev: job.rev, at: job.savedAt, note: 'Saved to a job file' }] : []);
  const kv = (rows) => `<table class="kv">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  return `${kv([['Report number', h(I.reportNo || '—')], ['Work order', h(I.workOrder || '—')], ['Job stage', h(STAGE_TXT[St.stage] || '—')], ['Current revision', job.rev ? `Rev ${job.rev}, saved ${h(dateOf(job.savedAt))}${(job.updated || 0) > (job.savedAt || 0) ? ' — <b>includes changes made after Rev ' + job.rev + '</b>' : ''}` : 'Not yet saved to a job file']])}
    <h3 class="rp-h3">Revision history</h3>
    <table class="grid small"><thead><tr><th>Rev</th><th>Date</th><th>By</th><th>Description</th></tr></thead><tbody>${revs.map((r) => `<tr><td>${h(r.rev ?? '')}</td><td>${h(dateOf(r.at))}</td><td>${h(r.by || '')}</td><td>${h(r.note || '')}</td></tr>`).join('') || '<tr><td colspan="4">No revisions saved to a job file yet.</td></tr>'}</tbody></table>
    <h3 class="rp-h3">Approval</h3>
    <table class="sig"><tr>${[['Prepared by', D.preparedBy || personName(job, 'insp653') || St.inspector, D.preparedDate], ['Peer reviewed by', St.reviewer, D.reviewedDate], ['Approved by', D.approvedBy, D.approvedDate]].map(([r, n, dt]) => `<td><div class="line"></div><b>${h(n || '')}</b>${dt ? ` · ${h(dt)}` : ''}<br>${r} · Signature and date</td>`).join('')}</tr></table>
    ${(D.dist || []).some((x) => x.name || x.org) ? `<h3 class="rp-h3">Distribution</h3><table class="grid small"><thead><tr><th>Name</th><th>Organisation</th><th>Copy / format</th></tr></thead><tbody>${D.dist.filter((x) => x.name || x.org).map((x) => `<tr><td>${h(x.name)}</td><td>${h(x.org)}</td><td>${h(x.copy)}</td></tr>`).join('')}</tbody></table>` : ''}`;
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
  const style = FRAME_CSS + SHEET_CSS + pageCSS({ size: company.pageSize, company: company.name, tankId: I.tankId, reportNo: I.reportNo, revText, status: issued ? 'ISSUED' : 'DRAFT', drawOrient: layout.drawOrient, drawPaper: layout.drawPaper,
    hf: { ...hfOf(company), logoSrc: company.logo }, vals: hfVals(job, company) });
  return `<article class="report rp2"><style>${style}</style>${issued ? '' : '<div class="rp-draft" aria-hidden="true">DRAFT</div>'}
  ${front.join('\n')}
  ${chapters.join('\n')}
  ${apps.join('\n')}
  ${footer}
</article>`;
}

/** Placeholder values for the page header and footer. */
export function hfVals(job, company) {
  const I = job?.info || {};
  return { company: company?.name || '', client: I.client || '', site: I.site || '', tank: I.tankId || '', report: I.reportNo || '',
    rev: job?.rev ? `Rev ${job.rev} · ${dateOf(job.savedAt)}` : 'Not saved to a job file', status: job?.status?.stage === 'complete' ? 'ISSUED' : 'DRAFT',
    date: I.inspDate || '', inspector: personName(job, 'insp653') || job?.status?.inspector || '', title: 'Storage Tank Inspection Report' };
}

/* ------------------------------------------------------------------ drawing sheets ---
   Floor, shell and roof drawings print as engineering drawing sheets: a double border with grid references, the
   drawing with its view title on the left, and on the right the design data, legend, numbered notes and a title
   block (report improvements, after R1). */
const ZONES_X = 8, ZONES_Y = 6;

/** info: { company: {name, logo}, client, site, tankId, reportNo, rev, revDate, status, drawnBy, checkedBy } */
export function sheetHTML(N, info, { cls = '', section, figure, view, scale = 'Not to scale', drawing, wrap = 'map-wrap', data = [], legend = '', notes = [] }) {
  const anchor = section ? N.anchor(section) : '';
  const f = N.figureRef(figure);
  const dwgNo = `${info.reportNo || info.tankId || 'DWG'}-F${f.no}`;
  const zx = (pos) => `<div class="z z${pos}">${Array.from({ length: ZONES_X }, (_, i) => `<span>${i + 1}</span>`).join('')}</div>`;
  const zy = (pos) => `<div class="z z${pos}">${Array.from({ length: ZONES_Y }, (_, i) => `<span>${String.fromCharCode(65 + i)}</span>`).join('')}</div>`;
  const kv = (rows) => `<table class="dwg-kv">${rows.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `<tr><th>${h(k)}</th><td>${v}</td></tr>`).join('')}</table>`;
  const block = (title, body) => (body ? `<div class="dwg-blk"><div class="dwg-bh">${title}</div>${body}</div>` : '');
  const tb = `<table class="dwg-tb">
      <tr><td colspan="2" class="tb-co">${info.company?.logo ? `<img src="${info.company.logo}" alt="">` : ''}<b>${h(info.company?.name || '')}</b></td></tr>
      <tr><td colspan="2" class="tb-title"><span>Title</span>${h(figure)}</td></tr>
      <tr><td><span>Client</span>${h(info.client || '—')}</td><td><span>Site</span>${h(info.site || '—')}</td></tr>
      <tr><td><span>Tank</span>${h(info.tankId || '—')}</td><td><span>Report no.</span>${h(info.reportNo || '—')}</td></tr>
      <tr><td><span>Drawn</span>${h(info.drawnBy || '—')}</td><td><span>Checked</span>${h(info.checkedBy || '—')}</td></tr>
      <tr><td><span>Scale</span>${h(scale)}</td><td><span>Date</span>${h(info.revDate || '—')}</td></tr>
      <tr><td class="tb-no"><span>Drawing no.</span>${h(dwgNo)}</td><td class="tb-rev"><span>Rev</span>${h(info.rev ?? '—')}</td></tr>
      <tr><td><span>Figure</span>${h(f.no)}</td><td class="tb-st">${h(info.status || '')}</td></tr>
    </table>`;
  return `<section class="rp-draw dwg ${cls}" id="${f.id}">${anchor}
    <div class="dwg-frame">${zx('t')}${zy('l')}
      <div class="dwg-in">
        <div class="dwg-area"><div class="${wrap}">${drawing}</div><div class="dwg-view"><b>${h(view)}</b><span>${h(scale)}</span></div></div>
        <aside class="dwg-side">
          ${block('Design data', data.length ? kv(data) : '')}
          ${block('Legend', legend)}
          ${block('Notes', notes.length ? `<ol class="dwg-notes">${notes.map((n) => `<li>${n}</li>`).join('')}</ol>` : '')}
          ${tb}
        </aside>
      </div>${zy('r')}${zx('b')}
    </div>
  </section>`;
}

/** Swatches for drawing legends. */
export const swatch = {
  dot: (fill, stroke = fill) => `<svg viewBox="-6 -6 12 12" width="12" height="12"><circle r="4.2" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/></svg>`,
  line: (stroke, dash = '') => `<svg viewBox="0 -6 18 12" width="18" height="12"><path d="M1 0H17" stroke="${stroke}" stroke-width="1.6" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg>`,
  box: (fill, stroke) => `<svg viewBox="-6 -6 12 12" width="12" height="12"><rect x="-5" y="-4" width="10" height="8" fill="${fill}" stroke="${stroke}" stroke-width="1"/></svg>`,
};
export const legendList = (items) => `<ul class="dwg-legend">${items.map(([sw, label]) => `<li>${sw}<span>${label}</span></li>`).join('')}</ul>`;

export const SHEET_CSS = `
.report .dwg-frame { display: grid; grid-template-columns: 14px minmax(0, 1fr) 14px; grid-template-rows: 14px minmax(0, 1fr) 14px; grid-template-areas: ". t ." "l in r" ". b ."; border: 2px solid #1d232b; outline: 0.5px solid #1d232b; outline-offset: -5px; margin: 6px 0 12px; }
.report .dwg-frame .z { display: flex; font: 8px Arial, Helvetica, sans-serif; color: #3a434e; }
.report .dwg-frame .z span { flex: 1; display: flex; align-items: center; justify-content: center; }
.report .dwg-frame .zt { grid-area: t; } .report .dwg-frame .zb { grid-area: b; }
.report .dwg-frame .zt span + span, .report .dwg-frame .zb span + span { border-left: 0.5px solid #1d232b; }
.report .dwg-frame .zl, .report .dwg-frame .zr { flex-direction: column; } .report .dwg-frame .zl { grid-area: l; } .report .dwg-frame .zr { grid-area: r; }
.report .dwg-frame .zl span + span, .report .dwg-frame .zr span + span { border-top: 0.5px solid #1d232b; }
.report .dwg-in { grid-area: in; display: grid; grid-template-columns: minmax(0, 1fr) 2.15in; border: 1px solid #1d232b; min-height: 0; }
.report .dwg-area { display: flex; flex-direction: column; padding: 6px; min-width: 0; min-height: 0; }
.report .dwg-area > div:first-child { flex: 1 1 auto; min-height: 0; }
.report .dwg-area svg { width: 100%; height: auto; display: block; }
.report .dwg-view { text-align: center; margin-top: 4px; font-size: 10px; }
.report .dwg-view b { display: block; text-transform: uppercase; letter-spacing: .06em; text-decoration: underline; text-underline-offset: 2px; }
.report .dwg-view span { color: #3a434e; font-size: 8.5px; }
.report .dwg-side { border-left: 1px solid #1d232b; display: flex; flex-direction: column; font-size: 8px; min-height: 0; }
.report .dwg-blk { border-bottom: 1px solid #1d232b; padding: 3px 5px 4px; }
.report .dwg-bh { font-weight: 700; text-transform: uppercase; letter-spacing: .05em; text-align: center; border-bottom: 0.5px solid #1d232b; margin: 0 -5px 3px; padding-bottom: 2px; font-size: 8px; }
.report .dwg-kv { width: 100%; border-collapse: collapse; } .report .dwg-kv th { text-align: left; font-weight: 400; color: #3a434e; padding: 1px 4px 1px 0; vertical-align: top; } .report .dwg-kv td { padding: 1px 0; font-weight: 600; }
.report .dwg-legend { list-style: none; margin: 0; padding: 0; } .report .dwg-legend li { display: flex; align-items: center; gap: 5px; padding: 1px 0; } .report .dwg-legend svg { flex: none; }
.report .dwg-notes { margin: 0; padding-left: 14px; } .report .dwg-notes li { margin: 0 0 2px; line-height: 1.3; }
.report .dwg-tb { margin-top: auto; width: 100%; border-collapse: collapse; border-top: 1.5px solid #1d232b; }
.report .dwg-tb td { border-bottom: 0.5px solid #1d232b; padding: 2px 4px; vertical-align: top; font-weight: 600; font-size: 8px; } .report .dwg-tb td + td { border-left: 0.5px solid #1d232b; }
.report .dwg-tb td span { display: block; font-weight: 400; color: #5b6470; font-size: 6.5px; text-transform: uppercase; letter-spacing: .04em; }
.report .dwg-tb .tb-co { text-align: center; font-size: 10px; padding: 4px; } .report .dwg-tb .tb-co img { display: block; max-height: 28px; max-width: 100%; margin: 0 auto 2px; }
.report .dwg-tb .tb-title { font-size: 9px; }
.report .dwg-tb .tb-no { font-size: 10px; } .report .dwg-tb .tb-rev { font-size: 10px; width: 30%; }
.report .dwg-tb .tb-st { text-align: center; vertical-align: middle; font-size: 10px; letter-spacing: .12em; }
.report .dwg.port .dwg-in { grid-template-columns: 1fr; grid-template-rows: minmax(0, 1fr) auto; }
.report .dwg.port .dwg-side { border-left: 0; border-top: 1px solid #1d232b; display: grid; grid-template-columns: 1fr 1fr; }
.report .dwg.port .dwg-side .dwg-tb { grid-column: 1 / -1; }
.report .rp-anchor { display: block; height: 0; }
.report .grid.wrap td, .report .grid.wrap td:nth-last-child(2) { white-space: normal; overflow-wrap: break-word; }
.report sup.vm { font-size: 7px; font-weight: 700; color: #3a434e; border: 0.5px solid #8a939d; border-radius: 2px; padding: 0 1.5px; margin-left: 2px; vertical-align: super; line-height: 1; }
.report .exec-scope { font-size: 11px; margin: 0 0 8px; }
.report .verdict .vk { display: block; font-size: 9px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; opacity: .8; margin-bottom: 2px; }
.report .verdict small { display: block; font-weight: 400; font-size: 9.5px; margin-top: 2px; }
.report .verdict.none { border: 1px dashed #8a939d; background: #fff; color: #3a434e; font-weight: 600; }
.report .dwg-side .legend { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; margin: 0; font-size: 8px; } .report .dwg-side .legend .lg { display: flex; align-items: center; gap: 5px; }
@media print {
  .report .rp-draw.dwg { display: block; }
  .report .rp-draw.dwg .dwg-frame { height: 100%; margin: 0; box-sizing: border-box; }
  .report .dwg-area .map-wrap svg, .report .dwg-area .ro-print svg, .report .dwg-area .roof-print svg { width: 100%; height: 100%; max-height: none; }
  .report .dwg-area > div:first-child { flex: 1 1 0; }
}`;
