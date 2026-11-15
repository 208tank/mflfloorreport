// Revision pruning (data integrity stage 12, decision 3): each job keeps its newest 15 daily checkpoints and its newest
// 5 other revisions. Revisions saved to a job file and issued reports are never removed. Older revisions stay in the
// job files and backups that were made from them. No browser APIs.
export const KEEP = { checkpoint: 15, other: 5 };
const PROTECTED = new Set(['file-save', 'issued']);

/** Which of a job's revisions to remove. revs: [{ id, n, reason }]; issuedN: the job's issued revision, if any. */
export function planPrune(revs, { keep = KEEP, issuedN = null } = {}) {
  const newest = [...revs].sort((a, b) => b.n - a.n);
  const isProtected = (r) => PROTECTED.has(r.reason) || r.n === issuedN;
  const cps = newest.filter((r) => !isProtected(r) && r.reason === 'checkpoint');
  const others = newest.filter((r) => !isProtected(r) && r.reason !== 'checkpoint');
  return [...cps.slice(keep.checkpoint), ...others.slice(keep.other)];
}

/** Photos in a job's bin that no remaining revision refers to. */
export function binToEmpty(binned, keptRevs) {
  const used = new Set(keptRevs.flatMap((r) => r.photoIds || []));
  return binned.filter((id) => !used.has(id));
}
