// Navigation: which screen is showing, the side menu, and the screen registry (refactoring step 1).
// A screen module registers itself with defineView (or by adding to `views` / `after`); go(name) finds it.
// nav.js never imports a screen: the few app-level steps it needs (header, leaving registry editing,
// section breadcrumbs) are passed in once at start-up with configureNav.
import { S, APP_VERSION, VIEWS, VIEWS_END, CHILD_ICON, REG_VIEWS } from './state.js';
import { SECTIONS, SEC, CHILDREN, viewPlace, childView, findings, allDefs, STATUS_TEXT } from '../sections.js';
import { inScope } from '../registry.js';
import { isSmall } from '../small.js';
import { esc as h } from '../util.js';
import { $ } from '../ui.js';

/** Screen name → function returning its HTML. */
export const views = {};
/** Inspection-section child pages (NDE, observations, photos, analysis, recommendations) → function. */
export const childViews = {};
/** Screen name → step run after the screen is drawn (maps, previews, async loads). */
export const after = {};
/** Register a screen: its HTML and, optionally, what to run once it is on the page. */
export function defineView(name, render, afterDraw) { views[name] = render; if (afterDraw) after[name] = afterDraw; }

const hooks = { header: () => {}, leaveRegistry: () => {}, crumb: () => '' };
/** App-level steps nav.js calls but does not own. */
export function configureNav(h_) { Object.assign(hooks, h_); }

export function go(view) {
  if (!S.job && !['jobs', 'dash', 'reg', 'guide'].includes(view)) view = 'jobs';
  if (S.job?.regEdit && !REG_VIEWS.includes(view)) hooks.leaveRegistry();
  if (view === 'roof') view = 'roofF';
  S.view = view;
  const pl = viewPlace(view); if (pl) S.navOpen = new Set([pl.sec]);
  if (view !== 'map') { S.mode = 'select'; }
  renderAll();
  $('#main').scrollTop = 0;
}

export function renderAll() { hooks.header(); renderNav(); renderView(); }

export function renderNav() {
  const job = S.job, place = viewPlace(S.view);
  const icon = (d, w = 18) => `<svg viewBox="0 0 24 24" width="${w}" height="${w}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  if (job?.regEdit) {
    const items = [['setup', 'Tank data & layout', VIEWS.find((v) => v[0] === 'setup')[2]], ['map', 'Floor map', SEC.get('floor').icon], ['shell', 'Shell courses', SEC.get('shell').icon], ['nozzles', 'Nozzles', SEC.get('nozzles').icon], ['roofF', 'Fixed roof', SEC.get('froof').icon], ['roofL', 'Floating roof', SEC.get('flroof').icon], ['settle', 'Settlement set-up', SEC.get('settle').icon]];
    $('#nav').innerHTML = `<button class="nav-btn" data-act="reg-done">${icon('M15 18l-6-6 6-6')}<span>Done — back to registry</span></button><div class="nav-group">Editing tank ${h(job.info.tankId || '')}</div>` +
      items.map(([id, label, d]) => `<button class="nav-btn${S.view === id ? ' active' : ''}" data-go="${id}">${icon(d)}<span>${label}</span></button>`).join('') +
      `<p class="nav-note">Readings entered here are not kept — the registry stores the tank, not inspection results.</p><div class="nav-foot">v${APP_VERSION}</div>`;
    return;
  }
  const btn = ([id, label, d], count) => `<button class="nav-btn${S.view === id ? ' active' : ''}" data-go="${id}" ${!job && !['jobs', 'dash', 'reg', 'guide'].includes(id) ? 'disabled' : ''}>${icon(d)}<span>${label}</span>${count ? `<em>${count}</em>` : ''}</button>`;
  let F = null; try { F = job && S.layout ? findings(job, S.layout, S.calc) : null; } catch { F = null; }
  const openDefs = job ? allDefs(job).filter((d) => d.status !== 'Closed').length : 0;
  const secs = SECTIONS.filter((sec) => !job || inScope(job, sec.key)).map((sec) => {
    const open = S.navOpen.has(sec.key), st = F?.[sec.key]?.status || 'none', d = job?.secs?.[sec.key] || {};
    const counts = { obs: d.obs?.length, photos: S.photos.filter((p) => p.sec === sec.key).length, recs: d.recs?.length };
    const kids = !open ? '' : CHILDREN.map(([c, label]) => {
      const v = c === 'nde' ? (S.ndeTab[sec.key] || 'nde:' + sec.key) : childView(sec.key, c), act = place?.sec === sec.key && place.child === c;
      const sub = c === 'nde' && act ? `<div class="nav-sub">${[['nde:' + sec.key, 'NDE scope'], ...sec.nde].map(([vv, l]) => `<button class="nav-btn l3${S.view === vv ? ' active' : ''}" data-go="${vv}">${l}</button>`).join('')}</div>` : '';
      return `<button class="nav-btn l2${act ? ' active' : ''}" data-go="${v}" ${!job ? 'disabled' : ''}>${icon(CHILD_ICON[c], 15)}<span>${label}</span>${counts[c] ? `<em>${counts[c]}</em>` : ''}</button>${sub}`;
    }).join('');
    return `<div class="nav-sec${open ? ' open' : ''}"><button class="nav-btn sec${place?.sec === sec.key ? ' cur' : ''}" data-act="nav-sec" data-sec="${sec.key}" ${!job ? 'disabled' : ''}>${icon(sec.icon)}<span>${sec.label}</span><i class="sdot s-${st}" title="${STATUS_TEXT[st]}"></i><b class="chev">${open ? '▾' : '▸'}</b></button>${kids}</div>`;
  }).join('');
  $('#nav').innerHTML = VIEWS.filter((v) => v[0] !== 'small' || isSmall(job)).map((v) => btn(v)).join('') + `<div class="nav-group">Tank</div>` + secs + `<div class="nav-group"></div>` + VIEWS_END.map((v) => btn(v, v[0] === 'defs' ? openDefs : 0)).join('') +
    `<div class="nav-foot">v${APP_VERSION}<br><span id="netState">${navigator.onLine ? 'Online' : 'Offline'}</span></div>`;
}

export function renderView() {
  const main = $('#main');
  main.className = 'main view-' + S.view;
  const pl = viewPlace(S.view);
  if (pl?.child === 'nde') S.ndeTab[pl.sec] = S.view;
  const fn = views[S.view] || (pl ? childViews[pl.child] : null) || views.jobs;
  main.innerHTML = (pl ? hooks.crumb(pl) : '') + fn();
  (after[S.view] || (pl ? after['sec:' + pl.child] : null))?.();
}

/** Redraws one screen asks of another (refactoring step 14). The screen that owns the redraw registers it here,
 *  because a direct import would loop: the floor map shows the nozzle panel, and setup shows the shell and
 *  nozzle tables. map / side / mapMode: floor map (views/floormap.js); setupPreview: tank setup (views/setup.js). */
export const redraw = {
  map: () => {}, side: () => {}, mapMode: () => {}, setupPreview: () => {},
};
