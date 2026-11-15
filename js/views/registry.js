// Tank registry: the tanks themselves (static data that carries from one inspection to the next) and
// their inspections (refactoring step 8).
import { S, todayISO } from '../app/state.js';
import { defineView, go, renderView } from '../app/nav.js';
import { onAction } from '../app/actions.js';
import { host } from '../app/host.js';
import { dashInit } from '../app/folder.js';
import { jobCard } from '../cards.js';
import { db } from '../db.js';
import { migrate, STAGE_LABEL, uid } from '../model.js';
import { diffFromTank, editJobFor, jobFromTank, newTank, normKey, SCOPE, SCOPE_HINT, scopeText, tankFromJob, tankKeyOf } from '../registry.js';
import { hasFixed, hasFloating, ROOF_TYPES } from '../roof.js';
import { $, askConfirm, toast } from '../ui.js';
import { fmt } from '../units.js';
import { esc as h } from '../util.js';
// Tanks entered once; each inspection starts from a copy of the tank's data.

/** All inspections of a tank: jobs on this device plus job files in the linked folder. */
function tankInspections(tid) {
  const rows = new Map();
  for (const j of S.jobs) if (j.tankRef === tid) rows.set(j.id, { ...jobCard(S.job?.id === j.id ? S.job : j), where: 'device' });
  for (const [id, f] of S.dash.files) if (f.card.tankRef === tid && !rows.has(id)) rows.set(id, { ...f.card, where: 'folder' });
  return [...rows.values()].sort((a, b) => (b.inspDate || b.planned || '').localeCompare(a.inspDate || a.planned || ''));
}
/** Jobs with a tank ID that are not yet linked to the registry. */
const unlinkedJobs = () => S.jobs.filter((j) => !j.tankRef && (j.info?.tankId || '').trim() && !S.tanks.some((t) => t.id === j.tankRef));

function viewReg() {
  const R = S.reg, q = R.q.trim().toLowerCase(), today = todayISO();
  const fmtD = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const list = S.tanks.filter((t) => !q || [t.info?.client, t.info?.site, t.info?.tankId, t.info?.location].join(' ').toLowerCase().includes(q));
  const groups = new Map();
  for (const t of list) {
    const c = t.info?.client || 'No client', st = t.info?.site || 'No site';
    if (!groups.has(c)) groups.set(c, new Map());
    const g = groups.get(c); if (!g.has(st)) g.set(st, []); g.get(st).push(t);
  }
  const roofTxt = (t) => (ROOF_TYPES.find(([k]) => k === t.roof?.type) || [])[1] || '';
  const card = (t) => {
    const ins = tankInspections(t.id), last = ins[0], open = R.open.has(t.id), T = t.tank || {};
    const facts = [t.tank?.diameter ? `Ø ${fmt(T.diameter, 'big', t)}` : 'Diameter not set', T.bottomType, t.layout?.annular ? 'annular ring' : '', t.roof?.type && t.roof.type !== 'none' ? roofTxt(t) : '', (t.shell?.courses || []).length ? `${t.shell.courses.length} courses` : '', (t.nozzles || []).length ? `${t.nozzles.length} nozzles` : '', T.yearBuilt ? `built ${T.yearBuilt}` : ''].filter(Boolean).join(' · ');
    const insRows = ins.map((r) => `<tr><td>${r.inspDate ? fmtD(r.inspDate) : r.planned ? 'Planned ' + fmtD(r.planned) : '—'}</td><td>${h(r.reportNo)}</td><td class="small">${h(r.scope ? scopeText(r.scope) : 'Full')}</td><td><span class="stg st-${r.stage}">${h(STAGE_LABEL[r.stage] || '')}</span>${r.due && r.due < today && r.stage !== 'complete' ? ' <small class="bad">overdue</small>' : ''}</td><td class="small">${h(r.condition)}</td><td class="n">${r.open || '—'}</td><td class="small muted">${r.where === 'folder' ? 'Folder' : 'Device'}</td><td><button class="btn sm" data-act="dash-open" data-id="${r.id}">Open</button></td></tr>`).join('');
    return `<div class="tank-card">
      <div class="tk-head"><div><b class="tk-id">${h(t.info?.tankId || 'Unnamed tank')}</b>${t.info?.location ? ` <span class="muted small">${h(t.info.location)}</span>` : ''}<div class="muted small">${h(facts)}</div></div>
        <div class="acts"><button class="btn sm primary" data-act="reg-insp" data-id="${t.id}">New inspection</button><button class="btn sm" data-act="reg-edit" data-id="${t.id}">Edit tank data</button>
        <details class="menu"><summary class="btn sm ghost icon" title="More">⋯</summary><div class="menu-pop right"><button data-act="reg-dup" data-id="${t.id}">Duplicate tank (same design)</button><button data-act="reg-del" data-id="${t.id}" class="danger-txt">Delete from registry</button></div></details></div></div>
      <button class="tk-ins-toggle" data-act="reg-toggle" data-id="${t.id}">${open ? '▾' : '▸'} ${ins.length ? `${ins.length} inspection${ins.length > 1 ? 's' : ''} · last ${last.inspDate ? fmtD(last.inspDate) : last.planned ? 'planned ' + fmtD(last.planned) : 'not dated'} · <span class="stg st-${last.stage}">${h(STAGE_LABEL[last.stage] || '')}</span>` : 'No inspections yet'}</button>
      ${open && ins.length ? `<div class="tblwrap"><table class="grid small"><thead><tr><th>Date</th><th>Report</th><th>Scope</th><th>Stage</th><th>Condition</th><th class="n">Open def.</th><th>Where</th><th></th></tr></thead><tbody>${insRows}</tbody></table></div>` : ''}
    </div>`;
  };
  const body = [...groups].map(([c, sites]) => `<section class="reg-client"><h2>${h(c)}</h2>${[...sites].map(([st, ts]) => `<div class="reg-site"><h3>${h(st)} <em>${ts.length}</em></h3>${ts.map(card).join('')}</div>`).join('')}</section>`).join('');
  const un = unlinkedJobs();
  return `<div class="page wide reg"><div class="page-head"><div><h1>Tank registry</h1><p class="muted">Each tank's static data — identity, construction, floor layout, nozzles, shell courses, roof and settlement set-up — entered once. <b>New inspection</b> copies it into a new job with the scope you choose; the job keeps its own copy, so reports always show the tank as inspected.</p></div>
      <div class="acts"><button class="btn primary" data-act="reg-new">Add tank</button></div></div>
    ${un.length ? `<div class="callout info reg-mig"><span><b>${un.length} job${un.length > 1 ? 's' : ''}</b> on this device ${un.length > 1 ? 'are' : 'is'} not in the registry yet. Build tank records from them — jobs for the same client, site and tank ID are grouped under one tank, using the most recent job's data.</span><button class="btn sm primary" data-act="reg-build">Build registry from jobs</button></div>` : ''}
    <div class="dash-tools"><input type="search" id="regQ" placeholder="Search client, site, tank…" value="${h(R.q)}"><span class="muted small">${S.tanks.length} tank${S.tanks.length === 1 ? '' : 's'}</span></div>
    ${body || `<div class="card empty">${S.tanks.length ? 'No tanks match the search.' : 'No tanks in the registry yet. <b>Add tank</b> to enter one, or build the registry from your existing jobs.'}</div>`}
  </div>`;
}
document.addEventListener('input', (e) => { if (e.target.id === 'regQ') { S.reg.q = e.target.value; clearTimeout(S.reg.qt); S.reg.qt = setTimeout(() => { const pos = e.target.selectionStart; renderView(); const n = $('#regQ'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } } }, 200); } });
const afterReg = async () => { const before = S.dash.scanned; await dashInit(); if (!before && S.dash.scanned && S.view === 'reg') renderView(); };

async function openTankEdit(tid, view = 'setup') {
  if (S.job && !(await host.leaveJobOk())) return;
  const t = await db.getTank(tid); if (!t) return toast('Tank not found');
  S.job = editJobFor(t); S.job.info.location = t.info?.location || ''; S.job.info.tankNotes = t.info?.notes || '';
  S.photos = []; S.fileName = null; S.sel = S.selPlate = S.selFeature = null; S.mode = 'select'; S.vb = null;
  host.recompute(); go(view);
}

async function addTank(fromJob = null) {
  const t = fromJob ? tankFromJob(fromJob) : newTank(S.jobs[0]?.units || 'imperial');
  await db.putTank(t); await host.loadTanks();
  return t;
}

/** Link every unlinked job to a tank record (one per client + site + tank ID). */
async function buildRegistry() {
  const un = unlinkedJobs(); if (!un.length) return;
  const byKey = new Map();
  for (const j of un) { const k = normKey(j.info.client, j.info.site, j.info.tankId); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k).push(j); }
  let made = 0, linked = 0;
  for (const [k, js] of byKey) {
    let t = S.tanks.find((x) => tankKeyOf(x) === k);
    if (!t) {
      const latest = js.slice().sort((a, b) => (b.info.inspDate || '').localeCompare(a.info.inspDate || '') || (b.updated || 0) - (a.updated || 0))[0];
      t = tankFromJob(migrate(await db.getJob(latest.id))); await db.putTank(t); S.tanks.push(t); made++;
    }
    for (const j of js) { const full = await db.getJob(j.id); full.tankRef = t.id; await db.putJob(full); if (S.job?.id === j.id) S.job.tankRef = t.id; linked++; }
  }
  await host.loadJobs(); await host.loadTanks(); renderView();
  toast(`${made} tank${made === 1 ? '' : 's'} added, ${linked} job${linked === 1 ? '' : 's'} linked.`);
}

/** Dialog: start an inspection of a registry tank. */
async function newInspectionDlg(tid) {
  const t = await db.getTank(tid); if (!t) return;
  const ins = tankInspections(tid).filter((r) => r.where === 'device');
  const lastCard = ins.find((r) => r.inspDate) || ins[0];
  const last = lastCard ? migrate(await db.getJob(lastCard.id)) : null;
  const sug = new Set(last?.scope || ['floor', 'nozzles', 'found', ...(t.shell?.courses?.length ? ['shell'] : []), ...(hasFixed(t) ? ['froof'] : []), ...(hasFloating(t) ? ['flroof'] : [])]);
  const lastTxt = last ? `${last.info.inspDate || 'undated'}${last.info.reportNo ? ', ' + last.info.reportNo : ''}` : '';
  const dlg = $('#dlg');
  $('#dlgBody').innerHTML = `<form class="ni-dlg" method="dialog">
    <div class="ed-head"><h2>New inspection — ${h(t.info?.tankId || 'tank')}</h2><button aria-label="Close" type="button" class="btn sm ghost" data-ni="close">✕</button></div>
    <p class="muted small">${h([t.info?.client, t.info?.site].filter(Boolean).join(' · '))}</p>
    <h3>Scope</h3><div class="ni-scope">${SCOPE.map(([k, l]) => `<label class="chk"><input type="checkbox" name="scope" value="${k}" ${sug.has(k) ? 'checked' : ''}><span><b>${l}</b><small class="muted"> ${SCOPE_HINT[k] || ''}</small></span></label>`).join('')}</div>
    <h3>Floor layout</h3><div class="ni-floor">
      <label class="chk"><input type="radio" name="floor" value="last" ${last ? 'checked' : 'disabled'}><span><b>As found at the last inspection</b><small class="muted"> ${last ? `${h(lastTxt)} — includes plate corrections and patches recorded then` : 'no earlier inspection on this device'}</small></span></label>
      <label class="chk"><input type="radio" name="floor" value="registry" ${last ? '' : 'checked'}><span><b>Registry layout</b><small class="muted"> the floor as stored for this tank</small></span></label>
      <label class="chk"><input type="radio" name="floor" value="new"><span><b>New floor — start a blank layout</b><small class="muted"> the floor has been replaced; keeps the tank, shell and nozzles</small></span></label>
    </div>
    <h3>Job</h3><div class="fgrid">
      <label class="fld"><span class="lbl">Planned inspection date</span><span class="ctl"><input type="date" name="planned"></span></label>
      <label class="fld"><span class="lbl">Report due</span><span class="ctl"><input type="date" name="due"></span></label>
      <label class="fld"><span class="lbl">Report no.</span><span class="ctl"><input name="reportNo" autocomplete="off"></span></label>
      <label class="fld"><span class="lbl">Work order</span><span class="ctl"><input name="workOrder" autocomplete="off"></span></label>
      <label class="fld"><span class="lbl">API 653 inspector</span><span class="ctl"><input name="inspector" value="${h(last?.info?.inspector || '')}" autocomplete="off"></span></label>
      <label class="fld"><span class="lbl">Product</span><span class="ctl"><input name="product" value="${h(last?.info?.product || '')}" autocomplete="off"></span></label>
    </div>
    ${last ? `<label class="chk"><input type="checkbox" name="equip" checked><span>Copy MFL / UT equipment from the last inspection (check serials and calibration dates)</span></label>` : ''}
    <p class="ni-err bad small" hidden></p>
    <div class="acts end"><button type="button" class="btn" data-ni="close">Cancel</button><button type="button" class="btn primary" data-ni="go">Create inspection</button></div>
  </form>`;
  const form = $('.ni-dlg', dlg);
  form.onclick = async (e) => {
    const b = e.target.closest('[data-ni]'); if (!b) return;
    if (b.dataset.ni === 'close') { dlg.close(); return; }
    const fd = new FormData(form), scope = fd.getAll('scope');
    if (!scope.length) { const er = $('.ni-err', form); er.textContent = 'Pick at least one item for the scope.'; er.hidden = false; return; }
    const j = jobFromTank(t, { scope, floorSrc: fd.get('floor') || 'registry', last, copyEquip: fd.get('equip') === 'on', info: { reportNo: fd.get('reportNo') || '', workOrder: fd.get('workOrder') || '', inspector: fd.get('inspector') || '', product: fd.get('product') || '' } });
    j.status.planned = fd.get('planned') || ''; j.status.due = fd.get('due') || '';
    if (j.status.planned) j.info.inspDate = j.status.planned;
    dlg.close();
    await host.createJob(j);
    toast(`Inspection created for ${t.info?.tankId || 'the tank'} — ${scopeText(scope)}`);
  };
  dlg.showModal();
}

/** Push a job's static data (layout, nozzles, courses…) back to its registry tank. */
async function updateRegistryFromJob() {
  const j = S.job; if (!j?.tankRef) return;
  const prev = await db.getTank(j.tankRef);
  if (!prev) { if (!(await askConfirm('The registry tank for this job is not on this device. Add this tank to the registry from this job?', { ok: 'Add to registry' }))) return; }
  const diff = prev ? diffFromTank(j, prev) : [];
  if (prev && !diff.length) { toast('The registry already matches this inspection.'); return; }
  if (prev && !(await askConfirm(`Update the registry record for ${prev.info?.tankId || 'this tank'} with this inspection's data?\n\nChanges: ${diff.join(', ')}.\n\nEarlier inspections keep their own copies.`, { ok: 'Update registry' }))) return;
  const t = tankFromJob(j, prev || { id: j.tankRef }); await db.putTank(t); await host.loadTanks(); renderView(); toast('Registry updated.');
}

defineView('reg', viewReg, afterReg);

onAction({
  'reg-new': async (el, id, e, act) => {
    { const t = await addTank(); return openTankEdit(t.id); }
  },
  'reg-edit': async (el, id, e, act) => {
    return openTankEdit(id);
  },
  'reg-done': async (el, id, e, act) => {
    { if (!(await host.leaveJobOk())) return; S.job = null; S.photos = []; host.recompute(); go('reg'); return; }
  },
  'reg-insp': async (el, id, e, act) => {
    return newInspectionDlg(id);
  },
  'reg-toggle': async (el, id, e, act) => {
    { S.reg.open.has(id) ? S.reg.open.delete(id) : S.reg.open.add(id); renderView(); return; }
  },
  'reg-build': async (el, id, e, act) => {
    return buildRegistry();
  },
  'reg-dup': async (el, id, e, act) => {
    {
      const t = await db.getTank(id); if (!t) return;
      const c = { ...JSON.parse(JSON.stringify(t)), id: uid(), created: Date.now(), updated: Date.now() };
      c.info.tankId = (c.info.tankId || 'Tank') + ' (copy)'; await db.putTank(c); await host.loadTanks(); return openTankEdit(c.id);
    }
  },
  'reg-del': async (el, id, e, act) => {
    {
      const t = S.tanks.find((x) => x.id === id), n = tankInspections(id).length;
      if (!(await askConfirm(`Delete ${t?.info?.tankId || 'this tank'} from the registry?${n ? `\n\nIts ${n} inspection${n > 1 ? 's' : ''} are kept; they just won't be linked to a registry tank.` : ''}`, { ok: 'Delete tank', danger: true }))) return;
      await db.deleteTank(id); await host.loadTanks(); renderView(); return;
    }
  },
  'reg-from-job': async (el, id, e, act) => {
    {
      if (!S.job) return;
      const dupe = S.tanks.find((x) => tankKeyOf(x) === normKey(S.job.info.client, S.job.info.site, S.job.info.tankId));
      if (dupe && await askConfirm(`${dupe.info.tankId} at ${dupe.info.site || 'this site'} is already in the registry. Link this job to it?`, { ok: 'Link to it', cancel: 'Add as a new tank' })) { S.job.tankRef = dupe.id; host.commit(); renderView(); toast('Linked to the registry tank.'); return; }
      const t = await addTank(S.job); S.job.tankRef = t.id; host.commit(); renderView(); toast('Tank added to the registry.'); return;
    }
  },
  'reg-update': async (el, id, e, act) => {
    return updateRegistryFromJob();
  }
});
