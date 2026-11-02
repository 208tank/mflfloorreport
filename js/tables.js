// Reference tables taken from the inspector's AcuTank workbook ("Dropdown Menus", "Project and Tank Data",
// "Hidden Edge Settlement Sheet", "Nozzle Data (2)", "Annular Calculations" sheets) so the app uses the same
// values: API 653 Table 4.1 materials and allowable stresses, Young's modulus, Tables 4.2 / 4.3 joint
// efficiencies, construction codes / editions / supplements, the API 653 Fig. B.11 / B.12 edge-settlement
// curves, the B.3.2.2 K table, API 653 Table 4.5 and API 650 Table 5.1b annular plate thickness and the
// nozzle neck wall tables. Stresses in psi (MPa columns as in the workbook), thicknesses in inches.

export const TABLES_SOURCE = 'AcuTank workbook reference tables (API 653 Tables 4.1, 4.2, 4.3, 4.5; API 650 Table 5.1b; API 653 Fig. B.11 / B.12; B.3.2.2)';

/* ------------------------------------------------------------ materials (API 653 Table 4.1) --- */
// [spec, Y, T, Sd lower two courses, Sd upper courses, St lower two, St upper, E (psi),
//  Y MPa, T MPa, Sd lower MPa, Sd upper MPa, St lower MPa, St upper MPa, E MPa]
export const MATERIALS = [
  ["ASTM A516 Gr. 55", 30000, 55000, 23600, 26000, 26000, 27000, 29400000, 207, 379, 163, 179, 179, 186, 202706],
  ["ASTM A516 Gr. 60", 32000, 60000, 25600, 28200, 28200, 28800, 29400000, 221, 414, 177, 194, 194, 199, 202706],
  ["ASTM A516 Gr. 65", 35000, 65000, 27900, 30700, 30700, 31500, 29400000, 241, 448, 192, 212, 212, 217, 202706],
  ["ASTM A516 Gr. 70", 38000, 70000, 30000, 33000, 33000, 34200, 29400000, 262, 483, 207, 228, 228, 236, 202706],
  ["ASTM A662 Gr. B", 40000, 65000, 27900, 30700, 30700, 33700, 29400000, 276, 448, 192, 212, 212, 232, 202706],
  ["ASTM A662 Gr. C", 43000, 70000, 30000, 33000, 33000, 36300, 29400000, 296, 483, 207, 228, 228, 250, 202706],
  ["ASTM A537 Gr. 1", 50000, 70000, 30000, 33000, 33000, 36300, 29400000, 345, 483, 207, 228, 228, 250, 202706],
  ["ASTM A537 Gr. 2", 60000, 80000, 34300, 37800, 37800, 41500, 29400000, 414, 552, 236, 261, 261, 286, 202706],
  ["ASTM A633 Gr. C", 50000, 70000, 30000, 33000, 33000, 36300, 29400000, 345, 483, 207, 228, 228, 250, 202706],
  ["ASTM A633 Gr. D", 50000, 70000, 30000, 33000, 33000, 36300, 29400000, 345, 483, 207, 228, 228, 250, 202706],
  ["ASTM A678 Gr. A", 50000, 70000, 30000, 33000, 33000, 36300, 29400000, 345, 483, 207, 228, 228, 250, 202706],
  ["ASTM A678 Gr. B", 60000, 80000, 34300, 37800, 37800, 41500, 29400000, 414, 552, 236, 261, 261, 286, 202706],
  ["ASTM A283 Gr. C", 30000, 55000, 23600, 26000, 26000, 27000, 29400000, 207, 379, 163, 179, 179, 186, 202706],
  ["ASTM A285 Gr. C", 30000, 55000, 23600, 26000, 26000, 27000, 29400000, 207, 379, 163, 179, 179, 186, 202706],
  ["ASTM A131 Gr. A", 34000, 58000, 24900, 27400, 27400, 30100, 29400000, 234, 400, 172, 189, 189, 208, 202706],
  ["ASTM A131 Gr. B", 34000, 58000, 24900, 27400, 27400, 30100, 29400000, 234, 400, 172, 189, 189, 208, 202706],
  ["ASTM A131 Gr. CS", 34000, 58000, 24900, 27400, 27400, 30100, 29400000, 234, 400, 172, 189, 189, 208, 202706],
  ["ASTM A131 Gr. EH36", 51000, 71000, 30500, 33500, 33500, 36800, 29400000, 352, 490, 210, 231, 231, 254, 202706],
  ["ASTM A36", 36000, 58000, 24900, 27400, 27400, 30100, 29400000, 248, 400, 172, 189, 189, 208, 202706],
  ["ASTM A442 Gr. 55", 30000, 55000, 23600, 26000, 26000, 27000, 29400000, 207, 379, 163, 179, 179, 186, 202706],
  ["ASTM A442 Gr. 60", 32000, 60000, 25600, 28200, 28200, 28800, 29400000, 221, 414, 177, 194, 194, 199, 202706],
  ["ASTM A573 Gr. 58", 32000, 58000, 24900, 27400, 27400, 28800, 29400000, 221, 400, 172, 189, 189, 199, 202706],
  ["ASTM A573 Gr. 65", 35000, 65000, 27900, 30700, 30700, 31500, 29400000, 241, 448, 192, 212, 212, 217, 202706],
  ["ASTM A573 Gr. 70", 42000, 70000, 30000, 33000, 33000, 36300, 29400000, 290, 483, 207, 228, 228, 250, 202706],
  ["ASTM A737 Gr. B", 50000, 70000, 30000, 33000, 33000, 36300, 29400000, 345, 483, 207, 228, 228, 250, 202706],
  ["ASTM A841", 50000, 70000, 30000, 33000, 33000, 36300, 29400000, 345, 483, 207, 228, 228, 250, 202706],
  ["CSA G40.21 Gr. 38W", 38000, 60000, 25700, 28300, 28300, 31100, 29400000, 262, 414, 177, 195, 195, 214, 202706],
  ["CSA G40.21 Gr. 44W", 44000, 65000, 27900, 30700, 30700, 33700, 29400000, 303, 448, 192, 212, 212, 232, 202706],
  ["CSA G40.21 Gr. 50W", 50000, 65000, 27900, 30700, 30700, 33700, 29400000, 345, 448, 192, 212, 212, 232, 202706],
  ["CSA G40.21 Gr. 50WT", 50000, 70000, 30000, 33000, 33000, 36300, 29400000, 345, 483, 207, 228, 228, 250, 202706],
  ["Unknown", 30000, 55000, 23600, 26000, 26000, 27000, 29400000, 207, 379, 163, 179, 179, 186, 202706],
  ["ASTM A7", 33000, 60000, 25700, 28300, 28300, 29700, 29400000, null, null, null, null, null, null, 202706],
  ["ASTM A9", 30000, 55000, 21000, 21000, 21000, 21000, 29400000, null, null, null, null, null, null, 202706],
  ["ASTM A10", 30000, 55000, 23600, 26000, 26000, 27000, 29400000, null, null, null, null, null, null, 202706]
];
export const MAT = new Map(MATERIALS.map((r) => [r[0], { name: r[0], Y: r[1], T: r[2], SdL: r[3], SdU: r[4], StL: r[5], StU: r[6], E: r[7], m: { Y: r[8], T: r[9], SdL: r[10], SdU: r[11], StL: r[12], StU: r[13], E: r[14] } }]));
export const RIVETED_S = 21000;          // riveted tanks: product and hydrostatic allowable (API 653 4.3.4)
export const E_DEFAULT = 29400000;       // Young's modulus used throughout the workbook (psi) = 202,706 MPa
export const PSI_MPA = 145.0377;

/** Allowable stresses for a course: table values, or API 653 4.3.3.1 rules when Y / T are entered by hand. */
export function allowables(mat, Y, T, lower, riveted) {
  if (riveted) return { Sd: RIVETED_S, St: RIVETED_S, src: 'riveted (21,000 psi)' };
  const m = MAT.get(mat);
  if (m && (Y == null || Y === m.Y) && (T == null || T === m.T)) return { Sd: lower ? m.SdL : m.SdU, St: lower ? m.StL : m.StU, src: 'Table 4.1' };
  const y = Y ?? m?.Y ?? 30000, t = Math.min(T ?? m?.T ?? 55000, 80000);
  return lower
    ? { Sd: Math.min(0.8 * y, 0.429 * t), St: Math.min(0.88 * y, 0.472 * t), src: '0.80Y / 0.429T; 0.88Y / 0.472T' }
    : { Sd: Math.min(0.88 * y, 0.472 * t), St: Math.min(0.9 * y, 0.519 * t), src: '0.88Y / 0.472T; 0.90Y / 0.519T' };
}

/* ---------------------------------------------------- construction codes, editions, supplements --- */
export const CODES = ['API 12A', 'API 12B', 'API 12C', 'API 12D', 'API 12F', 'API 620', 'API 650', 'API 650 Annex A', 'API 650 Annex J', 'API 650 Annex S', 'API 653', 'AWWA D100', 'NFPA 22', 'UL 142', 'Unknown'];
const ED650 = ['First, December 1961', 'Second, April 1964', 'Third, July 1966', 'Fourth, June 1970', 'Fifth, July 1973', 'Sixth, April 1977', 'Seventh, November 1980', 'Eighth, November 1988', 'Ninth, July 1993', 'Tenth, November 1998', 'Eleventh, June 2007', 'Twelfth, March 2013', 'Thirteenth, March 2020', 'Fourteenth (date to confirm)'];
// Added beyond the workbook: 13th edition Errata 1 (2021) and the 14th edition (listed by the API distributor; date not confirmed).
const ED12C = ['First, July 1936', 'Second, October 1937', 'Third, April 1940', 'Fourth, March 1941', 'Fifth, May 1942', 'Sixth, August 1944', 'Seventh, August 1946', 'Eighth, September 1948', 'Ninth, October 1950', 'Tenth, September 1951', 'Eleventh, September 1952', 'Twelfth, October 1954', 'Thirteenth, September 1955', 'Fourteenth, October 1957', 'Fifteenth, 1958'];
export function editionsFor(code) {
  if (/^API 650/.test(code)) return [...ED650, 'Unknown'];
  if (code === 'API 12C') return [...ED12C, 'Unknown'];
  return ['Unknown edition', 'N/A'];
}
const SUPP = {
  'First, December 1961': ['Supplement, 1963'], 'Third, July 1966': ['Supplement 1, Dec. 1967'], 'Fourth, June 1970': ['Supplement 1, Apr. 1971'],
  'Fifth, July 1973': ['Supplement 1, Oct. 1973', 'Supplement 2, Apr. 1974', 'Supplement 3, Mar. 1975'],
  'Sixth, April 1977': ['Revision 1, May 1978', 'Revision 2, December 1978', 'Revision 3, Oct. 1979'], 'Seventh, November 1980': ['Revision 1, Feb. 1984'],
  'Ninth, July 1993': ['Addendum 1, Dec. 1994', 'Addendum 2, Dec. 1995', 'Addendum 3, Dec. 1996', 'Addendum 4, Dec. 1997'],
  'Tenth, November 1998': ['Addendum 1, Mar. 2000', 'Addendum 2, Nov. 2001', 'Addendum 3, Aug. 2003', 'Addendum 4, Dec. 2005'],
  'Eleventh, June 2007': ['Addendum 1, Nov. 2008', 'Addendum 2, Nov. 2009', 'Addendum 3, Aug 2011'],
  'Twelfth, March 2013': ['Addendum 1, Sep. 2014', 'Addendum 2, Jan. 2016', 'Addendum 3, Aug. 2018'],
  'Thirteenth, March 2020': ['Errata 1, 2021'],
  'Second, October 1937': ['Supplement 1, Apr. 1938', 'Supplement 2, Sep. 1938', 'Supplement 3, Apr. 1939'], 'Seventh, August 1946': ['Supplement 1, Sep. 1947'],
  'Eighth, September 1948': ['Supplement 1, Dec. 1949'], 'Eleventh, September 1952': ['Supplement 1, Sep. 1953'], 'Thirteenth, September 1955': ['Supplement 1, Oct. 1956']
};
export function supplementsFor(ed) { const s = SUPP[ed]; return s ? [...s, 'Unknown', 'N/A'] : ['N/A']; }

/* ------------------------------------------------- joint efficiency (API 653 Tables 4.2 and 4.3) --- */
// Table 4.2 groups: key → [label, rows [type, E, applicability]]
export const JE_42 = {
  '650-7': ['API 650 7th and later (1980 to present)', [['Butt', 1.0, 'Basic standard'], ['Butt', 0.85, 'Annex A spot RT'], ['Butt', 0.7, 'Annex A no RT']]],
  '650-1': ['API 650 1st to 6th (1961 to 1978)', [['Butt', 0.85, 'Basic standard'], ['Butt', 1.0, 'Annexes D or G']]],
  '12C-14': ['API 12C 14th and 15th (1957 to 1958)', [['Butt', 0.85, '']]],
  '12C-3': ['API 12C 3rd to 13th (1940 to 1956)', [['Lap (a)', 0.75, '3/8 in. max. t'], ['Butt (c)', 0.85, '']]],
  '12C-1': ['API 12C 1st and 2nd (1936 to 1939)', [['Lap (a)', 0.7, '7/16 in. max. t'], ['Lap (b)', 0.55, '1/4 in. max. t'], ['Butt (c)', 0.85, '']]],
  'unk': ['Unknown', [['Lap (a)', 0.7, '7/16 in. max. t'], ['Lap (b)', 0.55, '1/4 in. max. t'], ['Butt', 0.7, ''], ['Lap (d)', 0.35, '']]]
};
export const JE_NOTES = {
  a: 'Full double lap-welded.', b: 'Full fillet weld with at least 25 % intermittent full fillet opposite side.',
  c: 'Single butt-welded joints with a back-up bar were permitted from 1936 to 1940 and 1948 to 1954.', d: 'Single lap-welded only.'
};
// Table 4.3 riveted: [type, rows of rivets, E]
export const JE_43 = [['Lap', 1, 0.45], ['Lap', 2, 0.6], ['Lap', 3, 0.7], ['Lap', 4, 0.75], ['Butt', 2, 0.75], ['Butt', 3, 0.85], ['Butt', 4, 0.9], ['Butt', 5, 0.91], ['Butt', 6, 0.92]];

/** Table 4.2 group for a construction code / edition. */
export function jeGroup(code, ed) {
  if (/^API 650/.test(code || '')) { const i = ED650.indexOf(ed); return i < 0 ? 'unk' : i >= 6 ? '650-7' : '650-1'; }
  if (code === 'API 12C') { const i = ED12C.indexOf(ed); return i < 0 ? 'unk' : i >= 13 ? '12C-14' : i >= 2 ? '12C-3' : '12C-1'; }
  return 'unk';
}
/** Joint options for the course selector: [key, label, E]. */
export function jointOptions(code, ed) {
  const g = jeGroup(code, ed), [glab, rows] = JE_42[g];
  const out = rows.map((r, i) => [`w:${g}:${i}`, `Welded ${r[0]}${r[2] ? ' — ' + r[2] : ''} (E ${r[1]})`, r[1]]);
  if (g !== 'unk') JE_42.unk[1].forEach((r, i) => out.push([`w:unk:${i}`, `Unknown edition: ${r[0]}${r[2] ? ' — ' + r[2] : ''} (E ${r[1]})`, r[1]]));
  JE_43.forEach((r, i) => out.push([`r:${i}`, `Riveted ${r[0]}, ${r[1]} row${r[1] > 1 ? 's' : ''} (E ${r[2]})`, r[2]]));
  return { group: glab, options: out };
}
export function jointE(key) {
  if (!key) return null;
  const [k, g, i] = String(key).split(':');
  if (k === 'w') return JE_42[g]?.[1]?.[+i]?.[1] ?? null;
  if (k === 'r') return JE_43[+g]?.[2] ?? null;
  return null;
}
export const isRiveted = (key) => String(key || '').startsWith('r:');
export function jointLabel(key) {
  const [k, g, i] = String(key || '').split(':');
  if (k === 'w') { const r = JE_42[g]?.[1]?.[+i]; return r ? `Welded ${r[0]}${r[2] ? ' (' + r[2] + ')' : ''}` : ''; }
  if (k === 'r') { const r = JE_43[+g]; return r ? `Riveted ${r[0]}, ${r[1]} row${r[1] > 1 ? 's' : ''}` : ''; }
  return '';
}

/* ------------------------------------- edge settlement allowables (API 653 Fig. B.11 / B.12 as tabulated) --- */
// Rows: [R (ft), value for each tank diameter in EDGE_D (ft)], values in inches.
export const EDGE_D = [20, 30, 40, 50, 60, 80, 100, 120, 160];
export const EDGE_BEW = [
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  [1.5, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  [1.7, 2, 2, 2, 2, 2, 2.151, 2.39291, 2.39291, 2.39291],
  [1.75, 2, 2, 2, 2, 2, 2.19, 2.4911, 2.491125, 2.491125],
  [1.91, 2, 2, 2, 2, 2, 2.313, 2.626, 2.805413, 2.805413],
  [1.98, 2, 2, 2, 2, 2.075, 2.366, 2.684, 2.942914, 2.942914],
  [2, 2, 2, 2, 2, 2.093, 2.38, 2.7, 2.953, 2.9822],
  [2.25, 2, 2, 2, 2, 2.25, 2.563, 2.915, 3.131, 3.473275],
  [2.29, 2, 2, 2, 2.024, 2.272, 2.591, 2.95, 3.164, 3.551847],
  [2.52, 2, 2, 2, 2.162, 2.4, 2.759, 3.126, 3.363, 4],
  [2.65, 2, 2, 2, 2.239, 2.473, 2.853, 3.223, 3.476, 4.1096],
  [3, 2, 2, 2.2, 2.45, 2.67, 3.1, 3.48, 3.78, 4.4043],
  [3.38, 2, 2, 2.366, 2.64, 2.872, 3.347, 3.756, 4.089, 4.72426],
  [3.46, 2, 2.031, 2.403, 2.68, 2.915, 3.399, 3.813, 4.15, 4.79162],
  [4, 2, 2.24, 2.64, 2.95, 3.19, 3.75, 4.2, 4.55, 5.2463],
  [4.5, 2, 2.425, 2.846, 3.178, 3.45, 4.058, 4.525, 4.925, 5.6673],
  [5, 2.15, 2.61, 3.05, 3.4, 3.71, 4.35, 4.85, 5.28, 6.0883],
  [5.53, 2.309, 2.817, 3.262, 3.639, 3.995, 4.641, 5.168, 5.662, 6.53456],
  [6, 2.45, 3, 3.45, 3.85, 4.23, 4.9, 5.45, 6, 6.9303]
];
export const EDGE_BE = [
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  [1.5, 2, 2, 2, 2, 2, 2, 2, 2, 2],
  [1.7, 2, 2, 2, 2, 2.18, 2.39291, 2.39291, 2.39291, 2.39291],
  [1.75, 2, 2, 2, 2.046, 2.225, 2.491125, 2.491125, 2.491125, 2.491125],
  [1.91, 2, 2, 2, 2.192, 2.369, 2.805413, 2.805413, 2.805413, 2.805413],
  [1.98, 2, 2, 2.075, 2.256, 2.432, 2.942914, 2.942914, 2.942914, 2.942914],
  [2, 2, 2, 2.093, 2.275, 2.45, 2.953, 2.9822, 2.9822, 2.9822],
  [2.25, 2, 2, 2.25, 2.454, 2.647, 3.131, 3.473275, 3.473275, 3.473275],
  [2.29, 2, 2, 2.272, 2.482, 2.678, 3.164, 3.551847, 3.551847, 3.551847],
  [2.52, 2, 2, 2.4, 2.647, 2.858, 3.363, 3.758, 4.003636, 4.003636],
  [2.65, 2, 2.074, 2.473, 2.739, 2.961, 3.476, 3.875, 4.258995, 4.258995],
  [3, 2, 2.275, 2.67, 2.99, 3.24, 3.78, 4.2, 4.63, 4.9465],
  [3.38, 2, 2.448, 2.872, 3.205, 3.498, 4.089, 4.533, 4.991, 5.692934],
  [3.46, 2.031, 2.485, 2.915, 3.254, 3.553, 4.15, 4.604, 5.066, 5.85],
  [4, 2.24, 2.73, 3.19, 3.59, 3.92, 4.55, 5.07, 5.58, 6.4107],
  [4.5, 2.425, 2.966, 3.45, 3.875, 4.237, 4.925, 5.48, 6.044, 6.93],
  [5, 2.61, 3.19, 3.71, 4.17, 4.55, 5.28, 5.89, 6.48, 7.4493],
  [5.53, 2.817, 3.423, 3.995, 4.445, 4.876, 5.662, 6.312, 6.906, 8],
  [6, 3, 3.63, 4.23, 4.69, 5.13, 6, 6.67, 7.27, 8]
];
function interpCurve(tbl, R, ci) {
  if (R <= 1.5) return 2;              // workbook: 2 in. allowed up to R = 1.5 ft
  if (R > 6 + 1e-9) return null;       // beyond the tabulated curves
  for (let i = 0; i < tbl.length - 1; i++) {
    const [r0] = tbl[i], [r1] = tbl[i + 1];
    if (R >= r0 - 1e-9 && R <= r1 + 1e-9) return r1 - r0 < 1e-9 ? tbl[i][ci] : tbl[i][ci] + ((R - r0) / (r1 - r0)) * (tbl[i + 1][ci] - tbl[i][ci]);
  }
  return tbl[tbl.length - 1][ci];
}
/** Bew and Be (inches) for a tank diameter D (ft) and settled width R (ft); linear in R and in D (D < 20 ft uses 20, D > 160 ft uses 160). */
export function edgeAllow(Dft, Rft) {
  if (!(Dft > 0) || !(Rft >= 0)) return { Bew: null, Be: null };
  const at = (tbl) => {
    if (Dft <= EDGE_D[0]) return interpCurve(tbl, Rft, 1);
    if (Dft >= EDGE_D[EDGE_D.length - 1]) return interpCurve(tbl, Rft, EDGE_D.length);
    for (let j = 0; j < EDGE_D.length - 1; j++) if (Dft >= EDGE_D[j] && Dft <= EDGE_D[j + 1]) {
      const lo = interpCurve(tbl, Rft, j + 1), hi = interpCurve(tbl, Rft, j + 2);
      if (lo === null || hi === null) return null;
      return lo + ((Dft - EDGE_D[j]) / (EDGE_D[j + 1] - EDGE_D[j])) * (hi - lo);
    }
    return null;
  };
  return { Bew: at(EDGE_BEW), Be: at(EDGE_BE) };
}

/* ----------------------------------------------------- B.3.2.2 differential settlement K table --- */
// [D from (exclusive), D to (inclusive) ft, K open top, K fixed roof]
export const K_TABLE = [[0, 50, 28.7, 10.5], [50, 80, 7.8, 5.8], [80, 120, 6.5, 3.9], [120, 180, 4.0, 2.3], [180, 240, 3.6, null], [240, 300, 2.4, null], [300, 1e9, null, null]];
export function kFor(Dft, fixedRoof) {
  const r = K_TABLE.find(([a, b]) => Dft > a && Dft <= b) || (Dft <= 0 ? null : null);
  return r ? (fixedRoof ? r[3] : r[2]) : null;
}

/* --------------------------------------------- annular plate thickness (API 653 Table 4.5, API 650 Table 5.1b) --- */
// rows: [first shell course t up to (in), values for each stress column]
export const T45 = { stress: [24300, 27000, 29700, 32400], rows: [[0.75, 0.17, 0.2, 0.23, 0.3], [1, 0.17, 0.22, 0.31, 0.38], [1.25, 0.17, 0.26, 0.38, 0.48], [1.5, 0.22, 0.34, 0.47, 0.59], [1e9, 0.27, 0.4, 0.53, 0.68]] };
export const T51B = { stress: [27000, 30000, 32000, 36000], rows: [[0.75, 0.236, 0.236, 0.281, 0.344], [1, 0.236, 0.281, 0.375, 0.438], [1.25, 0.236, 0.344, 0.469, 0.563], [1.5, 0.312, 0.438, 0.563, 0.688], [1e9, 0.344, 0.5, 0.625, 0.75]] };
/**
 * Minimum annular plate thickness (in). SG < 1: API 653 Table 4.5 with Sb = 2.34 D (H − 1) / t.
 * SG ≥ 1: API 650 Table 5.1b with Sb = 2.6 D (H − 1) G / t (product) or 2.6 D (H − 1) / t (hydrotest), the larger.
 * Interpolated between stress columns, not less than the first column (as the workbook does).
 */
export function annularMin(Dft, Hft, Gsg, t1in) {
  if (!(Dft > 0) || !(Hft > 1) || !(t1in > 0)) return null;
  const big = (Gsg ?? 1) >= 1, tbl = big ? T51B : T45;
  const Sb = big ? (2.6 * Dft * (Hft - 1) * Math.max(Gsg ?? 1, 1)) / t1in : (2.34 * Dft * (Hft - 1)) / t1in;
  const row = tbl.rows.find((r) => t1in <= r[0] + 1e-9);
  const xs = tbl.stress, ys = row.slice(1);
  let t;
  if (Sb <= xs[0]) t = ys[0];
  else if (Sb > xs[xs.length - 1]) t = null;
  else for (let i = 0; i < xs.length - 1; i++) if (Sb <= xs[i + 1]) { t = ys[i] + ((Sb - xs[i]) / (xs[i + 1] - xs[i])) * (ys[i + 1] - ys[i]); break; }
  return { Sb, t, table: big ? 'API 650 Table 5.1b' : 'API 653 Table 4.5', over: t === null };
}

/* --------------------------------------------------------------- nozzle necks (pipe wall) --- */
// [NPS, Sch XS wall, XS less 12.5 % mill tolerance, Sch STD wall, STD less 12.5 %] (in)
export const NOZZLE_PIPE = [
  [0.75, 0.218, 0.191, 0.113, 0.099],
  [1, 0.25, 0.219, 0.133, 0.116],
  [1.5, 0.2, 0.175, 0.145, 0.127],
  [2, 0.218, 0.191, 0.154, 0.135],
  [3, 0.3, 0.262, 0.216, 0.189],
  [4, 0.337, 0.295, 0.237, 0.207],
  [6, 0.432, 0.378, 0.28, 0.245],
  [8, 0.5, 0.438, 0.322, 0.282],
  [10, 0.5, 0.4375, 0.365, 0.319],
  [12, 0.5, 0.4375, 0.375, 0.328],
  [14, 0.5, 0.4375, 0.375, 0.328],
  [16, 0.5, 0.4375, 0.375, 0.328],
  [18, 0.5, 0.4375, 0.375, 0.328],
  [20, 0.5, 0.4375, 0.375, 0.328],
  [22, 0.5, 0.4375, 0.375, 0.328],
  [24, 0.5, 0.4375, 0.375, 0.328]
];
// Larger nozzles (NPS ≥ 26): minimum neck wall by shell thickness [shell t up to, neck wall]
export const NOZZLE_WALL_BY_SHELL = [[0.188, 0.5], [0.25, 0.5], [0.312, 0.5], [0.375, 0.5], [0.438, 0.5], [0.5, 0.5], [0.563, 0.5], [0.625, 0.5], [0.688, 0.5], [0.75, 0.5], [0.813, 0.5], [0.875, 0.5], [0.938, 0.5], [1, 0.5], [1.063, 0.563], [1.125, 0.563], [1.188, 0.625], [1.25, 0.625], [1.312, 0.688], [1.375, 0.688], [1.438, 0.75], [1.5, 0.75], [1.563, 0.813], [1.625, 0.813], [1.688, 0.875], [1.75, 0.875]];
// Pipe schedule used by each construction code (2 = extra-strong, 1 = standard)
export const CODE_SCHED = { 'API 12A': 2, 'API 12B': 1, 'API 12C': 2, 'API 12D': 1, 'API 12F': 1, 'API 620': 1, 'API 650': 2, 'API 650 Annex A': 2, 'API 650 Annex J': 2, 'API 650 Annex S': 2, 'API 653': 2, 'AWWA D100': 1, 'NFPA 22': 2, 'UL 142': 1, 'Unknown': 2 };
/** Default nozzle neck nominal and minimum (in) for a nominal pipe size; shell t (in) for NPS ≥ 26. */
export function nozzleNeck(nps, code, shellT) {
  if (!(nps > 0)) return null;
  const xs = (CODE_SCHED[code] ?? 2) === 2;
  if (nps >= 25.5) {
    const r = NOZZLE_WALL_BY_SHELL.find(([t]) => (shellT ?? 0) <= t + 1e-9) || NOZZLE_WALL_BY_SHELL[NOZZLE_WALL_BY_SHELL.length - 1];
    return { nom: r[1], min: r[1] * 0.875, sched: 'shell-based neck wall', nps: Math.round(nps * 10) / 10 };
  }
  let best = NOZZLE_PIPE[0];
  for (const r of NOZZLE_PIPE) if (Math.abs(r[0] - nps) < Math.abs(best[0] - nps)) best = r;
  return xs ? { nom: best[1], min: best[2], sched: 'XS', nps: best[0] } : { nom: best[3], min: best[4], sched: 'STD', nps: best[0] };
}
