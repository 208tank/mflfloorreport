// Tank registry: the static data of a tank (identity, construction, floor layout, nozzles, shell
// courses, roof and settlement set-up), entered once and copied into each new inspection.
// An inspection keeps its own copy, so a finished report always shows the tank as inspected.
import { setPersonName } from './personnel.js';
import { newJob, migrate, uid } from './model.js';
import { UT_CLOCK } from './calc.js';
import { SECTIONS } from './sections.js';

const clone = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));
const omit = (o, keys) => { const out = { ...(o || {}) }; for (const k of keys) delete out[k]; return out; };
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o && o[k] !== undefined).map((k) => [k, o[k]]));

export const SCOPE = SECTIONS.map((s) => [s.key, s.label]);
export const SCOPE_HINT = { floor: 'MFL scan, UT prove-up, plates', shell: 'Shell UT by course', froof: 'Fixed roof UT', flroof: 'Deck, pontoons, rim seal', nozzles: 'Nozzle UT', found: 'Visual', settle: 'Settlement survey' };
/** Old jobs have no scope: everything is in scope. */
export const inScope = (job, key) => !Array.isArray(job?.scope) || job.scope.includes(key);
export const scopeText = (keys) => SECTIONS.filter((s) => keys.includes(s.key)).map((s) => s.label).join(', ');

/** Per-inspection fields — never kept in the registry. */
const TANK_PER_INSP = ['sg', 'fillH', 'opTemp'];
/** Plate fields that describe the plate itself (the rest — scan, UT min, notes — are readings). */
const PLATE_GEOM = ['label', 'len', 'wid', 'orient', 'tNom', 'datumC'];
const NOZZLE_READ = [...UT_CLOCK.map(([k]) => k), 'utx', 'utNotes', 'cond'];

export const normKey = (...parts) => parts.map((x) => String(x || '').trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
export const tankKeyOf = (t) => normKey(t.info?.client, t.info?.site, t.info?.tankId);

/** Floor layout, plate geometry and floor features (columns, sumps, patches) of a job or tank. */
export function floorFrom(src) {
  const plates = {};
  for (const [k, o] of Object.entries(src.plates || {})) { const g = pick(o, PLATE_GEOM); if (Object.keys(g).length) plates[k] = g; }
  return { layout: clone(src.layout), plates, features: clone(src.features || []) };
}

/** The static part of a job, ready to store as (or over) a registry record. */
export function staticFrom(job) {
  const R = job.roof || {}, St = job.settle || {}, Sh = job.shell || {};
  return {
    units: job.units || 'imperial',
    info: pick(job.info || {}, ['client', 'site', 'tankId', 'zeroRef']),
    tank: clone(omit(job.tank, TANK_PER_INSP)),
    ...floorFrom(job),
    nozzles: (job.nozzles || []).map((n) => clone(omit(n, NOZZLE_READ))),
    calc: clone(job.calc),
    shell: clone(pick(Sh, ['courses', 'nLoc', 'start', 'zones', 'extraZ'])),
    roof: clone({
      type: R.type,
      fixed: R.fixed ? { ...omit(R.fixed, ['notes', 'pts']), pts: (R.fixed.pts || []).map((p) => omit(p, ['t', 'notes'])) } : undefined,
      floating: R.floating ? omit(R.floating, ['ut', 'pont', 'notes']) : undefined,
      seal: R.seal ? { std: R.seal.std, custom: R.seal.custom, primary: pick(R.seal.primary, ['type', 'shoeAbove', 'shoeBelow', 'shoeHeight']), secondary: pick(R.seal.secondary, ['type']) } : undefined
    }),
    settle: clone({ ...pick(St, ['n', 'start', 'eu', 'rod', 'benchmark', 'Y', 'E', 'yeAuto', 'H', 'curveMode', 'kRoof', 'arcs', 'curve', 'curveSrc']), ep: pick(St.ep, ['at0', 'tol', 'zones']) })
  };
}

export function tankFromJob(job, prev = null) {
  const s = staticFrom(job), now = Date.now();
  return {
    id: prev?.id || uid(), kind: 'tank', created: prev?.created || now, updated: now, ...s,
    info: { location: '', notes: '', ...(prev?.info || {}), ...s.info }
  };
}

export function newTank(units = 'imperial') { const t = tankFromJob(newJob(units)); t.info.tankId = ''; return t; }

/** Overlay a tank's static data onto a fresh job (used both for new inspections and to edit the tank). */
export function applyTank(j, t, { floor = null } = {}) {
  const b = newJob(t.units || 'imperial');
  j.units = t.units || j.units;
  Object.assign(j.info, pick(t.info || {}, ['client', 'site', 'tankId', 'zeroRef']));
  j.tank = { ...b.tank, ...clone(t.tank), ...pick(j.tank, TANK_PER_INSP) };
  const F = floor || floorFrom(t);
  j.layout = { ...b.layout, ...clone(F.layout) }; j.plates = clone(F.plates) || {}; j.features = clone(F.features) || [];
  j.nozzles = clone(t.nozzles || []);
  j.calc = { ...b.calc, ...clone(t.calc || {}) };
  j.shell = { ...b.shell, ...clone(t.shell || {}) };
  const r = clone(t.roof || {});
  j.roof = { ...b.roof, type: r.type || b.roof.type, fixed: { ...b.roof.fixed, ...(r.fixed || {}) }, floating: { ...b.roof.floating, ...(r.floating || {}) },
    seal: { ...b.roof.seal, ...(r.seal ? { std: r.seal.std || b.roof.seal.std, custom: r.seal.custom || b.roof.seal.custom } : {}), primary: { ...b.roof.seal.primary, ...(r.seal?.primary || {}) }, secondary: { ...b.roof.seal.secondary, ...(r.seal?.secondary || {}) } } };
  const s = clone(t.settle || {});
  j.settle = { ...b.settle, ...s, ep: { ...b.settle.ep, ...(s.ep || {}) } };
  return j;
}

/**
 * New inspection job for a tank.
 * floorSrc: 'registry' | 'last' (as-found layout of the last inspection) | 'new' (floor replaced — blank layout).
 */
export function jobFromTank(t, { scope, floorSrc = 'registry', last = null, copyEquip = true, info = {} } = {}) {
  const j = newJob(t.units || 'imperial');
  let floor = null;
  if (floorSrc === 'last' && last) floor = floorFrom(last);
  else if (floorSrc === 'new') {
    const b = newJob(t.units || 'imperial');
    floor = { layout: { ...b.layout, plateW: t.layout?.plateW ?? b.layout.plateW, plateL: t.layout?.plateL ?? b.layout.plateL, annular: !!t.layout?.annular, annW: t.layout?.annW ?? b.layout.annW }, plates: {}, features: [] };
  }
  applyTank(j, t, { floor });
  if (last) {
    if (copyEquip) { j.equip = clone(last.equip || {}); j.equipment = clone(last.equipment || []); }
    j.info.product = last.info?.product || '';
    for (const k of TANK_PER_INSP) if (last.tank?.[k] != null) j.tank[k] = last.tank[k];
    j.tank.lastInternal = last.info?.inspDate || j.tank.lastInternal;
  }
  const { inspector = '', ...rest } = info;
  Object.assign(j.info, rest);
  if (String(inspector).trim()) setPersonName(j, 'insp653', String(inspector).trim());
  if (last?.info?.reportNo && !j.tank.prevReport) j.tank.prevReport = [last.info.reportNo, last.info.inspDate].filter(Boolean).join(', ');
  j.tankRef = t.id;
  j.scope = scope && scope.length ? [...scope] : SECTIONS.map((s) => s.key);
  j.summary.scope = scopeText(j.scope);
  return migrate(j);
}

/** Edit copy: the tank shown as a job so the normal setup, floor map and section pages can edit it. */
export function editJobFor(t) {
  const j = applyTank(newJob(t.units || 'imperial'), t);
  j.id = 'reg:' + t.id; j.regEdit = t.id; j.scope = ['floor', 'shell', 'froof', 'flroof', 'nozzles', 'settle'];
  j.info.inspDate = ''; j.status = { ...j.status, stage: 'upcoming' };
  return migrate(j);
}

/** Does a job's static data differ from its registry record? Returns the parts that differ. */
export function diffFromTank(job, t) {
  if (!t) return [];
  const a = staticFrom(job), b = staticFrom(migrate(applyTank(newJob(t.units || 'imperial'), t)));
  for (const x of [a, b]) delete x.tank.lastInternal; // set from the previous inspection's date, not a tank change
  const parts = [['info', 'Identity'], ['tank', 'Tank details'], ['layout', 'Floor layout'], ['plates', 'Plate sizes / labels'], ['features', 'Floor features & patches'], ['nozzles', 'Nozzles'], ['shell', 'Shell courses'], ['roof', 'Roof'], ['settle', 'Settlement set-up']];
  const same = (x, y) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  return parts.filter(([k]) => !same(a[k], b[k])).map(([, l]) => l);
}
