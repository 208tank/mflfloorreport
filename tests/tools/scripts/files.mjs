// Exports and job files, for actions-diff.mjs: every Export menu item, the deficiency CSV, the UT loader
// download. (Job files: see the browser suite, which checks them byte for byte.)
const dl = (act) => ({ download: `#exportMenu [data-act="${act}"]` });
export const steps = [
  { go: 'map' },
  dl('exp-ind'), dl('exp-plates'), dl('exp-noz'), dl('exp-shell'), dl('exp-roof'), dl('exp-settle'),
  dl('exp-svg'), dl('exp-png'), dl('exp-shell-svg'),
  { go: 'defs' },
  { download: '#main [data-act="exp-defs"]' },
  { go: 'inds' },
  { download: '#main [data-act="utl-down"]' },
];
