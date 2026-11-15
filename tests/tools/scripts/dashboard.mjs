// Dashboard edits for actions-diff.mjs: stage filter, board/list, stage change by list and by drag, search, open.
export const steps = [
  { go: 'dash' },
  { click: '[data-act="dash-stage"][data-k="upcoming"]' },
  { click: '[data-act="dash-stage"][data-k="upcoming"]' },
  { click: '[data-act="dash-mode"][data-k="list"]' },
  { select: 'select[data-stage-of]', value: 'inspection' },
  { click: '[data-act="dash-mode"][data-k="board"]' },
  { drag: '[data-dash]', to: '[data-drop="reporting"]' },
  { fill: '#dashQ', value: 'TK-1', key: 'End' },
  { js: () => new Promise((r) => setTimeout(r, 600)) },
  { fill: '#dashQ', value: 'nothing-matches', key: 'End' },
  { js: () => new Promise((r) => setTimeout(r, 600)) },
  { fill: '#dashQ', value: '', key: 'End' },
  { js: () => new Promise((r) => setTimeout(r, 600)) },
  { click: '[data-act="dash-open"]' },
];
