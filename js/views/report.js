// Report screen: report options and the printable preview (refactoring step 2).
import { S } from '../app/state.js';
import { defineView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { buildReport } from '../report.js';
import { $ } from '../ui.js';

function viewReport() {
  const o = S.reportOpts;
  const chk = (k, label) => `<label class="chk sm"><input type="checkbox" data-act="ropt" data-k="${k}" ${o[k] ? 'checked' : ''}><span>${label}</span></label>`;
  return `<div class="report-tools no-print">
    <div><h1>Report</h1><p class="muted small">Print or save as PDF from the browser dialog (choose “Save as PDF”, Letter or A4, margins Default).</p></div>
    <div class="acts">${chk('exec', 'Executive summary')}${chk('defs', 'Deficiencies')}${chk('sections', 'Findings by component')}${chk('photos', 'Photos')}${chk('indSize', 'Indication sizes')}${chk('plates', 'Plate register')}${chk('provenOnly', 'Hide false calls')}${chk('plateLabels', 'Plate labels on map')}${chk('datums', 'Datum marks')}
      <button class="btn primary" data-act="print">Print / Save PDF</button></div></div>
    <div class="report-preview" id="reportRoot"></div>`;
}
const afterReport = () => { $('#reportRoot').innerHTML = buildReport(S.job, S.layout, S.calc, S.company, S.photos, S.reportOpts); };

defineView('report', viewReport, afterReport);

onAction({
  'print': async (el, id, e, act) => {
    window.print(); return;
  }
});

onChange([
  { order: 360, when: (el, act) => act === 'ropt', run: async (el, e, act) => {
    { S.reportOpts[el.dataset.k] = el.checked; afterReport(); return; }
  } }
]);
