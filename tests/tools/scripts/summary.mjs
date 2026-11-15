// Executive summary and deficiencies, for actions-diff.mjs.
export const steps = [
  { go: 'summary' },
  { select: 'select[data-bind="summary.condition"]', value: { index: 2 } },
  { click: '[data-act="sum-draft"] >> nth=0' },
  { confirmIf: 'yes' },
  { click: '[data-act="sum-draft"] >> nth=0' },
  { confirm: 'no' },
  { click: '[data-act="sum-draft"] >> nth=-1' },
  { confirmIf: 'yes' },
  { go: 'defs' },
  { click: '[data-act="def-filter"] >> nth=1' },
  { click: '[data-act="def-filter"] >> nth=0' },
  { click: '[data-act="def-issue"]' },
  { go: 'defrep' },
];
