// Job model helpers.
import { defaultLayout, buildLayout, toFloor, toLocal } from './geometry.js';
import { defaultCalc } from './calc.js';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function newJob(units = 'imperial') {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: uid(), app: 'tank-floor-inspector', schema: 2, created: Date.now(), updated: Date.now(), units,
    info: { client: '', site: '', tankId: '', product: '', reportNo: '', workOrder: '', inspDate: today, zeroRef: 'N', mflTech: '', utTech: '', inspector: '', notes: '' },
    tank: { diameter: null, tBottom: units === 'metric' ? 6 : 6.35, tAnnular: null, bottomType: 'Lap welded', coating: 'None', cp: false, rpb: false, yearBuilt: '', lastInternal: '' },
    layout: units === 'metric' ? { ...defaultLayout(), plateW: 2400, plateL: 9000, annW: 600 } : defaultLayout(),
    equip: {},
    calc: units === 'metric' ? { ...defaultCalc(), czDist: 75 } : defaultCalc(),
    plates: {}, indications: [], features: [], nozzles: []
  };
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
    plates: job.plates || {}, indications: job.indications || [], features: job.features || [], nozzles: job.nozzles || []
  };
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
    out.schema = 2;
  }
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
