// Job cards: the summary of a job shown on the Jobs list, the Dashboard and the tank registry.
// Works on a full job, a light job from the cards store (db.lite) or a job read from a folder file.
import { defaultStatus } from './model.js';

export const indCount = (j) => j.nInds ?? (j.indications || []).length;
export function jobCard(j) {
  const st = { ...defaultStatus(), ...(j.status || {}) };
  if (!j.status) st.stage = indCount(j) || j.rev ? 'inspection' : 'upcoming';
  let open = 0, pri = 0;
  for (const k of Object.keys(j.secs || {})) for (const r of j.secs[k].recs || []) if (r.def && r.status !== 'Closed') { open++; if (r.priority === 'P1' || r.priority === 'P2') pri++; }
  const since = (st.history || []).filter((x) => x.stage === st.stage).pop()?.at || null;
  return { id: j.id, tankId: j.info?.tankId || 'Untitled', client: j.info?.client || '', site: j.info?.site || '', inspDate: j.info?.inspDate || '', reportNo: j.info?.reportNo || '',
    inspector: j.info?.inspector || st.inspector || '', reviewer: st.reviewer || '', stage: st.stage, planned: st.planned || '', due: st.due || '', since,
    tankRef: j.tankRef || null, scope: j.scope || null, rev: j.rev || 0, savedAt: j.savedAt || 0, updated: j.updated || j.created || 0, condition: j.summary?.condition || '', open, pri, inds: indCount(j), diameter: j.tank?.diameter || null };
}
