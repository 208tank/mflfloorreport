// Roof screens: fixed roof UT, floating roof (deck plates and pontoons) and rim seal inspection
// (refactoring step 4). Calculations are in roof.js and seal.js; this module draws the screens and handles their inputs.
import { S } from '../app/state.js';
import { field, focusSel, readInput } from '../app/fields.js';
import { defineView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { host } from '../app/host.js';
import { angleOf, itemFloor, plateAt } from '../geometry.js';
import { MapController } from '../map.js';
import { uid } from '../model.js';
import { autoPontCount, FIXED_SUPPORT, FIXED_TYPES, fixedSVG, FLOAT_TYPES, floatingLayout, floatingSVG, hasFixed, hasFloating, plateUT, pointStatus, PONT_COND, PT5, PT5_SHORT, ROOF_NOTE, ROOF_TYPES, roofBad, roofDiameter } from '../roof.js';
import { activeStds, cm2mToIn2ft, gapSummary, newGap, nextDue, PRIMARY_TYPES, SEAL_CHECKS, SEAL_STDS, sealEval, SECONDARY_TYPES } from '../seal.js';
import { utLocations } from '../shell.js';
import { $, askConfirm, toast } from '../ui.js';
import { fmt, inVal, u } from '../units.js';
import { esc as h } from '../util.js';

function viewRoof() {
  const ttl = { roofF: ['Fixed roof', 'Fixed roof details and UT readings.'], roofL: ['Floating roof', 'Floating roof layout, deck plate UT readings and pontoons.'], seal: ['Rim seal inspection', 'Seal gap survey and visual inspection against US EPA / Canadian rules.'] }[S.view] || ['Roof', ''];
  return `<div class="page wide roof-page"><div class="page-head"><div><h1>${ttl[0]}</h1><p class="muted">${ttl[1]}</p></div>
    <div class="acts"><button class="btn" data-act="utl-down" title="Excel sheet for the UT technician">UT loader ↓</button><button class="btn" data-act="utl-up" title="Upload the completed UT loader sheet">UT loader ↑</button><button class="btn" data-act="exp-roof">Export CSV</button></div></div>
    <div id="roofBody">${roofBodyHTML()}</div></div>`;
}

export const rStatus = (st) => (st ? `<span class="st ${st === 'OK' ? 'st-OK' : 'st-below-MRT'}">${st}</span>` : '');

function roofBodyHTML() {
  const job = S.job;
  const typeCard = `<section class="card"><div class="fgrid">${field('Roof type', 'roof.type', 'sel', { options: ROOF_TYPES })}
    <p class="muted small">${hasFloating(job) && hasFixed(job) ? 'Both the fixed roof and the internal floating roof are shown below.' : job.roof.type === 'none' ? 'Choose the roof type to record roof details and UT readings.' : ''}</p></div></section>`;
  const none = (t) => `<section class="card"><p class="muted">${t}</p></section>`;
  if (S.view === 'roofF') return typeCard + (hasFixed(job) ? fixedCardHTML() : none('This tank has no fixed roof. Change the roof type above if it has one.'));
  if (S.view === 'seal') return hasFloating(job) ? sealCardHTML() : typeCard + none('Rim seal inspection applies to floating roofs. Set the roof type to an external or internal floating roof.');
  return typeCard + (hasFloating(job) ? floatingCardHTML() : none('This tank has no floating roof. Change the roof type above if it has one.'));
}

function fixedCardHTML() {
  const job = S.job, Fx = job.roof.fixed, U = u(job), pts = Fx.pts || [];
  const vals = pts.map((p) => pointStatus(job, p)).filter((x) => x.t !== null);
  const min = vals.length ? Math.min(...vals.map((x) => x.t)) : null;
  const bad = vals.filter((x) => roofBad(x.status)).length;
  const pin = (pt, k, kind, extra = '') => `<input data-rpt="${pt.id}" data-f="${k}" data-kind="${kind}" ${kind === 'text' ? '' : 'inputmode="decimal"'} value="${h(kind === 'text' || kind === 'num' ? pt[k] ?? '' : inVal(pt[k], kind, job))}" ${extra}>`;
  return `<section class="card"><div class="sp-head"><h2>Fixed roof</h2><span class="muted small">${pts.length} UT point${pts.length === 1 ? '' : 's'} · min ${min !== null ? fmt(min, 't', job) : '—'}${bad ? ` · <b class="bad">${bad} below t-min</b>` : ''}</span></div>
    <div class="roof-grid">
      <div class="roof-left">
        <div class="fgrid">${field('Roof', 'roof.fixed.kind', 'sel', { options: FIXED_TYPES })}${field('Support', 'roof.fixed.support', 'sel', { options: FIXED_SUPPORT })}
          ${field('Slope / dome radius', 'roof.fixed.slope', 'text', { ph: 'e.g. 3/4 in 12, 1.0 D' })}${field('Nominal plate t', 'roof.fixed.tNom', 't')}
          ${field('t-min', 'roof.fixed.tMin', 't', { hint: ROOF_NOTE })}<div></div>
          ${field('Notes', 'roof.fixed.notes', 'area', { rows: 2, cls: 'span2' })}</div>
        <h3>UT points</h3>
        <div class="tblwrap"><table class="grid rpts"><thead><tr><th>Point</th><th>Angle (°)</th><th>From centre (${U.big})</th><th>Reading (${U.small})</th><th>Status</th><th></th></tr></thead><tbody>
        ${pts.map((pt) => { const st = pointStatus(job, pt); return `<tr class="${S.roofPt === pt.id ? 'sel' : ''}${roofBad(st.status) ? ' is-bad' : ''}"><td>${pin(pt, 'label', 'text', 'class="lbl"')}</td><td>${pin(pt, 'angle', 'num')}</td><td>${pin(pt, 'r', 'big')}</td><td>${pin(pt, 't', 't')}</td><td>${rStatus(st.status)}</td><td><button aria-label="Delete point" class="btn sm icon ghost danger" data-act="rpt-del" data-id="${pt.id}" title="Delete point">✕</button></td></tr>`; }).join('') || '<tr><td colspan="6" class="empty">No UT points yet.</td></tr>'}
        </tbody></table></div>
        <div class="acts"><button class="btn sm" data-act="rpt-add">+ Point</button><button class="btn sm" data-act="rpt-std">Standard points: edge &amp; mid-radius at each shell UT station + centre</button></div>
      </div>
      <div class="roof-right">
        <div class="rp-tools"><button class="btn sm${S.roofAdd ? ' on' : ''}" data-act="rpt-mode">+ Point on plan</button><span class="spacer"></span><button class="btn sm" data-act="roof-fit" data-k="fixed">Fit</button></div>
        <div class="mapbox rp-box" id="rpFixed" data-mode="${S.roofAdd ? 'add' : 'select'}">${fixedSVG(job, { sel: S.roofPt, stations: utLocations(job), columns: roofColumns(), fmtT: (t) => fmt(t, 't', job, false) })}</div>
        <div class="mapstatus"><span id="rpFixedHover">${S.roofAdd ? 'Click the plan where the reading was taken' : 'Scroll to zoom · drag to pan · click a point to select it'}</span></div>
      </div>
    </div></section>`;
}

function roofColumns() {
  return (S.job.features || []).filter((ft) => ft.type === 'column').map((ft) => { const p = itemFloor(S.layout, ft); return p ? { ...p, d: +ft.sizeA || 0 } : null; }).filter(Boolean);
}

function floatingCardHTML() {
  const job = S.job, F = job.roof.floating, U = u(job), lay = floatingLayout(job);
  const deck = lay.plates.filter((p) => p.kind !== 'annular'), pons = lay.plates.filter((p) => p.kind === 'annular');
  const orphan = Object.keys(F.ut || {}).filter((k) => !lay.byKey.has(k) && !k.startsWith('an') && Object.values(F.ut[k] || {}).some((v) => v != null)).length;
  const all = deck.map((p) => plateUT(job, p));
  const bad = all.filter((x) => roofBad(x.status)).length, done = all.filter((x) => x.count === 5).length;
  const pBad = pons.filter((p) => ['Liquid present', 'Leaking'].includes(F.pont?.[p.key]?.cond)).length;
  const sel = S.roofSel ? lay.byKey.get(S.roofSel) : null;
  const condSel = (key, cond) => `<select data-rpc="${key}" data-f="cond" data-kind="text">${PONT_COND.map((c) => `<option ${(cond || '') === c ? 'selected' : ''} value="${c}">${c || '—'}</option>`).join('')}</select>`;
  const rin = (p, k) => `<input data-rut="${p.key}" data-pt="${k}" data-kind="t" inputmode="decimal" value="${h(inVal(F.ut?.[p.key]?.[k], 't', job))}">`;
  const row = (p) => { const x = plateUT(job, p); return `<tr class="${S.roofSel === p.key ? 'sel' : ''}${roofBad(x.status) ? ' is-bad' : ''}"><td><button class="linkbtn" data-act="rsel" data-key="${p.key}">${h(p.label)}</button>${p.cut ? ' <small class="muted">cut</small>' : ''}</td>${PT5.map(([k]) => `<td>${rin(p, k)}</td>`).join('')}<td class="n"><b>${x.min != null ? fmt(x.min, 't', job, false) : '—'}</b></td><td class="n">${x.lossPct != null ? x.lossPct.toFixed(0) + '%' : '—'}</td><td>${rStatus(x.status)}</td></tr>`; };
  const prow = (p) => { const pc = F.pont?.[p.key] || {}; return `<tr class="${S.roofSel === p.key ? 'sel' : ''}${['Liquid present', 'Leaking'].includes(pc.cond) ? ' is-bad' : ''}"><td><button class="linkbtn" data-act="rsel" data-key="${p.key}">${h(p.label)}</button></td><td>${condSel(p.key, pc.cond)}</td><td><input class="pnote" data-rpc="${p.key}" data-f="notes" data-kind="text" value="${h(pc.notes || '')}"></td></tr>`; };
  const nav = (list, i) => `<div class="acts"><button aria-label="Previous" class="btn sm icon" data-act="rsel-nav" data-d="-1" ${i <= 0 ? 'disabled' : ''} title="Previous">‹</button><button class="btn sm icon" data-act="rsel-nav" data-d="1" ${i >= list.length - 1 ? 'disabled' : ''} title="Next">›</button><button aria-label="Close" class="btn sm icon ghost" data-act="rsel-close" title="Close">✕</button></div>`;
  let panel;
  if (!sel) panel = `<p class="muted small">Click a deck plate on the plan (or its name in the table) to enter its 5 UT readings. Click a pontoon to record its condition.</p>`;
  else if (sel.kind === 'annular') {
    const pc = F.pont?.[sel.key] || {};
    panel = `<div class="ed-head"><div class="ed-title"><span>Pontoon</span><b>${h(sel.label)}</b></div>${nav(pons, pons.indexOf(sel))}</div>
      <p class="muted small">${(sel.a0 % 360).toFixed(1)}° – ${(sel.a1 % 360).toFixed(1)}°. Pontoons are inspected for condition; no UT readings are taken on the pontoon tops.</p>
      <div class="fgrid"><label class="fld"><span class="lbl">Condition</span><span class="ctl">${condSel(sel.key, pc.cond)}</span></label><label class="fld"><span class="lbl">Notes</span><span class="ctl"><input data-rpc="${sel.key}" data-f="notes" data-kind="text" value="${h(pc.notes || '')}"></span></label></div>`;
  } else {
    const x = plateUT(job, sel);
    const cell = (k) => `<label class="u5"><span>${PT5_SHORT[k]}</span><span class="ctl">${rin(sel, k)}</span></label>`;
    panel = `<div class="ed-head"><div class="ed-title"><span>Deck plate</span><b>${h(sel.label)}</b></div>${nav(deck, deck.indexOf(sel))}</div>
      <p class="muted small">${fmt(sel.bb.x1 - sel.bb.x0, 'big', job)} × ${fmt(sel.bb.y1 - sel.bb.y0, 'big', job)}${sel.cut ? ' · cut plate' : ''}. Readings in ${U.small}.</p>
      <div class="ut5">${cell('tl')}<i></i>${cell('tr')}<i></i>${cell('c')}<i></i>${cell('bl')}<i></i>${cell('br')}</div>
      <div class="sum-grid three"><div><span>Min.</span><b>${x.min != null ? fmt(x.min, 't', job) : '—'}</b><small>${x.count}/5 readings</small></div><div><span>Loss</span><b>${x.lossPct != null ? x.lossPct.toFixed(0) + '%' : '—'}</b><small>${x.tNom ? 'vs ' + fmt(x.tNom, 't', job) : 'enter nominal'}</small></div><div><span>Status</span><b class="${x.status === 'OK' ? 'ok' : x.status ? 'bad' : ''}">${x.status || '—'}</b><small>${x.tMin ? 't-min ' + fmt(x.tMin, 't', job) : ''}</small></div></div>`;
  }
  return `<section class="card"><div class="sp-head"><h2>${job.roof.type === 'fixed-ifr' ? 'Internal floating roof' : 'External floating roof'}</h2><span class="muted small">${deck.length} deck plates · ${done}/${deck.length} fully read${bad ? ` · <b class="bad">${bad} below t-min</b>` : ''} · ${pons.length} pontoons${pBad ? ` · <b class="bad">${pBad} with liquid / leaking</b>` : ''}</span></div>
    <div class="fgrid g4">
      ${field('Roof', 'roof.floating.kind', 'sel', { options: FLOAT_TYPES })}${field('Rim gap (roof to shell)', 'roof.floating.rimGap', 'small')}
      ${field('Pontoon width (radial)', 'roof.floating.pontW', 'big', { hint: '0 = no pontoon ring' })}${field('Number of pontoons', 'roof.floating.pontN', 'num', { ph: `${autoPontCount(job)} (suggested)` })}
      ${field('First pontoon bulkhead at', 'roof.floating.pontStart', 'num', { unit: '°', ph: '0' })}${field('Deck plate width', 'roof.floating.plateW', 'big')}
      ${field('Deck plate length', 'roof.floating.plateL', 'big')}${field('Deck plates run', 'roof.floating.orient', 'sel', { options: [['h', 'Left – right'], ['v', 'Top – bottom']] })}
      ${field('Row stagger', 'roof.floating.stagger', 'sel', { options: [['0', 'None'], ['0.5', '½ plate'], ['0.3333333333', '⅓ plate'], ['0.25', '¼ plate']], attrs: 'data-num="1"' })}${field('Deck nominal t', 'roof.floating.deckNom', 't')}
      ${field('Deck t-min', 'roof.floating.deckMin', 't')}<div></div>
      ${field('Notes', 'roof.floating.notes', 'text', { cls: 'span2' })}
    </div>
    <p class="muted small">Roof diameter ${fmt(roofDiameter(job), 'big', job)} (shell less twice the rim gap). Deck plates are laid like the floor grid and cut at the pontoon ring. Each deck plate has 5 UT readings: the four corners and the centre. Pontoons record condition only.</p>
    ${orphan ? `<p class="callout warn">${orphan} plate${orphan > 1 ? 's' : ''} with readings no longer exist after a layout change. Change the layout back to see them, or re-enter the readings.</p>` : ''}
    <div class="roof-grid fl">
      <div class="roof-right">
        <div class="rp-tools"><span class="legend-mini"><i class="d ok"></i>OK <i class="d bad"></i>below t-min <i class="d empty"></i>no reading <i class="sq liq"></i>pontoon liquid / leaking</span><span class="spacer"></span><button class="btn sm" data-act="roof-fit" data-k="floating">Fit</button></div>
        <div class="mapbox rp-box" id="rpFloat">${floatingSVG(job, lay, { sel: S.roofSel })}</div>
        <div class="mapstatus"><span id="rpFloatHover">Scroll to zoom · drag to pan · click a plate</span></div>
      </div>
      <div class="roof-panel ed">${panel}</div>
    </div>
    <h3>Deck plate UT readings (${U.small})</h3>
    <div class="tblwrap rd-wrap"><table class="grid rplates"><thead><tr><th>Plate</th>${PT5.map(([k, l]) => `<th>${l}</th>`).join('')}<th class="n">Min</th><th class="n">Loss</th><th>Status</th></tr></thead><tbody>
      ${deck.map(row).join('')}
    </tbody></table></div>
    ${pons.length ? `<h3>Pontoons</h3><div class="tblwrap rd-wrap short"><table class="grid rplates pons"><thead><tr><th>Pontoon</th><th>Condition</th><th>Notes</th></tr></thead><tbody>${pons.map(prow).join('')}</tbody></table></div>` : ''}
  </section>`;
}

/* ------------------------------------------------------------- rim seal inspection */

/** Gap area per metre of diameter / gap width shown in the job's units (with the other system in brackets). */
function fmtGapArea(v) { if (v === null || v === undefined) return '—'; return S.job.units === 'metric' ? `${v.toFixed(1)} cm²/m` : `${cm2mToIn2ft(v).toFixed(2)} in²/ft <small class="muted">(${v.toFixed(1)} cm²/m)</small>`; }
function fmtGapW(cm) { if (cm === null || cm === undefined) return '—'; const big = cm >= 5; return S.job.units === 'metric' ? `${cm.toFixed(big ? 1 : 2)} cm` : `${(cm / 2.54).toFixed(big ? 1 : 3)} in <small class="muted">(${cm.toFixed(big ? 1 : 2)} cm)</small>`; }
function fmtLim(r) {
  if (r.limit === null || r.limit === undefined) return '—';
  return `${r.op} ${r.unit === 'cm2m' ? fmtGapArea(r.limit) : fmtGapW(r.limit)}`;
}

function sealCardHTML() {
  const job = S.job, seal = job.roof.seal, U = u(job), D = +job.tank.diameter || 0;
  const ifr = job.roof.type === 'fixed-ifr';
  const gapTable = (k) => {
    const sd = k === 'p' ? seal.primary : seal.secondary, sum = gapSummary(sd.gaps, D);
    const gin = (g, f, kind, extra = '') => `<input data-sg="${k}" data-gid="${g.id}" data-f="${f}" data-kind="${kind}" ${kind === 'text' ? '' : 'inputmode="decimal"'} value="${h(kind === 'small' ? inVal(g[f], 'small', job) : g[f] ?? '')}" ${extra}>`;
    return `<div class="tblwrap"><table class="grid sgaps"><thead><tr><th>#</th><th>Start angle (°)</th><th>Length (${U.small})</th><th>Max width (${U.small})</th><th>Avg width (${U.small})</th><th class="n">Area</th><th>Notes</th><th></th></tr></thead><tbody>
      ${sd.gaps.map((g, i) => { const L = +g.len, W = +(g.wAvg ?? g.wMax); const a = L > 0 && W > 0 ? (L / 10) * (W / 10) : null; return `<tr><td>${i + 1}</td><td>${gin(g, 'angle', 'num')}</td><td>${gin(g, 'len', 'small')}</td><td>${gin(g, 'wMax', 'small')}</td><td>${gin(g, 'wAvg', 'small', 'placeholder="= max"')}</td><td class="n">${a === null ? '—' : job.units === 'metric' ? a.toFixed(1) + ' cm²' : (a / 6.4516).toFixed(2) + ' in²'}</td><td>${gin(g, 'notes', 'text', 'class="note"')}</td><td><button aria-label="Remove gap" class="btn sm icon ghost danger" data-act="sg-del" data-sg="${k}" data-gid="${g.id}" title="Remove gap">✕</button></td></tr>`; }).join('') || `<tr><td colspan="8" class="empty">${sd.noGaps ? 'No gaps found.' : 'No gaps entered.'}</td></tr>`}
      </tbody></table></div>
      <div class="acts"><button class="btn sm" data-act="sg-add" data-sg="${k}">+ Gap</button>${field('No gaps found', `roof.seal.${k === 'p' ? 'primary' : 'secondary'}.noGaps`, 'bool', { cls: 'inline-chk' })}<span class="spacer"></span><span class="muted small">${sum.n} gap${sum.n === 1 ? '' : 's'} · total ${job.units === 'metric' ? sum.areaCm2.toFixed(1) + ' cm²' : (sum.areaCm2 / 6.4516).toFixed(2) + ' in²'} · ${fmtGapArea(sum.n ? sum.perM : seal[k === 'p' ? 'primary' : 'secondary'].noGaps ? 0 : null)}</span></div>`;
  };
  const stds = activeStds(seal);
  const results = stds.map((k) => {
    const ev = sealEval(job, k), due = nextDue(job, k);
    return `<div class="seal-res ${ev.overall === 'Compliant' ? 'ok' : ev.overall === 'Not compliant' ? 'bad' : ''}">
      <div class="sr-head"><b>${h(ev.L.short)}</b><span class="chip ${ev.overall === 'Compliant' ? 'r-ok' : ev.overall === 'Not compliant' ? 'r-bad' : 'r-pending'}">${ev.overall}</span></div>
      <div class="muted small">${h(ev.L.name)}</div>
      <table class="grid sres"><tbody>${ev.rows.map((r) => `<tr><td>${h(r.item)}</td><td class="n">${r.text !== undefined ? h(r.text) : r.unit === 'cm2m' ? fmtGapArea(r.value) : fmtGapW(r.value)}</td><td class="n muted">${r.limit !== undefined ? fmtLim(r) : ''}</td><td>${r.ok === true ? '<span class="st st-OK">OK</span>' : r.ok === false ? '<span class="st st-below-MRT">Fails</span>' : '<span class="muted small">—</span>'}</td></tr>`).join('')}</tbody></table>
      ${ev.warn.length ? `<ul class="warn">${ev.warn.map((w) => `<li>${h(w)}</li>`).join('')}</ul>` : ''}
      ${ev.fails ? `<p class="small"><b>Repair:</b> ${h(ev.repair)}</p>` : ''}
      ${due.length ? `<p class="small muted"><b>Inspection frequency${seal.date ? ' / next due' : ''}:</b> ${due.map((d) => `${h(d.what)} — ${d.every}${d.due ? ` (${d.due.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })})` : ''}`).join('; ')}.</p>` : ''}
    </div>`;
  }).join('') || '<p class="muted">Select at least one standard to evaluate against.</p>';
  const chk = SEAL_CHECKS.map(([k, label]) => { const c = seal.checks?.[k] || {}; return `<tr class="${c.r === 'defect' ? 'is-bad' : ''}"><td>${h(label)}</td><td><select data-sck="${k}" data-kind="text"><option value="" ${!c.r ? 'selected' : ''}>—</option><option value="ok" ${c.r === 'ok' ? 'selected' : ''}>OK</option><option value="defect" ${c.r === 'defect' ? 'selected' : ''}>Defect</option><option value="na" ${c.r === 'na' ? 'selected' : ''}>N/A</option></select></td><td><input data-sckn="${k}" data-kind="text" value="${h(c.note || '')}" placeholder="Note"></td></tr>`; }).join('');
  const C = SEAL_STDS;
  return `<section class="card seal-card"><div class="sp-head"><h2>Rim seal inspection</h2><span class="muted small">${ifr ? 'Internal floating roof' : 'External floating roof'} · gaps are drawn on the roof plan above (primary red, secondary blue)</span></div>
    <div class="seal-std">
      <span class="lbl">Evaluate against</span>
      ${field(`${C.kb.short} — 40 CFR 60 Subpart Kb / 63 Subpart WW`, 'roof.seal.std.kb', 'bool')}
      ${field(`${C.ca.short} — SOR/2025-88`, 'roof.seal.std.ca', 'bool')}
      ${field('Custom / provincial approval (e.g. CCME PN 1180)', 'roof.seal.std.custom', 'bool')}
    </div>
    ${seal.std.custom ? `<div class="fgrid g4 custom-lim">${field('Name / permit', 'roof.seal.custom.label', 'text', { ph: 'e.g. CCME PN 1180, approval no.' })}${field('Primary gap area limit', 'roof.seal.custom.pArea', 'num', { unit: 'cm²/m' })}${field('Primary max gap width', 'roof.seal.custom.pWidth', 'num', { unit: 'cm' })}${field('Secondary gap area limit', 'roof.seal.custom.sArea', 'num', { unit: 'cm²/m' })}${field('Secondary max gap width', 'roof.seal.custom.sWidth', 'num', { unit: 'cm' })}${field('Shoe top above liquid (min)', 'roof.seal.custom.shoeAbove', 'num', { unit: 'cm' })}${field('Shoe bottom below liquid (min)', 'roof.seal.custom.shoeBelow', 'num', { unit: 'cm' })}<p class="muted small span2">Enter the limits from the CCME guideline or your provincial approval. Gap limits are compared as “not more than”.</p></div>` : ''}
    <div class="fgrid g4">
      ${field('Inspection date', 'roof.seal.date', 'date')}${field('Inspected by', 'roof.seal.inspector')}
      ${field('Roof / liquid level at measurement', 'roof.seal.level', 'text', { ph: 'e.g. 22 ft 4 in liquid level' })}${field('Notes', 'roof.seal.notes')}
    </div>
    <div class="seal-grid">
      <div class="seal-col">
        <h3>Primary seal</h3>
        <div class="fgrid g3">${field('Type', 'roof.seal.primary.type', 'sel', { options: PRIMARY_TYPES })}
          ${/shoe/i.test(seal.primary.type) ? `${field('Shoe top above liquid', 'roof.seal.primary.shoeAbove', 'small')}${field('Shoe bottom below liquid', 'roof.seal.primary.shoeBelow', 'small')}${field('Shoe height', 'roof.seal.primary.shoeHeight', 'small')}` : ''}
          ${field('Condition / notes', 'roof.seal.primary.notes', 'text', { cls: /shoe/i.test(seal.primary.type) ? 'span2' : 'span2' })}</div>
        ${gapTable('p')}
      </div>
      <div class="seal-col">
        <h3>Secondary seal</h3>
        <div class="fgrid">${field('Type', 'roof.seal.secondary.type', 'sel', { options: SECONDARY_TYPES })}${field('Condition / notes', 'roof.seal.secondary.notes')}</div>
        ${seal.secondary.type === 'None' ? '<p class="muted small">No secondary seal fitted.</p>' : gapTable('s')}
      </div>
    </div>
    <p class="muted small">Find gaps with a ${C.kb.probe} probe (Canada: ${C.ca.probe}) passed freely between the seal and the shell, with the roof floating freely and the liquid level steady. Record each gap's start angle, length along the shell and width; the area is length × average width (maximum width if no average is entered). Gap area per metre of tank diameter = total area ÷ diameter (${fmt(D, 'big', job)}).</p>
    <h3>Visual inspection</h3>
    <div class="tblwrap"><table class="grid schecks"><thead><tr><th>Item</th><th>Result</th><th>Note</th></tr></thead><tbody>${chk}</tbody></table></div>
    <h3>Results</h3>
    <div class="seal-results">${results}</div>
    <p class="muted small">Limits from 40 CFR 60.113b and 63.1063 (US EPA) and SOR/2025-88 ss. 64–65, 73–76, 91–101 and Schedule 4 (Canada). Check the version that applies to the tank, its permit or approval, and the product stored.</p>
  </section>`;
}

export function refreshRoof() {
  setTimeout(() => {
    const c = $('#roofBody'); if (!c) return;
    const a = document.activeElement, key = a && c.contains(a) ? focusSel(a) : null, typed = a && a.value !== undefined && a.value !== a.defaultValue ? a.value : null;
    c.innerHTML = roofBodyHTML();
    attachRoofMaps();
    if (key) { const n = c.querySelector(key); if (n && typed !== null && n.value !== typed) { n.value = typed; n.dataset.restored = '1'; } if (n) { n.focus({ preventScroll: true }); try { if (typed === null) n.select(); else n.setSelectionRange(n.value.length, n.value.length); } catch { /* */ } } }
  }, 0);
}

function attachRoofMaps() {
  const mk = (id, k, onClick, onHover) => {
    const box = $(id); if (!box) return;
    const ctl = new MapController(box, { onClick, onHover, rerender: () => { S.roofVB[k] = null; refreshRoof(); } });
    ctl.r = +box.querySelector('svg')?.dataset.r || 0; ctl.vb = S.roofVB[k]; ctl.afterRender();
    const orig = ctl.setVB.bind(ctl); ctl.setVB = (vb) => { orig(vb); S.roofVB[k] = vb; };
  };
  mk('#rpFixed', 'fixed', roofFixedClick, (fp) => { const el = $('#rpFixedHover'); if (!el) return; if (!fp) { el.textContent = S.roofAdd ? 'Click the plan where the reading was taken' : 'Scroll to zoom · drag to pan · click a point to select it'; return; } const r = Math.hypot(fp.x, fp.y); el.innerHTML = r > S.job.tank.diameter / 2 ? 'Outside the roof' : `θ <b>${angleOf(fp.x, fp.y).toFixed(1)}°</b> · <b>${fmt(r, 'big', S.job)}</b> from centre`; });
  mk('#rpFloat', 'floating', roofFloatClick, (fp) => { const el = $('#rpFloatHover'); if (!el) return; if (!fp) { el.textContent = 'Scroll to zoom · drag to pan · click a plate'; return; } const p = plateAt(floatingLayout(S.job), fp.x, fp.y); el.innerHTML = p ? `<b>${h(p.label)}</b> ${p.kind === 'annular' ? 'pontoon' : 'deck plate'}` : 'Rim gap / outside the roof'; });
}

function roofFixedClick(fp, hit) {
  if (!fp) return;
  if (hit.feature) { S.roofPt = hit.feature; refreshRoof(); setTimeout(() => $(`#roofBody input[data-rpt="${hit.feature}"][data-f="t"]`)?.focus(), 40); return; }
  if (S.roofAdd) {
    const r = Math.hypot(fp.x, fp.y), R = S.job.tank.diameter / 2;
    if (r > R) { toast('That point is outside the roof.'); return; }
    const st = S.job.units === 'metric' ? 10 : 25.4;
    const pts = (S.job.roof.fixed.pts = S.job.roof.fixed.pts || []);
    let n = 0; for (const p of pts) { const m = String(p.label || '').match(/^R(\d+)$/); if (m) n = Math.max(n, +m[1]); }
    const pt = { id: uid(), label: 'R' + (n + 1), angle: Math.round(angleOf(fp.x, fp.y) * 2) / 2 % 360, r: Math.round(r / st) * st, t: null };
    pts.push(pt); S.roofPt = pt.id; if (!hit.shift) S.roofAdd = false;
    host.commit(); refreshRoof(); setTimeout(() => $(`#roofBody input[data-rpt="${pt.id}"][data-f="t"]`)?.focus(), 40); return;
  }
  S.roofPt = null; refreshRoof();
}

function roofFloatClick(fp, hit) {
  S.roofSel = hit.plate || null; refreshRoof();
  if (S.roofSel) setTimeout(() => $(`.roof-panel input[data-pt="tl"], .roof-panel select[data-rpc]`)?.focus(), 40);
}

defineView('roofF', viewRoof, attachRoofMaps);
defineView('roofL', viewRoof, attachRoofMaps);
defineView('seal', viewRoof, attachRoofMaps);

onAction({
  'rsel': async (el, id, e, act) => {
    S.roofSel = el.dataset.key; refreshRoof(); setTimeout(() => $(`.roof-panel input[data-pt="tl"], .roof-panel select[data-rpc]`)?.focus(), 40); return;
  },
  'sg-add': async (el, id, e, act) => {
    {
      const sd = el.dataset.sg === 'p' ? S.job.roof.seal.primary : S.job.roof.seal.secondary;
      const g = newGap(); sd.gaps.push(g); sd.noGaps = false; host.commit(); refreshRoof();
      setTimeout(() => $(`#roofBody input[data-gid="${g.id}"][data-f="angle"]`)?.focus(), 40); return;
    }
  },
  'sg-del': async (el, id, e, act) => {
    {
      const sd = el.dataset.sg === 'p' ? S.job.roof.seal.primary : S.job.roof.seal.secondary;
      sd.gaps = sd.gaps.filter((x) => x.id !== el.dataset.gid); host.commit(); refreshRoof(); return;
    }
  },
  'rsel-close': async (el, id, e, act) => {
    S.roofSel = null; refreshRoof(); return;
  },
  'rsel-nav': async (el, id, e, act) => {
    {
      const all = floatingLayout(S.job).plates, cur = all.find((p) => p.key === S.roofSel);
      const list = all.filter((p) => (p.kind === 'annular') === (cur?.kind === 'annular')), i = list.indexOf(cur), nx = list[i + +el.dataset.d];
      if (nx) { S.roofSel = nx.key; refreshRoof(); setTimeout(() => $(`.roof-panel input[data-pt="tl"], .roof-panel select[data-rpc]`)?.focus(), 40); } return;
    }
  },
  'roof-fit': async (el, id, e, act) => {
    S.roofVB[el.dataset.k] = null; refreshRoof(); return;
  },
  'rpt-mode': async (el, id, e, act) => {
    S.roofAdd = !S.roofAdd; refreshRoof(); return;
  },
  'rpt-add': async (el, id, e, act) => {
    {
      const pts = (S.job.roof.fixed.pts = S.job.roof.fixed.pts || []);
      let n = 0; for (const p of pts) { const m = String(p.label || '').match(/^R(\d+)$/); if (m) n = Math.max(n, +m[1]); }
      const pt = { id: uid(), label: 'R' + (n + 1), angle: null, r: null, t: null }; pts.push(pt); S.roofPt = pt.id;
      host.commit(); refreshRoof(); setTimeout(() => $(`#roofBody input[data-rpt="${pt.id}"][data-f="angle"]`)?.focus(), 40); return;
    }
  },
  'rpt-del': async (el, id, e, act) => {
    {
      const Fx = S.job.roof.fixed, pt = (Fx.pts || []).find((x) => x.id === id); if (!pt) return;
      if (pt.t != null && !(await askConfirm(`Delete point ${pt.label || ''} and its reading?`, { ok: 'Delete', danger: true }))) return;
      Fx.pts = Fx.pts.filter((x) => x.id !== id); if (S.roofPt === id) S.roofPt = null; host.commit(); refreshRoof(); return;
    }
  },
  'rpt-std': async (el, id, e, act) => {
    {
      const D = +S.job.tank.diameter || 0; if (!(D > 0)) { toast('Enter the tank diameter first.'); return; }
      const Fx = S.job.roof.fixed;
      if ((Fx.pts || []).length && !(await askConfirm('Replace the current fixed roof UT points with the standard set? Readings on the current points will be removed.', { ok: 'Replace', danger: true }))) return;
      const R = D / 2, edge = Math.max(R * 0.5, R - (S.job.units === 'metric' ? 600 : 609.6));
      Fx.pts = [{ id: uid(), label: 'CTR', angle: 0, r: 0, t: null }];
      for (const l of utLocations(S.job)) { Fx.pts.push({ id: uid(), label: `${l.label}-E`, angle: l.angle, r: Math.round(edge), t: null }); Fx.pts.push({ id: uid(), label: `${l.label}-M`, angle: l.angle, r: Math.round(R / 2), t: null }); }
      host.commit(); refreshRoof(); return;
    }
  }
});

onChange([
  { order: 90, when: (el, act) => el.matches('[data-sg]'), run: async (el, e, act) => {
    {
    const sd = el.dataset.sg === 'p' ? S.job.roof.seal.primary : S.job.roof.seal.secondary;
    const g = sd.gaps.find((x) => x.id === el.dataset.gid); if (!g) return;
    const k = el.dataset.f; let v = readInput(el);
    if (k !== 'notes' && v !== null && v < 0) { toast('Values can’t be negative.'); return; }
    if (k === 'angle' && v !== null) v = ((v % 360) + 360) % 360;
    g[k] = v; host.commit(); refreshRoof(); return;
  }
  } },
  { order: 100, when: (el, act) => el.matches('[data-sck]') || el.matches('[data-sckn]'), run: async (el, e, act) => {
    {
    const seal = S.job.roof.seal; seal.checks = seal.checks || {};
    const k = el.dataset.sck || el.dataset.sckn, c = (seal.checks[k] = seal.checks[k] || {});
    if (el.dataset.sck) { if (el.value) c.r = el.value; else delete c.r; } else c.note = el.value;
    if (!c.r && !c.note) delete seal.checks[k];
    host.commit(); refreshRoof(); return;
  }
  } },
  { order: 110, when: (el, act) => el.matches('[data-rut]'), run: async (el, e, act) => {
    {
    const F = S.job.roof.floating; F.ut = F.ut || {};
    const m = (F.ut[el.dataset.rut] = F.ut[el.dataset.rut] || {}), v = readInput(el);
    if (v !== null && v < 0) { toast('Readings can’t be negative.'); return; }
    if (v === null) delete m[el.dataset.pt]; else m[el.dataset.pt] = v;
    host.commit(); refreshRoof(); return;
  }
  } },
  { order: 120, when: (el, act) => el.matches('[data-rpc]'), run: async (el, e, act) => {
    {
    const F = S.job.roof.floating; F.pont = F.pont || {};
    const m = (F.pont[el.dataset.rpc] = F.pont[el.dataset.rpc] || {}), v = readInput(el);
    if (v === null || v === '') delete m[el.dataset.f]; else m[el.dataset.f] = v;
    host.commit(); refreshRoof(); return;
  }
  } },
  { order: 130, when: (el, act) => el.matches('[data-rpt]'), run: async (el, e, act) => {
    {
    const pt = (S.job.roof.fixed.pts || []).find((x) => x.id === el.dataset.rpt); if (!pt) return;
    const k = el.dataset.f; let v = readInput(el);
    if (k !== 'label' && v !== null && v < 0) { toast('Values can’t be negative.'); return; }
    if (k === 'angle' && v !== null) v = ((v % 360) + 360) % 360;
    if (k === 'r' && v !== null && v > (+S.job.tank.diameter || 0) / 2) { toast('That is further from the centre than the shell.'); return; }
    pt[k] = v; host.commit(); refreshRoof(); return;
  }
  } }
]);
