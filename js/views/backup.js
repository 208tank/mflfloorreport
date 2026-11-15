// Backup and restore (data integrity stage 5): "Back up this device" writes one backup file with every job, photo,
// revision and audit entry, the tank registry and the company settings; an optional automatic backup goes to the
// linked jobs folder every N days; "Restore from a backup" checks the file, shows what it holds next to what is on
// this device, and asks job by job when the two differ. The file format is in js/backup.js.
import { APP_VERSION, S } from '../app/state.js';
import { renderAll } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { flushSave, loadJobs, loadTanks, recompute } from '../app/persist.js';
import { BACKUP_TYPES, backupName, backupPieces, entryAsCopy, planRestore, verifyBackup } from '../backup.js';
import { db } from '../db.js';
import { download } from '../export.js';
import { SCHEMA, uid } from '../model.js';
import { $, toast } from '../ui.js';
import { esc as h } from '../util.js';
import { addRevision, whoAmI } from './history.js';

/** S.backup: { last: { at, fileName, where, counts, bytes, hash } | null, days: 0 (off) | N, due: bool }. */
const AUTO_KEEP = 5;
const DAY = 86400000;

export async function loadBackupState() {
  S.backup = { last: (await db.getMeta('backup:last').catch(() => null)) || null, days: (await db.getMeta('backup:days').catch(() => 0)) || 0, due: false };
  return S.backup;
}

const daysSince = (at) => Math.floor((Date.now() - at) / DAY);
const sizeText = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' kB');

export function backupCardHTML() {
  const B = S.backup || { last: null, days: 0 }, L = B.last;
  const lastTxt = L ? `Last backup ${new Date(L.at).toLocaleString()} (${daysSince(L.at) === 0 ? 'today' : daysSince(L.at) + ' day' + (daysSince(L.at) === 1 ? '' : 's') + ' ago'})${L.where === 'folder' ? ' to the jobs folder' : ''}: ${L.counts.jobs} job${L.counts.jobs === 1 ? '' : 's'}, ${L.counts.photos} photo${L.counts.photos === 1 ? '' : 's'}, ${sizeText(L.bytes)}${L.fileName ? ' — ' + h(L.fileName) : ''}.` : 'No backup has been made on this device yet.';
  const opts = [[0, 'Off'], [1, 'Every day'], [7, 'Every 7 days'], [14, 'Every 14 days'], [30, 'Every 30 days']];
  return `<h2>Backups</h2>
    <p class="muted">A backup file holds every job on this device with its photos and saved revisions, the tank registry and these settings. Keep it somewhere other than this computer (OneDrive, a USB stick). Restoring checks the file first and asks before replacing a job that differs.</p>
    <p id="backupLast" class="${B.due ? 'warn-txt' : 'muted'}">${lastTxt}${B.due ? ' An automatic backup is due — reconnect the jobs folder on the Dashboard, or back up now.' : ''}</p>
    <div class="acts"><button class="btn sm primary" data-act="backup-make">Back up this device…</button>
      <label class="btn sm">Restore from a backup…<input type="file" accept=".json,application/json" data-act="backup-restore" hidden></label></div>
    <label class="fld backup-auto"><span class="lbl">Automatic backup to the linked jobs folder</span><span class="ctl"><select data-backup-days>${opts.map(([v, l]) => `<option value="${v}" ${+B.days === v ? 'selected' : ''}>${l}</option>`).join('')}</select></span></label>
    <p class="muted small">Automatic backups go in a <b>_backups</b> folder inside the jobs folder linked on the Dashboard (the newest ${AUTO_KEEP} are kept), when the app starts and a backup is due.</p>`;
}
function refreshBackupCard() { const c = $('#backupCard'); if (c) c.innerHTML = backupCardHTML(); }

/** Everything the backup file holds, read from the device as it is written. */
async function backupSource(at) {
  const cards = await db.allCards();
  return {
    created: at, appVersion: APP_VERSION, schema: SCHEMA, settings: S.company || {}, tanks: (await db.allTanks()).sort((a, b) => String(a.id).localeCompare(String(b.id))),
    jobIds: cards.map((c) => c.id).sort(), getJob: (id) => db.getJob(id), photoKeys: (id) => db.jobPhotoKeys(id), getPhoto: (k) => db.getPhoto(k),
    revisions: (id) => db.jobRevisions(id), audit: (id) => db.jobAudit(id),
  };
}

/**
 * Write a backup. where: 'file' (pick a file; download where the picker isn't available) or 'folder' (the linked
 * jobs folder's _backups subfolder, newest AUTO_KEEP kept). Returns the backup record, or null if cancelled.
 */
export async function makeBackup(where = 'file') {
  if (!(await flushSave())) { toast('The backup was not made: the latest changes could not be saved to this device first.'); return null; }
  const at = Date.now(), name = backupName(at, where === 'folder'), out = {};
  const src = await backupSource(at);
  if (where === 'folder') {
    const sub = await S.dash.dir.getDirectoryHandle('_backups', { create: true });
    const fh = await sub.getFileHandle(name, { create: true }), w = await fh.createWritable();
    try { for await (const c of backupPieces(src, out)) await w.write(c); await w.close(); }
    catch (e) { await w.abort().catch(() => {}); await sub.removeEntry(name).catch(() => {}); throw e; }
    const autos = []; for await (const [n] of sub.entries()) if (/^tfi-backup_auto_.*\.tfibackup\.json$/.test(n)) autos.push(n);
    for (const n of autos.sort().reverse().slice(AUTO_KEEP)) await sub.removeEntry(n).catch(() => {});
  } else if ('showSaveFilePicker' in window && window.self === window.top) {
    let fh;
    try { fh = await window.showSaveFilePicker({ suggestedName: name, id: 'tank-floor-backups', startIn: 'documents', types: BACKUP_TYPES }); }
    catch (e) { if (e.name === 'AbortError') return null; throw e; }
    const w = await fh.createWritable();
    try { for await (const c of backupPieces(src, out)) await w.write(c); await w.close(); }
    catch (e) { await w.abort().catch(() => {}); throw e; }
  } else {
    const parts = []; for await (const c of backupPieces(src, out)) parts.push(c);
    download(name, new Blob(parts, { type: 'application/json' }), 'application/json');
  }
  const rec = { at, fileName: name, where, counts: out.counts, bytes: out.bytes, hash: out.hash };
  await db.setMeta('backup:last', rec);
  S.backup = { ...(S.backup || {}), last: rec, due: false };
  refreshBackupCard();
  return rec;
}

/** At start-up: make the automatic backup if one is due and the linked folder can be written without asking. */
export async function autoBackupIfDue() {
  const B = await loadBackupState();
  if (!(B.days > 0) || (B.last && Date.now() - B.last.at < B.days * DAY)) return;
  const dir = S.dash?.dir || (await db.getMeta('dashDir').catch(() => null));
  let perm = 'denied'; try { perm = dir ? await dir.queryPermission({ mode: 'readwrite' }) : 'denied'; } catch { /* no folder */ }
  if (perm !== 'granted') { S.backup.due = true; refreshBackupCard(); return; }
  S.dash.dir = dir;
  try { const r = await makeBackup('folder'); if (r) toast(`Automatic backup made: ${r.counts.jobs} job${r.counts.jobs === 1 ? '' : 's'} to the jobs folder (_backups).`); }
  catch (e) { S.backup.due = true; refreshBackupCard(); toast('The automatic backup could not be written to the jobs folder: ' + e.message); }
}

/* ---------------------------------------------------------------- restore */

const ACTION_TEXT = { add: 'Add to this device', same: 'Already on this device', keep: 'Keep this device’s copy', replace: 'Replace with the backup copy', both: 'Keep both (backup copy added as a new job)' };

/** Read a backup file, check it, and show the restore preview. Nothing changes until the user confirms. */
export async function restoreFromFile(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast(`${file.name} can’t be restored: it is not a readable backup file. Nothing was changed.`, { label: 'OK', fn: () => {} }); return; }
  const v = await verifyBackup(data, { schema: SCHEMA });
  if (!v.ok) { toast(`${file.name} can’t be restored: ${v.error} Nothing was changed.`, { label: 'OK', fn: () => {} }); return; }
  const device = { jobs: new Map(), tanks: new Map((await db.allTanks()).map((t) => [t.id, t])) };
  for (const e of data.jobs) { const j = await db.getJob(e.job.id); if (j) device.jobs.set(j.id, { job: j, photoIds: new Set(await db.jobPhotoKeys(j.id)) }); }
  const plan = await planRestore(data, device);
  showRestorePreview(file.name, data, v.counts, plan);
}

function showRestorePreview(fileName, data, counts, plan) {
  const dlg = $('#dlg'), I = (j) => j.info || {};
  const row = (p) => {
    const j = p.entry.job, opts = p.status === 'differs' ? ['keep', 'replace', 'both'] : [p.status === 'new' ? 'add' : 'same'];
    const dev = p.status === 'new' ? '<span class="muted">Not on this device</span>' : p.status === 'same' ? 'Same as the backup' : `Differs — ${p.newer === 'backup' ? 'backup copy changed later' : p.newer === 'device' ? 'this device’s copy changed later' : 'changed at the same time'}<br><small class="muted">device ${p.device.rev ? 'Rev ' + p.device.rev + ', ' : ''}${new Date(p.device.updated || p.device.created).toLocaleString()}</small>`;
    return `<tr><td><b>${h(I(j).tankId || 'Untitled')}</b><br><small>${h([I(j).client, I(j).site].filter(Boolean).join(' · '))}</small></td>
      <td>${j.rev ? 'Rev ' + j.rev + '<br>' : ''}<small>${new Date(j.updated || j.created).toLocaleString()}</small><br><small class="muted">${p.entry.photos.length} photo${p.entry.photos.length === 1 ? '' : 's'}, ${p.entry.revisions.length} revision${p.entry.revisions.length === 1 ? '' : 's'}</small></td>
      <td>${dev}</td>
      <td>${opts.length > 1 ? `<select data-rj="${h(p.id)}">${opts.map((o) => `<option value="${o}">${ACTION_TEXT[o]}</option>`).join('')}</select>` : `<span class="muted">${ACTION_TEXT[opts[0]]}</span>`}</td></tr>`;
  };
  const tNew = plan.tanks.filter((t) => t.status === 'new').length, tDiff = plan.tanks.filter((t) => t.status === 'differs');
  const tanksTxt = !plan.tanks.length ? 'No registry tanks in this backup.' : `Tank registry: ${tNew ? `${tNew} new tank${tNew === 1 ? '' : 's'} will be added` : 'no new tanks'}${tDiff.length ? '' : '.'}`;
  const hasCompany = !!(S.company?.name || S.company?.logo);
  $('#dlgBody').innerHTML = `<form class="rs-dlg" method="dialog">
    <div class="ed-head"><h2>Restore from backup</h2><button aria-label="Close" type="button" class="btn sm ghost" data-rs="close">✕</button></div>
    <p class="muted small">${h(fileName)} — made ${new Date(data.created).toLocaleString()}${data.appVersion ? ' by v' + h(data.appVersion) : ''}: ${counts.jobs} job${counts.jobs === 1 ? '' : 's'}, ${counts.photos} photos, ${counts.revisions} revisions, ${counts.tanks} registry tank${counts.tanks === 1 ? '' : 's'}. The checksum matches.</p>
    <table class="grid small"><thead><tr><th>Tank</th><th>In the backup</th><th>On this device</th><th>Restore</th></tr></thead><tbody>${plan.jobs.map(row).join('') || '<tr><td colspan="4" class="empty">No jobs in this backup.</td></tr>'}</tbody></table>
    <p class="small">${tanksTxt}${tDiff.length ? `; ${tDiff.length} differ${tDiff.length === 1 ? 's' : ''} from this device — <label class="chk small"><input type="checkbox" name="tanksReplace"><span>replace ${tDiff.length === 1 ? 'it' : 'them'} with the backup ${tDiff.length === 1 ? 'copy' : 'copies'}</span></label>.` : ''}</p>
    <label class="chk small"><input type="checkbox" name="settings" ${hasCompany ? '' : 'checked'}><span>Also restore the company settings (name, details, logo, footer, inspector name)</span></label>
    <p class="muted small">A job you replace keeps a revision of this device’s copy first, and its saved revisions are kept alongside the backup’s. Each job is restored in one step: if one fails, that job is left as it was.</p>
    <div class="acts end"><button type="button" class="btn" data-rs="close">Cancel</button><button type="button" class="btn primary" data-rs="go">Restore</button></div>
  </form>`;
  const form = $('.rs-dlg', dlg);
  form.onclick = async (e) => {
    const b = e.target.closest('[data-rs]'); if (!b) return;
    if (b.dataset.rs === 'close') { dlg.close(); dlg.classList.remove('wide-dlg'); return; }
    const choice = new Map([...form.querySelectorAll('[data-rj]')].map((s) => [s.dataset.rj, s.value]));
    const opts = { tanksReplace: !!form.tanksReplace?.checked, settings: !!form.settings?.checked };
    dlg.close(); dlg.classList.remove('wide-dlg');
    await applyRestore(fileName, data, plan, choice, opts);
  };
  dlg.classList.add('wide-dlg'); if (!dlg.open) dlg.showModal();
}

async function applyRestore(fileName, data, plan, choice, opts) {
  const act = (p) => (p.status === 'new' ? 'add' : p.status === 'same' ? 'same' : choice.get(p.id) || 'keep');
  // the open job: make sure it is on the device; if the backup replaces it, it is closed (open it again from the list)
  const openId = S.job?.id, touchesOpen = plan.jobs.some((p) => p.id === openId && act(p) === 'replace');
  if (touchesOpen && !(await flushSave())) { toast('Nothing was restored: the open job’s latest changes could not be saved to this device first.'); return; }
  if (touchesOpen) { S.job = null; S.photos = []; recompute(); }
  const done = { add: 0, replace: 0, both: 0 }, failed = [];
  for (const p of plan.jobs) {
    const a = act(p); if (a === 'same' || a === 'keep') continue;
    try {
      if (a === 'replace') { await addRevision(p.device, 'before-replace', `Before restoring from backup ${fileName}`); await db.restoreJob(p.entry, { replace: true }); }
      else if (a === 'both') await db.restoreJob(entryAsCopy(p.entry, { job: uid(), photo: () => uid() }));
      else await db.restoreJob(p.entry);
      done[a]++;
    } catch (e) { failed.push(`${p.entry.job.info?.tankId || p.id} (${e.message})`); }
  }
  for (const t of plan.tanks) if (t.status === 'new' || (t.status === 'differs' && opts.tanksReplace)) await db.putTank(t.tank);
  if (opts.settings && data.settings) { S.company = { ...data.settings }; await db.setMeta('company', S.company); }
  await db.addImport({ at: Date.now(), by: await whoAmI(), kind: 'backup', fileName, hash: data.hash, jobId: null, result: failed.length ? 'partial' : 'ok', counts: { ...done, failed: failed.length }, decisions: plan.jobs.map((p) => ({ id: p.id, action: act(p) })) }).catch(() => {});
  await loadJobs(); await loadTanks();
  renderAll();
  const n = done.add + done.replace + done.both;
  const closed = touchesOpen ? ' The open job was replaced, so it was closed: open it again from the list.' : '';
  toast((failed.length ? `Restored ${n} job${n === 1 ? '' : 's'}. Not restored (left as they were): ${failed.join('; ')}.` : n ? `Restored ${n} job${n === 1 ? '' : 's'} from the backup${done.replace ? ` (${done.replace} replaced)` : ''}.` : 'Nothing needed restoring: the jobs on this device already match the backup.') + closed, { label: 'OK', fn: () => {} });
}

onAction({
  'backup-make': async (el, id, e, act) => {
    try { const r = await makeBackup('file'); if (r) toast(`Backup saved: ${r.counts.jobs} job${r.counts.jobs === 1 ? '' : 's'}, ${r.counts.photos} photo${r.counts.photos === 1 ? '' : 's'} (${sizeText(r.bytes)}).`); }
    catch (err) { toast('The backup could not be written: ' + err.message); }
  },
});

onChange([
  { order: 450, when: (el, act) => act === 'backup-restore', run: async (el, e, act) => {
    const f = el.files[0]; el.value = ''; if (f) await restoreFromFile(f);
  } },
  { order: 460, when: (el, act) => el.matches('[data-backup-days]'), run: async (el, e, act) => {
    const d = +el.value || 0; await db.setMeta('backup:days', d); S.backup = { ...(S.backup || {}), days: d };
    if (d) await autoBackupIfDue(); else { S.backup.due = false; refreshBackupCard(); }
  } },
]);
