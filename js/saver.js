// Reliable automatic saving (data integrity upgrade, stage 1).
//
// One saver per app. touch() marks the open job as changed and schedules a write after a short pause;
// flush() writes now. Writes never overlap: a change made while a write is in flight is written by the
// next write, after the first commits. A failed write is retried with back-off and reported through
// onState — never silently dropped — and the job stays "dirty" until a write succeeds.
//
// States: 'idle' (nothing written yet), 'pending' (changes waiting), 'saving', 'saved',
//         'retrying' (a write failed; another attempt is scheduled), 'error' (retries used up; the next
//         change or flush tries again).

export function createSaver({ write, onState = () => {}, debounce = 350, retryDelays = [1000, 3000, 10000], timers = globalThis } = {}) {
  let dirty = false, inflight = null, timer = null, retryTimer = null, attempt = 0, state = 'idle', lastError = null, gen = 0;
  const set = (s, err = null) => { state = s; lastError = err; onState(s, err); };
  const clear = () => { if (timer) { timers.clearTimeout(timer); timer = null; } if (retryTimer) { timers.clearTimeout(retryTimer); retryTimer = null; } };

  async function run() {
    clear();
    // wait until no write is in flight (the writer may start another one for changes made meanwhile)
    if (inflight) { while (inflight) await inflight.catch(() => {}); return dirty ? run() : state !== 'error' && state !== 'retrying'; }
    if (!dirty) return state !== 'error' && state !== 'retrying';
    const my = ++gen;
    dirty = false; set('saving');
    inflight = Promise.resolve().then(() => write());
    try {
      await inflight;
      inflight = null; attempt = 0;
      if (dirty) return run();      // changed while writing: write again
      set('saved');
      return true;
    } catch (e) {
      inflight = null; dirty = true; // keep the change: it is not on the device yet
      if (attempt < retryDelays.length) {
        const wait = retryDelays[attempt++];
        set('retrying', e);
        retryTimer = timers.setTimeout(() => { retryTimer = null; if (my === gen) run(); }, wait);
      } else { attempt = 0; set('error', e); }
      return false;
    }
  }

  return {
    /** The job changed: write it after a short pause. */
    touch() {
      dirty = true;
      if (state !== 'retrying' && state !== 'error') set('pending');
      if (timer) timers.clearTimeout(timer);
      timer = timers.setTimeout(() => { timer = null; run(); }, debounce);
    },
    /** Write now (and wait for any write in flight). Resolves true if everything is on the device. */
    flush() { return run(); },
    /** Changes not yet confirmed on the device (waiting, being written, or failed). */
    pending() { return dirty || !!inflight; },
    get state() { return state; },
    get error() { return lastError; },
    /** Forget unsaved changes (used only when the user explicitly discards them). */
    discard() { clear(); dirty = false; attempt = 0; set('idle'); }
  };
}

/** Plain words for a failed write, e.g. a full device. */
export function saveErrorText(e) {
  const n = e?.name || '', m = String(e?.message || e || '');
  if (n === 'QuotaExceededError' || /quota/i.test(m)) return 'this device is out of storage space — save jobs to files and delete finished ones';
  if (n === 'InvalidStateError' || /closing|closed/i.test(m)) return 'the device database was closed (another window may be updating the app)';
  return m || 'unknown error';
}
