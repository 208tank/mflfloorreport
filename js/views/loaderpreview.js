// Excel loader preview (data integrity stage 10): every reading in a returned loader sheet against the job, with a
// decision for each. Nothing is written until Apply. A sheet value that differs from a verified measurement is a
// conflict and needs a choice; Apply stays disabled until each one has one. On Apply: a before-replace revision,
// the readings, audit entries (source: loader sheet) and an imports record with every decision.
import { S } from '../app/state.js';
import { commit, flushSave } from '../app/persist.js';
import { renderAll } from '../app/nav.js';
import { addRevision, whoAmI } from '../app/revisions.js';
import { auditSource } from '../app/auditlog.js';
import { db } from '../db.js';
import { defaultDecisions, LOADER_STATUS, readLoader } from '../loader.js';
import { $, askConfirm, toast } from '../ui.js';
import { fmt, u } from '../units.js';
import { esc as h } from '../util.js';

/** Stages at which every reading in the job counts as verified (decision 1 (a)). */
const VERIFIED_STAGES = new Set(['review', 'admin', 'complete']);

async function bytesHash(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** A reading is verified if the job is at Peer review or Complete, or if this value was in a revision saved to a job
 *  file. */
async function verifier(job) {
  if (VERIFIED_STAGES.has(job.status?.stage)) return () => true;
  const saved = (await db.jobRevisions(job.id).catch(() => [])).filter((r) => r.reason === 'file-save' && r.job);
  const same = (a, b) => (typeof a === 'number' || typeof b === 'number' ? a !== null && b !== null && a !== undefined && b !== undefined && Math.abs(+a - +b) < 1e-6 : String(a ?? '') === String(b ?? '') && a !== '' && a != null);
  return (it) => saved.some((r) => { try { return same(it.get(r.job), it.old); } catch { return false; } });
}

const showVal = (it, v) => (v === null || v === undefined || v === '' ? '<span class="muted">—</span>' : it.kind === 'num' && typeof v === 'number' ? h(fmt(v, 't', S.job)) : h(String(v)));

/** Read the sheet, show the preview, apply what was decided. */
export async function previewLoader(file) {
  let res, buf;
  try { buf = await file.arrayBuffer(); res = await readLoader(S.job, buf, { verified: await verifier(S.job) }); }
  catch (err) { toast('Could not read the loader sheet: ' + err.message); return; }
  const hash = await bytesHash(buf);
  const past = (await db.importsByHash(hash).catch(() => [])).filter((r) => r.kind === 'loader' && r.jobId === S.job.id && r.result === 'applied');
  const items = res.items, dec = defaultDecisions(items);
  const count = (st) => items.filter((it) => it.status === st).length;
  const toDecide = items.filter((it) => ['new', 'changed', 'conflict'].includes(it.status));
  const record = async (result, applied = 0) => db.addImport({
    at: Date.now(), by: await whoAmI().catch(() => null), kind: 'loader', fileName: file.name, hash, jobId: S.job.id, result,
    counts: Object.fromEntries(Object.keys(LOADER_STATUS).map((k) => [k, count(k)])), applied,
    decisions: result === 'applied' ? items.filter((it) => it.status !== 'same').map((it) => ({ id: it.id, where: it.where, status: it.status, decision: dec.get(it.id) || 'skip', old: it.old, value: it.value })) : [],
  }).catch(() => {});

  if (!toDecide.length) {
    toast(`${file.name}: no new or changed readings${count('unreadable') ? ` (${count('unreadable')} cell${count('unreadable') > 1 ? 's' : ''} could not be read)` : ''}${past.length ? ' — this sheet was loaded before.' : '.'}`);
    record('nothing-to-apply'); return;
  }

  const dlg = $('#dlg'), body = $('#dlgBody');
  let showSame = false;
  const U = u(S.job);
  const conflicts = items.filter((it) => it.status === 'conflict');
  const areas = [...new Set(items.filter((it) => ['new', 'changed', 'same'].includes(it.status)).map((it) => it.area))];
  const applyCount = () => items.filter((it) => dec.get(it.id) === 'sheet').length;
  const undecided = () => conflicts.filter((it) => !dec.get(it.id)).length;

  const draw = () => {
    const plural = { conflict: 'conflicts', unreadable: 'unreadable' };
    const pills = Object.entries(LOADER_STATUS).filter(([k]) => count(k)).map(([k, l]) => `<span class="lp-pill st-${k}">${count(k)} ${h(count(k) > 1 && plural[k] ? plural[k] : l.toLowerCase())}</span>`).join(' ');
    body.innerHTML = `<div class="ed-head"><h2>Loader sheet: ${h(file.name)}</h2><button aria-label="Close" type="button" class="btn sm ghost" data-lp="cancel">✕</button></div>
      <div class="lp">
      ${res.jobMatch ? '' : `<p class="warn-txt">This sheet was made for ${h(res.info.tank || 'another tank')} (a different job). Readings are matched by ID, so only items in this job can be updated.</p>`}
      ${res.info.tech ? `<p class="muted">UT technician: ${h(res.info.tech)}${res.info.date ? ' · ' + h(res.info.date) : ''} · thicknesses in ${h(U.small)}</p>` : ''}
      ${past.length ? `<p class="lp-seen">This sheet was loaded on ${h(new Date(past.at(-1).at).toLocaleString())}. Only what still differs from the job is listed.</p>` : ''}
      <p>${pills}</p>
      <p class="muted small">Nothing changes until you press Apply. Blank cells never erase a reading. A <b>conflict</b> is a sheet value that differs from a verified reading (the job is at Peer review or Complete, or the reading was in a saved job file): choose for each one.</p>
      ${conflicts.length ? `<h3>Conflicts <span class="muted small">(${undecided() ? `${undecided()} to decide` : 'all decided'})</span></h3>
        <table class="grid lp-t"><thead><tr><th>Reading</th><th>Verified on this job</th><th>In the sheet</th><th>Decision</th></tr></thead><tbody>${conflicts.map((it) => `<tr class="${dec.get(it.id) ? '' : 'undecided'}"><td>${h(it.where)}</td><td>${showVal(it, it.old)}</td><td>${showVal(it, it.value)}</td>
          <td><select data-lp-dec="${h(it.id)}" aria-label="Decision for ${h(it.where)}"><option value="" ${dec.get(it.id) ? '' : 'selected'}>Choose…</option><option value="keep" ${dec.get(it.id) === 'keep' ? 'selected' : ''}>Keep this job’s reading</option><option value="sheet" ${dec.get(it.id) === 'sheet' ? 'selected' : ''}>Use the sheet</option><option value="skip" ${dec.get(it.id) === 'skip' ? 'selected' : ''}>Skip for now</option></select></td></tr>`).join('')}</tbody></table>
        <p><button type="button" class="btn sm" data-lp="all-keep">Keep all this job’s readings</button> <button type="button" class="btn sm" data-lp="all-sheet">Use the sheet for all conflicts…</button></p>` : ''}
      ${areas.map((a) => {
        const rows = items.filter((it) => it.area === a && (it.status === 'new' || it.status === 'changed' || (showSame && it.status === 'same')));
        if (!rows.length) return '';
        return `<h3>${h(a)}</h3><table class="grid lp-t"><thead><tr><th class="c">Use</th><th>Reading</th><th>On this job</th><th>In the sheet</th><th>Status</th></tr></thead><tbody>${rows.map((it) => `<tr class="st-${it.status}">
          <td class="c">${it.status === 'same' ? '' : `<input type="checkbox" data-lp-use="${h(it.id)}" ${dec.get(it.id) === 'sheet' ? 'checked' : ''} aria-label="Use the sheet for ${h(it.where)}">`}</td>
          <td>${h(it.where)}</td><td>${showVal(it, it.old)}</td><td>${showVal(it, it.value)}</td><td>${h(LOADER_STATUS[it.status])}</td></tr>`).join('')}</tbody></table>`;
      }).join('')}
      ${count('same') ? `<p><button type="button" class="btn sm ghost" data-lp="same">${showSame ? 'Hide' : 'Show'} ${count('same')} reading${count('same') === 1 ? '' : 's'} that match the job</button></p>` : ''}
      ${count('unmatched') || count('unreadable') ? `<h3>Not used</h3><ul class="lp-skip">${items.filter((it) => it.status === 'unmatched').map((it) => `<li><b>Not in this job</b> · ${h(it.area)}: ${h(it.where)}</li>`).join('')}${items.filter((it) => it.status === 'unreadable').map((it) => `<li><b>Unreadable</b> · ${h(it.message || it.where)}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="acts lp-acts"><span class="muted small" id="lpWhy">${undecided() ? `Decide ${undecided()} conflict${undecided() === 1 ? '' : 's'} to apply.` : ''}</span>
        <button type="button" class="btn" data-lp="cancel">Cancel</button>
        <button type="button" class="btn primary" data-lp="apply" ${undecided() || !applyCount() ? 'disabled' : ''}>Apply ${applyCount()} reading${applyCount() === 1 ? '' : 's'}</button></div>`;
  };

  const result = await new Promise((resolve) => {
    draw();
    const done = (v) => { dlg.onclick = null; dlg.onchange = null; dlg.onclose = null; if (dlg.open) dlg.close(); dlg.classList.remove('wide-dlg'); resolve(v); };
    dlg.onchange = (e) => {
      const t = e.target;
      if (t.dataset.lpDec !== undefined) { dec.set(t.dataset.lpDec, t.value); draw(); }
      else if (t.dataset.lpUse !== undefined) { dec.set(t.dataset.lpUse, t.checked ? 'sheet' : 'keep'); draw(); }
    };
    dlg.onclick = async (e) => {
      const b = e.target.closest('[data-lp]'); if (!b || b.disabled) return;
      const a = b.dataset.lp;
      if (a === 'cancel') done(false);
      else if (a === 'apply') done(true);
      else if (a === 'same') { showSame = !showSame; draw(); }
      else if (a === 'all-keep') { conflicts.forEach((it) => dec.set(it.id, 'keep')); draw(); }
      else if (a === 'all-sheet') {
        const ok = await askConfirm(`Replace ${conflicts.length} verified reading${conflicts.length === 1 ? '' : 's'} with the sheet’s values?\n\nThese readings were verified (the job is at Peer review or Complete, or they were in a saved job file). The values they replace are kept in a revision and in the audit trail.`, { ok: `Use the sheet for all ${conflicts.length}`, danger: true });
        if (ok) conflicts.forEach((it) => dec.set(it.id, 'sheet'));
        draw();
      }
    };
    dlg.onclose = () => done(false);
    dlg.classList.add('wide-dlg'); if (!dlg.open) dlg.showModal();
  });

  if (!result) { record('cancelled'); return; }
  if (!(await flushSave())) { toast('Nothing was updated: the latest changes could not be saved to this device first.'); return; }
  await addRevision(S.job, 'before-replace', `Before loading ${file.name}`).catch((e) => console.warn('Revision', e));
  auditSource('loader', file.name); // stage 9: the changes are logged as coming from the sheet
  const n = res.apply(dec);
  S.job.utLoads = [...(S.job.utLoads || []), { at: Date.now(), file: file.name, count: n, tech: res.info.tech || '' }].slice(-50);
  commit(); await flushSave(); renderAll();
  await record('applied', n);
  toast(`Updated ${n} reading${n === 1 ? '' : 's'} from ${file.name}.`);
}
