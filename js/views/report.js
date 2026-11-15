// Report screen: report options and the printable preview (refactoring step 2).
import { S } from '../app/state.js';
import { defineView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { db } from '../db.js';
import { buildReport } from '../report.js';
import { $ } from '../ui.js';
import { esc as h, sha256 } from '../util.js';

/** A Complete job shows the report exactly as it was issued (stage 8b). */
const issuedOf = (j) => (j?.status?.stage === 'complete' && j.issued ? j.issued : null);

function viewReport() {
  const o = S.reportOpts;
  const chk = (k, label) => `<label class="chk sm"><input type="checkbox" data-act="ropt" data-k="${k}" ${o[k] ? 'checked' : ''}><span>${label}</span></label>`;
  return `<div class="report-tools no-print">
    <div><h1>Report</h1><p class="muted small">Print or save as PDF from the browser dialog (choose “Save as PDF”, Letter or A4, margins Default).</p></div>
    <div class="acts">${issuedOf(S.job) ? '<span class="muted small">The issued report is shown with the options it was issued with.</span>' : `${chk('exec', 'Executive summary')}${chk('defs', 'Deficiencies')}${chk('sections', 'Findings by component')}${chk('photos', 'Photos')}${chk('indSize', 'Indication sizes')}${chk('plates', 'Plate register')}${chk('provenOnly', 'Hide false calls')}${chk('plateLabels', 'Plate labels on map')}${chk('datums', 'Datum marks')}`}
      <button class="btn primary" data-act="print">Print / Save PDF</button></div></div>
    <div class="report-preview" id="reportRoot"></div>`;
}
let cmp = null; // { issued, live } while the side-by-side comparison is open
async function afterReport() {
  const j = S.job, iss = issuedOf(j), root = $('#reportRoot');
  if (!iss) { root.innerHTML = buildReport(j, S.layout, S.calc, S.company, S.photos, S.reportOpts); return; }
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

onChange([
  { order: 360, when: (el, act) => act === 'ropt', run: async (el, e, act) => {
    { S.reportOpts[el.dataset.k] = el.checked; afterReport(); return; }
  } }
]);
