// Inspection equipment: one list per job; each NDE method picks the items it used.
// Self-contained (no imports) so the model can use it without import cycles.

export const EQ_TYPES = [
  ['mfl', 'MFL floor scanner'],
  ['refplate', 'MFL reference plate'],
  ['ut', 'UT thickness gauge / flaw detector'],
  ['probe', 'UT probe / transducer'],
  ['block', 'UT calibration block'],
  ['scanner', 'UT scanner (B / C-scan)'],
  ['level', 'Level / total station'],
  ['vacbox', 'Vacuum box'],
  ['mt', 'MT yoke / consumables'],
  ['pt', 'PT kit'],
  ['holiday', 'Holiday tester'],
  ['hard', 'Hardness tester'],
  ['vt', 'Visual tools (light, gauges, mirror)'],
  ['camera', 'Camera'],
  ['other', 'Other']
];
export const EQ_LABEL = Object.fromEntries(EQ_TYPES);
/** Hint for the settings / details field, by type. */
export const EQ_DETAIL_PH = {
  mfl: 'Sensitivity, coil / sensor settings, scan speed', refplate: 'Thickness, defect sizes', ut: 'Velocity, mode (echo-echo / P-E), range',
  probe: 'Frequency, diameter, dual / single', block: 'Material, step thicknesses', scanner: 'Encoder, gate, resolution', level: 'Accuracy, rod',
  vacbox: 'Pressure, solution', mt: 'Technique, particles, lift test', pt: 'Penetrant, developer, dwell', holiday: 'Voltage', hard: 'Scale, load'
};

/** Which equipment types each NDE method normally uses (for auto-selection). */
const METHOD_TYPES = {
  'MFL floor scan': ['mfl', 'refplate'],
  'UT thickness': ['ut', 'probe', 'block'],
  'UT scanning (B / C-scan)': ['ut', 'scanner', 'probe', 'block'],
  'Visual (VT)': ['vt', 'camera'],
  'Level / settlement survey': ['level'],
  'Vacuum box': ['vacbox'],
  'MT': ['mt'],
  'PT': ['pt'],
  'Hardness': ['hard'],
  'Holiday / coating test': ['holiday'],
  'Seal gap survey': ['vt']
};

let seq = 0;
const eid = () => 'eq' + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

export function newEquip(type = 'other', fields = {}) {
  return { id: eid(), type, make: '', model: '', serial: '', calDate: '', calDue: '', details: '', threshold: '', notes: '', ...fields };
}

/** v3.4 and earlier kept a fixed MFL / UT form in job.equip — turn it into list items. */
export function equipFromLegacy(E = {}) {
  const out = [], s = (v) => (v == null ? '' : String(v).trim());
  if ([E.mflMake, E.mflModel, E.mflSerial, E.mflCal, E.mflSettings, E.mflThreshold].some(s)) out.push(newEquip('mfl', { make: s(E.mflMake), model: s(E.mflModel), serial: s(E.mflSerial), calDate: s(E.mflCal), details: s(E.mflSettings), threshold: s(E.mflThreshold) }));
  if (s(E.mflRef)) out.push(newEquip('refplate', { model: s(E.mflRef) }));
  if ([E.utMake, E.utModel, E.utSerial].some(s)) out.push(newEquip('ut', { make: s(E.utMake), model: s(E.utModel), serial: s(E.utSerial) }));
  if (s(E.utProbe)) out.push(newEquip('probe', { model: s(E.utProbe) }));
  if (s(E.utBlock)) out.push(newEquip('block', { model: s(E.utBlock) }));
  if (s(E.vtTools)) out.push(newEquip('vt', { model: s(E.vtTools) }));
  return out;
}

/** Equipment ids that suit an NDE method, in the method's usual order (empty when nothing matches). */
export function suggestEquip(list, method) {
  const types = METHOD_TYPES[method] || [];
  // the first item of each matching type (e.g. one probe even when two are listed)
  return types.map((t) => (list || []).find((e) => e.type === t)).filter(Boolean).map((e) => e.id);
}

export const equipName = (e) => [e.make, e.model].filter(Boolean).join(' ') || EQ_LABEL[e.type] || 'Equipment';
/** One-line description for reports: "Make Model (S/N 123)". */
export const equipLine = (e) => equipName(e) + (e.serial ? ` (S/N ${e.serial})` : '');

/** Calibration state against the inspection date: '', 'soon' (within 30 days) or 'expired'. */
export function calState(e, onDate) {
  if (!e.calDue) return '';
  const due = new Date(e.calDue + 'T12:00'), ref = new Date((onDate || new Date().toISOString().slice(0, 10)) + 'T12:00');
  if (isNaN(due) || isNaN(ref)) return '';
  if (due < ref) return 'expired';
  return (due - ref) / 864e5 <= 30 ? 'soon' : '';
}

/** Where each item is used: Map id → ['Floor · MFL floor scan', …]. */
export function equipUse(job, sections, inScope = () => true) {
  const use = new Map();
  for (const s of sections) {
    if (!inScope(job, s.key)) continue;
    for (const n of job.secs?.[s.key]?.nde || []) for (const id of n.equip || []) {
      if (!use.has(id)) use.set(id, []);
      const lab = `${s.label} · ${n.method}`; if (!use.get(id).includes(lab)) use.get(id).push(lab);
    }
  }
  return use;
}

/** The UT instrument and probe for the UT loader sheet (created on demand when importing). */
export function utKit(job, create = false) {
  job.equipment = job.equipment || [];
  let ut = job.equipment.find((e) => e.type === 'ut'), probe = job.equipment.find((e) => e.type === 'probe');
  if (create && !ut) { ut = newEquip('ut'); job.equipment.push(ut); }
  if (create && !probe) { probe = newEquip('probe'); job.equipment.push(probe); }
  return { ut, probe };
}

/** Group "Section · Method" uses by method: ["UT thickness: Floor, Shell", …]. */
export function useByMethod(uses = []) {
  const m = new Map();
  for (const u of uses) { const i = u.indexOf(' · '); const sec = u.slice(0, i), meth = u.slice(i + 3); if (!m.has(meth)) m.set(meth, []); m.get(meth).push(sec); }
  return [...m].map(([meth, secs]) => `${meth}: ${secs.join(', ')}`);
}
