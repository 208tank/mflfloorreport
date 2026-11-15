// Nozzles screen and the nozzle table and side-panel editor shared with tank setup and the floor map
// (refactoring step 5).
import { nextMark, NZ_TYPES, nzPrefix, S } from '../app/state.js';
import { readInput } from '../app/fields.js';
import { defineView, go } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { host } from '../app/host.js';
import { nozzleUT, nozzleWall, NZ_CONN, NZ_CONN_SHORT, UT_CLOCK } from '../calc.js';
import { uid } from '../model.js';
import { $, askConfirm, toast } from '../ui.js';
import { fmt, inVal, u } from '../units.js';
import { esc as h } from '../util.js';

function viewNozzles() {
  return `<div class="page wide"><div class="page-head"><div><h1>Nozzles</h1><p class="muted">Shell nozzles, connections and neck UT readings. Nozzles also show on the floor map and the shell roll-out.</p></div>
    <div class="acts"><button class="btn" data-act="utl-down">UT loader ↓</button><button class="btn" data-act="utl-up">UT loader ↑</button></div></div>
    <section class="card" id="nozzleCard">${nozzleTableHTML()}</section></div>`;
}


function refreshNozzleUT(nz) {
  const b = $(`[data-ed="nozzle"][data-id="${nz.id}"] [data-part="nzut"]`); if (b) b.innerHTML = nozzleUTBox(nz);
  const r = nozzleUT(nz, S.job);
  const m = $(`[data-part="min-${nz.id}"]`); if (m) m.textContent = r.count ? fmt(r.min, 't', S.job, false) : '—';
  const st = $(`[data-part="st-${nz.id}"]`); if (st) { st.innerHTML = `<span class="st ${r.status === 'OK' ? 'st-OK' : r.status ? 'st-below-MRT' : ''}">${r.status || ''}</span>`; st.closest('tr')?.classList.toggle('is-bad', r.status === 'Below t-min'); }
}

export function nozzleUTBox(nz) {
  const r = nozzleUT(nz, S.job);
  if (!r.count) return '<span class="muted small">No UT readings yet.</span>';
  return `<div class="sum-grid three"><div><span>Min. reading</span><b>${fmt(r.min, 't', S.job)}</b><small>${r.count} reading${r.count > 1 ? 's' : ''}</small></div>
    <div><span>Wall loss</span><b>${r.lossPct != null ? r.lossPct.toFixed(0) + '%' : '—'}</b><small>${(() => { const w = nozzleWall(nz, S.job); return w.tNom ? 'vs ' + fmt(w.tNom, 't', S.job) + (w.nomTbl ? ' (table)' : '') : 'enter nominal'; })()}</small></div>
    <div><span>Status</span><b class="${r.status === 'OK' ? 'ok' : r.status ? 'bad' : ''}">${r.status || '—'}</b><small>${(() => { const w = nozzleWall(nz, S.job); return w.tMin ? 't-min ' + fmt(w.tMin, 't', S.job) + (w.minTbl ? ' (table)' : '') : 'enter t-min'; })()}</small></div></div>`;
}

export function nozzleTableHTML(design = false) {
  const list = (S.job.nozzles || []);
  const U = u(S.job), Cc = Math.PI * (+S.job.tank?.diameter || 0);
  const arcIn = (n) => `<input data-nb="arc" data-id="${n.id}" data-kind="big" inputmode="decimal" class="num" value="${h(Cc > 0 && Number.isFinite(+n.angle) && n.angle !== null && n.angle !== '' ? inVal((+n.angle / 360) * Cc, 'big', S.job) : '')}" ${Cc > 0 ? '' : 'disabled title="Enter the tank diameter first"'}>`;
  const inp = (n, k, kind, extra = '') => kind === 'sel'
    ? `<select data-nb="${k}" data-id="${n.id}" data-kind="text">${NZ_TYPES.map((t) => `<option ${n[k] === t ? 'selected' : ''}>${t}</option>`).join('')}</select>`
    : kind === 'conn'
      ? `<select data-nb="${k}" data-id="${n.id}" data-kind="text">${NZ_CONN.map(([v, l]) => `<option value="${v}" ${(n[k] || '') === v ? 'selected' : ''}>${v ? NZ_CONN_SHORT[v] : '—'}</option>`).join('')}</select>`
      : `<input data-nb="${k}" data-id="${n.id}" data-kind="${kind}" ${kind !== 'text' ? 'inputmode="decimal" class="num"' : ''} value="${h(kind === 'small' || kind === 't' ? inVal(n[k], kind, S.job) : n[k] ?? '')}" ${(k === 'tNom' || k === 'tMin') && !(n[k] > 0) ? (() => { const w = nozzleWall(n, S.job); const v = k === 'tNom' ? w.tNom : w.tMin; return v ? `placeholder="${inVal(v, 't', S.job)}" title="From the nozzle table: ${h(w.src)}"` : ''; })() : ''} ${extra}>`;
  if (design) return `<div class="sp-head"><h2>Nozzles</h2><span class="muted small">${list.length} on the shell</span></div>
    <p class="muted small">Position each nozzle by <b>angle</b> or by <b>distance around the shell</b>, both clockwise from the 0° datum (${h(S.job.info.zeroRef || 'set the 0° reference label above')}) — enter either one and the other follows. Elevation is to the nozzle centreline above the bottom. Nozzles are drawn on the floor drawing and the shell roll-out; neck UT readings are entered on the Nozzles page during an inspection.</p>
    <div class="tblwrap"><table class="grid nozzles"><thead><tr><th>Mark</th><th>Type</th><th>Connection</th><th>Angle (°)</th><th title="Distance around the shell, clockwise from the datum">From datum (${U.big})</th><th>Size (${U.small})</th><th>Elev. (${U.small})</th><th>Schedule</th><th>Nom. wall</th><th>t-min</th><th>Service / description</th><th></th></tr></thead><tbody>
    ${list.slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0)).map((n) => `<tr><td>${inp(n, 'mark', 'text', 'class="mk"')}</td><td>${inp(n, 'type', 'sel')}</td><td>${inp(n, 'conn', 'conn')}</td><td>${inp(n, 'angle', 'num')}</td><td>${arcIn(n)}</td><td>${inp(n, 'size', 'small')}</td><td>${inp(n, 'elev', 'small')}</td><td>${inp(n, 'sched', 'text', 'class="sch"')}</td><td>${inp(n, 'tNom', 't')}</td><td>${inp(n, 'tMin', 't')}</td><td>${inp(n, 'service', 'text')}</td><td><button aria-label="Delete" class="btn sm icon ghost danger" data-act="nozzle-del" data-id="${n.id}" title="Delete">✕</button></td></tr>`).join('') || '<tr><td colspan="12" class="empty">No nozzles yet. Add them here, or place them by clicking around the shell on the floor drawing.</td></tr>'}
    </tbody></table></div>
    <div class="acts"><button class="btn sm" data-act="nozzle-add">+ Nozzle</button><button class="btn sm" data-act="nozzle-place">Place on the floor drawing…</button></div>`;
  return `<div class="sp-head"><h2>Shell nozzles</h2><span class="muted small">${list.length} on the shell</span></div>
    <p class="muted small">Angle is clockwise from 0° (${h(S.job.info.zeroRef || 'the 0° reference')}). Neck UT readings at 12, 3, 6 and 9 o’clock; add more readings by clicking the nozzle on the Floor map. Thickness in ${U.small}.</p>
    <div class="tblwrap"><table class="grid nozzles"><thead><tr><th>Mark</th><th>Type</th><th>Connection</th><th>Angle (°)</th><th>Size (${U.small})</th><th>Elev. (${U.small})</th><th>Schedule</th><th>Nom. wall</th><th>t-min</th>${UT_CLOCK.map(([, l]) => `<th>${l}:00</th>`).join('')}<th>Min</th><th>Status</th><th>Service / description</th><th></th></tr></thead><tbody>
    ${list.slice().sort((a, b) => (+a.angle || 0) - (+b.angle || 0)).map((n) => { const r = nozzleUT(n, S.job); return `<tr class="${r.status === 'Below t-min' ? 'is-bad' : ''}"><td>${inp(n, 'mark', 'text', 'class="mk"')}</td><td>${inp(n, 'type', 'sel')}</td><td>${inp(n, 'conn', 'conn')}</td><td>${inp(n, 'angle', 'num')}</td><td>${inp(n, 'size', 'small')}</td><td>${inp(n, 'elev', 'small')}</td><td>${inp(n, 'sched', 'text', 'class="sch"')}</td><td>${inp(n, 'tNom', 't')}</td><td>${inp(n, 'tMin', 't')}</td>${UT_CLOCK.map(([k]) => `<td>${inp(n, k, 't')}</td>`).join('')}<td class="n" data-part="min-${n.id}">${r.count ? fmt(r.min, 't', S.job, false) + ((n.utx || []).length ? `<sup title="Includes ${(n.utx || []).length} extra reading(s)">+${(n.utx || []).length}</sup>` : '') : '—'}</td><td data-part="st-${n.id}"><span class="st ${r.status === 'OK' ? 'st-OK' : r.status ? 'st-below-MRT' : ''}">${r.status || ''}</span></td><td>${inp(n, 'service', 'text')}</td><td><button aria-label="Delete" class="btn sm icon ghost danger" data-act="nozzle-del" data-id="${n.id}" title="Delete">✕</button></td></tr>`; }).join('') || '<tr><td colspan="17" class="empty">No nozzles yet.</td></tr>'}
    </tbody></table></div>
    <div class="acts"><button class="btn sm" data-act="nozzle-add">+ Nozzle</button><button class="btn sm" data-act="exp-noz">Export CSV</button></div>`;
}

defineView('nozzles', viewNozzles);

onAction({
  'utx-add': async (el, id, e, act) => {
    {
      const nz = (S.job.nozzles || []).find((x) => x.id === id); if (!nz) return;
      nz.utx = nz.utx || []; const r = { id: uid(), loc: '', t: null }; nz.utx.push(r); host.commit(); host.renderSide();
      setTimeout(() => $(`#side [data-nbx="loc"][data-rid="${r.id}"]`)?.focus(), 30); return;
    }
  },
  'utx-del': async (el, id, e, act) => {
    {
      const nz = (S.job.nozzles || []).find((x) => x.id === id); if (!nz) return;
      nz.utx = (nz.utx || []).filter((x) => x.id !== el.dataset.rid); host.commit(); host.renderSide(); host.drawMap(); return;
    }
  },
  'nozzle-add': async (el, id, e, act) => {
    {
      const nz = { id: uid(), mark: nextMark('Nozzle'), type: 'Nozzle', angle: null, size: null, elev: null, service: '' };
      S.job.nozzles = S.job.nozzles || []; S.job.nozzles.push(nz); host.commit();
      const c = $('#nozzleCard'); if (c) c.innerHTML = nozzleTableHTML(c.dataset.design === '1');
      setTimeout(() => $(`#nozzleCard input[data-nb="angle"][data-id="${nz.id}"]`)?.focus(), 30); return;
    }
  },
  'nozzle-del': async (el, id, e, act) => {
    {
      const nz = (S.job.nozzles || []).find((x) => x.id === id); if (!nz) return;
      if (!(await askConfirm(`Delete nozzle ${nz.mark || ''}?`, { ok: 'Delete', danger: true }))) return;
      S.job.nozzles = S.job.nozzles.filter((x) => x.id !== id); if (S.selNozzle === id) S.selNozzle = null; host.commit();
      if (S.view === 'map') { host.drawMap(); host.renderSide(); }
      const c = $('#nozzleCard'); if (c) { c.innerHTML = nozzleTableHTML(c.dataset.design === '1'); if (S.view === 'setup') host.refreshSetupPreview(); }
      return;
    }
  },
  'nozzle-place': async (el, id, e, act) => {
    {
      if (!(S.job.tank?.diameter > 0)) { toast('Enter the tank diameter first.'); return; }
      go('map'); host.setMode('nozzle'); toast('Click around the shell to place each nozzle (Shift-click to keep placing). Set its details in the panel.'); return;
    }
  }
});

onChange([
  { order: 190, when: (el, act) => el.matches('[data-nb]'), run: async (el, e, act) => {
    {
    const nz = (S.job.nozzles || []).find((x) => x.id === el.dataset.id); if (!nz) return;
    let k = el.dataset.nb; let v = readInput(el);
    if (k === 'arc') {
      const Cc = Math.PI * (+S.job.tank?.diameter || 0); if (!(Cc > 0)) return;
      k = 'angle'; v = v === null ? null : Math.round(((((v / Cc) * 360) % 360 + 360) % 360) * 100) / 100;
    }
    if (k === 'angle' && v !== null) v = ((v % 360) + 360) % 360;
    if (k === 'type' && (!nz.mark || /^(N|MH|CO)\d+$/.test(nz.mark)) && nzPrefix(v) !== nzPrefix(nz.type)) nz.mark = nextMark(v);
    if (v === null || v === '') delete nz[k]; else nz[k] = v;
    host.commit();
    refreshNozzleUT(nz);
    if (S.view === 'map') { host.drawMap(); if (k === 'mark' || k === 'type') host.renderSide(); }
    if (S.view === 'setup' || S.view === 'nozzles') { const c = $('#nozzleCard'); if (c && (k === 'angle' || k === 'type' || k === 'mark' || el.dataset.nb === 'arc')) setTimeout(() => { c.innerHTML = nozzleTableHTML(c.dataset.design === '1'); }, 0); if (S.view === 'setup') host.refreshSetupPreview(); }
    return;
  }
  } },
  { order: 200, when: (el, act) => el.matches('[data-nbx]'), run: async (el, e, act) => {
    {
    const nz = (S.job.nozzles || []).find((x) => x.id === el.dataset.id); const r = nz?.utx?.find((x) => x.id === el.dataset.rid); if (!r) return;
    const v = readInput(el); if (v === null || v === '') delete r[el.dataset.nbx]; else r[el.dataset.nbx] = v;
    host.commit(); refreshNozzleUT(nz); if (S.view === 'map') host.drawMap(); return;
  }
  } }
]);
