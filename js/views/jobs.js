// Jobs screen and Settings: the job list, new / demo / open / duplicate / delete, company and device settings;
// opening and creating a job (refactoring step 14).
import { APP_VERSION, S } from '../app/state.js';
import { after, defineView, go, renderAll, renderView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { appReload, changesText, checkStorage, fileChanges, leaveJobOk, loadJobs, recompute, scheduleSave } from '../app/persist.js';
import { afterStorage, storageCardHTML } from './storage.js';
import { renderHeader } from '../app/header.js';
import { resizeImage } from '../app/images.js';
import { addRevision } from '../app/revisions.js';
import { logChange, setAuditBase } from '../app/auditlog.js';
import { indCount } from '../cards.js';
import { HF_DEFAULTS, HF_TOKENS, hfOf, hfPreview, hfVals } from '../report/frame.js';
import { db, requestPersistence } from '../db.js';
import { makeDemo } from '../demo.js';
import { pendingSteps } from '../migrations.js';
import { copyPhotos, migrate, migrationNotes, newJob, SCHEMA, uid } from '../model.js';
import { $, askConfirm, toast } from '../ui.js';
import { esc as h } from '../util.js';
import { backupCardHTML } from './backup.js';
import { integrityHTML, renderIntegrity } from './history.js';
import { smallMaxText } from './small.js';

function viewJobs() {
  // the open job's card may lag behind its latest change: show the open job's own values
  const rows = S.jobs.map((c) => (S.job?.id === c.id ? { ...c, rev: S.job.rev, savedAt: S.job.savedAt, updated: S.job.updated, edits: S.job.edits, editAreas: S.job.editAreas } : c)).map((j) => `<tr class="${S.job?.id === j.id ? 'cur' : ''}">
    <td><b>${h(j.info?.tankId || 'Untitled')}</b><br><small>${h(j.info?.reportNo || '')}</small></td>
    <td>${h(j.info?.client)}<br><small>${h(j.info?.site)}</small></td>
    <td>${h(j.info?.inspDate)}</td><td class="n">${indCount(j)}</td>
    <td>${j.rev ? `<b>Rev ${j.rev}</b><br><small>saved ${new Date(j.savedAt).toLocaleString()}</small>${(() => { const c = fileChanges(j); return c.n || !c.known ? `<br><small class="warn-txt" title="${h(c.areas.join(', '))}">${changesText(c)} not in the file</small>` : ''; })()}` : (fileChanges(j).n ? `<small class="warn-txt">not saved to a file · ${changesText(fileChanges(j))}</small>` : '<small class="muted">not saved to a file</small>')}</td>
    <td><small>${new Date(j.updated || j.created).toLocaleString()}</small></td>
    <td class="acts"><button class="btn sm primary" data-act="job-open" data-id="${j.id}">Open</button>
      <button class="btn sm" data-act="job-dup" data-id="${j.id}">Duplicate</button>
      <button class="btn sm" data-act="job-save" data-id="${j.id}">Save file</button>
      <button class="btn sm danger ghost" data-act="job-del" data-id="${j.id}">Delete</button></td></tr>`).join('');
  const c = S.company;
  return `<div class="page">
    <div class="page-head"><div><h1>Inspection jobs</h1><p class="muted">Each job is one tank floor. Jobs are kept in this browser and work offline. Use <b>Save file</b> to put a job in OneDrive (or any shared folder), and <b>Open job file</b> to load it on another computer.</p></div>
      <div class="acts"><button class="btn primary" data-act="job-new">New job</button><button class="btn" data-act="job-demo">Load demo tank</button>
      <button class="btn" data-act="job-open-file">Open job file…</button>
      <input type="file" id="openFileInput" accept=".json,application/json" data-act="job-import" hidden></div></div>
    <div class="card"><table class="grid jobs"><thead><tr><th>Tank</th><th>Client / site</th><th>Date</th><th>Ind.</th><th>Revision</th><th>Last changed</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty">No jobs yet. Start a new job or load the demo tank.</td></tr>'}</tbody></table></div>
    <div class="grid2">
      <section class="card"><h2>Report header</h2><p class="muted">Shown on every report from this device.</p>
        <label class="fld"><span class="lbl">Company name</span><span class="ctl"><input data-cb="name" value="${h(c.name)}"></span></label>
        <label class="fld"><span class="lbl">Details (address, phone, certification)</span><span class="ctl"><textarea data-cb="details" rows="3">${h(c.details)}</textarea></span></label>
        <label class="fld"><span class="lbl">Report footer note</span><span class="ctl"><input data-cb="footer" value="${h(c.footer)}"></span></label>
        <label class="fld"><span class="lbl">Report page size</span><span class="ctl"><select data-cb="pageSize"><option value="letter" ${c.pageSize !== 'a4' ? 'selected' : ''}>Letter (8.5 × 11 in)</option><option value="a4" ${c.pageSize === 'a4' ? 'selected' : ''}>A4 (210 × 297 mm)</option></select></span></label>
        <div class="logo-row">${c.logo ? `<img src="${c.logo}" alt="logo">` : '<span class="muted">No logo</span>'}
          <label class="btn sm">Choose logo<input type="file" accept="image/*" data-act="logo" hidden></label>${c.logo ? '<button class="btn sm ghost" data-act="logo-clear">Remove</button>' : ''}</div>
      </section>
      <section class="card"><h2>This device</h2>
        <label class="fld"><span class="lbl">Inspector name on this device</span><span class="ctl"><input data-cb="inspector" value="${h(c.inspector || '')}" placeholder="Recorded with each saved revision and change"></span></label>
        <label class="fld"><span class="lbl">Suggest the small tank report below diameter</span><span class="ctl"><input data-smallmax value="${h(smallMaxText())}" placeholder="40 ft"></span><small>For new jobs; type feet, or add m / mm.</small></label>
        <p class="muted small" id="migInfo"></p>
        <div class="integrity"><div class="acts"><button class="btn sm" data-act="integrity-run">Check data on this device</button><span class="muted small" id="integrityLast"></span></div><div id="integrityRes">${integrityHTML()}</div></div>
        <p class="muted">Install the app from the browser's address bar (or the Install button above) so it opens full-window and works without a connection.</p>
      </section>
    </div>
    <section class="card" id="hfCard">${hfCardHTML()}</section>
    <section class="card" id="storageCard">${storageCardHTML()}</section>
    <section class="card" id="backupCard">${backupCardHTML()}</section></div>`;
}
const afterJobs = async () => {
  if (!S.integrity) { const last = await db.getMeta('integrity:last').catch(() => null); const l = $('#integrityLast'); if (l && last) l.textContent = `Last checked ${new Date(last.at).toLocaleString()}: ${last.n ? last.n + ' problem' + (last.n > 1 ? 's' : '') : 'no problems'}`; } else renderIntegrity();
  try {
    const log = await db.migrationLog(), mi = $('#migInfo');
    if (mi) { const last = log.filter((x) => x.kind === 'db').at(-1), errs = log.filter((x) => x.kind === 'job-error'); mi.textContent = `Database version ${last?.to ?? '—'}${last ? ` (upgraded ${new Date(last.at).toLocaleDateString()})` : ''} · ${log.filter((x) => x.kind === 'job').length} job updates logged${errs.length ? ` · ${errs.length} job update${errs.length > 1 ? 's' : ''} failed` : ''}.`; }
  } catch { /* history not available */ }
  await afterStorage(); // stage 12: the storage panel
};

export async function openJob(id, view = 'map') {
  if (S.job && S.job.id !== id && !(await leaveJobOk())) return;
  const j = await db.getJob(id);
  if (!j) return toast('Job not found');
  const notes = migrationNotes(j), steps = pendingSteps(j).length, log = [];
  let mj;
  try {
    if (steps) await addRevision(j, 'migration', `Before migration from schema ${j.schema || 1} to ${SCHEMA}`);
    mj = migrate(j, { log, appVersion: APP_VERSION });
  } catch (e) {
    // the stored job is untouched (migrate works on a copy); record the failure and don't open it
    await db.logMigrations([{ kind: 'job-error', jobId: id, from: j.schema || 1, to: SCHEMA, at: Date.now(), app: APP_VERSION, error: String(e.message || e) }]).catch(() => {});
    return toast(`This job could not be updated to the current version (${e.message}). It has not been changed; save a backup and report the problem.`);
  }
  if (log.length) db.logMigrations(log).catch(() => {});
  // stage 9: log what the update changed (the migrated job is saved by the first write after opening)
  if (steps) await logChange(id, j, mj, 'migration', `Updated from schema ${j.schema || 1} to ${SCHEMA}`).catch((e) => console.warn('Audit', e));
  S.job = mj; setAuditBase(mj);
  S.photos = await db.jobPhotos(id);
  const fh = await db.getMeta('fh:' + id).catch(() => null);
  S.fileName = fh?.name || null;
  S.sel = S.selPlate = S.selFeature = null; S.mode = 'select'; S.vb = null;
  recompute();
  await db.setMeta('lastJob', id);
  go(S.job.tank.diameter ? view : 'setup');
  if (notes.length) { scheduleSave(); showMigrationNotes(notes); }
}

export function showMigrationNotes(notes) { toast('This job was updated from an older version of the app. ' + notes.join(' '), { label: 'OK', fn: () => {} }); }

export async function createJob(job) {
  await db.putJob(job);
  checkStorage();
  await loadJobs();
  await openJob(job.id, job.tank.diameter ? 'map' : 'setup');
}

defineView('jobs', viewJobs, afterJobs);

onAction({
  'job-new': async (el, id, e, act) => {
    { const j = newJob(); return createJob(j); }
  },
  'job-demo': async (el, id, e, act) => {
    { const j = makeDemo(); return createJob(j); }
  },
  'job-open': async (el, id, e, act) => {
    return openJob(id);
  },
  'job-dup': async (el, id, e, act) => {
    {
      const j = migrate(await db.getJob(id)); const old = j.id;
      j.id = uid(); j.created = j.updated = Date.now(); j.info.tankId = (j.info.tankId || 'Tank') + ' (copy)';
      await db.replaceJob(j, copyPhotos(j, await db.jobPhotos(old)));
      await loadJobs(); renderView(); toast('Job duplicated'); return;
    }
  },
  'job-del': async (el, id, e, act) => {
    {
      const j = S.jobs.find((x) => x.id === id);
      if (!(await askConfirm(`Delete ${j?.info?.tankId || 'this job'} and its photos from this device? This cannot be undone.`, { ok: 'Delete job', danger: true }))) return;
      await db.deleteJob(id); if (S.job?.id === id) { S.job = null; recompute(); }
      await loadJobs(); renderAll(); return;
    }
  },
  'logo-clear': async (el, id, e, act) => {
    S.company.logo = null; await db.setMeta('company', S.company); renderView(); return;
  },
  'app-reload': async (el, id, e, act) => {
    return appReload();
  },
  'persist': async (el, id, e, act) => {
    { const ok = await requestPersistence(); toast(ok ? 'Storage is now persistent.' : 'The browser did not grant persistent storage (installing the app usually helps).'); after.jobs(); return; }
  },
  'install': async (el, id, e, act) => {
    { if (S.installEvt) { S.installEvt.prompt(); await S.installEvt.userChoice; S.installEvt = null; renderHeader(); } return; }
  }
});

onChange([
  { order: 270, when: (el, act) => el.matches('[data-cb]'), run: async (el, e, act) => {
    { S.company[el.dataset.cb] = el.value; await db.setMeta('company', S.company); return; }
  } },
  { order: 420, when: (el, act) => act === 'logo', run: async (el, e, act) => {
    { const f = el.files[0]; if (!f) return; S.company.logo = await resizeImage(f, 600, 'image/png'); await db.setMeta('company', S.company); renderView(); return; }
  } }
]);

/* ---- report page header and footer (company settings) ---- */
function hfCardHTML() {
  const o = hfOf(S.company), f = (k, lbl) => `<label class="fld"><span class="lbl">${lbl}</span><span class="ctl"><input data-hf="${k}" value="${h(o[k])}" placeholder="(blank)"></span></label>`;
  return `<h2>Report page header and footer</h2>
    <p class="muted">Printed at the top and bottom of every report page (not the cover). Type text and placeholders; a part between <b>·</b> separators whose placeholders are all empty is left out.</p>
    <div class="hf-grid"><div class="hf-row"><b>Header</b>${f('hl', 'Left')}${f('hc', 'Centre')}${f('hr', 'Right')}</div>
      <div class="hf-row"><b>Footer</b>${f('fl', 'Left')}${f('fc', 'Centre')}${f('fr', 'Right')}</div></div>
    <div class="hf-opts">
      <label class="fld"><span class="lbl">Logo in the header</span><span class="ctl"><select data-hf="logo">${[['none', 'No logo'], ['left', 'Left'], ['centre', 'Centre'], ['right', 'Right']].map(([v, l]) => `<option value="${v}" ${o.logo === v ? 'selected' : ''}>${l}</option>`).join('')}</select></span></label>
      <label class="fld"><span class="lbl">Colour</span><span class="ctl"><input type="color" data-hf="color" value="${h(o.color)}"></span></label>
      <label class="fld"><span class="lbl">Text size (pt)</span><span class="ctl"><input type="number" min="6" max="11" step="0.5" data-hf="size" value="${o.size}"></span></label>
      <label class="chk"><input type="checkbox" data-hf="rule" ${o.rule ? 'checked' : ''}> Rule lines under the header and over the footer</label>
      <button class="btn sm ghost" data-act="hf-reset">Reset to default</button></div>
    ${o.logo !== 'none' && !S.company.logo ? '<p class="warn small">Choose a logo under Report header to show it.</p>' : ''}
    <p class="muted small">Placeholders: ${HF_TOKENS.map(([k, l]) => `<code>{${k}}</code> ${l}`).join(' · ')}</p>
    <div id="hfPreview">${hfPreviewHTML()}</div>`;
}
function hfPreviewHTML() {
  const o = hfOf(S.company), sample = { client: 'Client', site: 'Site', tank: 'TK-101', report: 'R-001', rev: 'Rev 2 · 2026-11-15', date: '2026-11-15', inspector: 'Inspector' };
  const vals = S.job ? hfVals(S.job, S.company) : { ...hfVals(null, S.company), ...sample };
  const [[hl, hc, hr], [fl, fc, fr]] = hfPreview(S.company, vals);
  const logo = (pos) => (o.logo === pos && S.company.logo ? `<img src="${S.company.logo}" alt="">` : '');
  const st = `color:${o.color};font-size:${o.size}pt`, rule = (side) => (o.rule ? `border-${side}:1px solid ${o.color}` : '');
  return `<div class="hf-prev"><div class="hf-pv-band" style="${st};${rule('bottom')}"><span>${logo('left')}${h(hl)}</span><span>${logo('centre')}${h(hc)}</span><span>${logo('right')}${h(hr)}</span></div>
    <div class="hf-pv-body">Report page${S.job ? ` — preview uses ${h(S.job.info?.tankId || 'the open job')}` : ' — sample values'}</div>
    <div class="hf-pv-band" style="${st};${rule('top')}"><span>${h(fl)}</span><span>${h(fc)}</span><span>${h(fr)}</span></div></div>`;
}
async function saveHF(key, value) {
  S.company.hf = { ...(S.company.hf || {}), [key]: value, logoV38: true };
  await db.setMeta('company', S.company);
}
document.addEventListener('input', (e) => {
  const k = e.target.dataset?.hf; if (!k || e.target.type === 'checkbox' || e.target.tagName === 'SELECT') return;
  S.company.hf = { ...(S.company.hf || {}), [k]: k === 'size' ? +e.target.value : e.target.value, logoV38: true };
  const p = document.getElementById('hfPreview'); if (p) p.innerHTML = hfPreviewHTML();
});
onChange([
  { order: 272, when: (el) => el.matches('[data-hf]'), run: async (el) => {
    const k = el.dataset.hf;
    await saveHF(k, el.type === 'checkbox' ? el.checked : k === 'size' ? +el.value : el.value);
    const c = document.getElementById('hfCard'); if (c && (k === 'logo' || el.type === 'checkbox')) c.innerHTML = hfCardHTML(); else { const p = document.getElementById('hfPreview'); if (p) p.innerHTML = hfPreviewHTML(); }
  } }
]);
onAction({
  'hf-reset': async () => { delete S.company.hf; await db.setMeta('company', S.company); const c = document.getElementById('hfCard'); if (c) c.innerHTML = hfCardHTML(); },
});
void HF_DEFAULTS;
