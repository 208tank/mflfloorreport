// Dashboard: every tank on this device and in the linked folder, by stage, as a board or a list
// (refactoring step 7).
import { S, todayISO } from '../app/state.js';
import { defineView, renderView } from '../app/nav.js';
import { onAction, onChange } from '../app/actions.js';
import { loadJobs } from '../app/persist.js';
import { renderHeader } from '../app/header.js';
import { canDir, dashInit, linkFolder, scanFolder, writeStageToFile } from '../app/folder.js';
import { changeStage } from '../app/stage.js';
import { jobCard } from '../cards.js';
import { db } from '../db.js';
import { STAGE_LABEL, STAGES } from '../model.js';
import { $, $$, toast } from '../ui.js';
import { esc as h } from '../util.js';
import { importJobFile, rememberFile } from './files.js';
import { openJob } from './jobs.js';

export async function setStage(id, stage) {
  const now = Date.now();
  if (!(await changeStage(id, stage))) { if (S.view === 'dash') renderView(); return; } // same stage, or reopening cancelled
  const f = S.dash.files.get(id);
  if (f || (await db.getMeta('fh:' + id).catch(() => null))) {
    const ok = await writeStageToFile(id, stage, now);
    if (!ok && f) toast('Stage changed on this device; the folder file could not be updated.');
  }
  await loadJobs(); if (S.view === 'dash') renderView();
  toast(`${(S.jobs.find((j) => j.id === id)?.info?.tankId) || f?.card.tankId || 'Tank'} → ${STAGE_LABEL[stage]}`);
}

async function openFromDash(id) {
  const local = S.jobs.find((j) => j.id === id), f = S.dash.files.get(id);
  if (f && (!local || f.card.updated > (local.updated || 0) + 1000)) {
    const nid = await importJobFile(await f.fh.getFile());
    if (nid) { await rememberFile(nid, f.fh, true); if (S.job?.id === nid) { S.fileName = f.name; renderHeader(); } }
    return;
  }
  if (local) { await openJob(id, 'setup'); if (f) { await rememberFile(id, f.fh, false); S.fileName = f.name; renderHeader(); } }
}

function dashRows() {
  const D = S.dash, rows = new Map();
  for (const j of S.jobs) rows.set(j.id, { ...jobCard(S.job?.id === j.id ? S.job : j), where: 'device' });
  for (const [id, f] of D.files) {
    const r = rows.get(id);
    if (!r) rows.set(id, { ...f.card, where: 'folder', file: f.path });
    else { const newer = f.card.updated > r.updated + 1000; rows.set(id, { ...(newer ? f.card : r), where: 'both', file: f.path, fileNewer: newer, stage: newer ? f.card.stage : r.stage }); }
  }
  let list = [...rows.values()];
  const q = D.q.trim().toLowerCase();
  if (q) list = list.filter((r) => [r.tankId, r.client, r.site, r.reportNo, r.inspector, r.reviewer].join(' ').toLowerCase().includes(q));
  const key = (r) => (r.stage === 'upcoming' ? r.planned || r.inspDate || '9' : r.due || r.inspDate || '9');
  return list.sort((a, b) => key(a).localeCompare(key(b)) || a.tankId.localeCompare(b.tankId, undefined, { numeric: true }));
}

function viewDash() {
  const D = S.dash, rows = dashRows(), today = todayISO();
  const by = Object.fromEntries(STAGES.map(([k]) => [k, rows.filter((r) => r.stage === k)]));
  const fmtD = (d) => (d ? new Date(d + 'T12:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const card = (r) => {
    const late = r.due && r.due < today && r.stage !== 'complete';
    const dates = [r.stage === 'upcoming' ? (r.planned ? `Planned ${fmtD(r.planned)}` : '') : r.inspDate ? `Inspected ${fmtD(r.inspDate)}` : '', r.due ? `<span class="${late ? 'bad' : ''}">Due ${fmtD(r.due)}${late ? ' — overdue' : ''}</span>` : ''].filter(Boolean).join(' · ');
    return `<div class="tcard${S.job?.id === r.id ? ' cur' : ''}${late ? ' late' : ''}" draggable="true" data-dash="${r.id}">
      <div class="tc-top"><b>${h(r.tankId)}</b>${r.rev ? `<span class="muted small">Rev ${r.rev}</span>` : ''}</div>
      <div class="small">${h([r.client, r.site].filter(Boolean).join(' · ')) || '<span class="muted">No client / site</span>'}</div>
      ${dates ? `<div class="small">${dates}</div>` : ''}
      ${r.inspector || r.reviewer ? `<div class="small muted">${r.inspector ? 'Insp. ' + h(r.inspector) : ''}${r.reviewer ? ' · Review ' + h(r.reviewer) : ''}</div>` : ''}
      <div class="tc-chips">${r.condition ? `<span class="cchip ${/Not fit|Further/.test(r.condition) ? 'bad' : /repairs/.test(r.condition) ? 'warn' : 'ok'}">${h(r.condition.replace('Fit for continued service', 'Fit for service'))}</span>` : ''}${r.open ? `<span class="cchip ${r.pri ? 'bad' : 'warn'}">${r.open} open deficienc${r.open === 1 ? 'y' : 'ies'}${r.pri ? ` · ${r.pri} P1/P2` : ''}</span>` : ''}
        <span class="cchip loc" title="${h(r.file || '')}">${r.where === 'device' ? 'This device' : r.where === 'folder' ? 'Folder' : 'Device + folder'}</span>${r.fileNewer ? '<span class="cchip warn" title="The folder file was changed more recently than the copy on this device">Folder copy newer</span>' : ''}</div>
      <div class="tc-acts"><select data-stage-of="${r.id}" aria-label="Stage">${STAGES.map(([k, l]) => `<option value="${k}" ${r.stage === k ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="btn sm primary" data-act="dash-open" data-id="${r.id}">Open</button></div></div>`;
  };
  const folderBar = !canDir() ? `<span class="muted small">Folder linking works in the installed app (Chrome / Edge). Showing tanks on this device.</span>`
    : !D.dir ? `<button class="btn" data-act="dash-link">Link jobs folder…</button><span class="muted small">Pick the shared folder (e.g. OneDrive) where the job files are saved.</span>`
      : D.perm !== 'granted' ? `<button class="btn primary" data-act="dash-reconnect">Reconnect ${h(D.dir.name)}</button><span class="muted small">The browser asks again each session before the app can read the folder.</span><button class="btn sm ghost" data-act="dash-link">Change folder…</button>`
        : `<span class="small">Folder <b>${h(D.dir.name)}</b> · ${D.scanning ? 'scanning…' : `${D.files.size} job file${D.files.size === 1 ? '' : 's'}`}</span><button class="btn sm" data-act="dash-rescan" ${D.scanning ? 'disabled' : ''}>Rescan</button><button class="btn sm ghost" data-act="dash-link">Change folder…</button>`;
  const tiles = STAGES.map(([k, l]) => `<button class="stile st-${k}${D.stage === k ? ' on' : ''}" data-act="dash-stage" data-k="${k}"><b>${by[k].length}</b><span>${l}</span></button>`).join('');
  const body = D.mode === 'list'
    ? `<section class="card"><div class="tblwrap"><table class="grid dlist"><thead><tr><th>Tank</th><th>Client / site</th><th>Stage</th><th>Planned / inspected</th><th>Due</th><th>Inspector</th><th>Reviewer</th><th>Condition</th><th class="n">Open def.</th><th>Where</th><th></th></tr></thead><tbody>
        ${rows.filter((r) => !D.stage || r.stage === D.stage).map((r) => `<tr class="${r.due && r.due < today && r.stage !== 'complete' ? 'is-bad' : ''}"><td><b>${h(r.tankId)}</b>${r.rev ? `<br><small class="muted">Rev ${r.rev}</small>` : ''}</td><td>${h(r.client)}<br><small class="muted">${h(r.site)}</small></td><td><select data-stage-of="${r.id}">${STAGES.map(([k, l]) => `<option value="${k}" ${r.stage === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td><td>${fmtD(r.stage === 'upcoming' ? r.planned : r.inspDate)}</td><td>${fmtD(r.due)}</td><td>${h(r.inspector)}</td><td>${h(r.reviewer)}</td><td class="small">${h(r.condition)}</td><td class="n">${r.open || '—'}${r.pri ? ` <small class="bad">(${r.pri} P1/P2)</small>` : ''}</td><td class="small">${r.where === 'device' ? 'Device' : r.where === 'folder' ? 'Folder' : 'Both'}${r.fileNewer ? ' <b class="warn-txt">· folder newer</b>' : ''}</td><td><button class="btn sm primary" data-act="dash-open" data-id="${r.id}">Open</button></td></tr>`).join('') || '<tr><td colspan="11" class="empty">No tanks.</td></tr>'}
      </tbody></table></div></section>`
    : `<div class="board">${STAGES.filter(([k]) => !D.stage || D.stage === k).map(([k, l]) => `<div class="bcol st-${k}" data-drop="${k}"><div class="bcol-h"><b>${l}</b><em>${by[k].length}</em></div>${by[k].map(card).join('') || '<p class="muted small bempty">Drag a tank here</p>'}</div>`).join('')}</div>`;
  return `<div class="page wide dash"><div class="page-head"><div><h1>Dashboard</h1><p class="muted">Every tank on this device and in the linked jobs folder, by stage. Drag a card to another column, or use its stage list. Stage changes are written to the job file in the folder so everyone sees them.</p></div>
    <div class="acts"><button class="btn primary" data-act="job-new">New tank</button><button class="btn" data-act="job-open-file">Open job file…</button></div></div>
    <div class="folderbar">${folderBar}</div>
    <div class="stiles">${tiles}</div>
    <div class="dash-tools"><input type="search" id="dashQ" placeholder="Search tank, client, site, inspector…" value="${h(D.q)}"><div class="seg"><button class="btn sm${D.mode === 'board' ? ' on' : ''}" data-act="dash-mode" data-k="board">Board</button><button class="btn sm${D.mode === 'list' ? ' on' : ''}" data-act="dash-mode" data-k="list">List</button></div>${D.stage ? `<button class="btn sm ghost" data-act="dash-stage" data-k="${D.stage}">Show all stages</button>` : ''}</div>
    ${body}</div>`;
}
const afterDash = async () => { const before = S.dash.scanned; await dashInit(); if (!before && S.dash.scanned && S.view === 'dash') renderView(); };

defineView('dash', viewDash, afterDash);

/* Drag a card to another stage column; search box. */
document.addEventListener('dragstart', (e) => { const c = e.target.closest?.('[data-dash]'); if (!c) return; e.dataTransfer.setData('text/plain', c.dataset.dash); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging'); });
document.addEventListener('dragend', (e) => { e.target.closest?.('[data-dash]')?.classList.remove('dragging'); $$('.bcol.over').forEach((x) => x.classList.remove('over')); });
document.addEventListener('dragover', (e) => { const col = e.target.closest?.('[data-drop]'); if (!col) return; e.preventDefault(); $$('.bcol.over').forEach((x) => x !== col && x.classList.remove('over')); col.classList.add('over'); });
document.addEventListener('drop', (e) => { const col = e.target.closest?.('[data-drop]'); if (!col) return; e.preventDefault(); col.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); if (id) setStage(id, col.dataset.drop); });
document.addEventListener('input', (e) => { if (e.target.id === 'dashQ') { S.dash.q = e.target.value; clearTimeout(S.dash.qt); S.dash.qt = setTimeout(() => { const pos = e.target.selectionStart; renderView(); const n = $('#dashQ'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch { /* */ } } }, 200); } });

onAction({
  'dash-link': async (el, id, e, act) => {
    return linkFolder();
  },
  'dash-reconnect': async (el, id, e, act) => {
    { try { S.dash.perm = await S.dash.dir.requestPermission({ mode: 'readwrite' }); } catch { S.dash.perm = 'denied'; } if (S.dash.perm === 'granted') { S.dash.scanned = false; await scanFolder(); } else renderView(); return; }
  },
  'dash-rescan': async (el, id, e, act) => {
    S.dash.scanned = false; return scanFolder();
  },
  'dash-open': async (el, id, e, act) => {
    return openFromDash(id);
  },
  'dash-mode': async (el, id, e, act) => {
    S.dash.mode = el.dataset.k; renderView(); return;
  },
  'dash-stage': async (el, id, e, act) => {
    S.dash.stage = S.dash.stage === el.dataset.k ? '' : el.dataset.k; renderView(); return;
  }
});

onChange([
  { order: 280, when: (el, act) => el.matches('[data-stage-of]'), run: async (el, e, act) => {
    { setStage(el.dataset.stageOf, el.value); return; }
  } }
]);
