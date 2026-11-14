// App-level steps that still live in app.js, for screen modules (refactoring step 3).
// A screen module can't import app.js (app.js imports the screens), so app.js hands these over once at
// start-up with configureHost. Each moves to its own core module later (commit → step 14, persistence),
// and the screens then import it directly.
export const host = {
  /** Record a change to the open job: recalculate, schedule the save, count the edit. */
  commit: () => { throw new Error('host.commit used before configureHost'); },
};
export function configureHost(h) { Object.assign(host, h); }
