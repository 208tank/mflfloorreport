// Small helpers shared by every module.

/** Escape text for use inside HTML (element content or a double- or single-quoted attribute). */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The same, leaving apostrophes as they are (used by the report and drawings, where ' is the
 *  foot mark in dimensions). Safe for element content and double-quoted attributes only. */
export const escText = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** JSON with object keys in sorted order at every level, so the same data always gives the same text
 *  (and the same checksum) whatever order its fields were written in. */
export function canonicalJSON(v) {
  const walk = (x) => {
    if (x === null || typeof x !== 'object') return x === undefined ? null : x;
    if (Array.isArray(x)) return x.map((y) => (y === undefined ? null : walk(y)));
    const o = {};
    for (const k of Object.keys(x).sort()) if (x[k] !== undefined) o[k] = walk(x[k]);
    return o;
  };
  return JSON.stringify(walk(v));
}

/** SHA-256 of a value's canonical JSON, as hex (Web Crypto: works offline in the browser and in Node). */
export async function sha256(v) {
  const text = typeof v === 'string' ? v : canonicalJSON(v);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
