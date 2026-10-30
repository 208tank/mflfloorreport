// Unit handling. Everything is stored internally in millimetres.
// "big" = tank / plate dimensions (ft or m); "small" = offsets, sizes and thickness (in or mm).

export const UNITS = {
  imperial: { label: 'Imperial (ft / in)', big: 'ft', small: 'in', bigMm: 304.8, smallMm: 25.4, bigDec: 2, smallDec: 2, tDec: 3, rateUnit: 'in/yr', rateDec: 4 },
  metric:   { label: 'Metric (m / mm)',    big: 'm',  small: 'mm', bigMm: 1000,  smallMm: 1,    bigDec: 3, smallDec: 0, tDec: 2, rateUnit: 'mm/yr', rateDec: 3 }
};

export const u = (job) => UNITS[job?.units] || UNITS.imperial;

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Convert a user-entered value to mm. kind: 'big' | 'small' | 't' */
export function toMm(v, kind, job) {
  const n = num(v);
  if (n === null) return null;
  const U = u(job);
  return n * (kind === 'big' ? U.bigMm : U.smallMm);
}

/** Convert mm to display units as a number (not rounded). */
export function fromMm(mm, kind, job) {
  if (mm === null || mm === undefined || !Number.isFinite(mm)) return null;
  const U = u(job);
  return mm / (kind === 'big' ? U.bigMm : U.smallMm);
}

/** Value for an <input>, rounded sensibly, '' when empty. */
export function inVal(mm, kind, job) {
  const v = fromMm(mm, kind, job);
  if (v === null) return '';
  const U = u(job);
  const dec = kind === 'big' ? U.bigDec + 1 : kind === 't' ? U.tDec + 1 : U.smallDec + 2;
  return String(+v.toFixed(dec));
}

/** Formatted display string with optional unit suffix. */
export function fmt(mm, kind, job, withUnit = true) {
  const v = fromMm(mm, kind, job);
  if (v === null) return '—';
  const U = u(job);
  const dec = kind === 'big' ? U.bigDec : kind === 't' ? U.tDec : U.smallDec + (U.small === 'in' ? 0 : 0);
  const unit = kind === 'big' ? U.big : U.small;
  return v.toFixed(dec) + (withUnit ? ' ' + unit : '');
}

/** Rate in mm/yr → display */
export function fmtRate(mmPerYr, job, withUnit = true) {
  if (mmPerYr === null || mmPerYr === undefined || !Number.isFinite(mmPerYr)) return '—';
  const U = u(job);
  return (mmPerYr / U.smallMm).toFixed(U.rateDec) + (withUnit ? ' ' + U.rateUnit : '');
}

export const unitLabel = (kind, job) => (kind === 'big' ? u(job).big : kind === 'rate' ? u(job).rateUnit : u(job).small);

export { num };
