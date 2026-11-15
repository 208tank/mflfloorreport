// Job files (save, save as, open, import), CSV / SVG / PNG exports and the UT Excel loader buttons
// (refactoring step 13).
import { APP_VERSION, S } from '../app/state.js';
import { renderAll, renderView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { checkStorage, commit, fileChanges, flushSave, loadJobs, loadTanks, saver, writeNow } from '../app/persist.js';
import { renderHeader } from '../app/header.js';
import { db } from '../db.js';
import { download, fileBase, indicationsCSV, nozzlesCSV, platesCSV, roofCSV, settleCSV, shellCSV, svgForExport, svgToPng } from '../export.js';
import { itemFloor } from '../geometry.js';
import { buildLoader, loaderAreas, readLoader } from '../loader.js';
import { renderMapSVG } from '../map.js';
import { copyPhotos, FILE_VERSION, migrationNotes, SCHEMA, uid } from '../model.js';
import { saveErrorText } from '../saver.js';
import { allDefs, numberDefs } from '../sections.js';
import { rolloutSVG, SHELL_SVG_STYLE } from '../shell.js';
import { $, askChoice, askConfirm, toast } from '../ui.js';
import { validateJobFile } from '../validate.js';
import { whoAmI } from './history.js';
import { openJob, showMigrationNotes } from './jobs.js';

/* Job files: one .json file per job (data + photos) that can live in OneDrive, SharePoint, a USB stick…
   Chrome / Edge write straight to the chosen file and remember it, so later saves update the same file.
   Other browsers download a copy instead. */
const FILE_TYPES = [{ description: 'Tank floor inspection', accept: { 'application/json': ['.json'] } }];
const canPick = () => 'showSaveFilePicker' in window && window.self === window.top;

/** Build the file for the next revision without changing the stored job yet.
 *  The file is produced in pieces (header + job, then one photo at a time, then the rest) so a job with
 *  hundreds of photos never needs one huge string in memory. The bytes are exactly what
 *  JSON.stringify({ format, version, saved, rev, job, photos, tank?, appVersion }) gives. */
async function jobFile(id) {
  // never write a file from stale data: every change must be on the device first
  if (S.job?.id === id && !(await flushSave())) throw Object.assign(new Error(`your latest changes could not be saved to this device (${saveErrorText(saver.error)})`), { name: 'NotSavedError' });
  const stored = await db.getJob(id); const keys = await db.jobPhotoKeys(id);
  const at = Date.now();
  const stamp = { rev: (stored.rev || 0) + 1, savedAt: at };
  const job = { ...stored, ...stamp, updated: at, edits: 0, editAreas: [], revisions: [...(stored.revisions || []), { rev: stamp.rev, at }].slice(-100) };
  // what the file contains: the stored job as read here. applyStamp keeps counting anything changed after it.
  const counted = { edits: stored.edits || 0, updated: stored.updated || 0 };
  const tank = stored.tankRef ? await db.getTank(stored.tankRef).catch(() => null) : null;
  const head = JSON.stringify({ format: 'tank-floor-inspector', version: FILE_VERSION, saved: new Date(at).toISOString(), rev: stamp.rev }).slice(0, -1) + ',"job":' + JSON.stringify(job) + ',"photos":[';
  const tail = ']' + (tank ? ',"tank":' + JSON.stringify(tank) : '') + ',"appVersion":' + JSON.stringify(APP_VERSION) + '}';
  async function* chunks() {
    yield head;
    let first = true;
    for (const k of keys) {
      const p = await db.getPhoto(k); if (!p) continue;
      yield (first ? '' : ',') + JSON.stringify(p); first = false;
    }
    yield tail;
  }
  return { job, stamp, chunks, counted };
}

/** After a successful save, record the new revision on the stored job (and the open one). */
async function applyStamp(id, job, counted = { edits: 0, updated: 0 }) {
  // changes made while the file was being written are not in it: keep counting them
  const keep = (cur) => {
    const later = Math.max(0, (cur.edits || 0) - counted.edits), after = (cur.updated || 0) > counted.updated;
    return { rev: job.rev, savedAt: job.savedAt, updated: after ? cur.updated : job.updated, revisions: job.revisions, edits: after ? Math.max(later, 1) : 0, editAreas: after ? cur.editAreas || [] : [] };
  };
  if (S.job?.id === id) {
    Object.assign(S.job, keep(S.job));
    await writeNow(); renderHeader();
  } else {
    const stored = await db.getJob(id);
    await db.putJob({ ...stored, ...keep(stored) });
  }
  await loadJobs();
  if (S.view === 'jobs') renderView();
}

const unsavedSinceRev = (j) => { const c = fileChanges(j); return !!j?.rev && (c.n > 0 || !c.known); };

async function fileHandle(id, write) {
  const hnd = await db.getMeta('fh:' + id).catch(() => null);
  if (!hnd) return null;
  const mode = { mode: write ? 'readwrite' : 'read' };
  try {
    if ((await hnd.queryPermission(mode)) === 'granted' || (await hnd.requestPermission(mode)) === 'granted') return hnd;
  } catch { /* handle no longer valid */ }
  return null;
}

/** Remember the file a job lives in. synced = the job on this device now matches that file's content
 *  (just saved or just opened), so a later save can skip re-reading it if nobody has changed it since. */
export async function rememberFile(id, hnd, synced) {
  await db.setMeta('fh:' + id, hnd);
  if (synced) { try { const f = await hnd.getFile(); await db.setMeta('fstamp:' + id, { m: f.lastModified, s: f.size }); } catch { /* ignore */ } }
  else await db.setMeta('fstamp:' + id, null);
}

/** Before overwriting a job file, make sure nobody else saved it since this device last did.
 *  Returns 'ok', 'copy', 'open' or 'cancel'. A stage change written from someone's Dashboard
 *  (same revision) is merged into this job instead of being overwritten. */
async function checkFileBeforeSave(id, hnd) {
  let f; try { f = await hnd.getFile(); } catch { return 'ok'; } // file gone or unreadable: writing recreates it
  const st = await db.getMeta('fstamp:' + id).catch(() => null);
  if (!f.size || (st && st.m === f.lastModified && st.s === f.size)) return 'ok';
  let data = null; try { data = JSON.parse(await f.text()); } catch { /* not JSON */ }
  const stored = await db.getJob(id);
  const when = (t) => (t ? new Date(t).toLocaleString() : 'unknown time');
  if (!data || data.format !== 'tank-floor-inspector' || !data.job) {
    return (await askChoice(`${hnd.name} is no longer a Tank Floor Inspector job file. Overwrite it, or save this job to a new file?`, [['cancel', 'Cancel'], ['copy', 'Save to a new file…', 'primary'], ['ok', 'Overwrite', 'danger-solid']])) || 'cancel';
  }
  if (data.job.id !== id) {
    return (await askChoice(`${hnd.name} now holds a different job ("${data.job.info?.tankId || 'untitled'}"). Save this job to a new file instead?`, [['cancel', 'Cancel'], ['copy', 'Save to a new file…', 'primary'], ['ok', 'Overwrite', 'danger-solid']])) || 'cancel';
  }
  const fr = data.job.rev || 0, lr = stored.rev || 0;
  if (fr > lr || (fr === lr && (data.job.savedAt || 0) !== (stored.savedAt || 0))) {
    const msg = `Someone else has saved ${hnd.name} since this device last opened or saved it.\n\n`
      + `File: Rev ${fr}, saved ${when(data.job.savedAt)}\nThis device: based on Rev ${lr}${stored.savedAt ? ', saved ' + when(stored.savedAt) : ''}, last changed ${when(stored.updated)}\n\n`
      + 'Overwriting would replace their changes with yours. Saving a copy keeps both.';
    return (await askChoice(msg, [['cancel', 'Cancel'], ['open', 'Open their version'], ['ok', 'Overwrite their changes', 'danger-solid'], ['copy', 'Save mine as a copy…', 'primary']])) || 'cancel';
  }
  // Same revision: only a Dashboard stage change can differ. Keep whichever stage was set last.
  const fh = data.job.status?.history || [], lh = stored.status?.history || [];
  if (data.job.status?.stage && (fh.at(-1)?.at || 0) > (lh.at(-1)?.at || 0)) {
    const status = { ...(stored.status || {}), stage: data.job.status.stage, history: fh };
    if (S.job?.id === id) { S.job.status = status; await writeNow(); renderHeader(); }
    else await db.putJob({ ...stored, status });
  }
  return 'ok';
}

export async function saveJobFile(id = S.job?.id, saveAs = false) {
  if (!id) return;
  if (S.job?.id === id && !(await flushSave())) { toast(`The job file was not written: your latest changes could not be saved to this device first (${saveErrorText(saver.error)}).`, { label: 'Try again', fn: () => saveJobFile(id, saveAs) }); return; }
  if (canPick()) {
    try {
      let hnd = saveAs ? null : await fileHandle(id, true);
      if (hnd) {
        const v = await checkFileBeforeSave(id, hnd);
        if (v === 'cancel') return;
        if (v === 'open') { const nid = await importJobFile(await hnd.getFile()); if (nid) await rememberFile(nid, hnd, true); return; }
        if (v === 'copy') hnd = null;
      }
      const { job, stamp, chunks, counted } = await jobFile(id);
      if (!hnd) hnd = await window.showSaveFilePicker({ suggestedName: fileBase(job) + '.json', id: 'tank-floor-jobs', startIn: 'documents', types: FILE_TYPES });
      const w = await hnd.createWritable();
      try { for await (const c of chunks()) await w.write(c); await w.close(); }
      catch (e) { await w.abort().catch(() => {}); throw e; } // abort leaves the previous file untouched
      await rememberFile(id, hnd, true);
      if (S.job?.id === id) S.fileName = hnd.name;
      await applyStamp(id, job, counted);
      toast(`Saved ${hnd.name} — Rev ${stamp.rev}`);
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;
      if (e.name === 'NotSavedError') { toast('The job file was not written: ' + e.message + '.'); return; }
      console.warn('Save file failed, downloading instead', e);
    }
  }
  const { job, stamp, chunks, counted } = await jobFile(id);
  const name = fileBase(job) + '.json', parts = [];
  for await (const c of chunks()) parts.push(c);
  download(name, new Blob(parts, { type: 'application/json' }), 'application/json');
  await applyStamp(id, job, counted);
  toast(`Downloaded ${name} (Rev ${stamp.rev}). Move it into your OneDrive folder to share it.`);
}

async function openJobFile() {
  if (canPick()) {
    try {
      const [hnd] = await window.showOpenFilePicker({ id: 'tank-floor-jobs', types: FILE_TYPES, multiple: false });
      const id = await importJobFile(await hnd.getFile());
      if (id) { await rememberFile(id, hnd, true); if (S.job?.id === id) { S.fileName = hnd.name; renderHeader(); } }
      return;
    } catch (e) { if (e.name === 'AbortError') return; console.warn(e); }
  }
  $('#openFileInput').click();
}

/** A list of problems for a dialog: the first 12, then how many more. */
const problemList = (a) => a.slice(0, 12).map((x) => '• ' + x).join('\n') + (a.length > 12 ? `\n• … and ${a.length - 12} more` : '');

export async function importJobFile(file) {
  if (!file) return null;
  try {
    const data = JSON.parse(await file.text());
    if (data.format !== 'tank-floor-inspector' || !data.job) throw new Error('This is not a Tank Floor Inspector job file.');
    if ((data.version || 1) > FILE_VERSION || (data.job.schema || 1) > SCHEMA) throw new Error(`it was saved by a newer version of the app${data.appVersion ? ' (v' + data.appVersion + ')' : ''}. Reload the app to update it (this is v${APP_VERSION}), then open the file again.`);
    // data integrity stage 6: check the whole file before anything on the device changes
    const v = await validateJobFile(data, { schema: SCHEMA, fileVersion: FILE_VERSION });
    const record = async (result) => db.addImport({ at: Date.now(), by: await whoAmI().catch(() => null), kind: 'job-file', fileName: file.name, jobId: data.job.id || null, result, counts: { errors: v.errors.length, warnings: v.warnings.length }, decisions: v.warnings.length && result === 'opened' ? ['warnings accepted'] : [] }).catch(() => {});
    if (v.errors.length) {
      await askChoice(`${file.name} was not opened: it has ${v.errors.length === 1 ? 'a problem' : v.errors.length + ' problems'} that would stop the app working with it. Nothing on this device was changed.\n\n${problemList(v.errors)}`, [['ok', 'OK', 'primary']]);
      record('refused'); return null;
    }
    if (v.warnings.length && (await askChoice(`${file.name} has ${v.warnings.length === 1 ? 'one thing' : v.warnings.length + ' things'} to check:\n\n${problemList(v.warnings)}\n\nOpen it anyway? You can correct these in the app.`, [['cancel', 'Cancel'], ['open', 'Open anyway', 'primary']])) !== 'open') { record('cancelled'); return null; }
    record('opened');
    const notes = migrationNotes(data.job);
    const job = v.job; // migrated, with numbers stored as text converted (validate.js)
    if (data.tank?.id && data.tank.id === job.tankRef && !(await db.getTank(data.tank.id))) { await db.putTank(data.tank); await loadTanks(); }
    const exists = await db.getJob(job.id);
    const oldId = job.id;
    if (exists) {
      const when = (t) => (t ? new Date(t).toLocaleString() : 'unknown');
      const newer = (job.updated || 0) >= (exists.updated || 0);
      const rv = (j) => (j.rev ? `Rev ${j.rev}` : 'no rev');
      const replace = await askConfirm(`"${job.info.tankId || 'This job'}" is already on this device.\n\nFile: ${rv(job)}, last changed ${when(job.updated)}${newer ? ' (newer)' : ''}\nThis device: ${rv(exists)}, last changed ${when(exists.updated)}${newer ? '' : ' (newer)'}${unsavedSinceRev(exists) ? ' — has changes not saved to a file' : ''}`, { ok: 'Replace with the file', cancel: 'Keep both (open as a copy)' });
      if (!replace) { job.id = uid(); job.info.tankId = (job.info.tankId || 'Tank') + ' (copy)'; }
    }
    // One transaction: the device copy is only replaced once the whole file has been written.
    const photos = job.id === oldId ? data.photos || [] : copyPhotos(job, data.photos || []);
    await db.replaceJob(job, photos, exists && job.id === oldId ? oldId : null);
    await loadJobs(); toast(`Opened ${file.name}`); await openJob(job.id); checkStorage();
    if (notes.length) showMigrationNotes(notes);
    return job.id;
  } catch (err) { toast('Could not open the file: ' + err.message); return null; }
}

function printMap() { return renderMapSVG(S.job, S.layout, { calc: S.calc, print: true, floorOf: (ft) => itemFloor(S.layout, ft) }); }

async function uploadLoader(file) {
  let res;
  try { res = await readLoader(S.job, await file.arrayBuffer()); }
  catch (err) { toast('Could not read the loader sheet: ' + err.message); return; }
  const lines = [];
  if (!res.jobMatch) lines.push(`This sheet was made for ${res.info.tank || 'another tank'} (a different job). Readings are matched by ID, so only items that exist in this job will be updated.`, '');
  if (res.info.tech) lines.push(`UT technician: ${res.info.tech}${res.info.date ? ' · ' + res.info.date : ''}`);
  for (const s of res.summary) lines.push(`${s.area}: ${s.added} new, ${s.changed} changed`);
  if (res.infoChanges) lines.push(`UT technician / instrument details: ${res.infoChanges} update${res.infoChanges > 1 ? 's' : ''}`);
  if (res.unmatched) lines.push(`${res.unmatched} row${res.unmatched > 1 ? 's' : ''} skipped — the item no longer exists in this job`);
  if (res.errors.length) lines.push('', `${res.errors.length} cell${res.errors.length > 1 ? 's' : ''} could not be read and will be skipped:`, ...res.errors.slice(0, 8).map((e) => '• ' + e), ...(res.errors.length > 8 ? [`• … and ${res.errors.length - 8} more`] : []));
  if (!res.total && !res.infoChanges) { toast(`${file.name}: no new or changed readings${res.errors.length ? ` (${res.errors.length} cell${res.errors.length > 1 ? 's' : ''} could not be read)` : ''}.`); return; }
  if (!(await askConfirm(`Update the report from ${file.name}?\n\n${lines.join('\n')}\n\nBlank cells in the sheet do not erase existing readings.`, { ok: `Update ${res.total} reading${res.total === 1 ? '' : 's'}` }))) return;
  res.apply();
  S.job.utLoads = [...(S.job.utLoads || []), { at: Date.now(), file: file.name, count: res.total, tech: res.info.tech || '' }].slice(-50);
  commit(); renderAll();
  toast(`Updated ${res.total} reading${res.total === 1 ? '' : 's'} from ${file.name}.`);
}

onAction({
  'job-save': async (el, id, e, act) => {
    return saveJobFile(id);
  },
  'job-open-file': async (el, id, e, act) => {
    return openJobFile();
  },
  'file-save': async (el, id, e, act) => {
    return saveJobFile();
  },
  'file-save-as': async (el, id, e, act) => {
    return saveJobFile(S.job?.id, true);
  },
  'utl-down': async (el, id, e, act) => {
    {
      const areas = loaderAreas(S.job);
      if (!areas.length) { toast('Nothing to load yet — set up the shell courses, nozzles, roof or floor indications first.'); return; }
      if (!(await flushSave())) { toast('The UT loader was not made: the latest changes could not be saved to this device first.'); return; }
      try { const blob = await buildLoader(S.job); download(fileBase(S.job) + '_UT-loader.xlsx', blob); toast(`UT loader sheet downloaded (${areas.join(', ')}). Give it to the UT technician.`); }
      catch (err) { toast('Could not build the loader sheet: ' + err.message); }
      return;
    }
  },
  'utl-up': async (el, id, e, act) => {
    $('#utlInput').click(); return;
  },
  'exp-roof': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_roof-ut.csv', roofCSV(S.job), 'text/csv');
  },
  'exp-settle': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_settlement.csv', settleCSV(S.job), 'text/csv');
  },
  'exp-shell': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_shell-ut.csv', shellCSV(S.job), 'text/csv');
  },
  'exp-shell-svg': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_shell-rollout.svg', rolloutSVG(S.job, { print: true }).replace(/(<svg[^>]*>)/, '$1' + SHELL_SVG_STYLE), 'image/svg+xml');
  },
  'exp-noz': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_nozzles.csv', nozzlesCSV(S.job), 'text/csv');
  },
  'exp-defs': async (el, id, e, act) => {
    {
      numberDefs(S.job);
      const rows = [['No.', 'Component', 'Location', 'Deficiency', 'Recommended action', 'Priority', 'Due', 'Status', 'Closed', 'Client comment', 'Code reference', 'History']];
      for (const d of allDefs(S.job)) rows.push([d.no || '', d.secLabel, d.loc || '', d.finding || '', d.action || '', d.priority, d.due || '', d.status, d.closedOn || '', d.client || '', d.ref || '', (d.history || []).map((x) => x.date + ' ' + x.status).join('; ')]);
      return download(fileBase(S.job) + '_deficiencies.csv', '\ufeff' + rows.map((r) => r.map((v) => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : v).join(',')).join('\r\n'), 'text/csv');
    }
  },
  'exp-ind': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_indications.csv', indicationsCSV(S.job, S.layout, S.calc), 'text/csv');
  },
  'exp-plates': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_plates.csv', platesCSV(S.job, S.layout, S.calc), 'text/csv');
  },
  'exp-svg': async (el, id, e, act) => {
    return download(fileBase(S.job) + '_floor-map.svg', svgForExport(printMap()), 'image/svg+xml');
  },
  'exp-png': async (el, id, e, act) => {
    { const b = await svgToPng(svgForExport(printMap())); return download(fileBase(S.job) + '_floor-map.png', b); }
  },
  'exp-json': async (el, id, e, act) => {
    return saveJobFile(S.job.id, true);
  }
});

onChange([
  { order: 400, when: (el, act) => act === 'utl-file', run: async (el, e, act) => {
    { const f = el.files[0]; el.value = ''; if (f) uploadLoader(f); return; }
  } },
  { order: 410, when: (el, act) => act === 'job-import', run: async (el, e, act) => {
    return importJobFile(el.files[0]).finally(() => (el.value = ''));
  } }
]);

/* Ctrl+S saves the job file (Ctrl+Shift+S: save as). */
document.addEventListener('keydown', (e) => {
  const typing = e.target.matches('input, textarea, select');
  if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S') && S.job) { e.preventDefault(); if (typing) e.target.blur(); setTimeout(() => saveJobFile(S.job.id, e.shiftKey), 0); return; }
});
