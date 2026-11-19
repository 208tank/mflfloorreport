// The header: job title, revision and stage, the job file badge and the header buttons (refactoring step 14).
import { S } from './state.js';
import { changesText, fileChanges } from './persist.js';
import { STAGE_LABEL } from '../model.js';
import { $ } from '../ui.js';
import { isAdmin } from './admin.js';
import { inspectorLocked } from '../roles.js';
import { esc as h } from '../util.js';

export function revText(j, long = false) {
  if (!j?.rev) return long ? 'Not saved to a file yet' : '';
  const d = new Date(j.savedAt);
  const when = long ? d.toLocaleString() : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `Rev ${j.rev} · saved ${when}`;
}

/** The job file status in the header: revision, and changes saved on this device but not yet in the file. */
export function showFileState() {
  const j = S.job, reg = !!j?.regEdit, fs = $('#fileState');
  if (!fs) return;
  fs.hidden = !j || reg;
    const c = fileChanges(j);
    fs.textContent = j ? (j.rev ? (c.n || !c.known ? `Rev ${j.rev} · ${changesText(c)} not in the file` : revText(j)) : `Not saved to a file${c.n ? ' · ' + changesText(c) : ''}`) : '';
    fs.dataset.state = j && (!j.rev || c.n || !c.known) ? 'dirty' : 'clean';
    fs.title = (j?.rev ? `${revText(j, true)}${S.fileName ? ' to ' + S.fileName : ''}` : 'Save file… keeps a copy in OneDrive and starts the revision count')
      + (c.n || !c.known ? `\nSaved on this device. Not yet in the job file: ${changesText(c)}${c.areas.length ? ' (' + c.areas.join(', ') + ')' : ''} — press Save to put them in the file.` : '');
}

/** v3.40: Locked (Complete, or in review for an inspector), the admin's Reopen / Unlock buttons, and the admin badge. */
function lockBadge(j) {
  const st = j.status?.stage, admin = isAdmin(j);
  if (st === 'complete') return ' <em class="locked" title="The report has been issued; the job is read-only">Locked</em>' + (admin ? ' <button type="button" class="btn sm" data-act="reopen" title="Back to Admin review for changes (asks for a reason)">Reopen</button>' : '');
  if (!inspectorLocked(j)) return '';
  return admin ? ' <button type="button" class="btn sm" data-act="unlock-insp" title="Back to Reporting so the inspector can edit it (asks for a reason)">Unlock for inspector</button>'
    : ' <em class="locked" title="In review: only an admin can edit it or unlock it">Locked</em>';
}

export function renderHeader() {
  const j = S.job, reg = !!j?.regEdit;
  if (reg) $('#jobTitle').innerHTML = `<b>${h(j.info.tankId || 'New tank')} <em class="stg st-reg">Registry</em></b><span>${h([j.info.client, j.info.site, 'editing the tank data'].filter(Boolean).join(' · '))}</span>`;
  else $('#jobTitle').innerHTML = j ? `<b>${h(j.info.tankId || 'Untitled tank')}${j.rev ? ` <em class="rev">Rev ${j.rev}</em>` : ''}${j.status?.stage ? ` <em class="stg st-${j.status.stage}">${h(STAGE_LABEL[j.status.stage])}</em>` : ''}${lockBadge(j)}</b><span>${h([j.info.client, j.info.site, j.info.inspDate].filter(Boolean).join(' · '))}</span>` : '<span>No job open</span>';
  showFileState();
  const ab = $('#adminBadge'); if (ab) { ab.hidden = !S.admin?.on; ab.textContent = S.admin?.on ? `Admin${S.admin.name ? ' · ' + S.admin.name : ''}` : ''; }
  $('#exportMenu').hidden = !j || reg;
  $('#saveFileBtn').hidden = !j || reg;
  const rb = $('.top-acts [data-go="report"]'); if (rb) rb.hidden = reg;
  $('#saveFileBtn').title = S.fileName ? `Save to ${S.fileName} (Ctrl+S)` : 'Save this job to a file, e.g. in OneDrive (Ctrl+S)';
  $('#saveFileBtn').textContent = S.fileName ? 'Save' : 'Save file…';
  $('#installBtn').hidden = !S.installEvt;
}
