// Database integrity validation (data integrity upgrade, stage 4).
//
// checkIntegrity() looks at a snapshot of the device database and lists every problem it finds. It never
// changes anything: repairs are separate, named actions that the app runs only when the user asks.
// Each problem: { code, severity: 'error' | 'warning', message, jobId?, id?, repair? }
// repair is set only for safe repairs: 'rebuild-card', 'remove-card', 'remove-meta'. Removing an orphan
// photo is offered separately ('delete-photo') and always needs an explicit confirmation.
import { migrate, SCHEMA } from './model.js';
import { buildLayout } from './geometry.js';
import { canonicalJSON } from './util.js';

const fin = (v) => v === null || v === undefined || v === '' || Number.isFinite(+v);

/**
 * data: { jobs: [job], cards: [card], photos: [{ id, jobId, indId?, ok? }], revisions: [{ id, jobId, n, hash, job? }],
 *         tanks: [tank], metaKeys: [key] }
 * opts.hash(job) → Promise<hex> verifies revision checksums (full check; skipped when absent or rev.job is missing).
 * opts.lite(job) → the card a job should have.
 */
export async function checkIntegrity(data, { hash = null, lite = null, yieldEvery = 0 } = {}) {
  const out = [], add = (p) => out.push(p);
  const jobs = new Map(), tanks = new Set((data.tanks || []).map((t) => t.id));
  let k = 0;
  const pause = async () => { if (yieldEvery && ++k % yieldEvery === 0) await new Promise((r) => setTimeout(r, 0)); };

  for (const j of data.jobs || []) {
    if (!j || typeof j.id !== 'string' || !j.id) { add({ code: 'job-no-id', severity: 'error', message: 'A job record has no id and cannot be opened.' }); continue; }
    jobs.set(j.id, j);
    const name = j.info?.tankId || 'Untitled tank';
    if ((j.schema || 1) > SCHEMA) { add({ code: 'job-newer', severity: 'warning', jobId: j.id, message: `${name}: saved by a newer version of the app (schema ${j.schema}); update the app before editing it.` }); continue; }
    let m;
    try { m = migrate(j); }
    catch (e) { add({ code: 'job-migrate', severity: 'error', jobId: j.id, message: `${name}: cannot be updated to the current version (${e.message}). It is unchanged; save a backup and report it.` }); continue; }
    const bad = [];
    if (!fin(m.tank?.diameter)) bad.push('diameter');
    if (!fin(m.tank?.tBottom)) bad.push('bottom thickness');
    const ids = new Set(), dup = new Set();
    for (const i of m.indications || []) {
      if (ids.has(i.id)) dup.add(i.no || i.id); ids.add(i.id);
      for (const f of ['x', 'y', 'utMin', 'utNom', 'vtDepth', 'mflPct', 'len', 'wid']) if (!fin(i[f])) bad.push(`indication ${i.no || i.id} ${f}`);
    }
    if (bad.length) add({ code: 'job-number', severity: 'error', jobId: j.id, message: `${name}: values that are not numbers — ${bad.slice(0, 6).join(', ')}${bad.length > 6 ? ` and ${bad.length - 6} more` : ''}.` });
    if (dup.size) add({ code: 'job-dup-ind', severity: 'error', jobId: j.id, message: `${name}: duplicate indication ids (${[...dup].slice(0, 5).join(', ')}).` });
    try {
      const L = buildLayout(m), lost = (m.indications || []).filter((i) => i.plate && !L.byKey.has(i.plate));
      if (lost.length) add({ code: 'job-ind-plate', severity: 'warning', jobId: j.id, message: `${name}: ${lost.length} indication${lost.length > 1 ? 's are' : ' is'} on a plate that is not in the layout (${lost.slice(0, 5).map((i) => i.no).join(', ')}).` });
    } catch (e) { add({ code: 'job-layout', severity: 'error', jobId: j.id, message: `${name}: the floor layout cannot be drawn (${e.message}).` }); }
    if (j.tankRef && !tanks.has(j.tankRef)) add({ code: 'job-tank', severity: 'warning', jobId: j.id, message: `${name}: linked to a registry tank that is no longer on this device.` });
    await pause();
  }

  // cards: one per job, matching it
  const cards = new Map((data.cards || []).map((c) => [c.id, c]));
  for (const [id, j] of jobs) {
    const c = cards.get(id), name = j.info?.tankId || 'Untitled tank';
    if (!c) add({ code: 'card-missing', severity: 'warning', jobId: id, repair: 'rebuild-card', message: `${name}: missing from the job list.` });
    else if (lite && canonicalJSON(c) !== canonicalJSON(lite(j))) add({ code: 'card-stale', severity: 'warning', jobId: id, repair: 'rebuild-card', message: `${name}: the job list shows out-of-date details.` });
  }
  for (const id of cards.keys()) if (!jobs.has(id)) add({ code: 'card-orphan', severity: 'warning', id, repair: 'remove-card', message: `The job list shows "${cards.get(id).info?.tankId || id}", but the job itself is not on this device.` });

  // photos: belong to a job (or are kept for its history), and to an existing indication
  const revPhotos = new Set((data.revisions || []).flatMap((r) => r.photoIds || []));
  for (const p of data.photos || []) {
    const j = jobs.get(p.jobId);
    if (!j) { if (!revPhotos.has(p.id)) add({ code: 'photo-orphan', severity: 'warning', id: p.id, jobId: p.jobId, repair: 'delete-photo', message: `A photo belongs to a job that is no longer on this device.` }); continue; }
    if (p.ok === false) add({ code: 'photo-bad', severity: 'error', id: p.id, jobId: p.jobId, message: `${j.info?.tankId || 'A job'}: a photo cannot be displayed (the image data is damaged).` });
    if (p.indId && !(j.indications || []).some((i) => i.id === p.indId)) add({ code: 'photo-ind', severity: 'warning', id: p.id, jobId: p.jobId, message: `${j.info?.tankId || 'A job'}: a photo is linked to an indication that was deleted.` });
  }

  // revisions: checksums match (full check)
  for (const r of data.revisions || []) {
    if (!hash || !r.job) continue;
    if ((await hash(r.job)) !== r.hash) add({ code: 'rev-hash', severity: 'error', id: r.id, jobId: r.jobId, message: `Revision ${r.n} of ${r.job?.info?.tankId || r.jobId} does not match its checksum: it has been changed or damaged since it was saved. It is kept as it is.` });
    await pause();
  }

  // settings that point at jobs that are gone
  for (const key of data.metaKeys || []) {
    const m = /^(fh|fstamp):(.+)$/.exec(key);
    if (m && !jobs.has(m[2])) add({ code: 'meta-orphan', severity: 'warning', id: key, repair: 'remove-meta', message: `A remembered file link for a job that is no longer on this device.` });
  }
  return out;
}

export const SAFE_REPAIRS = new Set(['rebuild-card', 'remove-card', 'remove-meta']);
