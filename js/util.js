// Small helpers shared by every module.

/** Escape text for use inside HTML (element content or a double- or single-quoted attribute). */
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The same, leaving apostrophes as they are (used by the report and drawings, where ' is the
 *  foot mark in dimensions). Safe for element content and double-quoted attributes only. */
export const escText = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
