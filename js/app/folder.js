// The linked jobs folder (e.g. the team's OneDrive jobs folder): link it, scan it for job files, and write a
// job's stage back into its file (refactoring step 7). Used by the dashboard, the tank registry and tank setup.
import { S } from './state.js';
import { renderView } from './nav.js';
import { jobCard } from '../cards.js';
import { db } from '../db.js';
import { toast } from '../ui.js';

/** Linking a folder needs the File System Access API in a top-level window (installed app in Chrome or Edge). */
export const canDir = () => 'showDirectoryPicker' in window && window.self === window.top;

export async function dashInit() {
  const D = S.dash;
  if (!D.dir) D.dir = await db.getMeta('dashDir').catch(() => null);
  if (D.dir) { try { D.perm = await D.dir.queryPermission({ mode: 'readwrite' }); } catch { D.perm = 'denied'; } }
  if (D.dir && D.perm === 'granted' && !D.scanned && !D.scanning) await scanFolder();
}

export async function scanFolder() {
  const D = S.dash; if (!D.dir) return;
  D.scanning = true; if (S.view === 'dash') renderView();
  const files = new Map();
  // Job files can be tens of MB (photos). Each file's card is cached by path, modified time and size,
  // so a rescan only reads the files that changed since the last one.
  const cache = (await db.getMeta('scanCache').catch(() => null)) || {}, seen = {};
  const walk = async (dir, path, depth) => {
    for await (const [name, hnd] of dir.entries()) {
      if (hnd.kind === 'directory') { if (depth < 2 && !name.startsWith('.')) await walk(hnd, path + name + '/', depth + 1); continue; }
      if (!/\.json$/i.test(name)) continue;
      try {
        const f = await hnd.getFile(), p = path + name, c = cache[p];
        let id, card;
        if (c && c.m === f.lastModified && c.s === f.size) ({ id, card } = c);
        else {
          if (!(await f.slice(0, 80).text()).includes('"tank-floor-inspector"')) { seen[p] = { m: f.lastModified, s: f.size, id: null }; continue; }
          const data = JSON.parse(await f.text());
          if (data.format !== 'tank-floor-inspector' || !data.job?.id) { seen[p] = { m: f.lastModified, s: f.size, id: null }; continue; }
          id = data.job.id; card = jobCard(data.job);
        }
        seen[p] = { m: f.lastModified, s: f.size, id, card };
        if (!id) continue;
        const prev = files.get(id);
        if (!prev || card.updated > prev.card.updated) files.set(id, { name, path: p, fh: hnd, card, modified: f.lastModified });
      } catch { /* not readable — skip */ }
    }
  };
  try { await walk(D.dir, '', 0); D.files = files; D.scanned = true; D.scannedAt = Date.now(); await db.setMeta('scanCache', seen).catch(() => {}); }
  catch (e) { toast('Could not read the folder: ' + e.message); }
  D.scanning = false;
  if (S.view === 'dash') renderView();
}

export async function linkFolder() {
  if (!canDir()) { toast('Linking a folder needs the installed app in Chrome or Edge.'); return; }
  try {
    const dir = await window.showDirectoryPicker({ id: 'tank-jobs-folder', mode: 'readwrite', startIn: 'documents' });
    S.dash.dir = dir; S.dash.perm = 'granted'; S.dash.scanned = false; await db.setMeta('dashDir', dir);
    await scanFolder();
  } catch (e) { if (e.name !== 'AbortError') toast('Could not link the folder: ' + e.message); }
}

/** Write a job's stage back into its folder file without changing its revision. */
export async function writeStageToFile(id, stage, at = Date.now()) {
  const D = S.dash; let fh = D.files.get(id)?.fh || null;
  if (!fh) { fh = await db.getMeta('fh:' + id).catch(() => null); }
  if (!fh) return false;
  try {
    let perm = await fh.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') perm = await fh.requestPermission({ mode: 'readwrite' }).catch(() => 'denied');
    if (perm !== 'granted') return false;
    const data = JSON.parse(await (await fh.getFile()).text());
    if (data.format !== 'tank-floor-inspector' || data.job?.id !== id) return false;
    // Change only the stage, and add to the file's own history rather than replacing it.
    const old = data.job.status || {};
    if (old.stage === stage) return true;
    data.job.status = { ...old, stage, history: [...(old.history || []), { stage, at }].slice(-50) };
    const w = await fh.createWritable(); await w.write(JSON.stringify(data)); await w.close();
    const e = D.files.get(id); if (e) e.card = jobCard(data.job);
    return true; // (the scan cache sees the new modified time and re-reads this file next time)
  } catch (e) { console.warn('stage write failed', e); return false; }
}
