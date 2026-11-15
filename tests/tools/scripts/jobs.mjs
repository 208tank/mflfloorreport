// Jobs screen and Settings, for actions-diff.mjs: settings fields, company logo, duplicate / delete / open a job,
// new job and demo job.
const wait = { js: () => new Promise((r) => setTimeout(r, 600)) };
export const steps = [
  { go: 'jobs' },
  { fill: 'input[data-cb="name"]', value: 'Test Co' },
  { fill: 'textarea[data-cb="details"]', value: '1 Main St' },
  { fill: 'input[data-cb="inspector"]', value: 'C. Inspector' },
  { upload: 'input[data-act="logo"]' }, wait,
  { go: 'dash' }, { go: 'jobs' },
  { click: '[data-act="logo-clear"]' },
  { click: '[data-act="job-dup"] >> nth=0' }, wait,
  { click: '[data-act="job-del"] >> nth=-1' },
  { confirm: 'no' },
  { click: '[data-act="job-del"] >> nth=-1' },
  { confirm: 'yes' }, wait,
  { click: '[data-act="job-open"] >> nth=0' }, wait,
  { go: 'jobs' },
  { click: '[data-act="job-new"]' }, wait,
  { go: 'jobs' },
  { click: '[data-act="job-demo"]' }, wait,
];
