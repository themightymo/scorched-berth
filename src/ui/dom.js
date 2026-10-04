// Tiny DOM helpers shared by screens.

export const $ = (id) => document.getElementById(id);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/** Tagged template that escapes interpolations unless wrapped with raw(). */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (v == null || v === false) return;
      if (Array.isArray(v)) out += v.map((x) => (x && x.__raw ? x.html : esc(x))).join('');
      else out += v && v.__raw ? v.html : esc(v);
    }
  });
  return { __raw: true, html: out };
}
export const raw = (h) => ({ __raw: true, html: String(h) });

export const isTyping = (el) => !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes(el.type)) || el.isContentEditable);

export const pad2 = (n) => String(n).padStart(2, '0');
