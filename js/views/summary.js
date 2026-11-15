// Executive summary, deficiencies list and the client deficiency report (refactoring step 9).
import { S, secData } from '../app/state.js';
import { field, sxIn, sxSel } from '../app/fields.js';
import { defineView, go, renderView } from '../app/nav.js';
import { onAction } from '../app/actions.js';
import { host } from '../app/host.js';
import { buildDefReport } from '../report.js';
import { allDefs, childView, findings, numberDefs, PRIORITIES, SECTIONS, STATUS_TEXT, STATUSES } from '../sections.js';
import { $, askConfirm, toast } from '../ui.js';
import { esc as h } from '../util.js';
const CONDITION_OPTS = ['', 'Fit for continued service', 'Fit for continued service after the listed repairs', 'Not fit for service until repaired', 'Further evaluation required'];
function viewSummary() {
  const job = S.job, F = findings(job, S.layout, S.calc), defs = allDefs(job), open = defs.filter((d) => d.status !== 'Closed');
  const rows = SECTIONS.map((s) => { const f = F[s.key], n = open.filter((d) => d.sec === s.key).length; return `<tr><td><button class="linkbtn" data-go="${childView(s.key, 'an')}">${h(s.label)}</button></td><td><span class="sres-chip s-${f.status}">${STATUS_TEXT[f.status]}</span></td><td class="small">${f.lines.slice(0, 3).join('<br>') || '<span class="muted">—</span>'}</td><td class="n">${n ? `<button class="linkbtn" data-go="defs">${n}</button>` : '—'}</td></tr>`; }).join('');
  const pri = open.filter((d) => ['P1', 'P2'].includes(d.priority));
  return `<div class="page wide"><div class="page-head"><div><h1>Executive summary</h1><p class="muted">The first page of the report: overall condition, scope, summary of findings and priority items. The component table updates from the inspection data.</p></div>
    <div class="acts"><button class="btn" data-go="defs">Deficiencies</button><button class="btn primary" data-go="report">Report</button></div></div>
    <section class="card"><div class="fgrid">
      ${field('Overall condition', 'summary.condition', 'sel', { options: CONDITION_OPTS.map((x) => [x, x || '—']), cls: 'span2' })}
      ${field('Return to service', 'summary.rts', 'text', { ph: 'e.g. after P1 / P2 repairs are complete' })}${field('Next external inspection', 'summary.nextExt', 'text', { ph: 'date or interval' })}
      ${field('Next internal inspection', 'summary.nextInt', 'text', { ph: S.calc?.Or ? `e.g. ${S.calc.Or} years (bottom MRT)` : '' })}${field('Next UT thickness inspection', 'summary.nextUT', 'text')}
    </div></section>
    <section class="card"><div class="sp-head"><h2>Condition by component</h2><span class="muted small">${open.length} open deficienc${open.length === 1 ? 'y' : 'ies'}</span></div>
      <div class="tblwrap"><table class="grid"><thead><tr><th>Component</th><th>Condition</th><th>Key results</th><th class="n">Open deficiencies</th></tr></thead><tbody>${rows}</tbody></table></div></section>
    <section class="card"><div class="sp-head"><h2>Scope</h2><button class="btn sm" data-act="sum-draft" data-f="scope">Draft from the NDE set-up</button></div>${field('', 'summary.scope', 'area', { rows: 4, ph: 'What was inspected and how' })}</section>
    <section class="card"><div class="sp-head"><h2>Summary of findings</h2><button class="btn sm" data-act="sum-draft" data-f="narrative">Draft from the findings</button></div>${field('', 'summary.narrative', 'area', { rows: 8, ph: 'Main findings and conclusions' })}</section>
    ${pri.length ? `<section class="card"><h2>Priority items (P1 / P2)</h2><ul class="flist bad">${pri.map((d) => `<li><b>${h(d.no || '')}</b> ${h(d.secLabel)}: ${h(d.finding)}${d.action ? ` — <i>${h(d.action)}</i>` : ''}</li>`).join('')}</ul></section>` : ''}
  </div>`;
}
function draftSummary(f) {
  const job = S.job, I = job.info, F = findings(job, S.layout, S.calc);
  if (f === 'scope') {
    const parts = SECTIONS.map((s) => { const m = secData(s.key).nde; return m.length ? `${s.label}: ${m.map((x) => x.method + (x.extent ? ' (' + x.extent + ')' : '')).join(', ')}.` : ''; }).filter(Boolean);
    return `${job.info.inspDate ? 'On ' + job.info.inspDate + ', ' : ''}an API 653 inspection of tank ${I.tankId || ''}${I.site ? ' at ' + I.site : ''} was carried out.${parts.length ? '\n' + parts.join('\n') : ''}`;
  }
  const defs = allDefs(job).filter((d) => d.status !== 'Closed');
  const lines = SECTIONS.map((s) => { const x = F[s.key]; if (x.status === 'none') return ''; return `${s.label}: ${STATUS_TEXT[x.status].toLowerCase()}. ${x.lines.slice(0, 2).map((l) => l.replace(/<[^>]+>/g, '')).join(' ')}`; }).filter(Boolean);
  return `${lines.join('\n')}${defs.length ? `\n\n${defs.length} deficienc${defs.length === 1 ? 'y is' : 'ies are'} listed in the deficiency report, ${defs.filter((d) => ['P1', 'P2'].includes(d.priority)).length} of them to be completed before return to service.` : ''}`;
}

function viewDefs() {
  const job = S.job; numberDefs(job);
  const f = S.defFilter || 'open';
  let defs = allDefs(job); const all = defs.length;
  if (f === 'open') defs = defs.filter((d) => d.status !== 'Closed'); else if (f === 'closed') defs = defs.filter((d) => d.status === 'Closed');
  const rows = defs.map((d) => `<tr class="p-${d.priority}${d.status === 'Closed' ? ' closed' : ''}"><td><b>${h(d.no || '')}</b></td><td><button class="linkbtn" data-go="recs:${d.sec}">${h(d.secLabel)}</button>${d.loc ? `<br><small class="muted">${h(d.loc)}</small>` : ''}</td><td class="small">${h(d.finding)}</td><td class="small">${h(d.action)}</td>
    <td>${sxSel('recs', d.sec, d, 'priority', PRIORITIES.map(([k]) => [k, k]))}</td><td>${sxIn('recs', d.sec, d, 'due', 'text', 'class="due"')}</td><td>${sxSel('recs', d.sec, d, 'status', STATUSES)}${d.closedOn ? `<br><small class="muted">${h(d.closedOn)}</small>` : ''}</td><td>${sxIn('recs', d.sec, d, 'client', 'text', 'placeholder="Client comment / work order"')}</td>
    <td class="small muted">${d.history?.length ? h(d.history[d.history.length - 1].date) : ''}</td></tr>`).join('') || `<tr><td colspan="9" class="empty">${all ? 'Nothing in this filter.' : 'No deficiencies yet — tick “Deficiency” on a recommendation, or add them from the Recommendations pages.'}</td></tr>`;
  const S2 = job.summary;
  return `<div class="page wide"><div class="page-head"><div><h1>Deficiencies</h1><p class="muted">Every recommendation marked as a deficiency, from all parts of the tank. Update status and client comments here, then issue the deficiency report to the client.</p></div>
    <div class="acts"><button class="btn" data-act="exp-defs">Export CSV</button><button class="btn" data-act="def-issue">Issue update${S2.defRev ? ' ' + (S2.defRev + 1) : ''}</button><button class="btn primary" data-go="defrep">Deficiency report</button></div></div>
    <section class="card"><div class="sp-head"><div class="seg">${[['open', 'Open'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => `<button class="btn sm${f === k ? ' on' : ''}" data-act="def-filter" data-k="${k}">${l}</button>`).join('')}</div><span class="muted small">${all} total · last issued ${h(S2.issued || '—')}${S2.defRev ? ' (update ' + S2.defRev + ')' : ''}</span></div>
      <div class="tblwrap"><table class="grid deflog"><thead><tr><th>No.</th><th>Component</th><th>Deficiency</th><th>Recommended action</th><th>Priority</th><th>Due</th><th>Status</th><th>Client comment</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table></div></section></div>`;
}
function viewDefRep() {
  return `<div class="report-tools no-print"><div><h1>Deficiency report</h1><p class="muted small">For updating the client. Print or save as PDF.</p></div><div class="acts"><button class="btn" data-go="defs">← Deficiencies</button><button class="btn primary" data-act="print">Print / Save PDF</button></div></div>
    <div class="report-preview" id="defRoot"></div>`;
}
const afterDefRep = () => { numberDefs(S.job); $('#defRoot').innerHTML = buildDefReport(S.job, S.company, S.photos); };

defineView('summary', viewSummary);
defineView('defs', viewDefs);
defineView('defrep', viewDefRep, afterDefRep);

onAction({
  'sum-draft': async (el, id, e, act) => {
    {
      const f = el.dataset.f;
      if ((S.job.summary[f] || '').trim() && !(await askConfirm('Replace the current text with a new draft?', { ok: 'Replace' }))) return;
      S.job.summary[f] = draftSummary(f); host.commit(); renderView(); return;
    }
  },
  'def-filter': async (el, id, e, act) => {
    S.defFilter = el.dataset.k; renderView(); return;
  },
  'def-issue': async (el, id, e, act) => {
    {
      const S2 = S.job.summary; S2.defRev = (S2.defRev || 0) + 1; S2.issued = new Date().toISOString().slice(0, 10); host.commit(); toast(`Deficiency report update ${S2.defRev} issued ${S2.issued}.`); go('defrep'); return;
    }
  }
});
