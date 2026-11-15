// Code tables screen: read-only reference values used by the calculations (refactoring step 2).
import { S } from '../app/state.js';
import { defineView } from '../app/nav.js';
import { CODE_SCHED, CODES, EDGE_BE, EDGE_BEW, EDGE_D, editionsFor, JE_42, JE_43, JE_NOTES, K_TABLE, MATERIALS, NOZZLE_PIPE, NOZZLE_WALL_BY_SHELL, supplementsFor, T45, T51B, TABLES_SOURCE } from '../tables.js';
import { esc as h } from '../util.js';

function viewRef() {
  const met = S.job?.units === 'metric', su = met ? 'MPa' : 'psi';
  const ps = (psi, mpa) => (met ? (mpa == null ? 'N/A' : mpa.toLocaleString()) : psi.toLocaleString());
  const ed650 = editionsFor('API 650').filter((e) => e !== 'Unknown'), ed12 = editionsFor('API 12C').filter((e) => e !== 'Unknown');
  const sup = (e) => supplementsFor(e).filter((x) => x !== 'Unknown' && x !== 'N/A').join('; ') || '—';
  const grid = (tbl, k) => `<table class="grid small reft"><thead><tr><th>R (ft)</th>${EDGE_D.map((d) => `<th class="n">D ${d}</th>`).join('')}</tr></thead><tbody>${tbl.map((r) => `<tr><td>${r[0]}</td>${r.slice(1).map((v) => `<td class="n">${(+v).toFixed(2)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const ann = (T, title) => `<h3>${title}</h3><table class="grid small reft"><thead><tr><th>Course 1 t (in)</th>${T.stress.map((x) => `<th class="n">S<sub>b</sub> ≤ ${x.toLocaleString()}</th>`).join('')}</tr></thead><tbody>${T.rows.map((r, i) => `<tr><td>${r[0] > 100 ? '> ' + T.rows[i - 1][0] : '≤ ' + r[0]}</td>${r.slice(1).map((v) => `<td class="n">${v}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  return `<div class="page wide ref-page"><div class="page-head"><div><h1>Code tables</h1><p class="muted">Reference values used by the calculations, taken from the inspection workbook (${h(TABLES_SOURCE)}). Read-only — check them against the editions in force.</p></div></div>
  <section class="card"><h2>Materials and allowable stresses — API 653 Table 4.1</h2>
    <div class="tblwrap"><table class="grid small reft"><thead><tr><th rowspan="2">Specification</th><th class="n" rowspan="2">Y (${su})</th><th class="n" rowspan="2">T (${su})</th><th class="c" colspan="2">Product design stress Sd (${su})</th><th class="c" colspan="2">Hydrotest stress St (${su})</th><th class="n" rowspan="2">Young's modulus (${su})</th></tr><tr><th class="n">Lower two courses</th><th class="n">Upper courses</th><th class="n">Lower two courses</th><th class="n">Upper courses</th></tr></thead><tbody>
    ${MATERIALS.map((m) => `<tr><td>${h(m[0])}</td><td class="n">${ps(m[1], m[8])}</td><td class="n">${ps(m[2], m[9])}</td><td class="n">${ps(m[3], m[10])}</td><td class="n">${ps(m[4], m[11])}</td><td class="n">${ps(m[5], m[12])}</td><td class="n">${ps(m[6], m[13])}</td><td class="n">${ps(m[7], m[14])}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="muted small">Riveted tanks: 21,000 psi product and hydrotest stress. Materials not listed: Sd = smaller of 0.80Y / 0.429T (lower two courses) or 0.88Y / 0.472T (upper); St = smaller of 0.88Y / 0.472T (lower) or 0.90Y / 0.519T (upper); T not more than 80,000 psi; unknown material 30,000 / 55,000 psi.</p></section>
  <div class="grid2">
    <section class="card"><h2>Joint efficiency — API 653 Table 4.2 (welded)</h2><table class="grid small reft"><thead><tr><th>Standard / edition</th><th>Joint</th><th class="n">E</th><th>Applicability / limits</th></tr></thead><tbody>
      ${Object.values(JE_42).map(([lab, rows]) => rows.map((r, i) => `<tr><td>${i ? '' : h(lab)}</td><td>${h(r[0])}</td><td class="n">${r[1]}</td><td>${h(r[2])}</td></tr>`).join('')).join('')}
      </tbody></table><p class="muted small">${Object.entries(JE_NOTES).map(([k, v]) => `(${k}) ${h(v)}`).join(' ')}</p></section>
    <section class="card"><h2>Joint efficiency — API 653 Table 4.3 (riveted)</h2><table class="grid small reft"><thead><tr><th>Joint</th><th class="n">Rows of rivets</th><th class="n">E</th></tr></thead><tbody>${JE_43.map((r) => `<tr><td>${r[0]}</td><td class="n">${r[1]}</td><td class="n">${r[2]}</td></tr>`).join('')}</tbody></table>
      <h2 style="margin-top:16px">B.3.2.2 K values</h2><table class="grid small reft"><thead><tr><th>Diameter (ft)</th><th class="n">Open top</th><th class="n">Fixed roof</th></tr></thead><tbody>${K_TABLE.map((r) => `<tr><td>${r[1] > 1e6 ? '> ' + r[0] : r[0] + ' – ' + r[1]}</td><td class="n">${r[2] ?? 'N/A'}</td><td class="n">${r[3] ?? 'N/A'}</td></tr>`).join('')}</tbody></table>
      <p class="muted small">Allowable = min(K · S<sub>arc</sub> · (D / H) · (Y / E), 4 in).</p></section>
  </div>
  <section class="card"><h2>Construction codes and editions</h2>
    <p class="small">Codes: ${CODES.map(h).join(', ')}.</p>
    <div class="grid2"><div><h3>API 650 (and Annexes A, J, S)</h3><table class="grid small reft"><thead><tr><th>Edition</th><th>Supplements / revisions / addenda</th><th>Table 4.2 group</th></tr></thead><tbody>${ed650.map((e, i) => `<tr><td>${h(e)}</td><td>${h(sup(e))}</td><td>${i >= 6 ? '7th and later' : '1st to 6th'}</td></tr>`).join('')}</tbody></table></div>
    <div><h3>API 12C</h3><table class="grid small reft"><thead><tr><th>Edition</th><th>Supplements</th><th>Table 4.2 group</th></tr></thead><tbody>${ed12.map((e, i) => `<tr><td>${h(e)}</td><td>${h(sup(e))}</td><td>${i >= 13 ? '14th and 15th' : i >= 2 ? '3rd to 13th' : '1st and 2nd'}</td></tr>`).join('')}</tbody></table></div></div></section>
  <section class="card"><h2>Edge settlement allowables — API 653 Fig. B.11 / B.12 (inches)</h2>
    <h3>Bew — bottom lap weld approximately parallel to the shell (Fig. B.11)</h3><div class="tblwrap">${grid(EDGE_BEW)}</div>
    <h3>Be — no weld, butt welds, or lap weld approximately perpendicular to the shell (Fig. B.12)</h3><div class="tblwrap">${grid(EDGE_BE)}</div>
    <p class="muted small">Linear interpolation in R and between diameters; D under 20 ft uses the 20 ft curve and over 160 ft the 160 ft curve; 2 in allowed up to R = 1.5 ft; R over 6 ft is beyond the curves.</p></section>
  <div class="grid2">
    <section class="card"><h2>Annular plate thickness (in)</h2>${ann(T45, 'API 653 Table 4.5 — product SG < 1 (S<sub>b</sub> = 2.34 D (H − 1) / t)')}${ann(T51B, 'API 650 Table 5.1b — product SG ≥ 1 (S<sub>b</sub> = 2.6 D (H − 1) G / t)')}</section>
    <section class="card"><h2>Nozzle necks (in)</h2><table class="grid small reft"><thead><tr><th class="n">NPS</th><th class="n">Sch XS</th><th class="n">XS − 12.5 %</th><th class="n">Sch STD</th><th class="n">STD − 12.5 %</th></tr></thead><tbody>${NOZZLE_PIPE.map((r) => `<tr>${r.map((v) => `<td class="n">${v}</td>`).join('')}</tr>`).join('')}</tbody></table>
      <h3>NPS 26 and larger — neck wall by shell thickness</h3><table class="grid small reft"><thead><tr><th class="n">Shell t up to</th><th class="n">Neck wall</th></tr></thead><tbody>${NOZZLE_WALL_BY_SHELL.map((r) => `<tr><td class="n">${r[0]}</td><td class="n">${r[1]}</td></tr>`).join('')}</tbody></table>
      <p class="muted small">Schedule by construction code: ${Object.entries(CODE_SCHED).map(([k, v]) => `${h(k)} ${v === 2 ? 'XS' : 'STD'}`).join(', ')}.</p></section>
  </div></div>`;
}

defineView('ref', viewRef);
