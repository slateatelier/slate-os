/* SLATE OS · Business and Books PIN
   The Principal, the COO and the accountant enter a 4-digit PIN to open Business and Books on a device.
   The database decides (see supabase/migrations/m_pin.sql); this file only asks for the PIN, keeps it open while
   the person is working, and says when it has locked again.
   SlatePin.ensure() resolves true once unlocked (or when no PIN is needed), false if the person chose not to. */
(function () {
'use strict';
let sb = null, st = null, until = 0, timer = null, lastTouch = 0, asking = null;
const lockCbs = [], unlockCbs = [];
const client = () => sb || window.slateSupabase || (window.BooksHost && window.BooksHost.sb) || null;
const touch = () => { try { return matchMedia('(pointer:coarse)').matches; } catch (_) { return false; } };
/* iPhone: a field focused by code (not by a tap) can end up focused with no keyboard, and tapping it then does nothing.
   So on touch screens nothing is focused for the person; a tap on a field always brings the keyboard up. */
const focusLater = i => { if (!touch()) setTimeout(() => i.focus(), 30); };
const tapFix = i => { i.addEventListener('touchend', e => { if (document.activeElement === i) { e.preventDefault(); i.blur(); setTimeout(() => i.focus(), 0); } }); return i; };
const isPhone = () => { try { return matchMedia('(pointer:coarse)').matches && Math.min(screen.width, screen.height) <= 820; } catch (_) { return false; } };
const hhmm = iso => { try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch (_) { return ''; } };

const P = window.SlatePin = {
  init(c) { sb = c; return P; },
  async status(force) {
    const c = client(); if (!c) return { required: false };
    if (st && !force) return st;
    const { data, error } = await c.rpc('pin_status');
    if (error) { st = { required: false, err: error.message }; return st; }
    st = data || { required: false };
    until = st.unlocked && st.until ? Date.parse(st.until) : 0; sched();
    return st;
  },
  known() { return !!st; },
  required() { return !!(st && st.required); },
  unlocked() { return !st || !st.required || Date.now() < until; },
  async ensure(opts) {
    await P.status();
    if (P.unlocked()) return true;
    if (!asking) asking = ask(opts || {}).finally(() => { asking = null; });
    return asking;
  },
  /* someone is using Business or Books: keep it open (at most one call a minute) */
  activity() {
    if (!P.required() || !P.unlocked() || Date.now() - lastTouch < 60000) return;
    lastTouch = Date.now();
    const c = client(); if (!c) return;
    c.rpc('pin_touch').then(({ data }) => { if (data) { until = Date.parse(data); sched(); } else { until = 0; fire(); } }, () => {});
  },
  async lock() { until = 0; clearTimeout(timer); try { await client().rpc('pin_lock'); } catch (_) {} fire(); },
  onLock(f) { lockCbs.push(f); },
  onUnlock(f) { unlockCbs.push(f); }
};
function sched() {
  clearTimeout(timer); if (!until) return;
  const ms = until - Date.now();
  if (ms <= 0) { until = 0; fire(); return; }
  timer = setTimeout(sched, Math.min(ms + 300, 2147000000));
}
function fire() { lockCbs.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }

/* ---------- the PIN screen ---------- */
const CSS = `#slate-pin{position:fixed;inset:0;z-index:2147483000;background:#fff;display:grid;place-items:center;padding:24px 16px;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#000;overflow:auto}
#slate-pin .pc{width:min(360px,100%);display:grid;gap:14px}
#slate-pin .pl{width:44px;height:44px;border-radius:50%;background:#F2F2F7;display:grid;place-items:center;margin-bottom:2px}
#slate-pin h2{margin:0;font-size:24px;font-weight:700;letter-spacing:-.02em}
#slate-pin p{margin:0;color:#8E8E93;font-size:14.5px;line-height:1.45}
#slate-pin label{display:grid;gap:6px;font-size:12.5px;font-weight:600;color:#8E8E93}
#slate-pin input[type=password],#slate-pin input[type=text]{font:inherit;font-size:16px;border:0;background:#F2F2F7;border-radius:10px;padding:12px 14px;color:#000;width:100%;box-sizing:border-box}
#slate-pin input.pin{font-size:28px;letter-spacing:.5em;text-align:center;font-variant-numeric:tabular-nums;padding:12px 8px}
#slate-pin input{-webkit-user-select:text;user-select:text;touch-action:manipulation}
#slate-pin input:focus{outline:2px solid #000;outline-offset:0}
#slate-pin .ck{display:flex;gap:10px;align-items:center;font-size:14px;font-weight:500;color:#000}
#slate-pin .ck input{width:18px;height:18px;accent-color:#000}
#slate-pin .err{color:#FF3B30;font-size:13.5px;font-weight:500;min-height:18px}
#slate-pin .btns{display:grid;gap:8px}
#slate-pin button{font:inherit;font-size:15px;font-weight:600;border:0;border-radius:10px;padding:12px 16px;cursor:pointer;background:#E8E8EC;color:#000}
#slate-pin button.pri{background:#000;color:#fff}
#slate-pin button.lnk{background:none;padding:4px;font-weight:500;font-size:14px;color:#000;text-decoration:underline;text-decoration-color:#C7C7CC;text-underline-offset:3px;justify-self:center}
#slate-pin button[disabled]{opacity:.5}`;
function el(t, a, ...kids) {
  const e = document.createElement(t);
  Object.entries(a || {}).forEach(([k, v]) => { if (k === 'text') e.textContent = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v); });
  kids.flat().forEach(k => { if (k != null) e.append(k); });
  return e;
}
const LOCK_ICO = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';

function ask(opts) {
  return new Promise(resolve => {
    if (!document.getElementById('slate-pin-css')) document.head.append(el('style', { id: 'slate-pin-css', text: CSS }));
    const root = el('div', { id: 'slate-pin', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Business and Books PIN' });
    let mode = st && st.hasPin && !st.blocked ? 'enter' : 'set', busy = false;
    const done = ok => { root.remove(); document.documentElement.style.overflow = ''; resolve(ok); };
    const trustBox = () => (st && st.canTrust && isPhone()) ? el('label', { class: 'ck' }, el('input', { type: 'checkbox', id: 'pin-trust' }), 'Keep unlocked on this phone') : null;
    const trust = () => { const t = root.querySelector('#pin-trust'); return !!(t && t.checked); };
    const ok = r => {
      until = Date.parse(r.until); st = Object.assign({}, st, { unlocked: true, hasPin: true, trusted: !!r.trusted, until: r.until, lockedUntil: null }); sched();
      lastTouch = Date.now(); unlockCbs.forEach(f => { try { f(); } catch (e) { console.error(e); } }); done(true);
    };
    const why = r => ({ wrong: `Wrong PIN. ${r.left} ${r.left === 1 ? 'try' : 'tries'} left.`, locked: `Too many wrong tries. Try again after ${hhmm(r.lockedUntil)}.`,
      password: 'That password isn’t right.', easy: 'That PIN is too easy to guess. Choose another.', format: 'The PIN is 4 digits.',
      nopin: 'Set your PIN first.', reset: 'Too many wrong tries today. Set a new PIN with your password.', signin: 'Sign in again, then try.' }[r.why] || 'Couldn’t check the PIN. Try again.');
    function render() {
      const err = el('div', { class: 'err', 'aria-live': 'polite' });
      const fail = m => { err.textContent = m; busy = false; root.querySelectorAll('button').forEach(b => { b.disabled = false; }); };
      const go = async (fn, args) => {
        if (busy) return; busy = true; err.textContent = ''; root.querySelectorAll('button').forEach(b => { b.disabled = true; });
        try { const { data, error } = await client().rpc(fn, args); if (error) throw error; if (data && data.ok) ok(data); else { if (data && (data.why === 'nopin' || data.why === 'reset')) { if (data.why === 'reset') st = Object.assign({}, st, { blocked: true }); mode = 'set'; render(); return; } fail(why(data || {})); } }
        catch (e) { fail(/fetch|network/i.test(e.message || '') ? 'No connection. Try again.' : why({})); }
      };
      const cancel = el('button', { type: 'button', onclick: () => done(false), text: opts.cancelText || 'Back to Studio' });
      let body;
      if (mode === 'enter') {
        const pin = el('input', { type: 'password', class: 'pin', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'off', maxlength: '4', 'aria-label': 'PIN', placeholder: '••••' });
        const submit = () => { const v = pin.value.replace(/\D/g, ''); if (v.length !== 4) return fail('The PIN is 4 digits.'); go('pin_unlock', { p_pin: v, p_trust: trust() }); pin.value = ''; };
        pin.addEventListener('input', () => { pin.value = pin.value.replace(/\D/g, '').slice(0, 4); if (pin.value.length === 4) submit(); });
        pin.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
        body = [el('h2', { text: 'Enter your PIN' }),
          el('p', { text: st && st.lockedUntil ? `Too many wrong tries. Try again after ${hhmm(st.lockedUntil)}.` : 'Business and Books need your 4-digit PIN on this device. They lock again after 10 minutes without use.' }),
          pin, trustBox(), err,
          el('div', { class: 'btns' }, el('button', { type: 'button', class: 'pri', onclick: submit, text: 'Unlock' }), cancel,
            el('button', { type: 'button', class: 'lnk', onclick: () => { mode = 'set'; render(); }, text: 'Forgot your PIN? Set a new one' }))];
        tapFix(pin); focusLater(pin);
      } else {
        const pw = el('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'Your SLATE OS password' });
        const p1 = el('input', { type: 'password', class: 'pin', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'new-password', maxlength: '4', placeholder: '••••', 'aria-label': 'New PIN' });
        const p2 = el('input', { type: 'password', class: 'pin', inputmode: 'numeric', pattern: '[0-9]*', autocomplete: 'new-password', maxlength: '4', placeholder: '••••', 'aria-label': 'New PIN again' });
        [p1, p2].forEach(i => i.addEventListener('input', () => { i.value = i.value.replace(/\D/g, '').slice(0, 4); }));
        const submit = () => {
          if (!pw.value) return fail('Enter your SLATE OS password.');
          if (p1.value.length !== 4) return fail('The PIN is 4 digits.');
          if (p1.value !== p2.value) return fail('The two PINs are different.');
          go('pin_set', { p_password: pw.value, p_pin: p1.value, p_trust: trust() });
        };
        body = [el('h2', { text: st && st.hasPin ? 'Set a new PIN' : 'Set your PIN' }),
          el('p', { text: st && st.blocked ? 'Too many wrong PINs today, so Business and Books are closed until you set a new PIN. Enter your SLATE OS password to set it.' : 'Business and Books now need a 4-digit PIN as well as your sign-in, so they stay closed on a shared computer. Enter your SLATE OS password to set it.' }),
          el('label', {}, 'Your SLATE OS password', pw), el('label', {}, 'New PIN (4 digits)', p1), el('label', {}, 'New PIN again', p2), trustBox(), err,
          el('div', { class: 'btns' }, el('button', { type: 'button', class: 'pri', onclick: submit, text: 'Set PIN and open' }), cancel,
            st && st.hasPin && !st.blocked ? el('button', { type: 'button', class: 'lnk', onclick: () => { mode = 'enter'; render(); }, text: 'I know my PIN' }) : null)];
        [pw, p1, p2].forEach(tapFix); focusLater(pw);
      }
      const ico = el('div', { class: 'pl' }); ico.innerHTML = LOCK_ICO;
      root.replaceChildren(el('div', { class: 'pc' }, ico, ...body));
    }
    render();
    document.body.append(root); document.documentElement.style.overflow = 'hidden';
  });
}
})();
