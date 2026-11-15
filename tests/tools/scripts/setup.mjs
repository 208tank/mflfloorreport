// Tank setup and the floor builders, for actions-diff.mjs: job and tank fields, scope, row-by-row and
// plate-by-plate builders (every button and field type), and switching back to the automatic grid.
const last = (q) => `${q} >> nth=-1`;
export const steps = [
  { go: 'setup' },
  { fill: '#main input[data-bind="info.client"]', value: 'Demo Energy' },
  { select: '#main select[data-bind="tank.code"]', value: { index: 2 } },
  { check: '#main input[data-act="scope-tog"][data-k="settle"]' },
  { check: '#main input[data-act="scope-tog"][data-k="settle"]' },
  // row by row
  { select: '#main select[data-bind="layout.mode"]', value: 'custom' },
  { click: '#main [data-act="rows-template"][data-t="block"]' },
  { confirmIf: 'yes' },
  { click: '#main [data-act="rows-template"][data-t="grid"]' },
  { confirm: 'yes' },
  { fill: '#main input[data-rowf="h"]', value: '6' },
  { fill: '#main input[data-rowf="n"]', value: '3' },
  { fill: '#main input[data-rowf="off"]', value: '2' },
  { click: '#main [data-act="row-n"][data-d="1"]' },
  { click: '#main [data-act="row-n"][data-d="-1"]' },
  { click: '#main [data-act="row-sug"]' },
  { click: '#main [data-act="row-add"]' },
  { click: last('#main [data-act="row-move"][data-d="-1"]') },
  { click: '#main [data-act="row-move"][data-d="1"]' },
  { click: last('#main [data-act="row-del"]') },
  { confirmIf: 'yes' },
  // plate by plate
  { select: '#main select[data-bind="layout.mode"]', value: 'measured' },
  { click: '#main [data-act="mtpl"]' },
  { confirmIf: 'yes' },
  { fill: '#main input[data-secf="h"]', value: '6' },
  { fill: '#main input[data-secf="off"]', value: '1' },
  { fill: '#main input[data-mpf="len"]', value: '30' },
  { fill: '#main input[data-mpf="wid"]', value: '-1' },
  { click: '#main [data-act="mp-add"]' },
  { click: last('#main [data-act="mp-del"]') },
  { click: '#main [data-act="msec-add"]' },
  { click: last('#main [data-act="msec-move"][data-d="-1"]') },
  { click: last('#main [data-act="msec-del"]') },
  { confirmIf: 'yes' },
  // back to the grid
  { select: '#main select[data-bind="layout.mode"]', value: 'grid' },
  { fill: '#main input[data-bind="tank.diameter"]', value: '110' },
];
