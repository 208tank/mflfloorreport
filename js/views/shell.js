// Shell screen: course build, shell UT readings and the shell evaluation (refactoring step 5).
import { S } from '../app/state.js';
import { field, focusSel, readInput, rerenderKeep } from '../app/fields.js';
import { defineView, redraw } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { commit } from '../app/persist.js';
import { defaultJoint, designBasis, fillFromT } from '../design.js';
import { uid } from '../model.js';
import { autoLocCount, autoPlateCount, courseAt, coursePlates, courseSummary, coursesWithElev, defaultShell, defaultZones, fmtElev, getReading, readingElevations, rolloutSVG, shellHeight, SPACING_MM, utLocations, zKey, zoneCount } from '../shell.js';
import { jointLabel, jointOptions, MATERIALS, PSI_MPA } from '../tables.js';
import { $, $$, askConfirm, toast } from '../ui.js';
import { fmt, inVal, num, toMm, u } from '../units.js';
import { esc as h } from '../util.js';

function viewShell() {
  return `<div class="page wide shell-page"><div class="page-head"><div><h1>Shell UT</h1><p class="muted">Shell course thickness readings at standard UT stations around the circumference, with a shell roll-out showing the station lines.</p></div>
    <div class="acts"><button class="btn" data-act="utl-down" title="Excel sheet for the UT technician">UT loader ↓</button><button class="btn" data-act="utl-up" title="Upload the completed UT loader sheet">UT loader ↑</button><button class="btn" data-act="exp-shell">Export CSV</button><button class="btn" data-act="exp-shell-svg">Roll-out (SVG)</button></div></div>
    <div id="shellBody">${shellBodyHTML()}</div></div>`;
}

function shellBodyHTML() {
  const job = S.job, sh = job.shell || defaultShell(job.units), U = u(job);
  const courses = coursesWithElev(job), locs = utLocations(job), sum = courseSummary(job);
  const D = +job.tank?.diameter || 0, C = Math.PI * D, auto = autoLocCount(job), H = shellHeight(job);
  const top = courses.slice().reverse();
  const cin = (c, k, kind, ph = '', cls = '') => { const raw = k === 'tMin' ? c.tMinSet : c[k]; if (k === 'tMin' && !ph && c.tMinCalc) ph = inVal(c.tMinCalc, 't', job); return `<input data-shc="${k}" data-course="${c.id}" data-kind="${kind}" inputmode="decimal" value="${h(kind === 'num' ? raw ?? '' : inVal(raw, kind, job))}" placeholder="${h(ph)}" class="${cls}" ${k === 'tMin' && c.tMinCalc && !c.tMinSet ? 'title="Calculated: API 653 §4.3.3.1 a) — type a value to override"' : ''}>`; };
  const st = (s) => (s.status ? `<span class="st ${s.status === 'OK' ? 'st-OK' : 'st-below-MRT'}">${s.status}</span>` : '');
  const sm = new Map(sum.map((x) => [x.id, x]));
  const zs = readingElevations(job);
  const autoN = autoPlateCount(job);

  // readings grid: elevation rows bottom → top, grouped by course
  let grid = '';
  if (courses.length && zs.length) {
    let cur = null;
    const rows = [];
    for (const z of zs) {
      const c = courseAt(courses, z);
      if (c && c.id !== cur) {
        cur = c.id; const s = sm.get(c.id);
        rows.push(`<tr class="crow"><td colspan="${locs.length + 2}"><b>Course ${c.no}</b> <span class="muted small">${fmtElev(c.z0, job)} – ${fmtElev(c.z1, job)} · nominal ${fmt(c.tNom, 't', job)} · t-min ${fmt(c.tMin, 't', job)} · min reading <b>${s.min != null ? fmt(s.min, 't', job) : '—'}</b></span> ${st(s)}</td></tr>`);
      }
      const vals = locs.map((l) => getReading(job, l.key, z)).filter((v) => v !== null);
      const rmin = vals.length ? Math.min(...vals) : null;
      const extra = (sh.extraZ || []).some((e) => zKey(e) === zKey(z));
      rows.push(`<tr><td class="el">${fmtElev(z, job)}${extra ? ` <button aria-label="Remove this extra elevation" class="x" data-act="z-del" data-z="${zKey(z)}" title="Remove this extra elevation">✕</button>` : ''}</td>${locs.map((l) => { const v = getReading(job, l.key, z); const bad = v != null && c?.tMin > 0 && v < c.tMin - 1e-9; return `<td class="${bad ? 'bad-cell' : ''}"><input data-shut="${l.key}" data-z="${zKey(z)}" data-kind="t" ${bad ? 'aria-invalid="true" title="Below t-min" ' : ''}inputmode="decimal" value="${h(inVal(v, 't', job))}"></td>`; }).join('')}<td class="n">${rmin != null ? fmt(rmin, 't', job, false) : ''}</td></tr>`);
    }
    grid = rows.join('');
  }

  return `<div class="shell-grid">
    <section class="card"><div class="sp-head"><h2>Shell courses &amp; plates</h2><span class="muted small">${courses.length} course${courses.length === 1 ? '' : 's'} · ${fmt(H, 'big', job)} high</span></div>
      <div class="tblwrap"><table class="grid courses"><thead><tr><th>Course</th><th>Height (${U.big})</th><th>Nominal t (${U.small})</th><th>t-min (${U.small})</th><th title="Number of shell plates in the course">Plates</th><th title="Angle of the first vertical seam">1st seam (°)</th><th title="Optional: plate length; the last plate is the closure plate">Plate length (${U.big})</th><th class="n">Min. reading</th><th>Status</th><th></th></tr></thead><tbody>
      ${top.map((c, k) => { const s = sm.get(c.id); const cp = coursePlates(job, c, c.no - 1); return `<tr class="${s.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${c.no}</b>${c.no === 1 ? ' <span class="muted small">bottom</span>' : ''}</td><td>${cin(c, 'h', 'big')}</td><td>${cin(c, 'tNom', 't')}</td><td>${cin(c, 'tMin', 't')}</td><td>${cin(c, 'pn', 'num', String(c.plen ? cp.n : autoN), 'xs')}</td><td>${cin(c, 'seam0', 'num', (Math.round(cp.seam0 * 10) / 10).toString(), 'xs')}</td><td>${cin(c, 'plen', 'big', fmt(cp.plates[0]?.len, 'big', job, false))}</td><td class="n">${s.min != null ? fmt(s.min, 't', job, false) : '—'}<small class="muted"> ${s.count}</small></td><td>${st(s)}</td><td><button aria-label="Delete course" class="btn sm icon ghost danger" data-act="course-del" data-course="${c.id}" title="Delete course">✕</button></td></tr>`; }).join('') || `<tr><td colspan="10" class="empty">No courses yet. Add them from the bottom course up, or start with <button class="btn sm" data-act="courses-std" data-n="5">5 courses</button> <button class="btn sm" data-act="courses-std" data-n="6">6 courses</button> <button class="btn sm" data-act="courses-std" data-n="8">8 courses</button></td></tr>`}
      </tbody></table></div>
      <div class="acts"><button class="btn sm" data-act="course-add">+ Course on top</button></div>
      <p class="muted small">Course 1 is the bottom course. Plates: give the number of plates (equal lengths), or a plate length (full plates from the first seam, the last one is the closure plate). Blank first seam staggers alternate courses by half a plate. t-min is calculated to API 653 §4.3.3.1 a) (grey) once the product SG is entered — see the shell evaluation below; type a value to override it.</p></section>

    <div class="shell-side">
    <section class="card"><h2>UT stations</h2>
      <p class="small">${D > 0 ? `Circumference ${fmt(C, 'big', job)} ÷ ${fmt(SPACING_MM, 'big', job)} = ${(C / SPACING_MM).toFixed(1)} → standard <b>${auto}</b> stations (minimum 4, maximum 8, one per 32 ft of circumference), equally spaced.` : 'Enter the tank diameter in Tank setup.'}</p>
      <div class="fgrid">${field('Number of stations', 'shell.nLoc', 'num', { ph: `${auto} (standard)`, hint: 'Leave blank for the standard count' })}${field('First station at', 'shell.start', 'num', { unit: '°', ph: '0' })}</div>
      <div class="loc-list">${locs.map((l) => `<span class="loc-chip"><b>${l.label}</b> ${l.angle.toFixed(1)}° <small>${fmt(l.arc, 'big', job)}</small></span>`).join('')}</div></section>

    <section class="card"><div class="sp-head"><h2>Reading elevations</h2><span class="muted small">${zs.length} per station · ${zs.length * locs.length} readings</span></div>
      <p class="muted small">Readings are taken at each station at these elevations above the bottom. Each zone gives a reading every <i>step</i> from <i>start</i> to <i>end</i> (blank end = top of the shell). Values in ${U.small}.</p>
      <table class="grid zones"><thead><tr><th>From</th><th>To</th><th>Every</th><th class="n">Readings</th><th></th></tr></thead><tbody>
      ${(sh.zones || []).map((zn) => `<tr><td><input data-zf="start" data-zone="${zn.id}" data-kind="small" inputmode="decimal" value="${h(inVal(zn.start, 'small', job))}"></td><td><input data-zf="end" data-zone="${zn.id}" data-kind="small" inputmode="decimal" value="${h(inVal(zn.end, 'small', job))}" placeholder="top"></td><td><input data-zf="step" data-zone="${zn.id}" data-kind="small" inputmode="decimal" value="${h(inVal(zn.step, 'small', job))}"></td><td class="n">${zoneCount(job, zn)}<br><small class="muted">${fmtElev(+zn.start || 0, job)}${zn.end != null ? ' – ' + fmtElev(+zn.end, job) : ' – top'}</small></td><td><button aria-label="Remove zone" class="btn sm icon ghost danger" data-act="zone-del" data-zone="${zn.id}" title="Remove zone">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No zones.</td></tr>'}
      </tbody></table>
      <div class="acts"><button class="btn sm" data-act="zone-add">+ Zone</button><button class="btn sm" data-act="zones-std">Standard: every 1 in to 2 ft, then every 1 ft</button></div>
      <div class="acts extra-z"><label class="fld inline"><span class="lbl">Add one elevation</span><span class="ctl"><input id="extraZ" data-kind="small" inputmode="decimal" placeholder="${U.small}"><i class="unit">${U.small}</i></span></label><button class="btn sm" data-act="z-add">Add</button></div></section>
    </div>
  </div>

  ${courses.length ? `<section class="card"><div class="sp-head"><h2>UT readings</h2><span class="muted small">thickness in ${U.small} · Tab moves across, Enter moves up the station</span></div>
    <div class="tblwrap rd-wrap"><table class="grid readings"><thead><tr><th>Elevation</th>${locs.map((l) => `<th class="n">${l.label}<br><small>${l.angle.toFixed(1)}°</small></th>`).join('')}<th class="n">Row min</th></tr></thead><tbody>${grid || `<tr><td colspan="${locs.length + 2}" class="empty">Set up reading elevations to start.</td></tr>`}</tbody></table></div></section>` : ''}

  ${shellEvalHTML()}

  <section class="card"><div class="sp-head"><h2>Shell roll-out</h2><span class="muted small">plates, UT stations, dimensions and nozzles</span></div>
    <div class="ro-wrap" id="roWrap">${rolloutSVG(job)}</div></section>`;
}

/** API 653 4.3.3 shell evaluation card: material, joint efficiency, allowable stresses, t-min, fill and hydrotest heights. */
export function shellEvalHTML() {
  const job = S.job, U = u(job), met = job.units === 'metric', B = designBasis(job), sh = job.shell || {};
  const courses = coursesWithElev(job); if (!courses.length) return '';
  const sm = new Map(courseSummary(job).map((x) => [x.id, x]));
  const jo = jointOptions(job.tank.code, job.tank.edition), dj = defaultJoint(job);
  const ps = (psi) => (psi == null ? '—' : met ? (psi / PSI_MPA).toFixed(0) : Math.round(psi).toLocaleString());
  const su = met ? 'MPa' : 'psi';
  const matSel = (val, attrs, blank) => `<select ${attrs} data-kind="text">${blank ? `<option value="">${blank}</option>` : ''}${MATERIALS.map((m) => `<option ${val === m[0] ? 'selected' : ''}>${h(m[0])}</option>`).join('')}</select>`;
  const jSel = (val, attrs, blank) => `<select ${attrs} data-kind="text">${blank ? `<option value="">${blank}</option>` : ''}${jo.options.map(([k, l]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${h(l)}</option>`).join('')}</select>`;
  const sIn = (c, k, val) => `<input data-shs="${k}" data-course="${c.id}" inputmode="decimal" class="xs" value="${c[k] != null ? (met ? +(c[k] / PSI_MPA).toFixed(1) : c[k]) : ''}" placeholder="${ps(val)}">`;
  let prodMin = null, hydMin = null;
  const rows = courses.slice().reverse().map((c) => {
    const d = c.d, s = sm.get(c.id), f = s.min != null ? fillFromT(job, d, s.min) : { prod: null, hydro: null };
    if (f.prod != null && (prodMin === null || f.prod < prodMin.v)) prodMin = { v: f.prod, c: c.no };
    if (f.hydro != null && (hydMin === null || f.hydro < hydMin.v)) hydMin = { v: f.hydro, c: c.no };
    return `<tr class="${s.status === 'Below t-min' ? 'is-bad' : ''}"><td><b>${c.no}</b></td><td>${matSel(c.matl || '', `data-shc="matl" data-course="${c.id}"`, 'Same as all')}</td>
      <td>${jSel(c.joint || '', `data-shc="joint" data-course="${c.id}"`, 'Same as all')}</td><td class="n">${d.Ej}</td>
      <td>${sIn(c, 'Y', d.Y)}</td><td>${sIn(c, 'T', d.T)}</td><td class="n">${ps(d.Sd)}</td><td class="n">${ps(d.St)}</td>
      <td class="n">${fmt(Math.max(0, B.fill - c.z0), 'big', job, false)}</td><td class="n">${c.tMinCalc ? fmt(c.tMinCalc, 't', job, false) : '—'}</td><td class="n"><b>${c.tMin ? fmt(c.tMin, 't', job, false) : '—'}</b>${c.tMinSet ? '<sup title="Entered">E</sup>' : ''}</td>
      <td class="n">${s.min != null ? fmt(s.min, 't', job, false) : '—'}</td><td>${s.status ? `<span class="st ${s.status === 'OK' ? 'st-OK' : 'st-below-MRT'}">${s.status}</span>` : ''}</td>
      <td class="n">${f.prod != null ? fmt(f.prod, 'big', job, false) : '—'}</td><td class="n">${f.hydro != null ? fmt(f.hydro, 'big', job, false) : '—'}</td></tr>`;
  }).join('');
  return `<section class="card shell-eval"><div class="sp-head"><h2>Shell evaluation — API 653 4.3.3</h2><span class="muted small">${h(job.tank.code || 'Code not set')}${job.tank.edition ? ', ' + h(job.tank.edition) : ''} · G ${B.G ?? '—'} · fill ${fmt(B.fill, 'big', job)} · D ${fmt(B.D, 'big', job)}</span></div>
    ${!(B.G > 0) ? '<p class="callout warn">Enter the product specific gravity (and the maximum fill height if it is not the full shell height) in Tank setup → Construction &amp; design to calculate t-min.</p>' : ''}
    <div class="fgrid g4">
      <label class="fld"><span class="lbl">Shell material (all courses)</span><span class="ctl">${matSel(sh.matl || '', 'data-bind="shell.matl"', 'Unknown (30,000 / 55,000 psi)')}</span></label>
      <label class="fld span2"><span class="lbl">Joint (all courses) — ${h(jo.group)}</span><span class="ctl">${jSel(sh.joint || '', 'data-bind="shell.joint"', `Default: ${jointLabel(dj)}`)}</span></label>
      ${field('Product SG', 'tank.sg', 'num')}
    </div>
    <div class="tblwrap"><table class="grid seval"><thead><tr><th>Course</th><th>Material</th><th>Joint</th><th class="n">E</th><th>Y (${su})</th><th>T (${su})</th><th class="n">Sd (${su})</th><th class="n">St (${su})</th><th class="n">Liquid above course (${U.big})</th><th class="n">t-min calc</th><th class="n">t-min used</th><th class="n">Min. reading</th><th>Status</th><th class="n" title="Product fill height this course's minimum reading supports">Max fill (${U.big})</th><th class="n" title="API 653 4.3.3.2 hydrostatic test height from this course's minimum reading">Hydrotest Ht (${U.big})</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="small">${prodMin ? `Maximum product fill height from the minimum readings: <b>${fmt(prodMin.v, 'big', job)}</b> (course ${prodMin.c})` : ''}${hydMin ? ` · hydrostatic test height: <b>${fmt(hydMin.v, 'big', job)}</b> (course ${hydMin.c})` : ''}${prodMin && prodMin.v < B.fill - 1 ? ` · <b class="bad">below the maximum fill height ${fmt(B.fill, 'big', job)}</b>` : ''}</p>
    <p class="muted small">t-min = 2.6 (H − 1) D G / (S E), not less than 0.100 in (SI: 4.9 D (H − 0.3) G / (S E), not less than 2.5 mm) (API 653 §4.3.3.1 a). Single readings are compared with the t-min at their elevation (§4.3.3.1 b) and evaluated per §4.3.2 when below it. S = product design stress from Table 4.1 — lower two courses use the smaller of 0.80Y / 0.429T, upper courses 0.88Y / 0.472T; riveted 21,000 psi. E from Table 4.2 (welded, by code and edition) or Table 4.3 (riveted). Hydrotest Ht = St E t / (2.6 D) + 1 (4.3.3.2). Fill and test heights use each course's minimum reading and are measured from the tank bottom. Y / T: type to override the table. Stresses in ${su}.</p>
  </section>`;
}

/** Tank setup: shell courses as designed — height, thickness, plates per course and seam offset from the datum. */
export function shellBuildHTML() {
  const job = S.job, U = u(job), courses = coursesWithElev(job), H = shellHeight(job), Cc = Math.PI * (+job.tank?.diameter || 0), autoN = autoPlateCount(job);
  const inp = (c, k, kind, ph = '', cls = '') => `<input data-shc="${k}" data-course="${c.id}" data-kind="${kind}" inputmode="decimal" value="${h(kind === 'num' ? c[k] ?? '' : inVal(c[k], kind, job))}" placeholder="${h(ph)}" class="${cls}">`;
  const rows = courses.slice().reverse().map((c) => {
    const cp = coursePlates(job, c, c.no - 1), set = c.seam0 !== null && c.seam0 !== undefined && c.seam0 !== '';
    const arcV = set && Cc > 0 ? inVal((+c.seam0 / 360) * Cc, 'big', job) : '';
    const arcPh = Cc > 0 ? inVal((cp.seam0 / 360) * Cc, 'big', job) : '';
    const closure = cp.plates.find((p) => p.closure);
    return `<tr><td><b>${c.no}</b>${c.no === 1 ? ' <span class="muted small">bottom</span>' : ''}</td><td>${inp(c, 'h', 'big')}</td><td>${inp(c, 'tNom', 't')}</td>
      <td>${inp(c, 'pn', 'num', String(c.plen ? cp.n : autoN), 'xs')}</td>
      <td><input data-shc="seam0arc" data-course="${c.id}" data-kind="big" inputmode="decimal" value="${h(arcV)}" placeholder="${h(arcPh)}" ${Cc > 0 ? '' : 'disabled title="Enter the tank diameter first"'}></td>
      <td>${inp(c, 'seam0', 'num', (Math.round(cp.seam0 * 10) / 10).toString(), 'xs')}</td>
      <td>${inp(c, 'plen', 'big', cp.plates[0] ? inVal(cp.plates[0].len, 'big', job) : '')}</td>
      <td class="small muted">${cp.n ? `${cp.n} × ${fmt(cp.plates[0]?.len, 'big', job)}${closure ? `<br>closure ${fmt(closure.len, 'big', job)}` : ''}` : '—'}</td>
      <td><button aria-label="Delete course" class="btn sm icon ghost danger" data-act="course-del" data-course="${c.id}" title="Delete course">✕</button></td></tr>`;
  }).join('');
  return `<div class="sp-head"><h2>Shell</h2><span class="muted small">${courses.length} course${courses.length === 1 ? '' : 's'}${H > 0 ? ' · ' + fmt(H, 'big', job) + ' high' : ''}${Cc > 0 ? ' · circumference ' + fmt(Cc, 'big', job) : ''}</span></div>
    <p class="muted small">Build the shell from the bottom course up. For each course give the height, nominal thickness and the plates — either the <b>number of plates</b> (equal lengths) or a <b>plate length</b> (full plates from the first seam; the last is the closure plate). Locate the <b>first vertical seam</b> by its distance around the shell or its angle, clockwise from the 0° datum (${h(job.info.zeroRef || 'set the 0° reference label above')}). Blank = alternate courses staggered by half a plate. Grey values are what will be used.</p>
    <div class="tblwrap"><table class="grid courses build"><thead><tr><th>Course</th><th>Height (${U.big})</th><th>Nominal t (${U.small})</th><th>Plates</th><th title="Distance around the shell from the datum to the first vertical seam, clockwise">1st seam from datum (${U.big})</th><th>1st seam (°)</th><th>Plate length (${U.big})</th><th>Plates in course</th><th></th></tr></thead>
    <tbody>${rows || `<tr><td colspan="9" class="empty">No courses yet. Start with <button class="btn sm" data-act="courses-std" data-n="5">5 courses</button> <button class="btn sm" data-act="courses-std" data-n="6">6 courses</button> <button class="btn sm" data-act="courses-std" data-n="8">8 courses</button> or add them one at a time.</td></tr>`}</tbody></table></div>
    <div class="acts"><button class="btn sm" data-act="course-add">+ Course on top</button>${courses.length ? `<span class="spacer"></span><button class="btn sm ghost" data-act="courses-fill" title="Copy the bottom course's number of plates and plate length to empty courses above">Copy course 1 plates up</button>` : ''}</div>
    ${courses.length ? `<div class="sp-head sp-ro"><h3>Shell roll-out</h3><span class="muted small">viewed from outside, clockwise from the 0° datum · plates, seams and nozzles</span></div><div id="spRoll" class="ro-wrap">${rolloutSVG(job)}</div>
    <p class="muted small">Materials, joint efficiency and t-min are set on the Shell page.</p>` : ''}`;
}

export function refreshShell() {
  setTimeout(() => {
    const sb = $('#shellBuild'); if (sb) { rerenderKeep(sb, shellBuildHTML()); redraw.setupPreview(); }
    const c = $('#shellBody'); if (!c) return;
    const a = document.activeElement, key = a && c.contains(a) ? focusSel(a) : null, typed = a && a.value !== undefined && a.value !== a.defaultValue ? a.value : null;
    c.innerHTML = shellBodyHTML();
    if (key) { const n = c.querySelector(key); if (n && typed !== null && n.value !== typed) { n.value = typed; n.dataset.restored = '1'; } if (n) { n.focus(); try { if (typed === null) n.select(); else n.setSelectionRange(n.value.length, n.value.length); } catch { /* */ } } }
  }, 0);
}

defineView('shell', viewShell);

onAction({
  'course-add': async (el, id, e, act) => {
    {
      const sh = (S.job.shell = S.job.shell || defaultShell()); sh.courses = sh.courses || [];
      const last = sh.courses[sh.courses.length - 1];
      const c = { id: uid(), h: last?.h ?? (S.job.units === 'metric' ? 2400 : 2438.4), tNom: last?.tNom ?? null, tMin: last?.tMin ?? null };
      sh.courses.push(c); commit(); refreshShell(); return;
    }
  },
  'course-del': async (el, id, e, act) => {
    {
      const sh = S.job.shell; const c = sh?.courses?.find((x) => x.id === el.dataset.course); if (!c) return;
      if (!(await askConfirm('Delete this course? The courses above it move down, and readings stay at their elevations.', { ok: 'Delete', danger: true }))) return;
      sh.courses = sh.courses.filter((x) => x.id !== c.id); commit(); refreshShell(); return;
    }
  },
  'zone-add': async (el, id, e, act) => {
    {
      const sh = S.job.shell; sh.zones = sh.zones || [];
      const last = sh.zones[sh.zones.length - 1];
      const ft = S.job.units === 'metric' ? 300 : 304.8;
      sh.zones.push({ id: uid(), start: last && last.end != null ? +last.end + (+last.step || ft) : 0, end: null, step: last?.step ?? ft });
      commit(); refreshShell(); return;
    }
  },
  'zone-del': async (el, id, e, act) => {
    { const sh = S.job.shell; sh.zones = (sh.zones || []).filter((z) => z.id !== el.dataset.zone); commit(); refreshShell(); return; }
  },
  'zones-std': async (el, id, e, act) => {
    {
      if ((S.job.shell.zones || []).length && !(await askConfirm('Replace the reading zones with the standard pattern (every 1 in up to 2 ft, then every 1 ft to the top)? Readings already entered are kept.', { ok: 'Use standard' }))) return;
      S.job.shell.zones = defaultZones(S.job.units); commit(); refreshShell(); return;
    }
  },
  'z-add': async (el, id, e, act) => {
    {
      const inp = $('#extraZ'); const v = toMm(inp?.value, 'small', S.job);
      if (v === null || v < 0) { toast('Enter an elevation above the bottom.'); return; }
      const H = shellHeight(S.job); if (H > 0 && v > H) { toast('That is above the top of the shell.'); return; }
      const sh = S.job.shell; sh.extraZ = sh.extraZ || []; if (!sh.extraZ.some((e) => zKey(e) === zKey(v))) sh.extraZ.push(+zKey(v));
      commit(); refreshShell(); return;
    }
  },
  'z-del': async (el, id, e, act) => {
    {
      const sh = S.job.shell, zk = el.dataset.z;
      const has = Object.values(sh.rd || {}).some((m) => m?.[zk] != null);
      if (has && !(await askConfirm(`Remove the elevation ${fmtElev(+zk, S.job)} and its readings?`, { ok: 'Remove', danger: true }))) return;
      sh.extraZ = (sh.extraZ || []).filter((e) => zKey(e) !== zk); for (const m of Object.values(sh.rd || {})) if (m) delete m[zk];
      commit(); refreshShell(); return;
    }
  },
  'courses-std': async (el, id, e, act) => {
    {
      const sh = (S.job.shell = S.job.shell || defaultShell());
      const n = Math.max(1, Math.round(+el.dataset.n || 5)), ch = S.job.units === 'metric' ? 2400 : 2438.4;
      if ((sh.courses || []).length && !(await askConfirm('Replace the current courses?', { ok: 'Replace' }))) return;
      sh.courses = Array.from({ length: n }, () => ({ id: uid(), h: ch, tNom: null, tMin: null })); commit(); refreshShell(); return;
    }
  },
  'courses-fill': async (el, id, e, act) => {
    {
      const cs = S.job.shell?.courses || [], c1 = cs[0]; if (!c1) return;
      for (const c of cs.slice(1)) { for (const k of ['pn', 'plen']) if ((c[k] === null || c[k] === undefined || c[k] === '') && c1[k] != null) c[k] = c1[k]; }
      commit(); refreshShell(); toast('Course 1 plates copied to the courses above (where empty).'); return;
    }
  }
});

onChange([
  { order: 140, when: (el, act) => el.matches('[data-shs]'), run: async (el, e, act) => {
    {
    const c = S.job.shell?.courses?.find((x) => x.id === el.dataset.course); if (!c) return;
    const v = num(el.value), k = el.dataset.shs;
    if (v !== null && v <= 0) { toast('Enter a positive stress.'); return; }
    if (v === null) delete c[k]; else c[k] = S.job.units === 'metric' ? v * PSI_MPA : v;
    commit(); refreshShell(); return;
  }
  } },
  { order: 150, when: (el, act) => el.matches('[data-shc="matl"]') || el.matches('[data-shc="joint"]'), run: async (el, e, act) => {
    {
    const c = S.job.shell?.courses?.find((x) => x.id === el.dataset.course); if (!c) return;
    if (el.value) c[el.dataset.shc] = el.value; else delete c[el.dataset.shc];
    commit(); refreshShell(); return;
  }
  } },
  { order: 160, when: (el, act) => el.matches('[data-shc]'), run: async (el, e, act) => {
    {
    const c = S.job.shell?.courses?.find((x) => x.id === el.dataset.course); if (!c) return;
    let v = readInput(el); const k = el.dataset.shc;
    if (v !== null && v < 0 && k !== 'seam0') { toast('Values can’t be negative.'); return; }
    if (k === 'seam0arc') {
      const Cc = Math.PI * (+S.job.tank?.diameter || 0); if (!(Cc > 0)) return;
      if (v === null) delete c.seam0; else c.seam0 = Math.round(((((v / Cc) * 360) % 360 + 360) % 360) * 100) / 100;
      commit(); refreshShell(); return;
    }
    if (k === 'seam0' && v !== null) v = ((v % 360) + 360) % 360;
    if (k === 'pn' && v !== null) v = Math.max(1, Math.round(v));
    if (v === null) { if (k === 'h') return; delete c[k]; } else c[k] = v;
    commit(); refreshShell(); return;
  }
  } },
  { order: 170, when: (el, act) => el.matches('[data-shut]'), run: async (el, e, act) => {
    {
    const sh = S.job.shell; sh.rd = sh.rd || {};
    const m = (sh.rd[el.dataset.shut] = sh.rd[el.dataset.shut] || {});
    const v = readInput(el);
    if (v !== null && v < 0) { toast('Readings can’t be negative.'); return; }
    if (v === null) delete m[el.dataset.z]; else m[el.dataset.z] = v;
    commit(); refreshShell(); return;
  }
  } },
  { order: 180, when: (el, act) => el.matches('[data-zf]'), run: async (el, e, act) => {
    {
    const zn = S.job.shell?.zones?.find((x) => x.id === el.dataset.zone); if (!zn) return;
    const v = readInput(el), k = el.dataset.zf;
    if (v !== null && v < 0) { toast('Values can’t be negative.'); return; }
    if (k === 'step' && v !== null && v <= 0) { toast('The step must be more than zero.'); return; }
    zn[k] = v;
    const n = readingElevations(S.job).length;
    if (n > 1500) toast(`That gives ${n} elevations per station — check the step.`);
    commit(); refreshShell(); return;
  }
  } }
]);

/* Enter moves to the next reading at the same station. */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('input[data-shut]')) {
    e.preventDefault();
    const inputs = $$(`#shellBody input[data-shut="${CSS.escape(e.target.dataset.shut)}"]`);
    const i = inputs.indexOf(e.target), next = inputs[e.shiftKey ? i - 1 : i + 1];
    const cur = e.target;
    if (next) { next.focus(); next.select(); } // leaving the field fires its change event
    else if (cur.value !== cur.defaultValue) cur.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
});
