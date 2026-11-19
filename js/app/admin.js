// Admin mode (v3.40.0): entering the admin PIN on this device makes this session an admin until it is left or the
// app is closed. The rules are in roles.js; this module keeps the session, the PIN (as a hash) in the company
// settings, and learns the PIN from a job that carries one. Core module.
import { S } from './state.js';
import { onAction } from './actions.js';
import { renderAll } from './nav.js';
import { db } from '../db.js';
import { adminFor, pinHash } from '../roles.js';
import { askSecret, toast } from '../ui.js';

S.admin = S.admin || { on: false, hash: '', name: '', at: 0 };

/** Is this session an admin for the open job (or the job given)? */
export const isAdmin = (job = S.job) => adminFor(job, S.admin);
export const adminName = () => (S.admin.on ? S.admin.name || S.company?.inspector || 'admin' : '');

async function saveCompany() { await db.setMeta('company', S.company).catch(() => {}); }

/** A job that carries the admin PIN teaches it to a device that has none (so the PIN travels with the job files). */
export async function adoptPin(job) {
  if (job?.adminPin && !S.company?.adminPin) { S.company = { ...(S.company || {}), adminPin: job.adminPin }; await saveCompany(); }
}

/** The PIN a job is stamped with when it reaches Peer review: the job's own, this admin's, or this device's. */
export const pinForJob = (job) => job?.adminPin || (S.admin.on ? S.admin.hash : '') || S.company?.adminPin || '';

export async function enterAdmin() {
  if (!S.company?.adminPin) {
    const pin = await askSecret('No admin PIN is set on this device yet. Set one now: give it only to the people who approve reports.\n\nJobs sent to Peer review carry it, so other devices learn it when they open those jobs.', { ok: 'Set PIN and enter admin mode', confirm: true, label: 'New admin PIN' });
    if (!pin) return false;
    S.company = { ...(S.company || {}), adminPin: await pinHash(pin) }; await saveCompany();
    S.admin = { on: true, hash: S.company.adminPin, name: S.company?.inspector || '', at: Date.now() };
  } else {
    const pin = await askSecret('Enter the admin PIN to switch this device into admin mode until you leave it or close the app.', { ok: 'Enter admin mode', label: 'Admin PIN' });
    if (!pin) return false;
    const hash = await pinHash(pin);
    // the device's PIN, or the PIN of the open job (an older PIN it was stamped with)
    if (hash !== S.company.adminPin && hash !== S.job?.adminPin) { toast('That PIN is not right.'); return false; }
    S.admin = { on: true, hash, name: S.company?.inspector || '', at: Date.now() };
  }
  renderAll(); toast(`Admin mode on${S.admin.name ? ' — ' + S.admin.name : ''}. Changes and unlocks are recorded with your name.`);
  return true;
}
export function exitAdmin() { S.admin = { on: false, hash: '', name: '', at: 0 }; renderAll(); toast('Admin mode off.'); }

export async function changePin() {
  if (!S.admin.on) { toast('Enter admin mode first.'); return; }
  const pin = await askSecret('Choose the new admin PIN. Jobs already stamped with the old PIN keep it; they still unlock with the old PIN.', { ok: 'Change PIN', confirm: true, label: 'New admin PIN' });
  if (!pin) return;
  const hash = await pinHash(pin);
  S.company = { ...(S.company || {}), adminPin: hash }; await saveCompany();
  S.admin = { ...S.admin, hash }; renderAll(); toast('Admin PIN changed on this device.');
}

onAction({
  'admin-enter': async () => { await enterAdmin(); },
  'admin-exit': async () => exitAdmin(),
  'admin-pin': async () => changePin(),
});
