// Shell design basis and API 653 §4.3.3 shell evaluation using the reference tables (tables.js).
//  tmin = 2.6 (H − 1) D G / (S E), not less than 0.100 in            (API 653 4.3.3.1)
//  S = Sd (product) from Table 4.1, lower two courses / upper courses; riveted 21,000 psi
//  Max product fill height from course = S E t / (2.6 D G) + 1 above the course bottom
//  Hydrotest height from course       Ht = St E t / (2.6 D) + 1 above the course bottom (API 653 4.3.3.2)
// D in ft, H in ft, t in in, stresses in psi; results returned in mm.
import { MAT, allowables, jointE, isRiveted, jointOptions, E_DEFAULT, PSI_MPA, annularMin } from './tables.js';

const IN = 25.4, FT = 304.8;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(+v) ? null : +v);

export function shellH(job) { return (job.shell?.courses || []).reduce((a, c) => a + (+c.h > 0 ? +c.h : 0), 0); }

/** Design basis for the shell calculations. */
export function designBasis(job) {
  const t = job.tank || {}, H = shellH(job);
  const fill = num(t.fillH) > 0 ? +t.fillH : H;
  return { D: num(t.diameter), G: num(t.sg), fill, H, code: t.code || '', edition: t.edition || '' };
}

/** Default joint key for the code / edition (first row of the Table 4.2 group). */
export function defaultJoint(job) { return jointOptions(job.tank?.code, job.tank?.edition).options[0][0]; }

/** Material, stresses, joint efficiency and calculated t-min for each course (bottom first). */
export function courseDesigns(job) {
  const B = designBasis(job), sh = job.shell || {};
  let z = 0;
  return (sh.courses || []).map((c, i) => {
    const h = +c.h > 0 ? +c.h : 0, z0 = z; z += h;
    const matl = c.matl || sh.matl || 'Unknown', m = MAT.get(matl);
    const jKey = c.joint || sh.joint || defaultJoint(job), riv = isRiveted(jKey);
    const Y = num(c.Y) ?? m?.Y ?? 30000, T = num(c.T) ?? m?.T ?? 55000, Emod = m?.E ?? E_DEFAULT;
    const al = allowables(matl, num(c.Y), num(c.T), i < 2, riv);
    const Ej = num(c.E) ?? jointE(jKey) ?? 1;
    const Hc = Math.max(0, B.fill - z0) / FT; // ft of liquid above the course bottom
    let tmin = null;
    if (B.D > 0 && B.G > 0 && al.Sd > 0 && Ej > 0) tmin = Math.max((2.6 * Math.max(0, Hc - 1) * (B.D / FT) * B.G) / (al.Sd * Ej), 0.1) * IN;
    return { id: c.id, no: i + 1, z0, z1: z, matl, known: !!m, Y, T, Emod, Sd: al.Sd, St: al.St, sSrc: al.src, jKey, Ej, riveted: riv, Hc, tmin };
  });
}

/** Fill heights supported by a course thickness t (mm): product (with G) and hydrotest (G = 1), measured from the tank bottom (mm). */
export function fillFromT(job, d, tmm) {
  const B = designBasis(job);
  if (!(B.D > 0) || !(tmm > 0)) return { prod: null, hydro: null };
  const t = tmm / IN, Dft = B.D / FT;
  const prod = B.G > 0 ? ((d.Sd * d.Ej * t) / (2.6 * Dft * B.G) + 1) * FT + d.z0 : null;
  const hydro = ((d.St * d.Ej * t) / (2.6 * Dft) + 1) * FT + d.z0;
  return { prod, hydro };
}

/** Young's modulus (psi) and yield (psi) for settlement: course 1 material (B.3.2.1) and lowest yield of all courses (B.3.2.2). */
export function shellYE(job) {
  const ds = courseDesigns(job);
  if (!ds.length) return { Y1: 30000, E1: E_DEFAULT, Ymin: 30000, src: 'no shell courses — 30,000 psi / 29,400,000 psi' };
  return { Y1: ds[0].Y, E1: ds[0].Emod, Ymin: Math.min(...ds.map((d) => d.Y)), src: `course 1 ${ds[0].matl}` };
}
export const toMPa = (psi) => psi / PSI_MPA;

/** Annular plate minimum thickness (mm) from Table 4.5 / 5.1b, using course 1 nominal t and the fill height. */
export function annularReq(job) {
  const B = designBasis(job), c1 = (job.shell?.courses || [])[0];
  if (!(B.D > 0) || !(B.fill > 0) || !(+c1?.tNom > 0)) return null;
  const r = annularMin(B.D / FT, B.fill / FT, B.G ?? 1, +c1.tNom / IN);
  return r ? { ...r, tmm: r.t === null ? null : r.t * IN } : null;
}
