// Audit trail screen (data integrity stage 9): every change to the open job — when, who, where it came from, and each
// field's old and new value — filtered by section, source and words; whether the trail is intact; a CSV of it.
import { S } from '../app/state.js';
import { defineView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { auditRows, filterRows, SOURCE_LABEL, verifyAudit } from '../audit.js';
import { db } from '../db.js';
import { download, fileBase } from '../export.js';
import { $ } from '../ui.js';
import { esc as h } from '../util.js';

const PAGE = 300;
const F = { area: '', source: '', text: '', shown: PAGE };
let rows = [], problems = [], forJob = null;

const show = (v) => (v === null || v === undefined || v === '' ? '<span class="muted">—</span>' : h(String(v).length > 120 ? String(v).slice(0, 120) + '…' : String(v)));
const tip = (v) => (v !== null && v !== undefined && String(v).length > 120 ? ` title="${h(String(v).slice(0, 2000))}"` : '');

function viewAudit() {
  if (!S.job) return '<div class="page"><p class="muted">Open a job to see its audit trail.</p></div>';
  if (forJob !== S.job.id) { Object.assign(F, { area: '', source: '', text: '', shown: PAGE }); forJob = S.job.id; }
  return `<div class="page wide">
    <div class="page-head"><div><h1>Audit trail</h1><p class="muted">Every change to this job: who made it, when, where it came from, and each field’s value before and after. Entries are never changed; each one is checked against the one before it.</p></div>
      <div class="acts"><button class="btn" data-act="exp-audit">Export CSV</button></div></div>
    <section class="card"><div class="aud-filters">
      <label class="fld"><span class="lbl">Section</span><select data-act="aud-area" id="audArea"><option value="">All</option></select></label>
      <label class="fld"><span class="lbl">Source</span><select data-act="aud-src" id="audSrc"><option value="">All</option>${Object.entries(SOURCE_LABEL).map(([k, l]) => `<option value="${k}" ${F.source === k ? 'selected' : ''}>${h(l)}</option>`).join('')}</select></label>
      <label class="fld grow"><span class="lbl">Item or field</span><input type="search" data-act="aud-text" id="audText" value="${h(F.text)}" placeholder="e.g. M12, mflPct, client"></label>
    </div><div id="audState" class="small"></div></section>
    <section class="card" id="audList"><p class="muted">Loading the audit trail…</p></section></div>`;
}

async function afterAudit() {
  if (!S.job) return;
  const id = S.job.id, entries = await db.jobAudit(id).catch(() => []);
  const pr = await verifyAudit(entries);
  if (S.job?.id !== id || S.view !== 'audit') return;
  rows = auditRows(entries); problems = pr;
  const areas = [...new Set(rows.map((r) => r.area).filter(Boolean))].sort();
  $('#audArea').innerHTML = `<option value="">All</option>${areas.map((a) => `<option ${F.area === a ? 'selected' : ''}>${h(a)}</option>`).join('')}`;
  $('#audState').innerHTML = !entries.length ? '' : problems.length
    ? `<p class="bad"><b>${problems.length} problem${problems.length === 1 ? '' : 's'} with the audit trail:</b></p><ul>${problems.slice(0, 10).map((p) => `<li>${h(p.message)}</li>`).join('')}</ul>`
    : `<p class="ok-txt">${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} · every entry matches its checksum and follows the one before it ✓</p>`;
  renderRows();
}

function renderRows() {
  const list = $('#audList'); if (!list) return;
  const fr = filterRows(rows, F), n = fr.length;
  if (!rows.length) { list.innerHTML = '<p class="muted">No changes recorded yet. Each change is recorded when it is saved on this device.</p>'; return; }
  list.innerHTML = `<p class="muted small">${n === rows.length ? `${n} change${n === 1 ? '' : 's'}` : `${n} of ${rows.length} changes`}${n > F.shown ? `, newest ${F.shown} shown` : ''}</p>
    <table class="grid aud"><thead><tr><th>When</th><th>By</th><th>Source</th><th>Section</th><th>Item</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${fr.slice(0, F.shown).map((r) => `<tr>
      <td class="nw">${h(new Date(r.at).toLocaleString())}</td><td>${r.by ? h(r.by) : '<span class="muted">this device</span>'}</td>
      <td>${h(SOURCE_LABEL[r.source] || r.source)}${r.note ? `<br><small class="muted">${h(r.note)}</small>` : ''}</td>
      <td>${h(r.area)}</td><td>${h(r.item)}</td><td>${h(r.field)}</td><td${tip(r.before)}>${show(r.before)}</td><td${tip(r.after)}>${show(r.after)}</td></tr>`).join('')}</tbody></table>
    ${n > F.shown ? `<p><button class="btn" data-act="aud-more">Show ${Math.min(PAGE, n - F.shown)} more</button></p>` : ''}`;
}

defineView('audit', viewAudit, afterAudit);

const csvCell = (v) => { const s = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

onAction({
  'aud-more': async () => { F.shown += PAGE; renderRows(); },
  'exp-audit': async () => {
    const fr = filterRows(rows, F);
    const lines = [['When', 'By', 'Source', 'Note', 'Section', 'Item', 'Field', 'Path', 'Before', 'After'], ...fr.map((r) => [new Date(r.at).toISOString(), r.by, SOURCE_LABEL[r.source] || r.source, r.note, r.area, r.item, r.field, r.path || '', r.before, r.after])];
    download(`${fileBase(S.job)}-audit.csv`, '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n'), 'text/csv');
  },
});

onChange([
  { order: 480, when: (el, act) => act === 'aud-area' || act === 'aud-src', run: async (el, e, act) => {
    F[act === 'aud-area' ? 'area' : 'source'] = el.value; F.shown = PAGE; renderRows();
  } },
]);

document.addEventListener('input', (e) => { if (e.target.dataset?.act === 'aud-text') { F.text = e.target.value; F.shown = PAGE; renderRows(); } });
