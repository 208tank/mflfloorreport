// Shared application state and constants (refactoring step 1, moved unchanged from app.js).
import { RESULTS } from '../calc.js';

export const APP_VERSION = '3.12.5';

export const S = {
  jobs: [], tanks: [], reg: { q: '', open: new Set() }, job: null, layout: null, calc: null, photos: [], company: {},
  view: 'jobs', sel: null, selPlate: null, selFeature: null, selNozzle: null, mode: 'select', ftType: 'column',
  plateLabels: true, indLabels: true, showCZ: true, showPatches: true, showDatums: true, filter: new Set(Object.keys(RESULTS)),
  search: '', resFilter: 'all', sort: { key: 'no', dir: 1 }, plateSearch: '',
  reportOpts: { exec: true, defs: true, sections: true, indSize: true, photos: true, plates: false, provenOnly: false, plateLabels: true, datums: true },
  mapCtl: null, vb: null, roofSel: null, roofPt: null, roofAdd: false, roofVB: { fixed: null, floating: null }, installEvt: null, saving: false,
  navOpen: new Set(), ndeTab: {}, dash: { dir: null, perm: null, files: new Map(), scanned: false, scanning: false, mode: 'board', q: '', stage: '' }, roofPart: 'fixed', photoSel: null
};

export const VIEWS = [
  ['dash', 'Dashboard', 'M4 4h7v9H4zM13 4h7v5h-7zM13 11h7v9h-7zM4 15h7v5H4z'],
  ['reg', 'Tank registry', 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3v12c0 1.7-3.6 3-8 3s-8-1.3-8-3zM4 6c0 1.7 3.6 3 8 3s8-1.3 8-3M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
  ['jobs', 'Jobs', 'M4 5h16M4 12h16M4 19h10'],
  ['setup', 'Tank setup', 'M12 3v3m0 12v3M3 12h3m12 0h3M6 6l2 2m8 8 2 2M6 18l2-2m8-8 2-2M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z'],
  ['equip', 'Equipment', 'M14 6l4 4-8 8H6v-4zM12 8l4 4M4 20h16'],
  ['summary', 'Executive summary', 'M5 4h14v16H5zM8 8h8M8 12h8M8 16h5']
];
export const VIEWS_END = [
  ['defs', 'Deficiencies', 'M12 3 2 20h20zM12 10v4M12 17h.01'],
  ['ref', 'Code tables', 'M4 4h16v16H4zM4 9h16M4 14h16M9 4v16'],
  ['report', 'Report', 'M6 3h9l4 4v14H6zM14 3v5h5']
];
export const CHILD_ICON = { nde: 'M3 12h4l3-8 4 16 3-8h4', obs: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', photos: 'M4 7h4l2-3h4l2 3h4v12H4zM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', an: 'M4 19V5M4 19h16M8 15l4-5 3 3 5-6', recs: 'M9 11l3 3 8-8M20 12v7H4V5h11' };

export const REG_VIEWS = ['setup', 'map', 'shell', 'nozzles', 'roofF', 'roofL', 'seal', 'settle'];
export const RESULT_OPTS = Object.entries(RESULTS);
export const VT_COND = ['', 'None visible', 'Isolated pit', 'Pitting cluster', 'General corrosion', 'Lake / area corrosion', 'Weld corrosion', 'Mechanical damage', 'Lamination / inclusion', 'Other'];
export const COATING = ['', 'None', 'Intact', 'Blistered', 'Disbonded', 'Failed / missing'];
export const UT_METHOD = ['', 'A-scan', 'B-scan', 'C-scan / mapping', 'Thickness gauge', 'Other'];
export const REPAIR_METHOD = ['', 'Patch plate (lap welded)', 'Weld build-up', 'Insert plate', 'Plate replacement', 'Coating / lining', 'Monitor', 'Other'];
export const NZ_TYPES = ['Nozzle', 'Manway', 'Inlet', 'Outlet', 'Water draw / drain', 'Clean-out door', 'Mixer', 'Level / instrument', 'Other'];
export const nzPrefix = (t) => (/manway/i.test(t) ? 'MH' : /clean-out/i.test(t) ? 'CO' : 'N');
export function nextMark(type) {
  const pre = nzPrefix(type); let max = 0;
  for (const n of S.job.nozzles || []) { const m = String(n.mark || '').match(new RegExp('^' + pre + '(\\d+)$')); if (m) max = Math.max(max, +m[1]); }
  return pre + (max + 1);
}
export const FT_TYPES = [['column', 'Roof column'], ['sump', 'Sump'], ['patch', 'Patch plate / repair'], ['nozzle', 'Nozzle / fitting'], ['manway', 'Manway'], ['other', 'Other']];
