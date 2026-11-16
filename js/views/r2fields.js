// Entry screens for the schema 5 fields (report improvements R2): personnel, calibration records and on-site checks,
// sources of design data, scope and limitations per component, engineering assessments and document control.
// Plain fields use data-bind (job paths); the three lists have their own handlers here.
import { S } from '../app/state.js';
import { field } from '../app/fields.js';
import { renderView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { commit } from '../app/persist.js';
import { calState, EQ_LABEL, equipName } from '../equipment.js';
import { certState, CERTS, newPerson, ROLES } from '../personnel.js';
import { SRC_FIELDS, SRC_OPTS } from '../sources.js';
import { $, askConfirm } from '../ui.js';
import { esc as h } from '../util.js';

let seq = 0;
const rid = (p) => p + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);
const dateIn = (attrs, v) => `<input type="date" ${attrs} value="${h(v || '')}">`;
const txtIn = (attrs, v, ph = '', cls = '') => `<input ${attrs} value="${h(v ?? '')}" placeholder="${h(ph)}" class="${cls}">`;
const stChip = (st, label = { expired: 'Expired', soon: 'Due ≤ 30 days' }) => (st === 'expired' ? `<span class="st st-below-MRT">${label.expired}</span>` : st === 'soon' ? `<span class="st st-warn">${label.soon}</span>` : '');

/* ------------------------------------------------------------------------------ personnel --- */

export function personnelCardHTML() {
  const j = S.job, list = j.personnel || [], d = j.info.inspDate;
  const roleSel = (p) => `<select data-pe="role" data-id="${p.id}">${ROLES.map(([k, l]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>`;
  const inp = (p, f, ph = '', cls = '') => txtIn(`data-pe="${f}" data-id="${p.id}"${f === 'cert' ? ' list="certList"' : ''}`, p[f], ph, cls);
  const lab = (l, ctl, cls = '') => `<label class="pe-f ${cls}"><span>${l}</span>${ctl}</label>`;
  const rows = list.map((p) => `<div class="pe-row${certState(p, d) === 'expired' ? ' is-bad' : ''}">
      ${lab('Role', roleSel(p), 'w2')}${lab('Name', inp(p, 'name', 'Name'), 'w2')}${lab('Company', inp(p, 'company', 'Company'), 'w2')}
      <button aria-label="Remove" class="btn sm icon ghost danger pe-del" data-act="pe-del" data-id="${p.id}" title="Remove">✕</button>
      ${lab('Certification', inp(p, 'cert', 'Scheme'), 'w2')}${lab('Cert. no.', inp(p, 'certNo', 'Number'))}${lab('Method', inp(p, 'method', 'e.g. UT'))}${lab('Level', inp(p, 'level', '1–3'))}
      ${lab('Expiry', dateIn(`data-pe="expiry" data-id="${p.id}"`, p.expiry) + stChip(certState(p, d)), 'w2')}
    </div>`).join('');
  return `<div class="sp-head"><h2>Personnel</h2><span class="muted small">${list.length} ${list.length === 1 ? 'person' : 'people'}</span></div>
    <p class="muted small">Everyone who inspected, tested or evaluated, with their certification. The report lists them, checks expiry against the inspection date, and uses the first API 653 inspector as the inspector of record.</p>
    <div class="pe-list">${rows || '<p class="empty muted">No personnel listed yet.</p>'}</div>
    <datalist id="certList">${CERTS.map((c) => `<option value="${h(c)}">`).join('')}</datalist>
    <div class="acts row-acts">${[['insp653', 'API 653 inspector'], ['mfl', 'MFL operator'], ['ut', 'UT technician'], ['other', 'Other']].map(([k, l]) => `<button class="btn sm" data-act="pe-add" data-role="${k}">+ ${l}</button>`).join('')}</div>`;
}

/* -------------------------------------------------------------------- calibration records --- */

export const calStatusText = (e, onDate) => { const c = calState(e, onDate); return !e.calDue ? 'No due date' : c === 'expired' ? 'Expired' : c === 'soon' ? 'Valid (due within 30 days)' : 'Valid'; };

export function calibrationCardHTML() {
  const j = S.job, list = j.equipment || [], d = j.info.inspDate;
  const rows = list.map((e) => {
    const checks = e.checks || [];
    return `<tr class="${calState(e, d) === 'expired' ? 'is-bad' : ''}"><td><b>${h(equipName(e))}</b><br><small class="muted">${h(EQ_LABEL[e.type] || '')}${e.serial ? ' · S/N ' + h(e.serial) : ''}</small></td>
      <td class="small">${h(e.calDate || '—')} → ${h(e.calDue || '—')}<br>${stChip(calState(e, d)) || `<span class="muted">${calStatusText(e, d)}</span>`}</td>
      <td>${txtIn(`data-eq="certNo" data-id="${e.id}"`, e.certNo, 'Certificate no.', 'sn')}</td>
      <td>${txtIn(`data-eq="refStd" data-id="${e.id}"`, e.refStd, 'Standard / block and its serial')}</td></tr>
      <tr class="ck-tr"><td></td><td colspan="3" class="ck-cell"><span class="muted small">On-site checks</span>${checks.map((c) => `<div class="ck-row"><input type="datetime-local" data-ck="at" data-eid="${e.id}" data-id="${c.id}" value="${h(c.at || '')}">${txtIn(`data-ck="check" data-eid="${e.id}" data-id="${c.id}"`, c.check, 'Check, e.g. step block 0.250 in')}${txtIn(`data-ck="result" data-eid="${e.id}" data-id="${c.id}"`, c.result, 'Result', 'xs2')}<button aria-label="Remove check" class="btn sm icon ghost danger" data-act="ck-del" data-eid="${e.id}" data-id="${c.id}">✕</button></div>`).join('')}
        <button class="btn sm ghost" data-act="ck-add" data-eid="${e.id}">+ Check</button></td></tr>`;
  }).join('');
  return `<div class="sp-head"><h2>Calibration records and on-site checks</h2></div>
    <p class="muted small">Calibration dates are entered in the list above. Add the certificate number, the reference standard or block, and the checks made on site (for example a UT verification on a step block, an MFL reference plate run) with their time and result.</p>
    <div class="tblwrap"><table class="grid cal-t"><thead><tr><th>Equipment</th><th>Calibration (status on the inspection date)</th><th>Certificate no.</th><th>Reference standard / block</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="empty">No equipment listed yet.</td></tr>'}</tbody></table></div>`;
}

/* ------------------------------------------------------------------ sources of design data --- */

export function sourcesCardHTML() {
  return `<section class="card"><h2>Sources of design data</h2>
    <p class="muted small">Where each design value came from. The report prints the source beside the value; a value with no source is printed as not stated.</p>
    <div class="fgrid src-grid">${SRC_FIELDS.map(([k, l]) => field(l, 'tank.src.' + k, 'sel', { options: SRC_OPTS })).join('')}</div></section>`;
}

/* ------------------------------------------------------------- scope, limitations, assessment --- */

export function scopeCardHTML(k) {
  return `<section class="card"><h2>Scope and limitations</h2>
    <p class="muted small">Printed in the report's scope chapter for this component, beside the methods and extent above. Leave blank what does not apply.</p>
    <div class="fgrid">
      ${field('Access', `secs.${k}.scope.access`, 'area', { rows: 2, ph: 'e.g. manway, scaffold, rope access, from the ground only' })}
      ${field('Cleaning / surface preparation', `secs.${k}.scope.cleaning`, 'area', { rows: 2, ph: 'e.g. water-washed and squeegeed; sludge remaining near the sump' })}
      ${field('Conditions during the inspection', `secs.${k}.scope.conditions`, 'area', { rows: 2, ph: 'e.g. dry, 12 °C, tank out of service and gas-free' })}
      ${field('Areas not inspected and why', `secs.${k}.scope.notInspected`, 'area', { rows: 2, ph: 'e.g. under the roof support pads; 0.5 m inside the shell (MFL dead zone)' })}
    </div></section>`;
}

export function assessCardHTML(k) {
  return `<section class="card"><h2>Engineering assessment</h2>
    <p class="muted small">The engineer's assessment of this component, printed as an assessment (A) under the calculated results. Nothing is printed here unless it is entered.</p>
    <div class="fgrid">
      ${field('Assessment', `secs.${k}.assess.text`, 'area', { rows: 3, cls: 'span2', ph: 'e.g. Suitable for continued service to the next internal inspection, subject to the P2 repairs.' })}
      ${field('Engineer', `secs.${k}.assess.by`)}${field('Date', `secs.${k}.assess.date`, 'date')}
    </div></section>`;
}

/* -------------------------------------------------------------------------- document control --- */

export function docCtlHTML() {
  const D = S.job.docctl || {}, dist = D.dist || [];
  const inp = (x, f, ph) => txtIn(`data-dist="${f}" data-id="${x.id}"`, x[f], ph);
  return `<div class="fgrid">
      ${field('Prepared by', 'docctl.preparedBy', 'text', { ph: 'the API 653 inspector' })}${field('Date prepared', 'docctl.preparedDate', 'date')}
      ${field('Peer reviewed by', 'status.reviewer')}${field('Date reviewed', 'docctl.reviewedDate', 'date')}
      ${field('Approved by', 'docctl.approvedBy')}${field('Date approved', 'docctl.approvedDate', 'date')}
    </div>
    <h3>Distribution</h3>
    <table class="grid small dist-t"><thead><tr><th>Name</th><th>Organisation</th><th>Copy / format</th><th></th></tr></thead><tbody>
      ${dist.map((x) => `<tr><td>${inp(x, 'name', 'Name')}</td><td>${inp(x, 'org', 'Organisation')}</td><td>${inp(x, 'copy', 'e.g. PDF, controlled copy 1')}</td><td><button aria-label="Remove" class="btn sm icon ghost danger" data-act="dist-del" data-id="${x.id}">✕</button></td></tr>`).join('') || '<tr><td colspan="4" class="empty">No distribution listed.</td></tr>'}
    </tbody></table>
    <div class="acts row-acts"><button class="btn sm" data-act="dist-add">+ Recipient</button></div>`;
}

/* ------------------------------------------------------------------------------ handlers --- */

onAction({
  'pe-add': async (el) => {
    const p = newPerson(el.dataset.role || 'other'); (S.job.personnel = S.job.personnel || []).push(p);
    commit(); renderView(); setTimeout(() => $(`[data-pe="name"][data-id="${p.id}"]`)?.focus(), 30);
  },
  'pe-del': async (el, id) => {
    const p = (S.job.personnel || []).find((x) => x.id === id); if (!p) return;
    if (p.name && !(await askConfirm(`Remove ${p.name} from the personnel list?`, { ok: 'Remove', danger: true }))) return;
    S.job.personnel = S.job.personnel.filter((x) => x.id !== id); commit(); renderView();
  },
  'ck-add': async (el) => {
    const e = (S.job.equipment || []).find((x) => x.id === el.dataset.eid); if (!e) return;
    const c = { id: rid('ck'), at: '', check: '', result: '' }; (e.checks = e.checks || []).push(c);
    commit(); renderView(); setTimeout(() => $(`[data-ck="check"][data-id="${c.id}"]`)?.focus(), 30);
  },
  'ck-del': async (el, id) => {
    const e = (S.job.equipment || []).find((x) => x.id === el.dataset.eid); if (!e) return;
    e.checks = (e.checks || []).filter((x) => x.id !== id); commit(); renderView();
  },
  'dist-add': async () => {
    const d = S.job.docctl || (S.job.docctl = {}); const x = { id: rid('ds'), name: '', org: '', copy: '' }; (d.dist = d.dist || []).push(x);
    commit(); renderView(); setTimeout(() => $(`[data-dist="name"][data-id="${x.id}"]`)?.focus(), 30);
  },
  'dist-del': async (el, id) => { const d = S.job.docctl || {}; d.dist = (d.dist || []).filter((x) => x.id !== id); commit(); renderView(); },
});

onChange([
  { order: 302, when: (el) => el.matches('[data-pe]'), run: async (el) => {
    const p = (S.job.personnel || []).find((x) => x.id === el.dataset.id); if (!p) return;
    p[el.dataset.pe] = el.value.trim(); commit();
    if (el.tagName === 'SELECT' || el.type === 'date') renderView();
  } },
  { order: 303, when: (el) => el.matches('[data-ck]'), run: async (el) => {
    const e = (S.job.equipment || []).find((x) => x.id === el.dataset.eid), c = e && (e.checks || []).find((x) => x.id === el.dataset.id); if (!c) return;
    c[el.dataset.ck] = el.value.trim(); commit();
  } },
  { order: 304, when: (el) => el.matches('[data-dist]'), run: async (el) => {
    const x = (S.job.docctl?.dist || []).find((y) => y.id === el.dataset.id); if (!x) return;
    x[el.dataset.dist] = el.value.trim(); commit(); if (S.view === 'report') renderView();
  } },
]);
