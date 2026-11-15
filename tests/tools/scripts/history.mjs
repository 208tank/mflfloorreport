// Data check on the Jobs screen (Settings), for actions-diff.mjs. Recovery and repairs are covered by the browser suite.
export const steps = [
  { go: 'jobs' },
  { click: '[data-act="integrity-run"]' },
  { js: () => new Promise((r) => setTimeout(r, 1500)) },
  { go: 'dash' },
  { go: 'jobs' },
];
