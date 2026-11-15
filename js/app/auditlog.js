// Recording the audit trail (data integrity stage 9). Core module.
//  - Every write of the open job is compared with the job as last recorded, and the changed fields are logged.
//    The source is 'edit' unless the code making the change named another one first (auditSource).
//  - Changes made outside the open job (Dashboard, imports, restores, recovery) call logChange themselves.
import { S } from './state.js';
import { whoAmI } from './revisions.js';
import { auditChanges, entryIntact, makeEntry } from '../audit.js';
import { db } from '../db.js';

const lastHash = new Map(); // jobId → hash of its latest entry (this session)
const base = new Map(); // jobId → the open job as last recorded
let pending = null; // { source, note } for the open job's next write

/** The job as the audit trail last saw it: the next write is compared with this (set when a job is opened). */
export function setAuditBase(job) { if (job?.id) base.set(job.id, structuredClone(job)); }

/** Name the source of the open job's next change (the Excel loader, a restore …). */
export function auditSource(source, note = '') { pending = { source, note }; }

async function latest(jobId) {
  if (lastHash.has(jobId)) return lastHash.get(jobId);
  const all = await db.jobAudit(jobId).catch(() => []);
  const h = all.length ? all[all.length - 1].hash : null;
  lastHash.set(jobId, h);
  return h;
}

/** Log the change from prev to next. Edits that change nothing aren't logged; other sources are, so that opening,
 *  restoring or recovering a job always leaves a line. */
export async function logChange(jobId, prev, next, source = 'edit', note = '') {
  const changes = auditChanges(prev, next);
  if (!changes.length && source === 'edit') return null;
  const e = await makeEntry({ jobId, at: Date.now(), by: await whoAmI(), source, note, changes }, await latest(jobId));
  await db.addAudit([e]);
  lastHash.set(jobId, e.hash);
  return e;
}

/** Has the job a base to compare its next write with? (If not, persist.js reads the stored copy.) */
export const hasAuditBase = (jobId) => base.has(jobId);

/** The changes a write of the open job is about to make, worked out just before it is written (persist.js): the job
 *  as it is now against the job as last recorded. Nothing is kept until recordWrite, so a failed write that is
 *  retried is still compared with the last version that reached the device. */
export function auditWrite(job, stored = null) {
  const snap = structuredClone(job), prev = base.get(job.id) || stored;
  if (!prev) return { jobId: job.id, snap, changes: [], source: 'create', note: '', pending }; // a new job: one line, not every field
  return { jobId: job.id, snap, changes: auditChanges(prev, snap), source: pending?.source || 'edit', note: pending?.note || '', pending };
}

/** Record what auditWrite worked out, once the job is on the device. */
export async function recordWrite(w) {
  base.set(w.jobId, w.snap);
  if (pending === w.pending) pending = null;
  if (!w.changes.length && w.source === 'edit') return null;
  const e = await makeEntry({ jobId: w.jobId, at: Date.now(), by: await whoAmI(), source: w.source, note: w.note, changes: w.changes }, await latest(w.jobId));
  await db.addAudit([e]);
  lastHash.set(w.jobId, e.hash);
  return e;
}

/** Add another device's entries for a job (from a job file). Only intact entries not already here are added; they keep
 *  their own chain. Resolves { added, skipped }. */
export async function mergeAudit(jobId, entries) {
  if (!Array.isArray(entries) || !entries.length) return { added: 0, skipped: 0 };
  const have = new Set((await db.jobAudit(jobId).catch(() => [])).map((e) => e.hash));
  const add = []; let skipped = 0;
  for (const e of [...entries].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    if (have.has(e?.hash)) continue;
    if (!(await entryIntact(e))) { skipped++; continue; }
    const { seq, ...rest } = e; // eslint-disable-line no-unused-vars
    add.push({ ...rest, jobId }); have.add(e.hash);
  }
  if (add.length) { await db.addAudit(add); lastHash.delete(jobId); }
  return { added: add.length, skipped };
}

/** Forget what this session knows about a job's entries (after a restore replaced them). */
export function forgetAudit(jobId) { lastHash.delete(jobId); base.delete(jobId); if (S.job?.id === jobId) setAuditBase(S.job); }
