// Front chapters of the report (report improvements R2): executive summary, tank identification and design,
// inspection scope and limitations, and personnel, equipment and calibration. Values are printed as entered or as
// the calculations give them; nothing here draws a conclusion that was not entered. No browser APIs.
import { calState, EQ_LABEL, EQ_TYPES, equipName, equipUse, useByMethod } from '../equipment.js';
import { certState, ROLE_LABEL } from '../personnel.js';
import { SRC_LABEL } from '../sources.js';
import { allDefs, findings, SECTIONS, STATUS_TEXT } from '../sections.js';
import { inScope } from '../registry.js';
import { hasFixed, hasFloating, ROOF_TYPES } from '../roof.js';
import { coursesWithElev, shellHeight } from '../shell.js';
import { courseDesigns } from '../design.js';
import { fmt } from '../units.js';
import { escText as h, escText } from '../util.js';

const yn = (b) => (b ? 'Yes' : 'No');
const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const para = (s) => h(s).replace(/\n/g, '<br>');
/** A value-type mark (key in the front matter). */
/** The mark for a remaining thickness by its source: from a UT reading C; nominal − VT pit depth or MFL estimate E. */
export const remMark = (a) => (!a?.src ? '' : a.src === 'UT' ? vm('C') : vm('E'));
/** Calculated result box (R6): what the calculation found, against its limit, and where the working is. */
export const resultBox = (lines, appendix, cls = '') => `<div class="rbox ${cls}"><span class="vk">Calculated result${vm('C')}</span>${lines.filter(Boolean).map((l) => `<div>${l}</div>`).join('')}${appendix && [].concat(appendix).length ? `<small>Working: ${[].concat(appendix).length > 1 ? 'appendices' : 'appendix'} ${[].concat(appendix).map((x) => `“${escText(x)}”`).join(' and ')}.</small>` : ''}</div>`;
/** Engineering assessment box (R6): the engineer's words as entered, or a plain statement that there are none. */
export const assessBox = (a, what = '') => (a?.text
  ? `<div class="abox"><span class="vk">Engineering assessment${vm('A')}${what ? ' — ' + escText(what) : ''}</span>${escText(a.text).replace(/\n/g, '<br>')}${a.by || a.date ? `<small>${escText([a.by, a.date].filter(Boolean).join(', '))}</small>` : ''}</div>`
  : `<div class="abox none"><span class="vk">Engineering assessment${vm('A')}${what ? ' — ' + escText(what) : ''}</span>No engineering assessment entered.</div>`);
export const vm = (k) => `<sup class="vm" title="${{ M: 'Measured', C: 'Calculated', E: 'Estimated', O: 'Inspector observation', A: 'Engineering assessment' }[k]}">${k}</sup>`;

/* --------------------------------------------------------------------------- executive summary --- */

export function execCh({ job, layout, calc, N }) {
  const I = job.info || {}, S2 = job.summary || {}, F = findings(job, layout, calc);
  const defs = allDefs(job), open = defs.filter((d) => d.status !== 'Closed'), pri = open.filter((d) => ['P1', 'P2'].includes(d.priority));
  const secs = SECTIONS.filter((s) => inScope(job, s.key));
  const who = [S2.assessBy, S2.assessDate].filter(Boolean).join(', ');
  const scopeLine = `API 653 inspection of tank ${h(I.tankId || '—')}${I.site ? ' at ' + h(I.site) : ''}${I.client ? ' for ' + h(I.client) : ''}${I.inspDate ? ', ' + h(I.inspDate) : ''}. Components in scope: ${h(secs.map((s) => s.label).join(', ') || '—')}.`;
  const verdict = S2.condition
    ? `<div class="verdict ${/Not fit|Further/.test(S2.condition) ? 'bad' : /repairs/.test(S2.condition) ? 'warn' : 'ok'}"><span class="vk">Overall condition — engineering assessment${vm('A')}</span>${h(S2.condition)}${who ? `<small>${h(who)}</small>` : ''}</div>`
    : `<div class="verdict none"><span class="vk">Overall condition — engineering assessment${vm('A')}</span>No engineering assessment entered.</div>`;
  // the floor interval: Oᵣ entered for the calculation, and the longest interval the calculation allows
  const orIn = +job.calc?.Or > 0 ? +job.calc.Or : null;
  const orMax = (calc.regions || []).map((r) => r.OrMax).filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  const nextRows = [
    ['Return to service', S2.rts, ''], ['Next external inspection', S2.nextExt, ''], ['Next internal inspection', S2.nextInt, ''], ['Next UT thickness inspection', S2.nextUT, ''],
  ].filter(([, v]) => !blank(v)).map(([k, v]) => [k, h(v) + vm('A')]);
  if (inScope(job, 'floor') && orIn) nextRows.push(['Floor — Oᵣ used in the bottom calculation', `${orIn} yr (input)`]);
  if (inScope(job, 'floor') && orMax.length) nextRows.push(['Floor — longest Oᵣ the calculation allows', `${Math.max(0, Math.min(...orMax)).toFixed(1)} yr${vm('C')} (bottom evaluation by area, floor chapter)`]);
  return `<section class="exec">
    <p class="exec-scope">${scopeLine}</p>
    ${verdict}
    ${S2.narrative ? `${N.sub('Summary of findings')}<p>${para(S2.narrative)}</p>` : ''}
    ${N.table('Condition by component')}<table class="grid small wrap"><thead><tr><th>Component</th><th>Evaluation result${vm('C')}${vm('O')}</th><th>Key results</th><th>Engineering assessment${vm('A')}</th><th class="n">Open deficiencies</th></tr></thead><tbody>
    ${secs.map((s) => { const f = F[s.key], n = open.filter((d) => d.sec === s.key).length, a = job.secs?.[s.key]?.assess || {};
      return `<tr class="${f.status === 'bad' ? 'is-bad' : ''}"><td><b>${h(s.label)}</b></td><td>${STATUS_TEXT[f.status]}</td><td>${f.lines.slice(0, 3).join('<br>') || '—'}</td><td>${a.text ? para(a.text) + (a.by || a.date ? `<br><small>${h([a.by, a.date].filter(Boolean).join(', '))}</small>` : '') : '<span class="muted">Not entered</span>'}</td><td class="n">${n || '—'}</td></tr>`; }).join('')}
    </tbody></table>
    <p class="note">Evaluation result: from the calculations and the recorded observations. Engineering assessment: as entered by the engineer.</p>
    ${pri.length ? `${N.sub('Priority items (P1 / P2)')}<ul>${pri.map((d) => `<li><b>${h(d.no || '')}</b> ${h(d.secLabel)}: ${h(d.finding)}${d.action ? ` — <i>${h(d.action)}</i>` : ''}</li>`).join('')}</ul>` : ''}
    ${nextRows.length ? `${N.sub('Next inspections')}<table class="kv">${nextRows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>` : ''}
  </section>`;
}

/* ---------------------------------------------------------------- tank identification and design --- */

export function tankCh({ job, N }) {
  const I = job.info || {}, T = job.tank || {}, src = T.src || {}, t = (mm) => fmt(mm, 't', job), big = (mm) => fmt(mm, 'big', job);
  const kv = (rows) => `<table class="kv">${rows.filter(([, v]) => !blank(v)).map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('')}</table>`;
  const courses = coursesWithElev(job), Hc = shellHeight(job);
  const designs = (() => { try { return courseDesigns(job); } catch { return []; } })();
  const mats = [...new Set(designs.map((d) => d.matl).filter(Boolean))];
  const tn = courses.map((c) => +c.tNom).filter((v) => v > 0);
  const roof = job.roof || {};
  const roofTxt = [ROOF_TYPES?.find?.(([k]) => k === roof.type)?.[1] || (roof.type && roof.type !== 'none' ? roof.type : 'None / not recorded'),
    hasFixed(job) ? [roof.fixed?.kind, roof.fixed?.support, roof.fixed?.tNom ? 'plate ' + t(roof.fixed.tNom) : ''].filter(Boolean).join(', ') : '',
    hasFloating(job) ? [roof.floating?.kind, roof.floating?.deckNom ? 'deck ' + t(roof.floating.deckNom) : ''].filter(Boolean).join(', ') : ''].filter(Boolean).join(' — ');
  const S = (k) => (src[k] ? h(SRC_LABEL[src[k]] || src[k]) : '<span class="muted">Not stated</span>');
  const design = [
    ['code', 'Construction code', h([T.code, T.edition, T.supp].filter(Boolean).join(', ') || '—')],
    ['yearBuilt', 'Year built', h(T.yearBuilt || '—')],
    ['diameter', 'Diameter', big(T.diameter)],
    ['height', 'Shell height', +T.height > 0 ? big(T.height) : Hc ? `${big(Hc)}${vm('C')} (sum of course heights)` : '—'],
    ['courses', 'Shell courses', courses.length ? `${courses.length}${tn.length ? `, nominal ${t(Math.max(...tn))} to ${t(Math.min(...tn))}` : ''}` : '—'],
    ['materials', 'Shell material', h(mats.join(', ') || '—')],
    ['bottomType', 'Bottom construction', h(T.bottomType || '—')],
    ['tBottom', 'Bottom nominal thickness', t(T.tBottom)],
    ['tAnnular', 'Annular nominal thickness', job.layout?.annular ? t(T.tAnnular) : 'No annular ring'],
    ['roof', 'Roof', h(roofTxt)],
    ['sg', 'Product specific gravity', h(T.sg ?? '—')],
    ['fillH', 'Maximum fill height', T.fillH ? big(T.fillH) : 'Shell height (no fill height entered)'],
    ['opTemp', 'Maximum operating temperature', blank(T.opTemp) ? '—' : `${h(T.opTemp)} ${job.units === 'metric' ? '°C' : '°F'}`],
    ['coating', 'Product-side coating / CP / RPB', `${h(T.coating || 'None')} / ${yn(T.cp)} / ${yn(T.rpb)}`],
  ];
  return `<section>
    ${N.sub('Identification')}
    ${kv([['Owner / operator', h(I.owner)], ['Client', h(I.client)], ['Facility / site', h(I.site)], ['Location / area', h(I.location)], ['Tank ID', h(I.tankId)], ['Service', h(I.service)], ['Product', h(I.product)],
      ['Work order', h(I.workOrder)], ['Inspection date', h(I.inspDate)], ['Last internal inspection', h(T.lastInternal)], ['Previous inspection report', h(T.prevReport)], ['Tank registry', job.tankRef ? 'Linked to the tank registry' : '']])}
    ${N.sub('Design data')}
    ${N.table('Design data and its source')}<table class="grid small wrap"><thead><tr><th>Item</th><th>Value</th><th>Source</th></tr></thead><tbody>
      ${design.map(([k, l, v]) => `<tr><td>${l}</td><td>${v}</td><td>${S(k)}</td></tr>`).join('')}
    </tbody></table>
    <p class="note">Source: nameplate, drawing, previous report, measured or assumed, as recorded for this job. "Not stated" — no source recorded; treat the value as unconfirmed.</p>
  </section>`;
}

/* -------------------------------------------------------------- inspection scope and limitations --- */

export function scopeCh({ job, layout, N }) {
  const S2 = job.summary || {}, secs = SECTIONS.filter((s) => inScope(job, s.key)), out = SECTIONS.filter((s) => !inScope(job, s.key));
  let aTot = 0, aNot = 0, aPart = 0;
  for (const p of layout.plates || []) { aTot += p.area; const s = job.plates?.[p.key]?.scan; if (s === 'not') aNot += p.area; else if (s === 'partial') aPart += p.area; }
  const pc = (a) => (aTot ? ((a / aTot) * 100).toFixed(1) + ' %' : '—');
  const cover = (k) => (k === 'floor' && aTot ? `MFL: ${pc(aTot - aNot - aPart)} of the floor area scanned in full, ${pc(aPart)} in part, ${pc(aNot)} not scanned${vm('C')}` : '');
  const methods = (k) => (job.secs?.[k]?.nde || []).map((n) => `${h(n.method)}${n.extent ? ' — ' + h(n.extent) : ''}${n.result ? ` <small>(${h(n.result)})</small>` : ''}`).join('<br>');
  const lim = secs.map((s) => [s, job.secs?.[s.key]?.scope || {}]).filter(([, x]) => ['access', 'cleaning', 'conditions', 'notInspected'].some((f) => !blank(x[f])));
  return `<section>
    ${N.sub('Methods and extent')}
    ${S2.scope ? `<p>${para(S2.scope)}</p>` : ''}
    ${N.table('Inspection scope by component')}<table class="grid small wrap"><thead><tr><th>Component</th><th>NDE methods and extent</th><th>Coverage</th></tr></thead><tbody>
      ${secs.map((s) => `<tr><td><b>${h(s.label)}</b></td><td>${methods(s.key) || '<span class="muted">No methods recorded</span>'}</td><td>${cover(s.key) || '—'}</td></tr>`).join('')}
    </tbody></table>
    ${out.length ? `<p class="note">Not in the scope of this inspection: ${h(out.map((s) => s.label).join(', '))}.</p>` : ''}
    ${N.sub('Access, conditions and limitations')}
    ${lim.length ? `${N.table('Access, cleaning, conditions and areas not inspected')}<table class="grid small wrap"><thead><tr><th>Component</th><th>Access</th><th>Cleaning / preparation</th><th>Conditions</th><th>Areas not inspected and why</th></tr></thead><tbody>
      ${lim.map(([s, x]) => `<tr><td><b>${h(s.label)}</b></td><td>${para(x.access || '—')}</td><td>${para(x.cleaning || '—')}</td><td>${para(x.conditions || '—')}</td><td>${para(x.notInspected || '—')}</td></tr>`).join('')}
    </tbody></table>` : '<p class="muted">No access, cleaning, conditions or limitations were recorded for this inspection.</p>'}
  </section>`;
}

/* ------------------------------------------------------------ personnel, equipment and calibration --- */

export function personnelCh({ job, N }) {
  const I = job.info || {}, d = I.inspDate, people = (job.personnel || []).filter((p) => p.name || p.certNo);
  const use = equipUse(job, SECTIONS, inScope), all = job.equipment || [];
  const picked = all.filter((e) => use.has(e.id));
  const list = (picked.length ? picked : all).slice().sort((a, b) => EQ_TYPES.findIndex(([k]) => k === a.type) - EQ_TYPES.findIndex(([k]) => k === b.type));
  const checks = list.flatMap((e) => (e.checks || []).filter((c) => c.check || c.result).map((c) => ({ ...c, e })));
  const calStatus = (e) => { const c = calState(e, d); return !e.calDue ? 'No due date recorded' : c === 'expired' ? '<b>Expired</b>' : 'Valid'; };
  const certCol = (p) => { const c = certState(p, d); return p.expiry ? `${h(p.expiry)}${c === 'expired' ? ' <b>(expired at the inspection date)</b>' : ''}` : '—'; };
  const signers = people.length ? people.filter((p) => p.name) : [['MFL operator'], ['UT technician'], ['API 653 inspector']].map(([r]) => ({ name: '', roleText: r }));
  return `<section>
    ${N.sub('Personnel')}
    ${people.length ? `${N.table('Inspection personnel and certification')}<table class="grid small wrap"><thead><tr><th>Role</th><th>Name</th><th>Company</th><th>Certification</th><th>Cert. no.</th><th>Method / level</th><th>Expiry</th></tr></thead><tbody>
      ${people.map((p) => `<tr class="${certState(p, d) === 'expired' ? 'is-bad' : ''}"><td>${h(ROLE_LABEL[p.role] || p.role || '')}</td><td>${h(p.name)}</td><td>${h(p.company)}</td><td>${h(p.cert)}</td><td>${h(p.certNo)}</td><td>${h([p.method, p.level ? 'Level ' + p.level : ''].filter(Boolean).join(', '))}</td><td>${certCol(p)}</td></tr>`).join('')}
    </tbody></table>` : '<p class="muted">No personnel listed.</p>'}
    ${N.sub('Equipment')}
    ${list.length ? `${N.table('Equipment used')}<table class="grid small wrap eq-rt"><thead><tr><th>Equipment</th><th>Make / model</th><th>Serial no.</th><th>Settings / details</th><th>Used for</th></tr></thead><tbody>${list.map((e) => `<tr><td>${h(EQ_LABEL[e.type] || e.type)}</td><td>${h([e.make, e.model].filter(Boolean).join(' '))}</td><td>${h(e.serial)}</td><td>${h([e.details, e.type === 'mfl' && e.threshold ? 'reporting threshold ' + e.threshold + ' %' : ''].filter(Boolean).join(' · '))}</td><td>${useByMethod(use.get(e.id)).map(h).join('<br>')}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">No equipment listed.</p>'}
    ${list.length ? `${N.sub('Calibration')}${N.table('Calibration status on the inspection date')}<table class="grid small wrap"><thead><tr><th>Equipment</th><th>Serial no.</th><th>Certificate no.</th><th>Calibrated</th><th>Cal. due</th><th>Status on ${h(d || 'the inspection date')}</th><th>Reference standard / block</th></tr></thead><tbody>
      ${list.map((e) => `<tr class="${calState(e, d) === 'expired' ? 'is-bad' : ''}"><td>${h(equipName(e))}</td><td>${h(e.serial)}</td><td>${h(e.certNo || '—')}</td><td>${h(e.calDate || '—')}</td><td>${h(e.calDue || '—')}</td><td>${calStatus(e)}</td><td>${h(e.refStd || '—')}</td></tr>`).join('')}
    </tbody></table>
    ${checks.length ? `${N.table('On-site verification checks')}<table class="grid small wrap"><thead><tr><th>Date and time</th><th>Equipment</th><th>Check</th><th>Result</th></tr></thead><tbody>${checks.map((c) => `<tr><td>${h(String(c.at || '').replace('T', ' '))}</td><td>${h(equipName(c.e))}${c.e.serial ? ' (S/N ' + h(c.e.serial) + ')' : ''}</td><td>${h(c.check)}</td><td>${h(c.result)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">No on-site verification checks recorded.</p>'}` : ''}
    ${I.utDate ? `<p class="small">Date of UT readings: ${h(I.utDate)}</p>` : ''}
    ${I.notes ? `<p><b>Notes:</b> ${para(I.notes)}</p>` : ''}
    <table class="sig">${Array.from({ length: Math.ceil(signers.length / 3) }, (_, r) => `<tr>${signers.slice(r * 3, r * 3 + 3).map((p) => `<td><div class="line"></div><b>${h(p.name || '')}</b><br>${h(p.roleText || ROLE_LABEL[p.role] || '')} · Date</td>`).join('')}</tr>`).join('')}</table>
  </section>`;
}
