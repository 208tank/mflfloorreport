// Revisions screen (data integrity stage 8): every revision of the open job — when, why, by whom, its file revision
// and whether its checksum still matches; its report (read-only); a field-by-field comparison of two revisions or of
// one with the job now; and restoring one as a new revision (the job as it is now is kept as a revision first).
import { S } from '../app/state.js';
import { defineView, renderAll } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { commit, flushSave } from '../app/persist.js';
import { addRevision, BOOKKEEPING, isLocked, REASON_LABEL } from '../app/revisions.js';
import { auditSource } from '../app/auditlog.js';
import { api653 } from '../calc.js';
import { db } from '../db.js';
import { buildLayout } from '../geometry.js';
import { migrate } from '../model.js';
import { buildReport } from '../report.js';
import { diffJobs } from '../revdiff.js';
import { $, askConfirm, toast } from '../ui.js';
import { esc as h, sha256 } from '../util.js';

const fmtAt = (t) => new Date(t).toLocaleString();
const byText = (b) => (b ? (b.name ? h(b.name) : '<span class="muted">this device</span>') : '');

function viewRevs() {
  if (!S.job) return '<div class="page"><p class="muted">Open a job to see its revisions.</p></div>';
  return `<div class="page wide">
    <div class="page-head"><div><h1>Revisions</h1><p class="muted">Every saved version of this job on this device: each save to a file, stage change, import, restore, update and a daily checkpoint. Revisions are never changed. Tick two to compare them, or one to compare it with the job as it is now.</p></div>
      <div class="acts"><button class="btn" data-act="rev-compare" id="revCompare" disabled>Compare</button></div></div>
    <section class="card" id="revList"><p class="muted">Loading revisions…</p></section>
    <section class="card" id="revDiff" hidden></section></div>`;
}

async function afterRevs() {
  if (!S.job) return;
  const id = S.job.id, revs = (await db.jobRevisions(id)).sort((a, b) => b.n - a.n);
  if (S.job?.id !== id || S.view !== 'revs') return;
  S.revs = revs;
  const rows = await Promise.all(revs.map(async (r) => {
    const ok = r.hash === (await sha256(r.job));
    return `<tr data-n="${r.n}"><td><input type="checkbox" data-revpick="${r.n}" aria-label="Select revision ${r.n}"></td><td class="n">${r.n}</td><td>${fmtAt(r.at)}</td>
      <td><b>${h(REASON_LABEL[r.reason] || r.reason)}</b>${r.note ? `<br><small class="muted">${h(r.note)}</small>` : ''}</td><td>${byText(r.by)}</td>
      <td>${r.rev ? 'Rev ' + r.rev : '<span class="muted">—</span>'}</td><td>${ok ? '<span class="ok-txt" title="The checksum matches">✓</span>' : '<span class="bad" title="This revision does not match its checksum">Checksum does not match</span>'}</td>
      <td class="acts"><button class="btn sm" data-act="rev-report" data-n="${r.n}">Report</button><button class="btn sm" data-act="rev-restore" data-n="${r.n}" ${ok ? '' : 'disabled'}>Restore</button></td></tr>`;
  }));
  $('#revList').innerHTML = revs.length ? `<table class="grid revs"><thead><tr><th></th><th class="n">No.</th><th>When</th><th>What</th><th>By</th><th>File</th><th>Checksum</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="muted">No revisions yet. One is saved each time the job is saved to a file or changes stage, and once a day while it is being edited.</p>';
}

const picked = () => [...document.querySelectorAll('[data-revpick]:checked')].map((c) => +c.dataset.revpick);
const revOf = (n) => (S.revs || []).find((r) => r.n === n);

function showDiff(a, b, aName, bName) {
  const rows = diffJobs(a, b), el = $('#revDiff');
  el.hidden = false;
  el.innerHTML = `<div class="sp-head"><h2>${h(aName)} → ${h(bName)}</h2><button class="btn sm ghost" data-act="rev-diff-close">Close</button></div>
    ${rows.length ? `<p class="muted small">${rows.length} difference${rows.length === 1 ? '' : 's'}. Values are as stored (lengths in millimetres).</p><table class="grid small"><thead><tr><th>Area</th><th>Item</th><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${h(r.area)}</td><td>${h(r.item)}</td><td>${h(r.field)}</td><td>${h(r.before)}</td><td>${h(r.after)}</td></tr>`).join('')}</tbody></table>` : '<p>No differences in the inspection data.</p>'}`;
  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function showRevReport(r) {
  const job = migrate(structuredClone(r.job)), layout = buildLayout(job), calc = api653(job, layout);
  const photos = (await Promise.all((r.photoIds || []).map((k) => db.getPhoto(k)))).filter(Boolean);
  const missing = (r.photoIds || []).length - photos.length;
  const html = r.issued?.html || buildReport(job, layout, calc, S.company, photos, S.reportOpts);
  const dlg = $('#dlg');
  $('#dlgBody').innerHTML = `<div class="ed-head"><h2>Revision ${r.n} — ${h(REASON_LABEL[r.reason] || r.reason)}, ${fmtAt(r.at)}</h2><button aria-label="Close" type="button" class="btn sm ghost" data-rv="close">✕</button></div>
    <p class="muted small">${r.issued ? 'The report as issued (frozen when the job was marked Complete).' : 'Read-only: the report regenerated from this revision by this version of the app.'}${missing ? ` ${missing} photo${missing === 1 ? ' has' : 's have'} been deleted from this device since and ${missing === 1 ? 'is' : 'are'} not shown.` : ''}</p>
    <div class="rev-report">${html}</div>`;
  $('#dlgBody').querySelector('[data-rv="close"]').onclick = () => { dlg.close(); dlg.classList.remove('wide-dlg'); };
  dlg.classList.add('wide-dlg'); if (!dlg.open) dlg.showModal();
}

/** Bring a revision's inspection data back as the current job (a new revision). The file bookkeeping (revision number,
 *  last file save) stays as it is now, so the next file save continues the numbering. */
async function restoreRevision(r) {
  if (isLocked(S.job)) { toast('This job is Complete and locked. Reopen it to restore an earlier revision.'); return; }
  if (!(await askConfirm(`Restore revision ${r.n} (${REASON_LABEL[r.reason] || r.reason}, ${fmtAt(r.at)})?\n\nThe job’s inspection data goes back to what it was then. The job as it is now is kept as a revision first, so this can be undone.`, { ok: 'Restore' }))) return;
  if (!(await flushSave())) { toast('Nothing was restored: the latest changes could not be saved to this device first.'); return; }
  await addRevision(S.job, 'before-replace', `Before restoring revision ${r.n}`);
  const cur = S.job, job = migrate(structuredClone(r.job));
  for (const k of BOOKKEEPING) { if (cur[k] === undefined) delete job[k]; else job[k] = cur[k]; }
  job.edits = (cur.edits || 0) + 1; job.editAreas = [...new Set([...(cur.editAreas || []), 'Restored revision'])];
  S.job = job; S.photos = await db.jobPhotos(job.id); auditSource('restore', `Revision ${r.n}`); commit(); await flushSave();
  await addRevision(S.job, 'restore', `Restored revision ${r.n} (${REASON_LABEL[r.reason] || r.reason}, ${fmtAt(r.at)})`);
  const gone = (r.photoIds || []).filter((k) => !S.photos.some((p) => p.id === k)).length;
  renderAll();
  toast(`Revision ${r.n} restored.${gone ? ` ${gone} photo${gone === 1 ? '' : 's'} from then ${gone === 1 ? 'has' : 'have'} been deleted from this device and could not be brought back.` : ''}`);
}

defineView('revs', viewRevs, afterRevs);

onAction({
  'rev-report': async (el, id, e, act) => { const r = revOf(+el.dataset.n); if (r) await showRevReport(r); },
  'rev-restore': async (el, id, e, act) => { const r = revOf(+el.dataset.n); if (r) await restoreRevision(r); },
  'rev-compare': async (el, id, e, act) => {
    const p = picked().sort((a, b) => a - b);
    if (p.length === 1) { const r = revOf(p[0]); showDiff(r.job, S.job, `Revision ${r.n}`, 'Now'); }
    else if (p.length === 2) { const a = revOf(p[0]), b = revOf(p[1]); showDiff(a.job, b.job, `Revision ${a.n}`, `Revision ${b.n}`); }
  },
  'rev-diff-close': async (el, id, e, act) => { $('#revDiff').hidden = true; },
});

onChange([
  { order: 470, when: (el, act) => el.matches('[data-revpick]'), run: async (el, e, act) => {
    const p = picked();
    if (p.length > 2) { el.checked = false; toast('Pick one revision (to compare with now) or two.'); return; }
    const b = $('#revCompare'); b.disabled = !p.length; b.textContent = p.length === 2 ? 'Compare the two' : p.length === 1 ? 'Compare with now' : 'Compare';
  } },
]);
