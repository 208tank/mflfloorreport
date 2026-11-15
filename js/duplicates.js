// Duplicate import detection (data integrity stage 7). Decides, before a job file is stored, whether it is
// already on this device, a different version of a job that is, or possibly the same inspection under another id.
// No browser APIs here, so the tests run it in Node.
import { sha256 } from './util.js';
import { tankKeyOf } from './registry.js';

/**
 * Compare a checked job file with this device.
 *   file:   { job, photoIds: [id] }  — job as it would be stored (validate.js output)
 *   device: { getJob(id), photoKeys(id), cards: [stored job cards / jobs] }
 *   past:   [import records for this file's checksum]
 * Returns { kind, device?, matches?, opened? }:
 *   'same'      — this job with identical content and photos is on this device: nothing to do
 *   'differs'   — this job id is on this device with different content: the user decides (replace / keep both)
 *   'possible'  — no job with this id, but one or more jobs for the same tank and inspection date (matches)
 *   'new'       — nothing like it on this device
 * opened = the earlier import records of this exact file (any kind), newest first.
 */
export async function classifyImport(file, device, past = []) {
  const opened = [...past].sort((a, b) => (b.at || 0) - (a.at || 0));
  const stored = await device.getJob(file.job.id);
  if (stored) {
    const keys = new Set(await device.photoKeys(file.job.id));
    const same = (await sha256(stored)) === (await sha256(file.job)) && keys.size === file.photoIds.length && file.photoIds.every((k) => keys.has(k));
    return { kind: same ? 'same' : 'differs', device: stored, opened };
  }
  const key = tankKeyOf(file.job), date = String(file.job.info?.inspDate || '').trim();
  const matches = date && key !== '||' ? device.cards.filter((c) => tankKeyOf(c) === key && String(c.info?.inspDate || '').trim() === date) : [];
  return { kind: matches.length ? 'possible' : 'new', matches, opened };
}
