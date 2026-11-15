// Form fields: the labelled inputs used on every screen, and reading their values (refactoring step 1).
import { S } from './state.js';
import { inVal, toMm, num, unitLabel } from '../units.js';
import { getPath } from '../model.js';
import { esc as h } from '../util.js';

export function valOf(v, kind) {
  if (kind === 'big' || kind === 'small' || kind === 't') return inVal(v, kind, S.job);
  return v ?? '';
}
export function readInput(el) {
  const k = el.dataset.kind || 'text';
  if (k === 'bool') return el.checked;
  const v = el.value.trim();
  if (k === 'big' || k === 'small' || k === 't') return toMm(v, k, S.job);
  if (k === 'num') return num(v);
  return v;
}
export function unitFor(kind, extra) {
  if (extra.unit) return extra.unit;
  if (kind === 'big' || kind === 'small' || kind === 't') return unitLabel(kind === 't' ? 'small' : kind, S.job);
  return '';
}
/** Generic labelled field. attr = 'data-bind' (job path) or other binding attr. */
export function field(label, key, kind = 'text', extra = {}) {
  const attr = extra.attr || 'data-bind';
  const v = extra.value !== undefined ? extra.value : getPath(S.job, key);
  const id = 'f_' + Math.random().toString(36).slice(2, 8);
  const common = `id="${id}" ${attr}="${h(key)}" data-kind="${kind}" ${extra.attrs || ''}`;
  let input;
  if (kind === 'bool') return `<label class="chk${extra.cls ? ' ' + extra.cls : ''}"><input type="checkbox" ${common} ${v ? 'checked' : ''}><span>${label}</span></label>`;
  if (kind === 'sel') input = `<select ${common}>${extra.options.map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o || '—']; return `<option value="${h(val)}" ${String(v ?? '') === String(val) ? 'selected' : ''}>${h(lab)}</option>`; }).join('')}</select>`;
  else if (kind === 'area') input = `<textarea ${common} rows="${extra.rows || 3}" placeholder="${h(extra.ph || '')}">${h(v)}</textarea>`;
  else {
    const type = kind === 'date' ? 'date' : 'text';
    const im = ['big', 'small', 't', 'num'].includes(kind) ? 'inputmode="decimal"' : '';
    input = `<input type="${type}" ${im} ${common} value="${h(valOf(v, kind))}" placeholder="${h(extra.ph ?? '')}" ${extra.list ? `list="${extra.list}"` : ''} autocomplete="off">`;
  }
  const un = unitFor(kind, extra);
  return `<label class="fld${extra.cls ? ' ' + extra.cls : ''}" for="${id}"><span class="lbl">${label}</span><span class="ctl">${input}${un ? `<i class="unit">${un}</i>` : ''}</span>${extra.hint ? `<small>${extra.hint}</small>` : ''}</label>`;
}

/** A selector that finds the same input again after its panel is redrawn (keeps focus while typing). */
export function focusSel(el) {
  const attrs = ['data-rowf', 'data-row', 'data-secf', 'data-sec', 'data-mpf', 'data-pl', 'data-shc', 'data-shut', 'data-course', 'data-z', 'data-zf', 'data-zone', 'data-rut', 'data-pt', 'data-rpt', 'data-f', 'data-rpc', 'data-sg', 'data-gid', 'data-sck', 'data-sckn', 'data-st', 'data-se', 'data-sd', 'data-eid', 'data-sts', 'data-ep', 'data-x', 'data-eps', 'data-epz', 'data-zid', 'data-cv', 'data-cid', 'data-shs', 'data-bind', 'data-act'];
  const parts = attrs.filter((k) => el.hasAttribute(k)).map((k) => `[${k}="${CSS.escape(el.getAttribute(k))}"]`);
  return parts.length ? el.tagName.toLowerCase() + parts.join('') : null;
}

/** Re-render a block, keeping keyboard focus on the same input. */
export function rerenderKeep(c, html) {
  const a = document.activeElement, key = a && c.contains(a) ? focusSel(a) : null;
  c.innerHTML = html;
  if (key) { const n = c.querySelector(key); if (n) { n.focus(); try { n.select(); } catch { /* */ } } }
}

/** Inputs and selects for a section record (NDE, observation, recommendation): data-sx / data-sec / data-iid / data-f. */
export function sxIn(kind, sec, it, f, type = 'text', extra = '') {
  const v = it[f] ?? '';
  if (type === 'area') return `<textarea data-sx="${kind}" data-sec="${sec}" data-iid="${it.id}" data-f="${f}" rows="2" ${extra}>${h(v)}</textarea>`;
  return `<input data-sx="${kind}" data-sec="${sec}" data-iid="${it.id}" data-f="${f}" ${type === 'date' ? 'type="date"' : ''} value="${h(v)}" ${extra}>`;
}
export function sxSel(kind, sec, it, f, opts) {
  return `<select data-sx="${kind}" data-sec="${sec}" data-iid="${it.id}" data-f="${f}">${opts.map((o) => { const [k, l] = Array.isArray(o) ? o : [o, o || '—']; return `<option value="${h(k)}" ${String(it[f] ?? '') === String(k) ? 'selected' : ''}>${h(l)}</option>`; }).join('')}</select>`;
}
