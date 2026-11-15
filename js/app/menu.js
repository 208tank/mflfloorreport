// Side menu: the button on a section heading opens or closes that section's group of screens
// (refactoring step 15). The menu itself is drawn by renderNav in nav.js.
import { S } from './state.js';
import { go, renderNav } from './nav.js';
import { onAction } from './actions.js';
import { viewPlace } from '../sections.js';

onAction({
  'nav-sec': async (el, id, e, act) => {
    {
      const k = el.dataset.sec, pl = viewPlace(S.view);
      if (S.navOpen.has(k)) { S.navOpen.delete(k); renderNav(); return; }
      S.navOpen.add(k);
      if (pl?.sec === k) { renderNav(); return; }
      go(S.ndeTab[k] || 'nde:' + k); return;
    }
  }
});
