// Inspection personnel: one list per job (report improvements R2, schema 5). Replaces the three name fields
// (info.mflTech, info.utTech, info.inspector), which the schema 5 migration turns into entries here.
// Self-contained (no imports) so the model can use it without import cycles.

export const ROLES = [
  ['insp653', 'API 653 inspector'],
  ['mfl', 'MFL operator'],
  ['ut', 'UT technician'],
  ['vt', 'Visual inspector'],
  ['survey', 'Settlement surveyor'],
  ['engineer', 'Engineer'],
  ['assist', 'Assistant / helper'],
  ['other', 'Other'],
];
export const ROLE_LABEL = Object.fromEntries(ROLES);

/** Certification schemes offered in the list (the field also takes free text). Names only. */
export const CERTS = ['API 653', 'API 650', 'ASNT SNT-TC-1A', 'ASNT ACCP', 'CGSB (CAN/CGSB-48.9712)', 'ISO 9712 / PCN', 'AWS CWI', 'STI SP001', 'Other'];

/** The old name fields and the role each becomes. */
export const LEGACY = [['inspector', 'insp653', ''], ['mflTech', 'mfl', 'MFL'], ['utTech', 'ut', 'UT']];

let seq = 0;
const pid = () => 'pe' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

export function newPerson(role = 'other', fields = {}) {
  return { id: pid(), role, name: '', company: '', cert: role === 'insp653' ? 'API 653' : '', certNo: '', method: '', level: '', expiry: '', ...fields };
}

/** Schema 5 migration: personnel entries from the three name fields (blank names are skipped). */
export function personnelFromLegacy(info = {}) {
  const out = [];
  for (const [f, role, method] of LEGACY) {
    const name = String(info[f] ?? '').trim();
    if (name) out.push(newPerson(role, { name, method }));
  }
  return out;
}

/** The name in a role — the first person listed in it; for a job not yet updated, the old name field. */
export function personName(job, role) {
  const p = (job?.personnel || []).find((x) => x.role === role && x.name);
  if (p) return p.name;
  const l = LEGACY.find(([, r]) => r === role);
  return (l && job?.info?.[l[0]]) || '';
}

/** Set the name in a role: the first person in it, or a new entry. A blank name leaves an existing entry blank. */
export function setPersonName(job, role, name) {
  job.personnel = job.personnel || [];
  const p = job.personnel.find((x) => x.role === role);
  if (p) p.name = name;
  else if (String(name || '').trim()) job.personnel.push(newPerson(role, { name, method: LEGACY.find(([, r]) => r === role)?.[2] || '' }));
}

/** Certificate state against the inspection date: '', 'soon' (within 30 days) or 'expired'. */
export function certState(p, onDate) {
  if (!p.expiry) return '';
  const due = new Date(p.expiry + 'T12:00'), ref = new Date((onDate || new Date().toISOString().slice(0, 10)) + 'T12:00');
  if (isNaN(due) || isNaN(ref)) return '';
  if (due < ref) return 'expired';
  return (due - ref) / 864e5 <= 30 ? 'soon' : '';
}

/** "Name (Company)" lines for a role, for signature blocks. */
export const peopleIn = (job, role) => (job?.personnel || []).filter((p) => p.role === role && p.name);
