// Page helpers shared by the screens: element lookup, toasts and the in-app dialogs.
import { esc as h } from './util.js';

export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

/** In-app confirmation dialog (works where native confirm() is blocked). Resolves true for OK. */
export function askConfirm(msg, { ok = 'OK', cancel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    const d = $('#confirmDlg');
    d.innerHTML = `<div class="cf"><p>${h(msg).replace(/\n/g, '<br>')}</p><div class="acts">
      <button type="button" class="btn" data-cf="no">${h(cancel)}</button>
      <button type="button" class="btn ${danger ? 'danger-solid' : 'primary'}" data-cf="yes">${h(ok)}</button></div></div>`;
    d.returnValue = '';
    d.onclick = (e) => { const b = e.target.closest('[data-cf]'); if (b) d.close(b.dataset.cf); };
    d.onclose = () => resolve(d.returnValue === 'yes');
    d.showModal();
    $('[data-cf="yes"]', d).focus();
  });
}

/** In-app dialog with several buttons: choices = [[key, label, cls?], …]. Resolves the key, or null on Esc. */
export function askChoice(msg, choices) {
  return new Promise((resolve) => {
    const d = $('#confirmDlg');
    d.innerHTML = `<div class="cf"><p>${h(msg).replace(/\n/g, '<br>')}</p><div class="acts">${choices.map(([k, label, cls]) => `<button type="button" class="btn ${cls || ''}" data-cf="${h(k)}">${h(label)}</button>`).join('')}</div></div>`;
    d.returnValue = '';
    d.onclick = (e) => { const b = e.target.closest('[data-cf]'); if (b) d.close(b.dataset.cf); };
    d.onclose = () => resolve(d.returnValue || null);
    d.showModal();
    $('.primary[data-cf]', d)?.focus();
  });
}

/** In-app dialog asking for a line of text (a reason). Resolves the trimmed text, or null if cancelled.
 *  OK stays disabled until something is typed when `required`. */
export function askText(msg, { ok = 'OK', cancel = 'Cancel', label = '', required = true, placeholder = '' } = {}) {
  return new Promise((resolve) => {
    const d = $('#confirmDlg');
    d.innerHTML = `<form class="cf" method="dialog"><p>${h(msg).replace(/\n/g, '<br>')}</p>
      <label class="fld">${label ? `<span class="lbl">${h(label)}</span>` : ""}<textarea id="askText" rows="3" placeholder="${h(placeholder)}"></textarea></label><div class="acts">
      <button type="button" class="btn" data-cf="no">${h(cancel)}</button>
      <button type="submit" class="btn primary" data-cf="yes" ${required ? 'disabled' : ''}>${h(ok)}</button></div></form>`;
    d.returnValue = '';
    const ta = $('#askText', d), yes = $('[data-cf="yes"]', d);
    ta.oninput = () => { yes.disabled = required && !ta.value.trim(); };
    d.onclick = (e) => { const b = e.target.closest('[data-cf]'); if (b && !b.disabled) { e.preventDefault(); d.close(b.dataset.cf); } };
    d.onclose = () => resolve(d.returnValue === 'yes' ? ta.value.trim() : null);
    d.showModal();
    ta.focus();
  });
}

let toastTimer;
export function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = `<span>${h(msg)}</span>${action ? `<button class="btn sm" id="toastAct">${h(action.label)}</button>` : ''}`;
  t.hidden = false; clearTimeout(toastTimer);
  if (action) $('#toastAct').onclick = () => { t.hidden = true; action.fn(); };
  toastTimer = setTimeout(() => (t.hidden = true), action ? 15000 : 3500);
}
