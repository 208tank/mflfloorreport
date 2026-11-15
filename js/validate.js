// Job file validation (data integrity stage 6). Runs before an imported job file changes anything on the device.
// No browser APIs here, so the tests run it in Node.
//
// Errors block the import: anything that would break the app or let an edit land on the wrong item — not a job file,
// a newer file, missing or wrong-typed parts, items without an id, duplicate ids, a value that is not a number where
// a number is needed, photos without image data, a checksum that doesn't match, a job that can't be updated to this
// version. Warnings are listed and the user may open the file anyway: values outside their normal range and
// references to things that aren't there (a plate not in the layout, a photo linked to a missing indication…).
// Checks run on a migrated copy, so a file from an older version is judged on the same terms as a new one.
import { migrate } from './model.js';
import { buildLayout } from './geometry.js';
import { SEC } from './sections.js';
import { sha256 } from './util.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const blank = (v) => v === null || v === undefined || v === '';
/** A number, or text that reads as one (a hand-edited file may store a number as text). */
const numeric = (v) => (typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v));

// field → [label, min, max, minExclusive]; a value outside the range is a warning
const T = (label) => [label, 0, Infinity, true];          // thickness and sizes: more than 0
const POS = (label) => [label, 0, Infinity, false];       // distances: 0 or more
const ANG = (label) => [label, 0, 360, false];
const NUM = {
  tank: { diameter: T('Diameter'), tBottom: T('Bottom nominal thickness'), tAnnular: T('Annular nominal thickness'), sg: T('Specific gravity'), fillH: POS('Maximum fill height'), opTemp: ['Operating temperature', -Infinity, Infinity] },
  layout: { plateW: T('Plate width'), plateL: T('Plate length'), annW: T('Annular plate width') },
  indication: { x: POS('X'), y: POS('Y'), mflPct: ['MFL %', 0, 100], len: T('Length'), wid: T('Width'), utMin: T('UT minimum'), utNom: T('UT nominal'), vtDepth: POS('VT pit depth'), repLen: T('Repair length'), repWid: T('Repair width'), repT: T('Patch thickness') },
  feature: { x: POS('X'), y: POS('Y'), sizeA: T('Size'), sizeB: T('Size') },
  nozzle: { angle: ANG('Angle'), size: T('Size'), tNom: T('Nominal wall'), tMin: T('t-min'), ut12: T('UT 12 o’clock'), ut3: T('UT 3 o’clock'), ut6: T('UT 6 o’clock'), ut9: T('UT 9 o’clock') },
  plate: { tNom: T('Nominal thickness'), utMin: T('UT minimum'), len: T('Length'), wid: T('Width') },
  course: { h: T('Height'), tNom: T('Nominal thickness'), tMin: T('t-min'), pn: ['Number of plates', 1, Infinity], seam0: ANG('First seam angle'), plen: T('Plate length') },
};

/**
 * Check a parsed job file. Returns { errors: [text], warnings: [text], job } — job is the migrated copy, with numbers
 * stored as text converted to numbers; it is what the import stores (null when the file can't be read as a job).
 * The file itself is not changed. opts: { schema, fileVersion } of this app.
 */
export async function validateJobFile(data, { schema = Infinity, fileVersion = Infinity } = {}) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  // ---- the file itself
  if (!isObj(data) || data.format !== 'tank-floor-inspector') return { errors: ['This is not a Tank Floor Inspector job file.'], warnings, job: null };
  if (!isObj(data.job)) return { errors: ['The file has no job in it.'], warnings, job: null };
  if ((data.version || 1) > fileVersion || (data.job.schema || 1) > schema) return { errors: [`It was saved by a newer version of the app${data.appVersion ? ' (v' + data.appVersion + ')' : ''}. Reload the app to update it, then open the file again.`], warnings, job: null };
  if (typeof data.job.id !== 'string' || !data.job.id) err('The job has no id.');
  if (data.photos !== undefined && !Array.isArray(data.photos)) err('The photos part of the file is not a list.');
  if (data.hash !== undefined && (typeof data.hash !== 'string' || data.hash !== (await sha256(data.job)))) err('The job’s checksum does not match: the file has been changed or damaged since it was saved.');
  for (const k of ['info', 'tank', 'layout', 'plates']) if (data.job[k] !== undefined && !isObj(data.job[k])) err(`The job’s ${k} part has the wrong type.`);
  for (const k of ['indications', 'features', 'nozzles', 'equipment']) if (data.job[k] !== undefined && !Array.isArray(data.job[k])) err(`The job’s ${k} part is not a list.`);
  if (errors.length) return { errors, warnings, job: null };
  // ---- update a copy to this version
  let job;
  try { job = migrate(structuredClone(data.job)); }
  catch (e) { return { errors: [`The job could not be updated to this version of the app (${e.message}).`], warnings, job: null }; }
  for (const k of ['info', 'tank', 'layout', 'plates']) if (!isObj(job[k])) err(`The job has no ${k} part.`);
  for (const k of ['indications', 'features']) if (!Array.isArray(job[k])) err(`The job has no ${k} list.`);
  if (errors.length) return { errors, warnings, job };

  // ---- ids: every item in a list has one, and no two share it
  const lists = [
    ['Indication', job.indications, (x) => x.no], ['Floor feature', job.features, (x) => x.label || x.type], ['Nozzle', job.nozzles, (x) => x.mark],
    ['Equipment item', job.equipment, (x) => [x.make, x.model, x.serial].filter(Boolean).join(' ')], ['Shell course', job.shell?.courses, null],
    ['Settlement edge area', job.settle?.edge, null], ['Bottom depression', job.settle?.dep, null], ['Fixed roof UT point', job.roof?.fixed?.pts, (x) => x.label],
    ['Primary seal gap', job.roof?.seal?.primary?.gaps, null], ['Secondary seal gap', job.roof?.seal?.secondary?.gaps, null],
    ...Object.entries(job.secs || {}).flatMap(([k, s]) => [['NDE method', s?.nde, (x) => x.method, k], ['Observation', s?.obs, (x) => x.item, k], ['Recommendation', s?.recs, (x) => x.no || x.finding, k]]),
  ];
  for (const [what, list, name, sec] of lists) {
    if (list === undefined || list === null) continue;
    if (!Array.isArray(list)) { err(`${what}s: not a list.`); continue; }
    const seen = new Map(), where = sec ? ` (${SEC.get(sec)?.label || sec})` : '';
    list.forEach((x, i) => {
      if (!isObj(x)) { err(`${what} ${i + 1}${where} is not a valid entry.`); return; }
      if (typeof x.id !== 'string' || !x.id) { err(`${what} ${name?.(x) || i + 1}${where} has no id.`); return; }
      if (seen.has(x.id)) err(`${what}s ${name?.(seen.get(x.id)) || ''} and ${name?.(x) || ''}${where} share the id ${x.id}: edits would change both.`.replace(/\s+/g, ' '));
      else seen.set(x.id, x);
    });
  }
  const photos = data.photos || [], photoIds = new Map();
  photos.forEach((p, i) => {
    if (!isObj(p) || typeof p.id !== 'string' || !p.id) { err(`Photo ${i + 1} has no id.`); return; }
    if (photoIds.has(p.id)) err(`Two photos share the id ${p.id}.`); else photoIds.set(p.id, p);
    if (typeof p.dataUrl !== 'string' || !p.dataUrl.startsWith('data:image/')) err(`Photo ${p.caption ? '“' + p.caption + '”' : i + 1} has no image data.`);
  });

  // ---- numbers: a number (or text that reads as one) where one is needed; normal ranges
  const checkNums = (o, spec, label) => {
    if (!isObj(o)) return;
    for (const [k, [name, min, max, minEx]] of Object.entries(spec)) {
      const v = o[k]; if (blank(v)) continue;
      if (!numeric(v)) { err(`${label}: ${name} is “${String(v).slice(0, 30)}”, which is not a number.`); continue; }
      const n = +v;
      // the calculations need real numbers: text that reads as one is converted in the copy that will be stored
      if (typeof v === 'string') { o[k] = n; warn(`${label}: ${name} was stored as the text “${v}” — it will be read as the number ${n}.`); }
      if (n < min || (minEx && n === min) || n > max) warn(`${label}: ${name} is ${n}${max === Infinity ? (minEx ? ' — expected more than ' + min : ' — expected ' + min + ' or more') : ` — expected ${min} to ${max}`}.`);
    }
  };
  checkNums(job.tank, NUM.tank, 'Tank');
  checkNums(job.layout, NUM.layout, 'Plate layout');
  for (const x of job.indications) checkNums(x, NUM.indication, `Indication ${x.no || x.id}`);
  for (const x of job.features) checkNums(x, NUM.feature, `Floor feature ${x.label || x.type || x.id}`);
  for (const x of job.nozzles || []) checkNums(x, NUM.nozzle, `Nozzle ${x.mark || x.id}`);
  for (const [k, p] of Object.entries(job.plates)) checkNums(p, NUM.plate, `Plate ${p?.label || k}`);
  (job.shell?.courses || []).forEach((c, i) => checkNums(c, NUM.course, `Shell course ${i + 1}`));
  const nos = new Map();
  for (const x of job.indications) { if (!blank(x.no)) { if (nos.has(String(x.no))) warn(`Two indications are numbered ${x.no}.`); nos.set(String(x.no), x); } }

  // ---- references
  let plateKeys = null;
  try { plateKeys = buildLayout(job).byKey; } catch { /* layout can't be built: reported by the calculation */ }
  if (plateKeys?.size) {
    for (const x of job.indications) if (x.plate && !plateKeys.has(x.plate)) warn(`Indication ${x.no || x.id} is on plate ${x.plate}, which is not in the floor layout.`);
    for (const x of job.features) if (x.plate && !plateKeys.has(x.plate)) warn(`Floor feature ${x.label || x.type || x.id} is on plate ${x.plate}, which is not in the floor layout.`);
  }
  const indIds = new Set(job.indications.map((x) => x.id)), eqIds = new Set((job.equipment || []).map((e) => e.id));
  for (const p of photos) {
    if (!isObj(p)) continue;
    const name = p.caption ? `Photo “${p.caption}”` : `Photo ${p.id}`;
    if (p.indId && !indIds.has(p.indId)) warn(`${name} belongs to an indication that is not in the job.`);
    if (p.sec && !SEC.has(p.sec)) warn(`${name} is in an unknown section (${p.sec}).`);
    if (p.sec && p.obs && !(job.secs?.[p.sec]?.obs || []).some((o) => o.id === p.obs)) warn(`${name} is linked to an observation that is not in the job.`);
  }
  for (const [k, s] of Object.entries(job.secs || {})) {
    for (const r of s?.recs || []) if (r?.photo && !photoIds.has(r.photo)) warn(`Recommendation ${r.no || r.finding || r.id} (${SEC.get(k)?.label || k}) shows a photo that is not in the file.`);
    for (const n of s?.nde || []) for (const e of n?.equip || []) if (!eqIds.has(e)) warn(`NDE method ${n.method || n.id} (${SEC.get(k)?.label || k}) uses equipment that is not in the job’s equipment list.`);
  }
  return { errors, warnings, job };
}
