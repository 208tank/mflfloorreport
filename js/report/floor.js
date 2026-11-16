// Floor chapter parts (report improvements R3): MFL inspection summary, prove-up results, corrosion and remaining
// thickness summaries, and repair status. Every number is a value the API 653 calculation (calc.js) or the job already
// holds; nothing is recalculated here, and the marks say which kind of value each is. No browser APIs.
import { RESULTS, RESULT_SHORT, statusText } from '../calc.js';
import { equipLine } from '../equipment.js';
import { fmt, fmtRate } from '../units.js';
import { escText as h } from '../util.js';
import { vm } from './front.js';

const PROVEN = ['ps', 'ss', 'both'];
const has = (v) => v !== null && v !== undefined && v !== '';
export const REPAIR_STATUSES = [['', 'Not recorded'], ['proposed', 'Proposed'], ['completed', 'Completed'], ['verified', 'Verified']];
const REP_LABEL = Object.fromEntries(REPAIR_STATUSES);

/** Repairs as units for status records: each patch plate, and each repaired location not under a patch. The key
 *  is built from the indication ids, so it stays with the same repair when patch numbers change. */
export function repairUnits(job, calc, patches) {
  const per = calc.per, inds = (job.indications || []).filter((i) => per.get(i.id)?.repair || per.get(i.id)?.status === 'below MRT');
  const units = [], inPatch = new Set();
  for (const pp of patches || []) {
    const ids = (pp.inds || []).map((x) => x.ind?.id || x.id).filter(Boolean);
    if (!ids.length) continue;
    ids.forEach((id) => inPatch.add(id));
    units.push({ key: 'inds:' + [...ids].sort().join(','), label: pp.id, kind: 'Patch plate', inds: ids.map((id) => (job.indications || []).find((i) => i.id === id)).filter(Boolean) });
  }
  for (const i of inds) if (!inPatch.has(i.id)) units.push({ key: 'ind:' + i.id, label: i.repId || i.no, kind: i.repairMethod || (per.get(i.id)?.repair ? 'Repair' : 'Repair declined'), inds: [i] });
  return units;
}

export function floorParts({ job, layout, calc, N, patches, opts = {} }) {
  const per = calc.per, C = calc.C || {}, t = (mm) => fmt(mm, 't', job), I = job.info || {};
  const inds = (job.indications || []).slice().sort((a, b) => String(a.no).localeCompare(String(b.no), undefined, { numeric: true }));
  const res = (i) => i.result || 'pending';
  const areaOf = (a) => (a?.region === 'annular' ? 'Annular' : 'Bottom');
  const basisMark = (a) => (a?.src === 'MFL estimate' ? vm('E') : a?.src ? vm('M') : '');
  const basisTxt = (a) => (a?.src === 'UT' ? 'UT' : a?.src === 'VT pit depth' ? 'Nominal − VT pit depth' : a?.src === 'MFL estimate' ? 'MFL estimate' : '—');

  /* ---- MFL inspection: set-up, coverage, counts */
  const mflNde = (job.secs?.floor?.nde || []).filter((n) => n.method === 'MFL floor scan');
  const eq = [...new Set(mflNde.flatMap((n) => n.equip || []))].map((id) => (job.equipment || []).find((e) => e.id === id)).filter(Boolean);
  const scanner = eq.filter((e) => e.type === 'mfl'), ref = eq.filter((e) => e.type === 'refplate');
  const thrRep = scanner.map((e) => e.threshold).filter(Boolean);
  const cov = { bottom: [0, 0, 0, 0, 0], annular: [0, 0, 0, 0, 0] }; // full, partial, not areas; plate count; plates not scanned
  const notPlates = [];
  for (const p of layout.plates || []) {
    const k = p.kind === 'annular' ? 'annular' : 'bottom', s = job.plates?.[p.key]?.scan;
    cov[k][s === 'not' ? 2 : s === 'partial' ? 1 : 0] += p.area; cov[k][3]++;
    if (s === 'not') { cov[k][4]++; notPlates.push(p.label); }
  }
  const pc = (a, tot) => (tot ? ((a / tot) * 100).toFixed(1) + ' %' : '—');
  const covRow = (k, label) => { const c = cov[k], tot = c[0] + c[1] + c[2]; return tot ? [`${label} (${c[3]} plates)`, `${pc(c[0], tot)} full, ${pc(c[1], tot)} partial, ${pc(c[2], tot)} not scanned${vm('C')}`] : null; };
  const setup = [
    ['MFL scanner', scanner.map((e) => h(equipLine(e))).join('<br>') || '<span class="muted">Not recorded</span>'],
    ['Reference plate', ref.map((e) => h(equipLine(e))).join('<br>') || '<span class="muted">Not recorded</span>'],
    ['Scanner reporting threshold', thrRep.length ? thrRep.map((x) => h(x) + ' % of nominal').join(', ') : '<span class="muted">Not recorded</span>'],
    ['MFL threshold used for UPᵣ', C.mflThresholdPct != null && C.mflThresholdPct !== '' ? `${h(C.mflThresholdPct)} % of nominal (input)` : '—'],
    covRow('bottom', 'Coverage — bottom plates'), layout.Ri < layout.R ? covRow('annular', 'Coverage — annular plates') : null,
    ['Plates not scanned', notPlates.length ? h(notPlates.join(', ')) + ' — hatched on the floor plan' : 'None'],
  ].filter(Boolean);
  const RES = ['ps', 'ss', 'both', 'nri', 'other', 'pending'];
  const by = (r, f) => inds.filter((i) => res(i) === r && f(per.get(i.id))).length;
  const anyAnn = layout.Ri < layout.R;
  const countRows = RES.map((r) => [RESULTS[r], by(r, (a) => a?.region !== 'annular'), by(r, (a) => a?.region === 'annular'), by(r, (a) => a?.critical), by(r, () => true)]).filter((x) => x[4]);
  const mfl = () => `${N.sub('MFL inspection')}
    ${N.table('MFL scan set-up and coverage')}<table class="kv">${setup.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>
    ${N.table('MFL indications by prove-up result and area')}<table class="grid small wrap"><thead><tr><th>Result</th><th class="n">Bottom</th>${anyAnn ? '<th class="n">Annular</th>' : ''}<th class="n">Critical zone</th><th class="n">Total</th></tr></thead><tbody>
      ${countRows.map(([l, b, a, cz, tot]) => `<tr><td>${h(l)}</td><td class="n">${b}</td>${anyAnn ? `<td class="n">${a}</td>` : ''}<td class="n">${cz}</td><td class="n">${tot}</td></tr>`).join('')}
      <tr><td><b>All indications</b></td><td class="n"><b>${inds.filter((i) => per.get(i.id)?.region !== 'annular').length}</b></td>${anyAnn ? `<td class="n"><b>${inds.filter((i) => per.get(i.id)?.region === 'annular').length}</b></td>` : ''}<td class="n"><b>${inds.filter((i) => per.get(i.id)?.critical).length}</b></td><td class="n"><b>${inds.length}</b></td></tr>
    </tbody></table>
    <p class="note">Critical zone: the recorded corrosion reaches within ${fmt(C.czDist, 'small', job)} of the shell (counted also under bottom or annular).</p>`;

  /* ---- prove-up */
  const proven = inds.filter((i) => PROVEN.includes(res(i)));
  const pending = inds.filter((i) => res(i) === 'pending');
  const proveRows = proven.map((i) => { const a = per.get(i.id) || {}; return `<tr data-ind="${h(i.id)}"><td>${h(i.no)}</td><td>${h(a.plate?.label ?? '?')}</td><td class="n">${i.mflPct ?? '—'}</td><td>${RESULT_SHORT[res(i)]}</td><td class="n">${fmt(i.utMin, 't', job, false)}</td><td>${h(i.utMethod || '')}</td><td class="n">${fmt(i.vtDepth, 't', job, false)}</td><td class="n" data-c="rem">${fmt(a.rem, 't', job, false)}${basisMark(a)}</td><td>${basisTxt(a)}</td></tr>`; }).join('');
  const prove = () => `${N.sub('Prove-up — UT and VT')}
    ${proven.length ? `${N.table('Proven-up indications: MFL estimate, measurements and the remaining thickness used')}<table class="grid small wrap"><thead><tr><th>No.</th><th>Plate</th><th class="n">MFL %${vm('E')}</th><th>Side</th><th class="n">UT min${vm('M')}</th><th>UT method</th><th class="n">VT pit${vm('M')}</th><th class="n">Remaining used</th><th>Basis</th></tr></thead><tbody>${proveRows}</tbody></table>
    <p class="note">Thickness in ${job.units === 'metric' ? 'mm' : 'in'}. Remaining used: the UT minimum where one was read (M); otherwise nominal less the VT pit depth (M, product side); otherwise the MFL estimate (E). The calculation uses this value.</p>` : '<p class="muted">No indications proven up.</p>'}
    ${pending.length ? `${N.table('Indications not proven — pending prove-up')}<table class="grid small wrap"><thead><tr><th>No.</th><th>Plate</th><th class="n">X</th><th class="n">Y</th><th class="n">MFL %${vm('E')}</th><th>In the calculation</th></tr></thead><tbody>${pending.map((i) => { const a = per.get(i.id) || {}; return `<tr><td>${h(i.no)}</td><td>${h(a.plate?.label ?? '?')}</td><td class="n">${fmt(i.x, 'small', job, false)}</td><td class="n">${fmt(i.y, 'small', job, false)}</td><td class="n">${i.mflPct ?? '—'}</td><td>${a.counts ? 'Yes — as soil side, on the MFL estimate' : 'No'}</td></tr>`; }).join('')}</tbody></table>` : ''}
    ${inds.some((i) => ['nri', 'other'].includes(res(i))) ? `<p class="note">${inds.filter((i) => ['nri', 'other'].includes(res(i))).length} indication(s) proved to be no indication or other (not corrosion); they are listed in the floor indication register.</p>` : ''}`;

  /* ---- corrosion and remaining thickness */
  const counted = inds.map((i) => [i, per.get(i.id)]).filter(([, a]) => a?.counts && a.rem !== null && a.rem !== undefined);
  const sideRow = (label, test, rate, src) => {
    const xs = counted.filter(([i]) => test(res(i)));
    const rems = xs.map(([, a]) => a.rem), losses = xs.map(([, a]) => a.lossPct).filter((v) => v !== null && v !== undefined);
    const gov = src === 'override' ? 'entered (override)' : src === 'threshold' ? `MFL threshold ${h(C.mflThresholdPct)} % of nominal` : src?.no ? `indication ${h(src.no)}` : rate === 0 ? (label.startsWith('Product') && C.coated ? 'coated — 0' : label.startsWith('Soil') && C.cp ? 'effective CP — 0' : 'no corrosion') : '—';
    return `<tr><td>${label}</td><td class="n">${xs.length}</td><td class="n">${rems.length ? t(Math.min(...rems)) : '—'}</td><td class="n">${losses.length ? Math.max(...losses).toFixed(0) + ' %' : '—'}</td><td class="n">${fmtRate(rate, job)}</td><td>${gov}</td></tr>`;
  };
  const areaRow = (label, f, limit) => {
    const xs = counted.filter(([, a]) => f(a)), rems = xs.map(([, a]) => a.rem);
    return `<tr><td>${label}</td><td class="n">${xs.length}</td><td class="n">${rems.length ? t(Math.min(...rems)) : '—'}</td><td class="n">${t(limit)}</td><td class="n">${xs.filter(([, a]) => a.status === 'below MRT').length || '—'}</td><td class="n">${xs.filter(([, a]) => a.repair).length || '—'}</td></tr>`;
  };
  const worst = counted.slice().sort((x, y) => x[1].rem - y[1].rem).slice(0, 10);
  const plates = (layout.plates || []).map((p) => {
    const its = inds.filter((i) => i.plate === p.key), o = job.plates?.[p.key] || {};
    const rems = its.map((i) => per.get(i.id)).filter((a) => a?.counts && a.rem != null).map((a) => a.rem);
    return { p, its, o, min: rems.length ? Math.min(...rems) : null };
  }).filter((x) => x.its.length || has(x.o.utMin));
  const corr = () => `${N.sub('Corrosion and remaining thickness')}
    ${N.table('Product side and soil side')}<table class="grid small wrap"><thead><tr><th>Side</th><th class="n">Locations</th><th class="n">Min. remaining${vm('C')}</th><th class="n">Max. loss${vm('C')}</th><th class="n">Rate used${vm('C')}</th><th>Governing location / basis</th></tr></thead><tbody>
      ${sideRow('Product side (StPᵣ)', (r) => r === 'ps' || r === 'both', calc.StPr, calc.stSrc)}
      ${sideRow('Soil side (UPᵣ)', (r) => r === 'ss' || r === 'both' || r === 'pending', calc.UPr, calc.upSrc)}
    </tbody></table>
    <p class="note">Locations counted in the calculation, with their remaining thickness. Both-side locations count on both sides; pending indications count on the soil side only when "include unverified" is set. Rates are those the calculation used (${h(fmtRate(calc.StPr + calc.UPr, job))} combined).</p>
    ${N.table('Results by area')}<table class="grid small wrap"><thead><tr><th>Area</th><th class="n">Locations</th><th class="n">Min. remaining${vm('C')}</th><th class="n">Limit</th><th class="n">Below MRT, not repaired</th><th class="n">Repaired</th></tr></thead><tbody>
      ${areaRow('Bottom plates', (a) => a.region !== 'annular', calc.mBot)}${anyAnn ? areaRow('Annular plates', (a) => a.region === 'annular', calc.mAnn) : ''}${areaRow('Critical zone', (a) => a.critical, calc.czLim)}
    </tbody></table>
    ${worst.length ? `${N.table(`Lowest remaining thickness — ${worst.length} worst location${worst.length === 1 ? '' : 's'}`)}<table class="grid small wrap worst"><thead><tr><th>No.</th><th>Plate</th><th>Area</th><th>Side</th><th class="n">Remaining</th><th class="n">Loss %${vm('C')}</th><th class="n">t at Oᵣ${vm('C')}</th><th class="n">Limit</th><th>Status${vm('C')}</th></tr></thead><tbody>
      ${worst.map(([i, a]) => `<tr data-ind="${h(i.id)}" class="${a.status === 'below MRT' ? 'is-bad' : a.repair ? 'is-rep' : ''}"><td>${h(i.no)}</td><td>${h(a.plate?.label ?? '?')}</td><td>${areaOf(a)}${a.critical ? ' (CZ)' : ''}</td><td>${RESULT_SHORT[res(i)]}</td><td class="n" data-c="rem">${fmt(a.rem, 't', job, false)}${basisMark(a)}</td><td class="n" data-c="loss">${a.lossPct != null ? a.lossPct.toFixed(0) : '—'}</td><td class="n" data-c="proj">${fmt(a.projected, 't', job, false)}</td><td class="n" data-c="lim">${fmt(a.limit, 't', job, false)}</td><td>${h(statusText(a))}</td></tr>`).join('')}
    </tbody></table>` : ''}
    ${plates.length ? `${N.table('Minimum remaining thickness by plate')}<table class="grid small wrap"><thead><tr><th>Plate</th><th>Type</th><th class="n">Nominal</th><th class="n">Indications (proven / all)</th><th class="n">Min. at indications</th><th class="n">Plate UT min${vm('M')}</th><th>MFL scan</th></tr></thead><tbody>
      ${plates.map(({ p, its, o: ov, min }) => `<tr><td>${h(p.label)}</td><td>${p.kind === 'annular' ? 'Annular' : 'Bottom'}</td><td class="n">${fmt(ov.tNom ?? (p.kind === 'annular' ? job.tank?.tAnnular ?? job.tank?.tBottom : job.tank?.tBottom), 't', job, false)}</td><td class="n">${its.filter((i) => PROVEN.includes(res(i))).length} / ${its.length}</td><td class="n">${fmt(min, 't', job, false)}</td><td class="n">${fmt(ov.utMin, 't', job, false)}</td><td>${ov.scan === 'not' ? 'Not scanned' : ov.scan === 'partial' ? 'Partial' : 'Scanned'}</td></tr>`).join('')}
    </tbody></table><p class="note">Plates with indications or a plate UT reading. Thickness in ${h(job.units === 'metric' ? 'mm' : 'in')}; min. at indications is the lowest remaining thickness the calculation used on that plate.</p>` : ''}`;

  /* ---- repair status */
  const units = repairUnits(job, calc, patches), R = job.repairs || {};
  const status = () => units.length ? `${N.table('Repair status')}<table class="grid small wrap"><thead><tr><th>Repair</th><th>Type</th><th>Indications</th><th>Status</th><th>Date</th><th>Contractor</th><th>Examination after repair</th></tr></thead><tbody>
      ${units.map((u) => { const r = R[u.key] || {}; return `<tr><td><b>${h(u.label)}</b></td><td>${h(u.kind)}</td><td>${h(u.inds.map((i) => i.no).join(', '))}</td><td>${r.status ? h(REP_LABEL[r.status] || r.status) : '<span class="muted">Not recorded</span>'}</td><td>${h(r.date || '')}</td><td>${h(r.contractor || '')}</td><td>${h(r.exam || '')}${r.notes ? `<br><small>${h(r.notes)}</small>` : ''}</td></tr>`; }).join('')}
    </tbody></table><p class="note">Status as recorded on Floor → Analysis. Proposed: recommended in this report. Completed: work done. Verified: examined after repair and accepted.</p>` : '';

  /* ---- full register (appendix) */
  void opts; void I;
  return { mfl, prove, corr, status };
}
