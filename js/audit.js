// The change audit trail (data integrity stage 9). One entry per write of a job to the device: who, when, the
// source of the change and every field that changed, old and new. Each entry carries a checksum of itself and of
// the entry before it, so an entry edited or taken out of the middle shows up in the integrity check. That is
// evidence against accidental or casual tampering, not proof against a determined one. No browser APIs.
import { diffJobs } from './revdiff.js';
import { sha256 } from './util.js';

/** Where a change came from. */
export const SOURCE_LABEL = {
  create: 'Job created', edit: 'Typed in the app', stage: 'Stage change', loader: 'Excel loader sheet', import: 'Job file opened',
  restore: 'Restored', recovery: 'Recovered after a close', migration: 'App update',
};

/** The fields that differ between two versions of a job: [{ area, item, field, path, before, after }]. */
export const auditChanges = (prev, next) => diffJobs(prev || {}, next || {}, { raw: true });

/** The part of an entry its checksum covers. The job id is left out, so an entry stays valid when a job file is
 *  opened as a copy under a new id. */
const body = (e) => ({ at: e.at, by: e.by ?? null, source: e.source, note: e.note || '', changes: e.changes || [], prev: e.prev ?? null });

/** A new entry, chained to the hash of the job's latest entry (prevHash, or null for its first). */
export async function makeEntry({ jobId, at, by, source, note = '', changes = [] }, prevHash = null) {
  const b = body({ at, by, source, note, changes, prev: prevHash });
  return { jobId, ...b, hash: await sha256(b) };
}

/** Does an entry still match its checksum? */
export const entryIntact = async (e) => !!e && typeof e.hash === 'string' && (await sha256(body(e))) === e.hash;

/** Check a job's entries: each matches its checksum, and the entry each one follows is there.
 *  Entries from several devices (merged through job files) form a tree, which is fine; a gap is not. */
export async function verifyAudit(entries) {
  const problems = [], have = new Set(entries.map((e) => e.hash));
  for (const e of entries) {
    if (!(await entryIntact(e))) problems.push({ entry: e, kind: 'changed', message: `The audit entry of ${new Date(e.at).toLocaleString()} (${SOURCE_LABEL[e.source] || e.source}) does not match its checksum: it was changed after it was recorded.` });
    else if (e.prev && !have.has(e.prev)) problems.push({ entry: e, kind: 'gap', message: `The audit entry before the one of ${new Date(e.at).toLocaleString()} is missing: an entry was taken out.` });
  }
  return problems;
}

/** Flatten entries to one row per changed field (entries with no field changes give one row), newest first. */
export function auditRows(entries) {
  const rows = [];
  for (const e of [...entries].sort((a, b) => b.at - a.at || (b.seq || 0) - (a.seq || 0))) {
    const base = { at: e.at, by: e.by?.name || '', source: e.source, note: e.note || '', seq: e.seq };
    if (!e.changes?.length) rows.push({ ...base, area: '', item: '', field: '', before: null, after: null });
    for (const c of e.changes || []) rows.push({ ...base, ...c });
  }
  return rows;
}

/** Filter rows by section (area), source and words in the item or field. */
export function filterRows(rows, { area = '', source = '', text = '' } = {}) {
  const t = text.trim().toLowerCase();
  return rows.filter((r) => (!area || r.area === area) && (!source || r.source === source) && (!t || `${r.item} ${r.field} ${r.path || ''}`.toLowerCase().includes(t)));
}
