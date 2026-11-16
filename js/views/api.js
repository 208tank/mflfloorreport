// API 653 floor evaluation screen: MRT, corrosion rates and the inspection interval (refactoring step 11).
import { assessCardHTML, repairStatusCardHTML } from './r2fields.js';
import { byNo, S } from '../app/state.js';
import { field } from '../app/fields.js';
import { defineView, renderView } from '../app/nav.js';
import { onAction } from '../app/actions.js';
import { commit } from '../app/persist.js';
import { czLimitAuto, statusText } from '../calc.js';
import { annularReq } from '../design.js';
import { patchList } from '../patches.js';
import { $ } from '../ui.js';
import { fmt, fmtRate, inVal, u } from '../units.js';
import { esc as h } from '../util.js';
import { findingsBox } from './sections.js';

function viewApi() {
  const met = S.job.units === 'metric';
  const v = (mm) => (met ? `${mm.toFixed(2)} mm` : `${(mm / 25.4).toFixed(3)} in`);
  const f = (label, key, kind, extra = {}) => field(label, 'calc.' + key, kind, extra);
  return `<div class="page">
  <div class="page-head"><div><h1>API 653 bottom evaluation</h1><p class="muted">Minimum remaining thickness at the next internal inspection (API 653, 5th ed. Addendum 4 (2025), §4.4.5). Check the limits against the edition in force and the tank's design.</p></div></div>
  ${findingsBox('floor')}
  ${assessCardHTML('floor')}
  ${repairStatusCardHTML()}
  <div class="api-grid">
    <section class="card"><h2>Inputs</h2><div class="fgrid">
      ${f('Oᵣ — years to next internal inspection', 'Or', 'num', { unit: 'yr', hint: `§6.4.2.2.1: at most ${S.job.tank.rpb ? 30 : 20} years${S.job.tank.rpb ? ' (with RPB)' : ' (30 with an RPB)'}` })}
      ${f('Tank age (years) — UPᵣ basis', 'years', 'num', { unit: 'yr', hint: 'API 653 §4.4.5.1: UPᵣ is a linear rate over the age of the tank' })}
      ${f('StPᵣ basis (optional)', 'stprYears', 'num', { unit: 'yr', ph: 'tank age', hint: 'e.g. years since the coating or the last inspection' })}
      ${f('MFL threshold', 'mflThresholdPct', 'num', { unit: '% of nominal', hint: 'API 653 §4.4.5.1 Note 1: UPᵣ uses the lesser of the threshold and the thinnest unrepaired area' })}
      ${f('Min. remaining — bottom plates', 'mrtBottom', 't')}
      ${f('Min. remaining — annular plates', 'mrtAnnular', 't', { ph: S.calc?.ann?.tbl != null ? inVal(S.calc.ann.tbl, 't', S.job) : '', hint: 'Blank = Table 4.5 / API 650 Table 5.1 value + CA (§4.4.6)' })}
      ${f('Annular corrosion allowance', 'annCA', 't', { hint: 'Added to the table value (§4.4.6.2)' })}<div></div>
      ${(() => { const a = annularReq(S.job); if (!a) return '<p class="muted small span2">Annular plate minimum (API 653 Table 4.5 / API 650 Table 5.1b): enter the shell courses (course 1 nominal t), the maximum fill height and the product SG to calculate it.</p>'; return `<p class="small span2 ann-req">${h(a.table)}: S<sub>b</sub> = ${Math.round(a.Sb).toLocaleString()} psi with course 1 t = ${fmt(+S.job.shell.courses[0].tNom, 't', S.job)} → minimum annular plate <b>${a.over ? 'beyond the table — engineering evaluation' : fmt(a.tmm, 't', S.job)}</b> ${!a.over ? `<button class="btn sm" data-act="ann-apply" data-v="${a.tmm}">Use for annular plates</button>` : ''}<br><span class="muted">${(S.job.tank.sg ?? 1) >= 1 ? 'SG ≥ 1: S<sub>b</sub> = 2.6 D (H − 1) G / t' : 'SG &lt; 1: S<sub>b</sub> = 2.34 D (H − 1) / t'}, interpolated between stress columns.</span></p>`; })()}
      <div class="span2 presets"><span class="muted small">Bottom limit presets:</span>
        <button class="btn sm" data-act="mrt-preset" data-v="2.54">${v(2.54)} — no leak detection / containment</button>
        <button class="btn sm" data-act="mrt-preset" data-v="1.27">${v(1.27)} — with leak detection &amp; containment</button>
        <button class="btn sm" data-act="mrt-preset" data-v="1.27">${v(1.27)} — reinforced lining &gt; 0.05 in</button></div>
      <h3 class="span2" style="margin:8px 0 0">Repair patch plates</h3>
      ${f('Auto patch repair indications', 'autoPatch', 'bool', { value: S.job.calc.autoPatch !== false, cls: 'span2' })}
      ${f('Default patch length', 'patchL', 'small', { ph: met ? '300' : '12' })}${f('Default patch width', 'patchW', 'small', { ph: met ? '300' : '12' })}
      ${f('Extend past the corrosion by at least', 'patchMargin', 'small', { hint: 'API 653 §9.11.1.1 c: 2 in' })}${f('Patch plate thickness', 'patchT', 't', { hint: 'Critical zone: 1/4 in max.' })}<p class="muted small" id="patchSum">${(() => { const pl = patchList(S.job, S.layout, S.calc); return pl.length ? `${pl.length} patch${pl.length > 1 ? 'es' : ''}: ${pl.map((p) => `${p.id} ${fmt(p.L, 'small', S.job, false)} × ${fmt(p.W, 'small', S.job)}${p.kind === 'tomb' ? ' tombstone' : ''}${p.status !== 'OK' ? ' (' + p.status.toLowerCase() + ')' : ''}`).join(', ')}` : 'No patches.'; })()}</p>
      ${f('Critical zone width (from shell)', 'czDist', 'small')}
      ${f('Critical zone limit', 'czLimit', 't', { ph: inVal(czLimitAuto(S.job), 't', S.job), hint: `Blank = §4.4.5.4: the smaller of ${met ? '3 mm' : '0.118 in'} and ½ course 1 t-min, not less than ${met ? '2.5 mm' : '0.10 in'}` })}
      ${f('Reason for an entered critical zone limit', 'czLimitReason', 'text', { ph: 'e.g. isolated pitting, Table 4.4' })}
      ${f('Lower shell course t-min', 'shellTmin', 't', { hint: 'Optional, for the critical zone limit' })}
      ${field('Shell toughness (critical-zone patch spacing)', 'tank.shellTough', 'sel', { options: [['', 'Unknown — §9.11.1.2 g applies'], ['known', 'Known (meets API 650 toughness)']] })}
      ${field('Bottom projection beyond the shell — thickness at the outside weld toe', 'tank.projT', 't', { hint: 'API 653 §4.4.5.7: at least 0.10 in (2.5 mm)' })}
      ${field('Bottom projection beyond the shell — width', 'tank.projW', 'small', { hint: 'API 653 §4.4.5.7: at least 3/8 in (10 mm)' })}
      ${f('Product side coated, coating life ≥ Oᵣ (StPᵣ = 0)', 'coated', 'bool', { cls: 'span2' })}
      ${f('Coating basis confirmed by the engineer despite recorded product-side pitting', 'coatConfirmed', 'bool', { cls: 'span2' })}
      ${f('Effective cathodic protection (UPᵣ = 0)', 'cp', 'bool', { cls: 'span2' })}
      ${f('Oᵣ set by an RBI assessment (§6.4.2.2.2)', 'rbi', 'bool', { cls: 'span2' })}
      ${f('Include pending MFL calls using the MFL % estimate (as soil side)', 'includeUnverified', 'bool', { cls: 'span2' })}
      ${field('StPᵣ override', 'calc.stprOverride', 't', { unit: u(S.job).rateUnit, ph: 'calculated' })}
      ${field('UPᵣ override', 'calc.uprOverride', 't', { unit: u(S.job).rateUnit, ph: 'calculated' })}
    </div></section>
    <section class="card" id="apiResults"></section>
  </div></div>`;
}
export function refreshApi() {
  const el = $('#apiResults'); if (!el) return;
  const ps = $('#patchSum'); if (ps) { const pl = patchList(S.job, S.layout, S.calc); ps.textContent = pl.length ? `${pl.length} patch${pl.length > 1 ? 'es' : ''}: ${pl.map((p) => `${p.id} ${fmt(p.L, 'small', S.job, false)} × ${fmt(p.W, 'small', S.job)}${p.kind === 'tomb' ? ' tombstone' : ''}${p.status !== 'OK' ? ' (' + p.status.toLowerCase() + ')' : ''}`).join(', ')}` : 'No patches.'; }
  const c = S.calc, t = (mm) => fmt(mm, 't', S.job), tn = (mm) => fmt(mm, 't', S.job, false);
  const reps = S.job.indications.filter((i) => c.per.get(i.id)?.repair || c.per.get(i.id)?.status === 'below MRT').sort(byNo);
  el.innerHTML = `<h2>Results</h2>
    <p class="formula">MRT = min(RT<sub>bc</sub>, RT<sub>ip</sub>) − O<sub>r</sub>(StP<sub>r</sub> + UP<sub>r</sub>)</p>
    <div class="rates"><div><span>StP<sub>r</sub> product side</span><b>${fmtRate(c.StPr, S.job)}</b><small>${c.stSrc === 'override' ? 'entered' : c.C.coated && !c.stSrc ? 'coated → 0' : c.stSrc ? 'from ' + h(c.stSrc.no) + (c.stYears !== c.years ? ` over ${c.stYears} yr` : '') : 'no product side loss'}</small></div>
      <div><span>UP<sub>r</sub> soil side</span><b>${fmtRate(c.UPr, S.job)}</b><small>${c.C.cp ? 'effective CP → 0' : c.upSrc === 'override' ? 'entered' : c.upSrc === 'threshold' ? `MFL threshold ${c.C.mflThresholdPct} %` : c.upSrc ? 'from ' + h(c.upSrc.no) : 'no soil side loss'}</small></div>
      <div><span>Loss over O<sub>r</sub></span><b>${t(c.Or * c.K)}</b><small>${c.Or} yr × combined rate</small></div></div>
    <table class="grid"><thead><tr><th>Area (${u(S.job).small})</th><th class="n">RT<sub>ip</sub></th><th class="n">RT<sub>bc</sub></th><th class="n">MRT</th><th class="n">Min.</th><th class="n">Max. O<sub>r</sub></th><th></th></tr></thead><tbody>
    ${c.regions.map((r) => `<tr><td>${h(r.label)}</td><td class="n">${tn(r.RTip)}</td><td class="n">${tn(r.RTbc)}</td><td class="n"><b>${tn(r.MRT)}</b></td><td class="n">${tn(r.limit)}</td><td class="n">${r.OrMax == null ? '—' : Number.isFinite(r.OrMax) ? Math.max(0, r.OrMax).toFixed(1) + ' yr' : '∞'}</td><td class="${r.ok ? 'ok' : r.ok === false ? 'bad' : ''}">${r.notEvaluated ? 'Not evaluated' : r.ok == null ? '—' : r.ok ? (r.provisional ? `✓ Provisional (${r.provisional} on MFL estimates)` : '✓ OK') : '✕ Fails'}</td></tr>`).join('')}
    </tbody></table>
    <p class="muted small">Limits: bottom ${t(c.mBot)}${S.layout.Ri < S.layout.R ? ` · annular ${t(c.mAnn)} (${h(c.ann.src)})` : ''} · critical zone ${t(c.czLim)} (${c.C.czLimit != null ? 'entered' + (c.C.czLimitReason ? ': ' + h(c.C.czLimitReason) : '') : '§4.4.5.4'})${c.projection ? ` · bottom projection ${c.projection.ok === true ? '✓' : c.projection.ok === false ? '✕' : '?'} (§4.4.5.7)` : ''}</p>
    <p class="muted small">Any unrepaired location thinner than <b>${t(c.regions[0]?.tReq)}</b> today (bottom plates) will be below the minimum after ${c.Or} years at the current rates. Locations set to Repair "Auto" are marked for repair worst-first until the rest pass; rates are then re-derived from what is left unrepaired.</p>
    ${c.warnings.length ? `<ul class="warn">${c.warnings.map((w) => `<li>${h(w)}</li>`).join('')}</ul>` : ''}
    <h3>Repairs (${reps.length})</h3>
    <div class="ind-list">${reps.map((i) => { const a = c.per.get(i.id); return `<button class="ind-row" data-act="open-ind" data-id="${i.id}"><span class="dot r-${i.result}"></span><b>${h(i.no)}</b><span>${h(a.plate?.label)}</span><span class="n">${t(a.rem)}</span><span class="st st-${a.status.replace(/\W+/g, '-')}">${h(statusText(a))}</span></button>`; }).join('') || '<p class="muted small">No repairs required.</p>'}</div>`;
}

defineView('api', viewApi, () => refreshApi());

onAction({
  'ann-apply': async (el, id, e, act) => {
    S.job.calc.mrtAnnular = +el.dataset.v; commit(); renderView(); return;
  },
  'mrt-preset': async (el, id, e, act) => {
    S.job.calc.mrtBottom = +el.dataset.v; commit(); renderView(); return;
  }
});
