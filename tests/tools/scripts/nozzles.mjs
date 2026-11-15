// Nozzles screen, the nozzle table on tank setup and the nozzle side panel on the floor map, for actions-diff.mjs.
const last = (q) => `${q} >> nth=-1`;
export const steps = [
  { go: 'nozzles' },
  { click: '#nozzleCard [data-act="nozzle-add"]' },
  { fill: last('#nozzleCard input[data-nb="angle"]'), value: '370' },
  { select: last('#nozzleCard select[data-nb="type"]'), value: { index: 2 } },
  { select: last('#nozzleCard select[data-nb="conn"]'), value: { index: 1 } },
  { fill: last('#nozzleCard input[data-nb="size"]'), value: '6' },
  { fill: last('#nozzleCard input[data-nb="elev"]'), value: '12' },
  { fill: last('#nozzleCard input[data-nb="tNom"]'), value: '0.28' },
  { fill: last('#nozzleCard input[data-nb="ut12"]'), value: '0.2' },
  { fill: last('#nozzleCard input[data-nb="mark"]'), value: 'N99' },
  { fill: last('#nozzleCard input[data-nb="service"]'), value: 'Drain' },
  { click: last('#nozzleCard [data-act="nozzle-del"]') },
  { confirm: 'no' },
  { click: last('#nozzleCard [data-act="nozzle-del"]') },
  { confirm: 'yes' },
  // the nozzle panel on the floor map
  { js: () => { window.__app.selNozzle = window.tfi.job().nozzles[0].id; window.tfi.go('map'); } },
  { click: '#side [data-act="utx-add"]' },
  { fill: last('#side input[data-nbx="loc"]'), value: 'Weld toe' },
  { fill: last('#side input[data-nbx="t"]'), value: '0.25' },
  { click: last('#side [data-act="utx-del"]') },
  { fill: '#side input[data-nb="angle"]', value: '95' },
  // tank setup table
  { go: 'setup' },
  { click: '#nozzleCard [data-act="nozzle-add"]' },
  { fill: last('#nozzleCard input[data-nb="angle"]'), value: '200' },
  { click: last('#nozzleCard [data-act="nozzle-del"]') },
  { confirm: 'yes' },
  { click: '#main [data-act="nozzle-place"]' },
];
