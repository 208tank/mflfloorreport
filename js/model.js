// Job model helpers.
import { equipFromLegacy, suggestEquip } from './equipment.js';
import { defaultLayout } from './geometry.js';
import { JOB_STEPS, JOB_SCHEMA, pendingSteps, runJobSteps, stepNotes } from './migrations.js';
import { defaultCalc } from './calc.js';
import { defaultShell, migrateShell } from './shell.js';
import { defaultRoof, migrateRoof } from './roof.js';
import { defaultSettle, migrateSettle } from './settle.js';
import { defaultSecs, migrateSecs, defaultSummary } from './sections.js';
import { defaultSmall, migrateSmall } from './small.js';
import { defaultFloorUT, migrateFloorUT } from './floorut.js';

export const STAGES = [['upcoming', 'Upcoming'], ['inspection', 'Inspection ongoing'], ['reporting', 'Reporting'], ['review', 'Peer review'], ['admin', 'Admin review'], ['complete', 'Complete']];
export const STAGE_LABEL = Object.fromEntries(STAGES);
export const defaultStatus = () => ({ stage: 'upcoming', planned: '', due: '', inspector: '', reviewer: '', notes: '', history: [] });

/** Document control (schema 5): prepared / reviewed / approved dates and names, distribution list. The peer
 *  reviewer's name stays in status.reviewer. */
export const defaultDocCtl = () => ({ preparedBy: '', preparedDate: '', reviewedDate: '', approvedBy: '', approvedDate: '', dist: [] });

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Job data version this copy of the app understands. Bump it whenever a release changes the job
 *  structure, so older installed copies refuse those files instead of re-saving them without the new data. */
export const SCHEMA = JOB_SCHEMA;
/** Job file (container) format version. */
export const FILE_VERSION = 2; // 2: the issued report and the audit trail (data integrity stage 8c)

export function newJob(units = 'imperial') {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: uid(), app: 'tank-floor-inspector', schema: SCHEMA, created: Date.now(), updated: Date.now(), units,
    info: { client: '', owner: '', site: '', location: '', tankId: '', product: '', service: '', reportNo: '', workOrder: '', jobNo: '', poNo: '', inspDate: today, zeroRef: 'N', notes: '' },
    tank: { diameter: null, height: null, tBottom: units === 'metric' ? 6 : 6.35, tAnnular: null, bottomType: 'Lap welded', coating: 'None', cp: false, rpb: false, yearBuilt: '', lastInternal: '', prevReport: '', code: 'API 650', edition: '', supp: '', sg: null, fillH: null, opTemp: null, src: {}, maker: '', serialNo: '', capacity: '', matFloor: '', matShell: '', matRoof: '' },
    personnel: [], repairs: {}, docctl: defaultDocCtl(),
    template: '', small: defaultSmall(), // schema 6: report template ('' = not chosen) and the small-tank checklist
    layout: units === 'metric' ? { ...defaultLayout(), plateW: 2400, plateL: 9000, annW: 600 } : defaultLayout(),
    equip: {}, equipment: [],
    calc: units === 'metric' ? { ...defaultCalc(), czDist: 75, mrtBottom: 2.5, patchMargin: 50 } : defaultCalc(),
    plates: {}, indications: [], features: [], nozzles: [], floorUT: defaultFloorUT(units), shell: defaultShell(units), roof: defaultRoof(units), settle: defaultSettle(units),
    secs: defaultSecs(), summary: defaultSummary(), defSeq: 0, status: { ...defaultStatus(), history: [{ stage: 'upcoming', at: Date.now() }] }
  };
}

/** What migrate() will change in this (raw, stored) job, in plain words, so the user is told when an
 *  older job is updated rather than finding a setting changed. Empty for current jobs. */
export function migrationNotes(job) {
  const out = [];
  if (job.calc?.patchMargin === 25.4) out.push('Patch plates now extend at least 2 in past the corrosion (was 1 in; API 653 §9.11.1.1 c).');
  if (!Array.isArray(job.equipment) && job.equip && Object.values(job.equip).some(Boolean)) out.push('MFL / UT equipment moved to the Equipment list.');
  return [...out, ...stepNotes(job)];
}

/** Fill in every field a current job has, from the defaults (not versioned: safe to repeat). */
function normalise(job) {
  const base = newJob(job.units || 'imperial');
  const out = {
    ...base, ...job,
    info: { ...base.info, ...(job.info || {}) },
    tank: { ...base.tank, ...(job.tank || {}), src: { ...((job.tank || {}).src || {}) } },
    personnel: Array.isArray(job.personnel) ? job.personnel : [], repairs: job.repairs && typeof job.repairs === 'object' && !Array.isArray(job.repairs) ? job.repairs : {},
    docctl: { ...defaultDocCtl(), ...(job.docctl || {}), dist: Array.isArray(job.docctl?.dist) ? job.docctl.dist : [] },
    template: ['full', 'small'].includes(job.template) ? job.template : '', small: migrateSmall(job.small),
    layout: { ...base.layout, ...(job.layout || {}) },
    equip: { ...(job.equip || {}) },
    calc: { ...base.calc, ...(job.calc || {}) },
    plates: job.plates || {}, indications: job.indications || [], features: job.features || [], nozzles: job.nozzles || [],
    floorUT: migrateFloorUT(job.floorUT, job.units || 'imperial'),
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
  return out;
}

/**
 * Bring older / imported jobs up to the current shape: normalise, then run the job migration steps the
 * job still needs (migrations.js). When a step will run, it works on a copy, so a step that throws leaves
 * `job` exactly as it was. `log` (optional array) receives one entry per step run.
 */
export function migrate(job, { log = null, steps = JOB_STEPS, appVersion = '' } = {}) {
  const src = pendingSteps(job, steps).length ? structuredClone(job) : job;
  const out = normalise(src);
  const done = runJobSteps(out, src, steps, appVersion);
  if (log) log.push(...done);
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
