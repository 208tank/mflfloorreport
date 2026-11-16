// Small tank report template (schema 6): the checklist data behind the short report for small-diameter tanks.
// The report itself follows the order of SMALL_ORDER; the checklist screen (views/small.js) uses the same order.
// No standards text is stored here: limits taken from API 12R1 (or a company rule) are entered by the user from
// their own licensed copy, with the clause number they came from.
const uidS = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Report template per job. '' = not chosen yet (new jobs): the full report, with the small one suggested. */
export const TEMPLATES = [['full', 'Full API 653 report'], ['small', 'Small tank report']];
export const templateOf = (job) => (job?.template === 'small' ? 'small' : 'full');
export const isSmall = (job) => templateOf(job) === 'small';

/** Diameter below which the small template is suggested (device setting, mm). Default 40 ft. */
export const SMALL_MAX_D = 40 * 304.8;
export const smallMaxD = (company) => (Number(company?.smallMaxD) > 0 ? Number(company.smallMaxD) : SMALL_MAX_D);
/** Show the suggestion? Only while no template has been chosen. */
export const suggestSmall = (job, company) => !job?.template && !job?.regEdit && Number(job?.tank?.diameter) > 0 && job.tank.diameter < smallMaxD(company);

/** Read a threshold typed as "40", "40 ft", "12 m" or "12192 mm" (feet when no unit). Returns mm or null. */
export function parseDiameter(text) {
  const m = /^\s*([\d.]+)\s*(ft|feet|'|m|mm)?\s*$/i.exec(String(text ?? ''));
  if (!m || !(+m[1] > 0)) return null;
  const u = (m[2] || 'ft').toLowerCase();
  return Math.round(+m[1] * (u === 'm' ? 1000 : u === 'mm' ? 1 : 304.8) * 10) / 10;
}

export const TITLES = [['oos', 'Out of Service Tank Inspection Report (Small Diameter)'], ['ins', 'In Service Tank Inspection Report (Small Diameter)']];
export const titleOf = (job) => (TITLES.find(([k]) => k === job?.small?.title) || TITLES[0])[1];

export const RATINGS = [['good', 'Good'], ['fair', 'Fair'], ['poor', 'Poor'], ['na', 'N/A']];
export const RATING_LABEL = Object.fromEntries(RATINGS);

/** The 16 checklist items, in report order. sec: the inspection section whose data and recommendations go with it. */
export const ITEMS = [
  { k: 'x-lot', grp: 'ext', label: 'Tank lot and containment', sec: 'found' },
  { k: 'x-proj', grp: 'ext', label: 'Floor projections and shell-to-floor weld', sec: 'found', table: 'proj' },
  { k: 'x-shell', grp: 'ext', label: 'Tank shell', sec: 'shell' },
  { k: 'x-roof', grp: 'ext', label: 'Fixed roof', sec: 'froof' },
  { k: 'x-noz', grp: 'ext', label: 'Nozzles and piping', sec: 'nozzles' },
  { k: 'x-instr', grp: 'ext', label: 'Instrumentation', sec: 'shell' },
  { k: 'x-opp', grp: 'ext', label: 'Over-pressure protection', sec: 'froof', table: 'opp' },
  { k: 'x-settle', grp: 'ext', label: 'Settlement', sec: 'settle', table: 'tilt' },
  { k: 'i-floor', grp: 'int', label: 'Tank floor', sec: 'floor' },
  { k: 'i-fsw', grp: 'int', label: 'Floor-to-shell weld', sec: 'floor' },
  { k: 'i-shell', grp: 'int', label: 'Tank shell', sec: 'shell' },
  { k: 'i-roof', grp: 'int', label: 'Fixed roof', sec: 'froof' },
  { k: 'i-noz', grp: 'int', label: 'Nozzles', sec: 'nozzles' },
  { k: 'i-acc', grp: 'int', label: 'Accessories', sec: 'shell' },
  { k: 'i-edge', grp: 'int', label: 'Edge settlement', sec: 'settle', table: 'edge' },
  { k: 'insul', grp: 'insul', label: 'Insulation and cladding', sec: 'shell' }
];
export const ITEM = new Map(ITEMS.map((i) => [i.k, i]));
export const GROUPS = [['ext', 'External'], ['int', 'Internal'], ['insul', 'Insulation']];

export const COMPASS = ['N', 'E', 'S', 'W'];
export const SETTLE_BASIS = [['small', 'Small-tank planar method'], ['653', 'API 653 Annex B'], ['12r1', 'API 12R1 (limits entered)']];
export const INTERVAL_BASIS = [['653', 'API 653'], ['12r1', 'API 12R1 (rules entered)']];
export const FIT = [['', '—'], ['fit', 'Fit for continued service'], ['unfit', 'Unfit for continued service']];
/** Interval overrides: [key, label]. Blank = use the calculated value (stage S2). */
export const INTERVALS = [['ut', 'UT thickness'], ['ext', 'In service (external)'], ['int', 'Out of service (internal)']];

export const newProj = (loc) => ({ id: uidS(), loc, t: null, len: null });
export const newDevice = (o = {}) => ({ id: uidS(), dev: '', serial: '', press: '', vac: '', svc: '', ...o });
export const newStation = (loc) => ({ id: uidS(), loc, elev: null, lean: null });
export const newEdge = (st) => ({ id: uidS(), st: String(st), max: null, bo: null });

export function defaultSmall() {
  return {
    title: 'oos', items: {},
    proj: COMPASS.map(newProj), opp: [], tilt: COMPASS.map(newStation), level: 1219.2, edge: [1, 2, 3, 4].map(newEdge),
    basis: { settle: 'small', intervals: '653' },
    lim: { twist: null, plumb: null, edge: null, edgeDist: null, refs: '', edgeRefs: '' }, // entered limits (12R1 or company); blank = none
    r12int: { ut: null, ext: null, int: null, refs: '' },                      // 12R1 interval rules, years, entered
    intOv: { utDone: '', utNot: '', extDone: '', extNot: '', intDone: '', intNot: '' },
    followup: '', fit: '', fitNote: ''
  };
}

const arr = (a, fb) => (Array.isArray(a) ? a : fb);
const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
/** Fill in a stored small-tank block from the defaults (safe to repeat). */
export function migrateSmall(s) {
  const b = defaultSmall(), x = obj(s);
  const items = {};
  for (const [k, v] of Object.entries(obj(x.items))) if (ITEM.has(k) && v && typeof v === 'object') items[k] = { rating: v.rating || '', text: v.text || '' };
  return {
    ...b, ...x, items,
    proj: arr(x.proj, b.proj), opp: arr(x.opp, b.opp), tilt: arr(x.tilt, b.tilt), edge: arr(x.edge, b.edge),
    basis: { ...b.basis, ...obj(x.basis) }, lim: { ...b.lim, ...obj(x.lim) }, r12int: { ...b.r12int, ...obj(x.r12int) }, intOv: { ...b.intOv, ...obj(x.intOv) }
  };
}

/** Checklist progress: items rated / 16. */
export const progress = (job) => ITEMS.filter((i) => job?.small?.items?.[i.k]?.rating).length;
