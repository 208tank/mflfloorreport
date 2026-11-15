// Storage panel (data integrity stage 12), on the Jobs page: how full the device is and what uses the space, whether
// the browser keeps the data, days since the last backup, and the revision history that is kept.
import { S } from '../app/state.js';
import { onAction } from '../app/actions.js';
import { go } from '../app/nav.js';
import { PHOTO_STOP, STORAGE_LEVELS, storageEstimate } from '../app/persist.js';
import { pruneJob } from '../app/revisions.js';
import { db } from '../db.js';
import { KEEP } from '../prune.js';
import { $, toast } from '../ui.js';
import { esc as h } from '../util.js';

const DAY = 86400000;
const mb = (b) => (b >= 1073741824 ? (b / 1073741824).toFixed(1) + ' GB' : b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : b > 0 ? Math.max(1, Math.round(b / 1024)) + ' kB' : 'nothing');
let sizes = null, sizesAt = 0;

/** Days without a backup after which the panel reminds: the automatic backup interval if one is set, else 14. */
export const backupRemindDays = () => S.backup?.days || 14;
/** Days since the last backup or, on a device never backed up, since its oldest job; and whether that is overdue. */
function backupAge() {
  const last = S.backup?.last?.at || null, oldest = Math.min(...(S.jobs || []).map((j) => j.created || j.updated || Date.now()));
  const days = Math.floor((Date.now() - (last || oldest)) / DAY);
  return { last, days, overdue: !!(S.jobs || []).length && days >= backupRemindDays() };
}

export function storageCardHTML() {
  return `<h2>Storage on this device</h2><div id="storagePanel"><p class="muted">Checking storage…</p></div>
    <p class="muted small">Each job keeps its newest ${KEEP.checkpoint} daily checkpoints and newest ${KEEP.other} other revisions. Revisions saved to a job file and issued reports are always kept. Older ones remain in the job files and backups made from them.</p>
    <div class="acts"><button class="btn sm" data-act="prune-all">Tidy revision history now</button> <button class="btn sm" data-act="persist">Ask the browser to keep this data</button></div>`;
}

export async function afterStorage() {
  const el = $('#storagePanel'); if (!el) return;
  const [est, pers] = await Promise.all([storageEstimate(), navigator.storage?.persisted?.().catch(() => null)]);
  if (!sizes || !sizes.jobs || Date.now() - sizesAt > 15000) { sizes = await db.sizes().catch(() => null); sizesAt = Date.now(); } // a moment's cache: the Jobs page redraws often
  if (!$('#storagePanel')) return;
  const level = est ? [...STORAGE_LEVELS].reverse().find((l) => est.full >= l) : null;
  const pct = est ? Math.round(est.full * 100) : null;
  const { last, days, overdue } = backupAge(), remind = backupRemindDays();
  el.innerHTML = `${est ? `<div class="meter ${level ? 'lvl-' + Math.round(level * 100) : ''}" role="meter" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="Storage used"><span style="width:${Math.min(100, pct)}%"></span>${STORAGE_LEVELS.map((l) => `<i style="left:${l * 100}%"></i>`).join('')}</div>
    <p id="storageInfo" class="${level ? 'warn-txt' : ''}">Using ${mb(est.usage)} of ${mb(est.quota)} available (${pct} %).${level ? (est.full >= PHOTO_STOP ? ' <b>Full: new photos can’t be added.</b> Save jobs to files and delete finished ones.' : level >= 0.85 ? ' Nearly full: save jobs to files and delete finished ones now.' : ' Getting full: save finished jobs to files and delete them when you can.') : ''}</p>` : '<p id="storageInfo" class="muted">This browser doesn’t say how much space is available.</p>'}
    ${sizes ? `<p class="muted small" id="storageSplit">About ${mb(sizes.jobs)} in jobs · ${mb(sizes.photos)} in photos · ${mb(sizes.history)} in revision history and the audit trail${sizes.binned ? ` · ${mb(sizes.binned)} in removed photos that revisions still show` : ''}.</p>` : ''}
    <p id="storagePersist" class="${pers ? '' : 'warn-txt'}">${pers ? '<b>Persistent:</b> the browser won’t clear this data to free up space.' : '<b>Best-effort:</b> if the device runs low on space, the browser may clear this app’s data without asking. Installing the app usually makes it persistent; keep job files and backups.'}</p>
    <p id="storageBackup" class="${overdue ? 'warn-txt' : 'muted'}">${last ? `Last backup ${days === 0 ? 'today' : days === 1 ? 'yesterday' : days + ' days ago'}.` : 'This device has not been backed up yet.'}${overdue ? ` Back up now (below): it’s been ${days} days${last ? '' : ' since the first job on this device'}, and the reminder comes after ${remind}.` : ''}</p>`;
}

/** At start-up: remind once a day when a backup is overdue. */
export async function remindBackup() {
  try {
    const { last, days, overdue } = backupAge();
    if (!overdue) return;
    const at = await db.getMeta('backup:reminded').catch(() => 0);
    if (at && Date.now() - at < DAY) return;
    await db.setMeta('backup:reminded', Date.now());
    toast(last ? `This device was last backed up ${days} days ago.` : 'This device has not been backed up yet.', { label: 'Back up', fn: () => { go('jobs'); $('#backupCard')?.scrollIntoView({ block: 'center' }); } });
  } catch { /* reminders are a convenience */ }
}

onAction({
  'prune-all': async () => {
    let r = 0, p = 0;
    for (const j of await db.allCards()) { const x = await pruneJob(j.id).catch(() => ({ revisions: 0, photos: 0 })); r += x.revisions; p += x.photos; }
    sizes = null;
    toast(r || p ? `Removed ${r} older revision${r === 1 ? '' : 's'}${p ? ` and ${p} removed photo${p === 1 ? '' : 's'} no revision shows` : ''}.` : 'Nothing to tidy: every job is within what is kept.');
    afterStorage();
  },
});

