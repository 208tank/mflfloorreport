// Crash recovery journal (data integrity upgrade, stage 3).
//
// IndexedDB writes are asynchronous, so a change can be lost if the browser or tab is killed in the moment
// between the change and its device write (or while writes are failing, see saver.js). The journal closes
// that gap: on every change the app synchronously writes a copy of the open job to localStorage, and
// removes it once the device write has committed. A journal entry still present on the next start means
// the app closed before the change reached the device; the user is offered the changes back.
//
// Each tab has its own session id and keeps a heartbeat, so an entry belonging to another tab that is
// still open is never mistaken for a crash.

const KEY = 'tfi-journal:', ALIVE = 'tfi-alive:';

export function createJournal({ storage = globalThis.localStorage, session = Math.random().toString(36).slice(2), now = () => Date.now(), aliveMs = 10000 } = {}) {
  let failed = false;
  const read = (k) => { try { return JSON.parse(storage.getItem(k)); } catch { return null; } };
  return {
    session,
    /** True once a write has failed (storage full / blocked): the app warns once and carries on. */
    get failed() { return failed; },
    /** Record the open job (called on every change). Returns false if storage refused it. */
    put(job) {
      try {
        storage.setItem(KEY + job.id, JSON.stringify({ session, at: now(), job }));
        failed = false; return true;
      } catch { failed = true; return false; }
    },
    /** The device write committed: forget the job's entry (only this tab's). */
    clear(jobId) { const e = read(KEY + jobId); if (e && e.session === session) storage.removeItem(KEY + jobId); },
    /** Remove an entry whatever its session (after the user restores or discards it). */
    remove(jobId) { storage.removeItem(KEY + jobId); },
    /** This tab is alive (called every few seconds). */
    heartbeat() { try { storage.setItem(ALIVE + session, String(now())); } catch { /* ignore */ } },
    /** Clean exit: this tab no longer holds anything. */
    end() { storage.removeItem(ALIVE + session); },
    /** Entries left by tabs that are no longer running (no heartbeat within aliveMs). */
    orphans() {
      const out = [], t = now();
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i); if (!k?.startsWith(KEY)) continue;
        const e = read(k); if (!e?.job?.id) { out.push({ key: k, broken: true }); continue; }
        if (e.session === session) continue;
        const beat = +storage.getItem(ALIVE + e.session) || 0;
        if (t - beat > aliveMs) out.push({ key: k, ...e });
      }
      // heartbeats of tabs long gone
      for (let i = storage.length - 1; i >= 0; i--) { const k = storage.key(i); if (k?.startsWith(ALIVE) && t - (+storage.getItem(k) || 0) > aliveMs * 30) storage.removeItem(k); }
      return out;
    }
  };
}

/** What a journal entry would bring back compared with the job on the device. */
export function recoveryDiff(entry, stored) {
  if (!stored) return { action: 'gone' };
  const j = entry.job;
  if ((j.updated || 0) <= (stored.updated || 0)) return { action: 'stale' };     // the device already has it (or newer)
  const n = Math.max(1, (j.edits || 0) - (stored.edits || 0));
  const areas = (j.editAreas || []).filter((a) => !(stored.editAreas || []).includes(a));
  return { action: 'offer', n, areas: areas.length ? areas : j.editAreas || [], at: j.updated };
}
