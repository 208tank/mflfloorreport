// Compare two versions of a job, field by field (data integrity stage 8: Revisions → Compare). No browser APIs.
// Lists of items with ids are matched by id; file and save bookkeeping is ignored.
import { SEC } from './sections.js';

/** Fields that record a job's file and save bookkeeping rather than its content. */
export const BOOKKEEPING = ['rev', 'savedAt', 'revisions', 'updated', 'edits', 'editAreas', 'issued'];

const AREA = { info: 'Job', tank: 'Tank', layout: 'Floor layout', calc: 'API 653 settings', status: 'Stage', summary: 'Executive summary', shell: 'Shell', roof: 'Roof', settle: 'Settlement', plates: 'Plate', indications: 'Indication', features: 'Floor feature', nozzles: 'Nozzle', equipment: 'Equipment', personnel: 'Personnel', repairs: 'Repair status', docctl: 'Document control', secs: 'Section', scope: 'Scope', units: 'Units', template: 'Report template', small: 'Small tank checklist', floorUT: 'Floor UT' };
const IGNORE = new Set([...BOOKKEEPING, 'status.history']);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keyed = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => isObj(x) && typeof x.id === 'string');
const itemName = (x, i, list) => x.no || x.mark || x.label || x.method || x.item || x.finding || x.make || x.name || x.check || (list ? `${list} ${i + 1}` : x.id);
const LIST = { areas: 'Area', courses: 'Course', zones: 'Zone', edge: 'Edge area', dep: 'Depression', pts: 'Point', gaps: 'Gap', checks: 'Check', dist: 'Copy', nde: 'NDE', obs: 'Observation', recs: 'Recommendation', rows: 'Row', mrows: 'Row', proj: 'Projection', opp: 'Device', tilt: 'Station' };
const SUB = { cz: 'Critical zone scans', areas: 'Areas', nde: 'NDE', obs: 'Observations', recs: 'Recommendations', courses: 'Courses', rd: 'UT readings (station › elevation)', items: 'Checklist items', lim: 'Entered limits', intOv: 'Interval overrides', basis: 'Basis', ut: 'UT readings', pont: 'Pontoons', el: 'Station elevations', src: 'Data sources', assess: 'Engineering assessment', scope: 'Scope and limitations' };
const show = (v) => (v === undefined || v === null || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 80) + (JSON.stringify(v).length > 80 ? '…' : '') : String(v));

/** Values as the audit trail keeps them: text and numbers as they are, anything else as its JSON. */
const raw = (v) => (v === undefined ? null : v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

/** Rows { area, item, field, before, after } for everything that differs between job a and job b.
 *  For the screen, values are shortened text. { raw: true } (the audit trail) keeps them whole, and an added or
 *  removed item carries its content. Each row also has `path`, where the value lives (e.g. indications.ab12.mflPct). */
export function diffJobs(a, b, { raw: keep = false } = {}) {
  const rows = [];
  const val = keep ? raw : show;
  const add = (where, field, before, after, path = '') => rows.push({ ...where, field, before: val(before), after: val(after), ...(keep ? { path } : {}) });
  // path: the field's pattern ('[]' for any item, used for IGNORE); loc: where it is (item ids spelled out)
  const walk = (x, y, path, where, key = '', loc = '') => {
    if (IGNORE.has(path)) return;
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    if (keyed(x) || keyed(y)) {
      const list = LIST[key], name = (o, arr) => `${where.item ? where.item + ' › ' : ''}${itemName(o, arr.indexOf(o), list)}`;
      const xs = x || [], ys = y || [], xa = new Map(xs.map((o) => [o.id, o])), ya = new Map(ys.map((o) => [o.id, o]));
      for (const [id, o] of xa) {
        if (!ya.has(id)) add({ ...where, item: name(o, xs) }, '(item)', keep ? o : 'present', keep ? null : 'removed', `${loc}.${id}`);
        else walk(o, ya.get(id), path + '[]', { ...where, item: name(ya.get(id), ys) }, key, `${loc}.${id}`);
      }
      for (const [id, o] of ya) if (!xa.has(id)) add({ ...where, item: name(o, ys) }, '(item)', keep ? null : '—', keep ? o : 'added', `${loc}.${id}`);
      return;
    }
    if (isObj(x) && isObj(y)) {
      for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
        if (k === 'id') continue;
        const p = path ? `${path}.${k}` : k, l = loc ? `${loc}.${k}` : k;
        if (!path) walk(x[k], y[k], p, { area: AREA[k] || k, item: '' }, k, l);
        else if (path === 'plates') walk(x[k], y[k], p, { ...where, item: k }, k, l);
        else if (path === 'secs') walk(x[k], y[k], p, { ...where, item: SEC.get(k)?.label || k }, k, l);
        else if (keyed(x[k]) || keyed(y[k])) walk(x[k], y[k], p, where, k, l);
        else walk(x[k], y[k], p, (isObj(x[k]) || isObj(y[k])) && !path.endsWith('[]') ? { ...where, item: where.item ? `${where.item} › ${SUB[k] || k}` : SUB[k] || k } : where, k, l);
      }
      return;
    }
    add(where, key, x, y, loc);
  };
  walk(a || {}, b || {}, '', { area: '', item: '' });
  return rows;
}
