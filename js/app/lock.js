// The Complete lock (data integrity stage 8b): a Complete job's report has been issued, so its inspection data is
// read-only until the job is reopened with a reason. Three layers: inputs on the job's screens are disabled, the
// action and change dispatch refuse anything that isn't on the view-only list, and saving refuses a change to a
// locked job's content (persist.js). Core module.
import { S } from './state.js';
import { setActionGuard } from './actions.js';
import { renderView } from './nav.js';
import { isLocked } from './revisions.js';
import { $, toast } from '../ui.js';

/** Screens that don't edit the open job: never locked. */
const FREE_VIEWS = new Set(['dash', 'reg', 'jobs', 'report', 'revs', 'audit', 'ref', 'defrep']);
/** Buttons and fields that only look, navigate, select, filter or export: allowed on a locked job. */
const VIEW_ONLY = new Set(['zoom-in', 'zoom-out', 'zoom-fit', 'filter', 'sort', 'def-filter', 'toggle', 'resfilter', 'search', 'plate-search',
  'ind-nav', 'ind-pick', 'ind-show', 'ind-zoom', 'ind-close', 'open-ind', 'sel-ind', 'close-sel', 'photo-view', 'rsel', 'rsel-close', 'rsel-nav',
  'nav-sec', 'print', 'ropt', 'file-save', 'file-save-as', 'job-save', 'reopen']);
const LOCK_MSG = 'This job is Complete and its report has been issued, so it is read-only. Use Reopen in the header to change it.';

/** Is the screen showing a locked job's data? */
export function lockedNow() {
  return !!S.job && !S.job.regEdit && isLocked(S.job) && !FREE_VIEWS.has(S.view);
}

/** May this element be used on a locked job? */
export function allowedWhenLocked(el) {
  if (el.matches('[data-go]')) return true;
  if (el.dataset.bind === 'status.stage') return true; // changing the stage reopens it, with a reason
  const act = el.dataset.act;
  if (act === 'mode') return el.dataset.mode === 'select';
  if (act) return VIEW_ONLY.has(act) || act.startsWith('exp-') || act.startsWith('rev-');
  if (el.matches('button')) return !Object.keys(el.dataset).some((k) => !['cf', 'rv', 'tab'].includes(k)) || !!el.closest('.nav, header');
  return false; // a field bound to the job some other way (data-sh…, data-ep…, …)
}

const inLockedArea = (el) => !!el.closest?.('#main, #dlg');

/** Disable everything on the job's screens that would change it. */
export function applyLock() {
  if (!lockedNow()) return;
  for (const root of [$('#main'), $('#dlg')]) {
    if (!root) continue;
    for (const el of root.querySelectorAll('input, select, textarea, button')) {
      if (el.disabled || allowedWhenLocked(el)) continue;
      el.disabled = true; el.classList.add('locked-off'); el.title = el.title || 'Locked: the job is Complete';
    }
  }
}

let toastAt = 0;
setActionGuard((el, kind) => {
  if (!lockedNow() || !inLockedArea(el) || allowedWhenLocked(el)) return true;
  if (Date.now() - toastAt > 3000) { toastAt = Date.now(); toast(LOCK_MSG); }
  if (kind === 'change') renderView(); // put the field back as it was
  return false;
});

// re-apply after every redraw of the job's screens (screens draw with innerHTML; attributes aren't watched)
const obs = new MutationObserver(() => applyLock());
for (const id of ['#main', '#dlg']) { const el = $(id); if (el) obs.observe(el, { childList: true, subtree: true }); }
