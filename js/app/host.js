// App-level steps that still live in app.js, for screen modules (refactoring step 3).
// A screen module can't import app.js (app.js imports the screens), so app.js hands these over once at
// start-up with configureHost. Each moves to its own core module later (commit, loadJobs → step 14, persistence; map and setup redraws → steps 10 and 12),
// and the screens then import it directly.
export const host = {
  /** Record a change to the open job: recalculate, schedule the save, count the edit. */
  commit: () => { throw new Error('host.commit used before configureHost'); },
  /** Reload the jobs list from the device (after crash recovery or a data repair). */
  loadJobs: () => { throw new Error('host.loadJobs used before configureHost'); },
  /** The recovery journal of unsaved changes (created with the save queue). */
  journal: null,
  /** Floor map redraws (step 12) and the tank setup preview (step 10), used by the nozzle editor. */
  drawMap: () => { throw new Error('host.drawMap used before configureHost'); },
  renderSide: () => { throw new Error('host.renderSide used before configureHost'); },
  setMode: () => { throw new Error('host.setMode used before configureHost'); },
  refreshSetupPreview: () => { throw new Error('host.refreshSetupPreview used before configureHost'); },
};
export function configureHost(h) { Object.assign(host, h); }
