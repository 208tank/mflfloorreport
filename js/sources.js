// Sources of design data (report improvements R2, schema 5): where each design value came from, kept in
// job.tank.src by field. No imports.
export const SRC_OPTS = [['', '—'], ['nameplate', 'Nameplate'], ['drawing', 'Drawing'], ['prev', 'Previous report'], ['measured', 'Measured'], ['assumed', 'Assumed']];
export const SRC_LABEL = Object.fromEntries(SRC_OPTS.filter(([k]) => k));
/** Design values whose source can be recorded, in the order the report lists them. */
export const SRC_FIELDS = [
  ['code', 'Construction code and edition'], ['yearBuilt', 'Year built'], ['diameter', 'Diameter'], ['height', 'Shell height'], ['courses', 'Shell courses (heights, thicknesses)'],
  ['materials', 'Materials'], ['tBottom', 'Bottom nominal thickness'], ['tAnnular', 'Annular nominal thickness'], ['bottomType', 'Bottom construction'],
  ['roof', 'Roof type and plate thickness'], ['sg', 'Product specific gravity'], ['fillH', 'Maximum fill height'], ['opTemp', 'Maximum operating temperature'], ['coating', 'Coating, CP and RPB'],
];

