// Job model helpers.
import { equipFromLegacy, suggestEquip } from './equipment.js';
import { defaultLayout, buildLayout, toFloor, toLocal } from './geometry.js';
import { defaultCalc } from './calc.js';
import { defaultShell, migrateShell } from './shell.js';
import { defaultRoof, migrateRoof } from './roof.js';
import { defaultSettle, migrateSettle } from './settle.js';
import { defaultSecs, migrateSecs, defaultSummary } from './sections.js';

export const STAGES = [['upcoming', 'Upcoming'], ['inspection', 'Inspection ongoing'], ['reporting', 'Reporting'], ['review', 'Peer review'], ['complete', 'Complete']];
export const STAGE_LABEL = Object.fromEntries(STAGES);
export const defaultStatus = () => ({ stage: 'upcoming', planned: '', due: '', inspector: '', reviewer: '', notes: '', history: [] });

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Job data version this copy of the app understands. Bump it whenever a release changes the job
 *  structure, so older installed copies refuse those files instead of re-saving them without the new data. */
export const SCHEMA = 3;
/** Job file (container) format version. */
export const FILE_VERSION = 1;

export function newJob(units = 'imperial') {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: uid(), app: 'tank-floor-inspector', schema: SCHEMA, created: Date.now(), updated: Date.now(), units,
    info: { client: '', site: '', tankId: '', product: '', reportNo: '', workOrder: '', inspDate: today, zeroRef: 'N', mflTech: '', utTech: '', inspector: '', notes: '' },
    tank: { diameter: null, tBottom: units === 'metric' ? 6 : 6.35, tAnnular: null, bottomType: 'Lap welded', coating: 'None', cp: false, rpb: false, yearBuilt: '', lastInternal: '', code: 'API 650', edition: '', supp: '', sg: null, fillH: null, opTemp: null },
    layout: units === 'metric' ? { ...defaultLayout(), plateW: 2400, plateL: 9000, annW: 600 } : defaultLayout(),
    equip: {}, equipment: [],
    calc: units === 'metric' ? { ...defaultCalc(), czDist: 75, mrtBottom: 2.5, patchMargin: 50 } : defaultCalc(),
    plates: {}, indications: [], features: [], nozzles: [], shell: defaultShell(units), roof: defaultRoof(units), settle: defaultSettle(units),
    secs: defaultSecs(), summary: defaultSummary(), defSeq: 0, status: { ...defaultStatus(), history: [{ stage: 'upcoming', at: Date.now() }] }
  };
}

/** What migrate() will change in this (raw, stored) job, in plain words, so the user is told when an
 *  older job is updated rather than finding a setting changed. Empty for current jobs. */
export function migrationNotes(job) {
  const out = [];
  if (job.calc?.patchMargin === 25.4) out.push('Patch plates now extend at least 2 in past the corrosion (was 1 in; API 653 §9.11.1.1 c).');
  if ((job.schema || 1) < 2 && (job.indications || []).length) out.push('Indication X / Y on plates cut by the shell are now measured from the plate edges; positions on the floor are unchanged.');
  if (!Array.isArray(job.equipment) && job.equip && Object.values(job.equip).some(Boolean)) out.push('MFL / UT equipment moved to the Equipment list.');
  if ((job.schema || 1) < 3) {
    const c = job.calc || {};
    if (c.mrtAnnular === 2.54) out.push('Annular plate limit: the old 0.10 in default is replaced by the API 653 Table 4.5 / API 650 Table 5.1 value where it can be calculated (§4.4.6). Enter a limit to override.');
    if (c.mflThresholdPct === undefined && (job.indications || []).length) out.push('UPr now includes the MFL threshold (default 20 % of nominal, API 653 §4.4.5.1 Note 1). Change it on the API 653 page.');
    if ((job.indications || []).some((i) => i.repair === 'yes' || i.repairMethod)) out.push('Repaired soil-side locations now keep their corrosion rate in UPr unless "cause of corrosion removed" is ticked, and only welded repairs remove a location from RT (API 653 §4.4.5.1 Note 1, §4.4.5.5–6).');
    out.push('Calculations follow the approved corrections (critical-zone limit per §4.4.5.4, rate basis, coating / CP checks). Results may differ from the last report.');
  }
  return out;
}

/** Bring older / imported jobs up to the current shape. */
export function migrate(job) {
  const base = newJob(job.units || 'imperial');
  const out = {
    ...base, ...job,
    info: { ...base.info, ...(job.info || {}) },
    tank: { ...base.tank, ...(job.tank || {}) },
    layout: { ...base.layout, ...(job.layout || {}) },
    equip: { ...(job.equip || {}) },
    calc: { ...base.calc, ...(job.calc || {}) },
    plates: job.plates || {}, indications: job.indications || [], features: job.features || [], nozzles: job.nozzles || [],
    shell: migrateShell(job.shell, job.units || 'imperial'),
    roof: migrateRoof(job.roof, job.units || 'imperial'),
    settle: migrateSettle(job.settle, job.units || 'imperial'),
    secs: migrateSecs(job.secs), summary: { ...defaultSummary(), ...(job.summary || {}) }, defSeq: job.defSeq || 0,
    status: job.status ? { ...defaultStatus(), ...job.status } : { ...defaultStatus(), stage: (job.indications || []).length || job.rev ? 'inspection' : 'upcoming' }
  };
  // v3.4.2: equipment is a list; NDE methods reference the items they used.
  if (!Array.isArray(job.equipment)) {
    out.equipment = equipFromLegacy(job.equip);
    for (const sec of Object.values(out.secs || {})) for (const n of sec.nde || []) if (!Array.isArray(n.equip)) n.equip = suggestEquip(out.equipment, n.method);
  } else out.equipment = job.equipment;
  if (out.calc.patchMargin === 25.4) out.calc.patchMargin = 50.8; // v3.1 default was 1 in; API 653 §9.11.1.1 c asks for 2 in
  // schema 3 (calculation review): the old 0.10 in annular default becomes "auto" (Table 4.5 / 5.1 value, §4.4.6)
  if ((job.schema || 1) < 3) { if (job.calc?.mrtAnnular === 2.54) out.calc.mrtAnnular = null; }
  // schema 2: X/Y on shell-cut plates are measured from the plate edges, not the seam/shell point.
  // Convert older jobs so their indications stay where they were on the floor.
  if ((job.schema || 1) < 2) {
    try {
      const oldL = buildLayout(out, { legacySnap: true }), newL = buildLayout(out);
      for (const it of [...out.indications, ...out.features]) {
        const po = oldL.byKey.get(it.plate), pn = newL.byKey.get(it.plate);
        if (!po || !pn || !po.datum?.snapped || it.x == null || it.y == null) continue;
        const f = toFloor(oldL, po, it.x, it.y), l = toLocal(newL, pn, f.x, f.y);
        it.x = Math.round(Math.max(0, l.X) * 10) / 10; it.y = Math.round(Math.max(0, l.Y) * 10) / 10;
      }
    } catch { /* leave as is */ }
  }
  out.schema = Math.max(job.schema || 1, SCHEMA);
  return out;
}

export function nextNo(job) {
  let max = 0;
  for (const i of job.indications || []) { const m = String(i.no || '').match(/(\d+)(?!.*\d)/); if (m) max = Math.max(max, +m[1]); }
  return String(max + 1).padStart(3, '0');
}

export function getPath(o, path) { return path.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
export function setPath(o, path, v) {
  const ks = path.split('.'); let a = o;
  for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] == null || typeof a[ks[i]] !== 'object') a[ks[i]] = {}; a = a[ks[i]]; }
  a[ks[ks.length - 1]] = v;
}

/** Copies of a job's photos with new ids, for a duplicated job. Recommendations in `job` that link
 *  to a photo are pointed at the new copy, so the duplicate's report keeps its photos. */
export function copyPhotos(job, photos) {
  const map = new Map(photos.map((p) => [p.id, uid()]));
  for (const sec of Object.values(job.secs || {})) for (const r of sec.recs || []) if (r.photo && map.has(r.photo)) r.photo = map.get(r.photo);
  return photos.map((p) => ({ ...p, id: map.get(p.id), jobId: job.id }));
}
