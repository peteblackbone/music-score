/**
 * editor-demo-forms.js — the form helpers the settings dialogs of
 * editor.html share (editor-demo-settings.js, editor-demo-measure.js,
 * editor-demo-tracks.js). Not part of the package.
 *
 * Every dialog: open → rebuild from the API, clear errors, showModal, focus
 * the first enabled field. Apply → check the fields (inline errors, the
 * dialog stays open), build a patch of the changed fields only, then: an
 * empty patch closes silently; a call that returns true closes and focuses
 * the editor (the library announces); false shows the library's reason
 * (editor.lastMessage) in the alert line; a throw shows
 * "Couldn't apply: <message>.". Cancel / Esc close and focus the opener.
 */

/** Show `message` in `input`'s error slot (`<id>-err`, created after the input when missing); aria-invalid and the error id first in aria-describedby. */
export function setFieldError(doc, input, message) {
  const id = `${input.id}-err`;
  let p = doc.getElementById(id);
  if (!p) {
    p = doc.createElement('p');
    p.className = 'field-error';
    p.id = id;
    input.after(p);
  }
  p.textContent = message;
  p.hidden = false;
  if (!input.dataset.describedby) input.dataset.describedby = input.getAttribute('aria-describedby') ?? '';
  input.setAttribute('aria-invalid', 'true');
  input.setAttribute('aria-describedby', [id, input.dataset.describedby].filter(Boolean).join(' '));
}
/** Clear `input`'s error. */
export function clearFieldError(doc, input) {
  if (input.getAttribute('aria-invalid') !== 'true') return;
  const p = doc.getElementById(`${input.id}-err`);
  if (p) { p.textContent = ''; p.hidden = true; }
  input.removeAttribute('aria-invalid');
  if (input.dataset.describedby) input.setAttribute('aria-describedby', input.dataset.describedby);
  else input.removeAttribute('aria-describedby');
  delete input.dataset.describedby;
}
/** Clear every field error of `form` and its alert line. */
export function clearErrors(doc, form, alert) {
  form.querySelectorAll('[aria-invalid="true"]').forEach((el) => clearFieldError(doc, el));
  alert.textContent = '';
}
/** Show `errors` (`[[input, message]]`): inline, the count in the alert, focus on the first; true when there were any. */
export function showErrors(doc, alert, errors) {
  if (!errors.length) return false;
  errors.forEach(([input, msg]) => setFieldError(doc, input, msg));
  alert.textContent = `Couldn't apply: ${errors.length === 1 ? '1 field needs' : `${errors.length} fields need`} fixing.`;
  errors[0][0].focus();
  return true;
}
/** Run API call `fn`: true when it returned true; else the reason (false: lastMessage; a throw: its message) goes to `alert`. */
export function callApi(editor, alert, fn) {
  try {
    if (fn()) return true;
    alert.textContent = editor.lastMessage;
  } catch (err) {
    alert.textContent = `Couldn't apply: ${String(err.message).replace(/\.$/, '')}.`;
  }
  return false;
}
const focusable = (el) => !el.disabled && !el.hidden && !el.closest('[hidden]') && !el.closest('fieldset:disabled');
/** The first enabled field of `form` (a checked radio of a group counts for its group). */
export function firstField(form) {
  return [...form.querySelectorAll('input, select, textarea, button')]
    .filter((el) => focusable(el) && (el.type !== 'radio' || el.checked))[0] ?? null;
}
/**
 * Run `fn` (which may disable or hide controls of `form`); if the control
 * that had focus can't keep it, focus moves to the nearest enabled control
 * after it, else before it, so focus never falls to the page.
 */
export function withFocus(form, fn) {
  const had = form.ownerDocument.activeElement;
  fn();
  if (!had || !form.contains(had) || focusable(had)) return;
  const all = [...form.querySelectorAll('input, select, textarea, button')].filter(focusable);
  const after = all.find((x) => had.compareDocumentPosition(x) & 4);
  const before = all.filter((x) => had.compareDocumentPosition(x) & 2).pop();
  (after ?? before)?.focus();
}

/**
 * Wire one dialog: the `opener` button opens it (open() rebuilds it, then
 * showModal and focus the first field); submit runs apply(), which returns
 * true to close and focus the editor; Cancel / Esc focus the opener.
 */
export function wireDialog(doc, editor, { dialog, form, opener, cancel, alert, open, apply }) {
  let applied = false;
  opener.addEventListener('click', () => {
    applied = false;
    clearErrors(doc, form, alert);
    open();
    dialog.showModal();
    firstField(form)?.focus();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    alert.textContent = '';
    if (!apply()) return;
    applied = true;
    dialog.close();
    editor.focus();
  });
  form.addEventListener('input', (e) => clearFieldError(doc, e.target));
  form.addEventListener('change', (e) => clearFieldError(doc, e.target));
  cancel.addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { if (!applied) opener.focus(); });
}
