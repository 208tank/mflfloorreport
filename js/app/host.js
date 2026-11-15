// App-level steps that still live in app.js, for screen modules (refactoring step 3).
// A screen module can't import app.js (app.js imports the screens), so app.js hands these over once at
// start-up with configureHost. Each moves to its own core module later (commit, recompute, loading and saving jobs → step 14; map and setup redraws → steps 10 and 12),
// and the screens then import it directly.
export const host = {
  /** Record a change to the open job: recalculate, schedule the save, count the edit. */
  commit: () => { throw new Error('host.commit used before configureHost'); },
  /** The save queue, an immediate write, changes not yet in the job file, and the notice after an older job is updated. */
  saver: null,
  writeNow: () => { throw new Error('host.writeNow used before configureHost'); },
  fileChanges: () => { throw new Error('host.fileChanges used before configureHost'); },
  showMigrationNotes: () => { throw new Error('host.showMigrationNotes used before configureHost'); },
  /** Schedule a save of the open job without recalculating; check device storage after adding photos. */
  scheduleSave: () => { throw new Error('host.scheduleSave used before configureHost'); },
  checkStorage: () => { throw new Error('host.checkStorage used before configureHost'); },
  /** Recalculate the open job's layout and results (no save). */
  recompute: () => { throw new Error('host.recompute used before configureHost'); },
  /** Reload the jobs list / tank registry from the device. */
  loadJobs: () => { throw new Error('host.loadJobs used before configureHost'); },
  loadTanks: () => { throw new Error('host.loadTanks used before configureHost'); },
  /** Store a new job and open it; ask before leaving a job with unsaved changes. */
  createJob: () => { throw new Error('host.createJob used before configureHost'); },
  leaveJobOk: () => { throw new Error('host.leaveJobOk used before configureHost'); },
  /** The recovery journal of unsaved changes (created with the save queue). */
  journal: null,
  /** Job file and save steps (steps 13–14): write now, header, open, import a file, remember its file handle. */
  flushSave: () => { throw new Error('host.flushSave used before configureHost'); },
  renderHeader: () => { throw new Error('host.renderHeader used before configureHost'); },
  openJob: () => { throw new Error('host.openJob used before configureHost'); },
  importJobFile: () => { throw new Error('host.importJobFile used before configureHost'); },
  rememberFile: () => { throw new Error('host.rememberFile used before configureHost'); },
  /** Floor map redraws (step 12) and the tank setup preview (step 10), used by the nozzle editor. */
  drawMap: () => { throw new Error('host.drawMap used before configureHost'); },
  renderSide: () => { throw new Error('host.renderSide used before configureHost'); },
  setMode: () => { throw new Error('host.setMode used before configureHost'); },
  refreshSetupPreview: () => { throw new Error('host.refreshSetupPreview used before configureHost'); },
};
export function configureHost(h) { Object.assign(host, h); }
