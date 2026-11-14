// Action registry (refactoring step 1): one document listener each for clicks and changes, dispatching to
// handlers that screen modules register. Every data-act name and every attribute binding is unchanged.
//  - onAction({ name: (el, id, e, act) => … }) — a click on [data-act="name"]; [data-go] buttons navigate.
//  - onChange([{ order, when: (el, act) => bool, run: (el, e, act) => … }]) — the first matching handler,
//    in `order`, handles a change event. Orders keep the original sequence of checks whatever module a
//    handler lives in.
import { go } from './nav.js';

const actions = Object.create(null);
const changes = [];

export function onAction(map) {
  for (const [name, fn] of Object.entries(map)) {
    if (actions[name]) throw new Error(`Action "${name}" is registered twice`);
    actions[name] = fn;
  }
}
export function onChange(list) {
  for (const c of list) {
    if (changes.some((x) => x.order === c.order)) throw new Error(`Change handler order ${c.order} is used twice`);
    changes.push(c);
  }
  changes.sort((a, b) => a.order - b.order);
}
/** Registered action names (for tests). */
export const actionNames = () => Object.keys(actions);

document.addEventListener('click', async (e) => {
  const g = e.target.closest('[data-go]');
  if (g && !g.disabled) { go(g.dataset.go); return; }
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const id = el.dataset.id;
  const menu = el.closest('details.menu'); if (menu) menu.open = false;
  const fn = actions[act];
  if (fn) return fn(el, id, e, act);
});

document.addEventListener('change', async (e) => {
  const el = e.target, act = el.dataset?.act;
  for (const c of changes) if (c.when(el, act)) return c.run(el, e, act);
});
