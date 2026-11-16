// Report screen: report options and the printable preview (refactoring step 2).
import { docCtlHTML } from './r2fields.js';
import { S } from '../app/state.js';
import { defineView, renderView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { db } from '../db.js';
import { buildReport } from '../report.js';
import { layoutOf } from '../report/frame.js';
import { reportHistory } from '../app/stage.js';
import { $ } from '../ui.js';
import { esc as h, sha256 } from '../util.js';

/** A Complete job shows the report exactly as it was issued (stage 8b). */
const issuedOf = (j) => (j?.status?.stage === 'complete' && j.issued ? j.issued : null);

/* Report options (R1): the section list (switch and order per chapter and appendix), drawing orientation and the
   content options, kept on this device (meta 'report:opts') so they last between sessions and apply to every job. */
const optsLoaded = db.getMeta('report:opts').then((o) => { if (o && typeof o === 'object') Object.assign(S.reportOpts, o); }).catch(() => {});
function storedLayout() {
  const L = layoutOf(S.reportOpts);
  return { order: L.chapters.map((c) => c.id), appOrder: L.appendices.map((a) => a.id), off: [...L.front, ...L.chapters, ...L.appendices].filter((x) => !x.on).map((x) => x.id), drawOrient: L.drawOrient, drawPaper: L.drawPaper };
}
async function saveOpts() { await db.setMeta('report:opts', S.reportOpts).catch(() => {}); }

function sectionsPanel() {
  const L = layoutOf(S.reportOpts);
  const row = (it, list, i, n, mark = '') => `<li>${list ? `<span class="rsec-no">${mark}</span>` : ''}<label class="chk sm"><input type="checkbox" data-act="rsec" data-id="${it.id}" ${it.on ? 'checked' : ''}><span>${h(it.title)}</span></label>${list ? `<span class="rsec-mv"><button type="button" class="btn sm ghost" data-act="rsec-up" data-list="${list}" data-id="${it.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${h(it.title)} up">↑</button><button type="button" class="btn sm ghost" data-act="rsec-down" data-list="${list}" data-id="${it.id}" ${i === n - 1 ? 'disabled' : ''} aria-label="Move ${h(it.title)} down">↓</button></span>` : ''}</li>`;
  return `<details class="rsec" ${S.reportSecOpen ? 'open' : ''}><summary data-act="rsec-toggle">Report sections and layout</summary><div class="rsec-cols">
    <div><h4>Front matter</h4><ul>${L.front.map((x) => row(x, '', 0, 0)).join('')}</ul>
      <h4>Drawings</h4><label class="fld"><span class="lbl">Drawing pages</span><select data-act="rdraw"><option value="landscape" ${L.drawOrient === 'landscape' ? 'selected' : ''}>Landscape</option><option value="portrait" ${L.drawOrient === 'portrait' ? 'selected' : ''}>Portrait</option></select></label>
      <label class="fld"><span class="lbl">Floor, shell and roof drawings on</span><select data-act="rpaper"><option value="report" ${L.drawPaper === 'report' ? 'selected' : ''}>Report paper (${S.company.pageSize === 'a4' ? 'A4' : 'Letter'})</option><option value="tabloid" ${L.drawPaper === 'tabloid' ? 'selected' : ''}>11 × 17 in (Tabloid / Ledger)</option></select></label>
      <p class="muted small">Report paper: ${S.company.pageSize === 'a4' ? 'A4' : 'Letter'} (Jobs → Company). Drawings fill their page.</p></div>
    <div><h4>Chapters</h4><ul class="rsec-list">${L.chapters.map((x, i, a) => row(x, 'order', i, a.length, i + 1 + '.')).join('')}</ul></div>
    <div><h4>Appendices</h4><ul class="rsec-list">${L.appendices.map((x, i, a) => row(x, 'appOrder', i, a.length, String.fromCharCode(65 + i) + '.')).join('')}</ul>
      <h4>Content</h4>${[['photos', 'Photos'], ['indSize', 'Indication sizes'], ['provenOnly', 'Hide false calls'], ['plateLabels', 'Plate labels on map'], ['datums', 'Datum marks']].map(([k, l]) => `<label class="chk sm"><input type="checkbox" data-act="ropt" data-k="${k}" ${S.reportOpts[k] ? 'checked' : ''}><span>${l}</span></label>`).join('')}
      <p><button type="button" class="btn sm ghost" data-act="rsec-reset">Default layout</button></p></div>
  </div><p class="muted small">Chapters and appendices are numbered in the order shown; those without content for this job are left out. Contents lists section, table and figure numbers; the browser adds page numbers to each page.</p></details>`;
}

function viewReport() {
  return `<div class="report-tools no-print">
    <div><h1>Report</h1><p class="muted small">Print or save as PDF from the browser dialog (choose “Save as PDF” and margins Default, and turn off the browser’s “Headers and footers”: the report prints its own).</p></div>
    <div class="acts">${issuedOf(S.job) ? '<span class="muted small">The issued report is shown with the options it was issued with.</span>' : ''}
      <button class="btn primary" data-act="print">Print / Save PDF</button></div>
    ${issuedOf(S.job) ? '' : sectionsPanel() + `<details class="rsec" ${S.reportDocOpen ? 'open' : ''}><summary data-act="rdoc-toggle">Document control</summary><div class="rdoc">${docCtlHTML()}</div></details>`}</div>
    <div class="report-preview" id="reportRoot"></div>`;
}
let cmp = null; // { issued, live } while the side-by-side comparison is open
async function afterReport() {
  const j = S.job, iss = issuedOf(j), root = $('#reportRoot');
  await optsLoaded;
  if (!iss) {
    const history = await reportHistory(j.id);
    if (S.job !== j || S.view !== 'report') return;
    root.innerHTML = buildReport(j, S.layout, S.calc, S.company, S.photos, { ...S.reportOpts, history }); return;
  }
  const r = await db.getRevision(`${j.id}:${iss.n}`).catch(() => null);
  if (S.job !== j || S.view !== 'report') return;
  if (!r?.issued?.html) {
    root.innerHTML = `<div class="issued-bar differs no-print"><span class="grow"><b>The issued report isn’t on this device.</b> Showing the report as this version of the app produces it.</span></div>`
      + buildReport(j, S.layout, S.calc, S.company, S.photos, S.reportOpts);
    return;
  }
  const intact = (await sha256(r.issued.html)) === r.issued.hash;
  // the report this version of the app would produce from the same data, options and file revision
  const live = buildReport({ ...j, rev: r.job.rev, savedAt: r.job.savedAt, updated: r.job.updated }, S.layout, S.calc, S.company, S.photos, r.issued.opts || S.reportOpts);
  const same = (await sha256(live)) === r.issued.hash;
  if (S.job !== j || S.view !== 'report') return;
  cmp = { issued: r.issued.html, live };
  const when = new Date(r.issued.at).toLocaleString();
  root.innerHTML = `<div class="issued-bar no-print ${same && intact ? '' : 'differs'}" id="issuedBar"><span class="grow"><b>Issued report</b> · revision ${r.n} · ${h(when)} · app ${h(r.issued.appVersion || '')}${intact ? ' · checksum ✓' : ' · <b>checksum does not match</b>'}`
    + `${same ? '' : '<br>This version of the app would produce a different report from the same data. The issued report is unchanged.'}</span>`
    + `${same ? '' : '<button class="btn sm" data-act="rev-issued-cmp">Compare side by side</button>'}</span></div><div id="issuedReport">${r.issued.html}</div>`;
}


defineView('report', viewReport, afterReport);

onAction({
  'rev-issued-cmp': async () => {
    if (!cmp) return;
    const dlg = $('#dlg');
    $('#dlgBody').innerHTML = `<div class="ed-head"><h2>Issued report and this version’s report</h2><button aria-label="Close" type="button" class="btn sm ghost" data-rv="close">✕</button></div>
      <div class="issued-cmp"><div><h4>Issued</h4><div class="rev-report">${cmp.issued}</div></div><div><h4>This version of the app</h4><div class="rev-report">${cmp.live}</div></div></div>`;
    $('#dlgBody').querySelector('[data-rv="close"]').onclick = () => { dlg.close(); dlg.classList.remove('wide-dlg'); };
    dlg.classList.add('wide-dlg'); if (!dlg.open) dlg.showModal();
  },
  'print': async (el, id, e, act) => {
    window.print(); return;
  }
});

const relayout = async (fn) => { const L = storedLayout(); fn(L); S.reportOpts.layout = L; await saveOpts(); renderView(); };
const move = (el, d) => relayout((L) => { const list = L[el.dataset.list], i = list.indexOf(el.dataset.id), j = i + d; if (i < 0 || j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; });
onAction({
  'rsec-up': async (el) => move(el, -1),
  'rsec-down': async (el) => move(el, 1),
  'rsec-reset': async () => { delete S.reportOpts.layout; Object.assign(S.reportOpts, { exec: true, defs: true, sections: true, plates: false }); await saveOpts(); renderView(); },
  'rsec-toggle': async () => { S.reportSecOpen = !S.reportSecOpen; },
  'rdoc-toggle': async () => { S.reportDocOpen = !S.reportDocOpen; },
});

onChange([
  { order: 360, when: (el, act) => act === 'ropt', run: async (el, e, act) => {
    { S.reportOpts[el.dataset.k] = el.checked; await saveOpts(); afterReport(); return; }
  } },
  { order: 365, when: (el, act) => act === 'rsec', run: async (el) => relayout((L) => { L.off = L.off.filter((x) => x !== el.dataset.id); if (!el.checked) L.off.push(el.dataset.id); }) },
  { order: 366, when: (el, act) => act === 'rdraw', run: async (el) => relayout((L) => { L.drawOrient = el.value; }) },
  { order: 367, when: (el, act) => act === 'rpaper', run: async (el) => relayout((L) => { L.drawPaper = el.value; }) },
]);
