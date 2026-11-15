// The issued report inside a job file (data integrity stage 8c). The frozen report embeds its photos, which are in
// the file anyway, so in the file each embedded photo is written as a reference to it ("tfi-photo:<id>") and put
// back when the file is opened. The checksum is of the report as issued, so it proves the round trip.
import { sha256 } from './util.js';

export const PHOTO_REF = 'tfi-photo:';

/** Replace one photo's embedded image with a reference to it. */
export const packPhoto = (html, p) => (p?.dataUrl ? html.split(`"${p.dataUrl}"`).join(`"${PHOTO_REF}${p.id}"`) : html);

/** Put the photos back in a report from a file. */
export function unpackHtml(html, photos) {
  for (const p of photos || []) if (p?.id && p.dataUrl) html = html.split(`"${PHOTO_REF}${p.id}"`).join(`"${p.dataUrl}"`);
  return html;
}

/** Check a file's issued report. Resolves { html, ...the rest } when it is intact, or { problem } when it isn't. */
export async function readIssued(fi, photos) {
  if (!fi || typeof fi !== 'object' || typeof fi.html !== 'string' || typeof fi.hash !== 'string') return { problem: 'its issued report is incomplete' };
  const html = unpackHtml(fi.html, photos);
  if ((await sha256(html)) !== fi.hash) return { problem: html.includes(`"${PHOTO_REF}`) ? 'its issued report refers to photos that are not in the file' : 'its issued report does not match its checksum' };
  return { ...fi, html };
}
