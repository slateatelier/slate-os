/* SLATE OS · searchable project picker
   Every project drop-down in SLATE OS, Books and Finance opens a list with a search box instead of the
   phone's or browser's plain list. The page's own <select> stays where it is and keeps its value, look and
   change handlers: this file only replaces the list that opens from it, then sets the value and fires
   "change" as if the person had picked from the plain list.

   Which drop-downs: any <select> with data-pick (data-pick="off" leaves one plain), or one that is clearly a
   project picker: aria-label "Project…" (not "Project type"), an id ending in proj / project / projectId /
   pid / prj / defProj, or name="projectId". Account pickers too: Books marks every account list it builds
   (data-pick="account"), and aria-label "Account…", account/ledger ids and name="…accountId" are caught here.
   Search: every word typed must appear somewhere in the option (code, name, client, in any order). */
(function () {
  'use strict';
  if (window.__slatePick) return; window.__slatePick = true;

  const isProjSel = s => /(^|[-_])(proj|project|projectid|pid|prj|defproj)$/i.test(s.id || '') || (s.getAttribute('name') || '') === 'projectId';
  const isAccSel = s => s.getAttribute('data-pick') === 'account' || /^(account|head of account)\b/i.test(s.getAttribute('aria-label') || '')
    || /(^|[-_])(acc|acct|ledger|bankacc|cashacc|dedacc|accdep|pettyledger|floatledger|otherledger|jvpartner|tdsvendor)$/i.test(s.id || '') || /^sh-led-/.test(s.id || '')
    || /acc(oun)?tid$/i.test(s.getAttribute('name') || '');
  const isPick = s => {
    if (!s || s.tagName !== 'SELECT' || s.multiple || s.size > 1 || s.disabled) return false;
    const dp = s.getAttribute('data-pick');
    if (dp != null) return dp !== 'off';
    const al = s.getAttribute('aria-label') || '';
    if (/^project\b/i.test(al) && !/^project type/i.test(al)) return true;
    if (/(^|[-_])(proj|project|projectid|pid|prj|defproj)$/i.test(s.id || '')) return true;
    if ((s.getAttribute('name') || '') === 'projectId') return true;
    if (isAccSel(s)) return true;
    return false;
  };

  /* ---------- styles (use each page's own colours where it has them) ---------- */
  const css = `
.pk-back{position:fixed;inset:0;z-index:2147482999;background:transparent}
.pk{position:fixed;z-index:2147483000;display:flex;flex-direction:column;min-width:240px;max-width:min(560px,calc(100vw - 16px));
  background:var(--surface,var(--bg,#fff));color:var(--ink,#000);border:1px solid var(--line,rgba(60,60,67,.18));
  border-radius:var(--r,10px);box-shadow:0 12px 32px rgba(0,0,0,.16),0 2px 6px rgba(0,0,0,.08);overflow:hidden;font:inherit;font-size:14px}
.pk-top{display:flex;align-items:center;gap:6px;padding:8px;border-bottom:1px solid var(--line,rgba(60,60,67,.12))}
.pk-q{flex:1 1 auto;min-width:0;width:100%;font:inherit;font-size:15px;color:inherit;background:var(--group,rgba(118,118,128,.12));
  border:0;border-radius:calc(var(--r,10px) - 2px);padding:9px 11px 9px 32px;outline:none;-webkit-appearance:none;appearance:none;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%238E8E93' stroke-width='2.2' stroke-linecap='round'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E");
  background-repeat:no-repeat;background-position:10px 50%}
.pk-q:focus{box-shadow:0 0 0 2px var(--ink,#000) inset}
.pk-x{flex:none;border:0;background:none;color:var(--muted,#8E8E93);font:inherit;font-size:14px;padding:8px 6px;cursor:pointer}
.pk-list{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;padding:4px 0;margin:0;list-style:none}
.pk-g{padding:8px 12px 4px;font-size:11px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--muted,#8E8E93)}
.pk-o{display:flex;align-items:flex-start;gap:8px;padding:9px 12px;cursor:pointer;line-height:1.3;word-break:break-word}
.pk-o .pk-t{flex:1 1 auto;min-width:0}
.pk-o .pk-c{flex:none;width:16px;text-align:center;font-weight:700;opacity:0}
.pk-o[aria-selected="true"] .pk-c{opacity:1}
.pk-o.pk-on{background:var(--group,rgba(118,118,128,.12))}
.pk-o.pk-none{color:var(--muted,#8E8E93)}
.pk-o[aria-disabled="true"]{opacity:.45;cursor:default}
.pk-o mark{background:none;color:inherit;font-weight:700}
.pk-empty{padding:16px 12px;color:var(--muted,#8E8E93);text-align:center}
.pk-foot{padding:6px 12px;border-top:1px solid var(--line,rgba(60,60,67,.12));font-size:12px;color:var(--muted,#8E8E93)}
.pk.pk-sheet{left:8px!important;right:8px;width:auto!important;max-width:none;min-width:0}
.pk-back.pk-dim{background:rgba(0,0,0,.28)}
@media (max-width:820px){.pk-q{font-size:16px}.pk-o{padding:11px 12px}}
`;
  const addCss = () => { if (document.getElementById('pk-css')) return; const st = document.createElement('style'); st.id = 'pk-css'; st.textContent = css; (document.head || document.documentElement).appendChild(st); };

  /* ---------- search ---------- */
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = q => norm(q).split(/[\s·,/|()\-–—]+/).filter(Boolean);
  const matches = (text, ws) => { const t = norm(text); return ws.every(w => t.includes(w)); };
  function marked(text, ws) {                          // the option's text with the typed words in bold, built safely
    const frag = document.createDocumentFragment(); if (!ws.length) { frag.append(text); return frag; }
    const t = norm(text), hit = new Array(text.length).fill(false);
    if (t.length === text.length) ws.forEach(w => { let i = t.indexOf(w); while (i >= 0) { for (let k = i; k < i + w.length; k++) hit[k] = true; i = t.indexOf(w, i + w.length); } });
    let i = 0; while (i < text.length) { const on = hit[i]; let j = i; while (j < text.length && hit[j] === on) j++;
      const part = text.slice(i, j); if (on) { const m = document.createElement('mark'); m.textContent = part; frag.append(m); } else frag.append(part); i = j; }
    return frag;
  }

  /* ---------- the open list ---------- */
  let P = null;   // { sel, id, el, back, q, list, rows, on, ws }

  function items(sel) {
    const out = []; let g = null;
    for (const node of sel.children) {
      if (node.tagName === 'OPTGROUP') { const lbl = node.label || ''; for (const o of node.children) if (o.tagName === 'OPTION' && !o.hidden) out.push({ o, g: lbl }); }
      else if (node.tagName === 'OPTION' && !node.hidden) out.push({ o: node, g: null });
    }
    return out;
  }

  function build() {
    const { sel, list, ws } = P; list.textContent = '';
    const all = items(sel), cur = sel.options[sel.selectedIndex] || null; P.rows = [];
    const shown = all.filter(x => !ws.length || x.o.value === '' || matches(x.o.textContent + ' ' + (x.g || ''), ws) || matches(x.o.textContent, ws));
    const real = shown.filter(x => x.o.value !== '').length;
    let lastG = null;
    shown.forEach(x => {
      if (x.g && x.g !== lastG) { const gh = document.createElement('li'); gh.className = 'pk-g'; gh.setAttribute('role', 'presentation'); gh.textContent = x.g; list.append(gh); }
      lastG = x.g;
      const li = document.createElement('li'); li.className = 'pk-o' + (x.o.value === '' ? ' pk-none' : ''); li.setAttribute('role', 'option');
      li.id = 'pk-o-' + P.rows.length; li.setAttribute('aria-selected', x.o === cur ? 'true' : 'false');
      if (x.o.disabled) li.setAttribute('aria-disabled', 'true');
      const c = document.createElement('span'); c.className = 'pk-c'; c.textContent = '✓';
      const t = document.createElement('span'); t.className = 'pk-t'; t.append(marked(x.o.textContent, ws));
      li.append(c, t);
      const idx = P.rows.length;
      li.addEventListener('pointermove', () => { if (P && P.on !== idx) hl(idx, false); });
      li.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); choose(idx); });
      list.append(li); P.rows.push({ li, o: x.o });
    });
    if (ws.length && !real) { const e = document.createElement('li'); e.className = 'pk-empty'; e.setAttribute('role', 'presentation'); e.textContent = 'Nothing matches “' + P.q.value.trim() + '”'; list.append(e); }
    P.foot.textContent = ws.length ? `${real} of ${all.filter(x => x.o.value !== '').length} shown` : `${all.filter(x => x.o.value !== '').length} to choose from`;
    // highlight: the current choice when not searching, otherwise the first match that isn't the "none" line
    let start = -1;
    if (!ws.length) start = P.rows.findIndex(r => r.li.getAttribute('aria-selected') === 'true');
    if (start < 0) start = P.rows.findIndex(r => !r.o.disabled && (ws.length ? r.o.value !== '' : true));
    hl(start, true);
  }

  function hl(i, scroll) {
    if (!P) return; if (P.on >= 0 && P.rows[P.on]) P.rows[P.on].li.classList.remove('pk-on');
    P.on = i; const r = P.rows[i];
    if (r) { r.li.classList.add('pk-on'); P.q.setAttribute('aria-activedescendant', r.li.id); if (scroll) r.li.scrollIntoView({ block: 'nearest' }); }
    else P.q.removeAttribute('aria-activedescendant');
  }
  function move(d) {
    if (!P || !P.rows.length) return; let i = P.on;
    for (let n = 0; n < P.rows.length; n++) { i = (i + d + P.rows.length) % P.rows.length; if (!P.rows[i].o.disabled) break; }
    hl(i, true);
  }

  function choose(i) {
    if (!P) return; const r = P.rows[i]; if (!r || r.o.disabled) return;
    const sel = P.sel; close(true);
    if (!r.o.selected || !sel.contains(r.o)) {
      if (!sel.contains(r.o)) { const same = [...sel.options].find(o => o.value === r.o.value); if (!same) return; same.selected = true; } else r.o.selected = true;
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  const narrow = () => window.matchMedia('(max-width:640px)').matches;
  function place() {
    if (!P) return;
    if (!P.sel.isConnected) {                          // the page redrew itself: follow the new copy of the same drop-down
      const again = P.id && document.getElementById(P.id);
      if (again && again !== P.sel && isPick(again)) P.sel = again; else return close(false);
    }
    const vv = window.visualViewport, vh = vv ? vv.height : window.innerHeight, vt = vv ? vv.offsetTop : 0, vw = window.innerWidth;
    const el = P.el;
    if (narrow()) {                                    // phones: a panel across the screen, clear of the keyboard
      el.classList.add('pk-sheet'); P.back.classList.add('pk-dim');
      el.style.top = (vt + 12) + 'px'; el.style.bottom = 'auto'; el.style.maxHeight = Math.max(220, vh - 24) + 'px';
      P.list.style.maxHeight = 'none'; el.style.height = Math.max(220, Math.min(vh - 24, 560)) + 'px';
      return;
    }
    el.classList.remove('pk-sheet'); P.back.classList.remove('pk-dim'); el.style.height = '';
    const r = P.sel.getBoundingClientRect(), w = Math.min(Math.max(r.width, 300), 560, vw - 16);
    let left = Math.min(Math.max(8, r.left), vw - w - 8);
    const below = vt + vh - r.bottom - 8, above = r.top - vt - 8, want = 380;
    el.style.width = w + 'px'; el.style.left = left + 'px';
    if (below >= Math.min(want, 260) || below >= above) {
      el.style.top = (r.bottom + 4) + 'px'; el.style.bottom = 'auto'; el.style.maxHeight = Math.max(160, Math.min(want, below)) + 'px';
    } else {
      el.style.top = 'auto'; el.style.bottom = (window.innerHeight - r.top + 4) + 'px'; el.style.maxHeight = Math.max(160, Math.min(want, above)) + 'px';
    }
  }

  function open(sel, seed) {
    if (P) close(false); addCss();
    const back = document.createElement('div'); back.className = 'pk-back';
    const el = document.createElement('div'); el.className = 'pk'; el.setAttribute('role', 'dialog');
    const lbl = sel.getAttribute('aria-label') || (sel.closest('label') && (sel.closest('label').querySelector('.lbl') || {}).textContent) || 'Project';
    el.setAttribute('aria-label', 'Choose: ' + lbl.trim());
    const top = document.createElement('div'); top.className = 'pk-top';
    const q = document.createElement('input'); q.className = 'pk-q'; q.type = 'search'; q.autocomplete = 'off'; q.spellcheck = false;
    q.setAttribute('enterkeyhint', 'go'); q.setAttribute('role', 'combobox'); q.setAttribute('aria-expanded', 'true'); q.setAttribute('aria-autocomplete', 'list');
    q.placeholder = isAccSel(sel) ? 'Search accounts by name or group' : /project/i.test(lbl) || isProjSel(sel) ? 'Search by project code or name' : 'Type to search';
    const x = document.createElement('button'); x.type = 'button'; x.className = 'pk-x'; x.textContent = 'Cancel';
    const list = document.createElement('ul'); list.className = 'pk-list'; list.setAttribute('role', 'listbox'); list.id = 'pk-list'; q.setAttribute('aria-controls', 'pk-list');
    const foot = document.createElement('div'); foot.className = 'pk-foot';
    top.append(q, x); el.append(top, list, foot);
    el.style.display = 'flex'; list.style.flex = '1 1 auto';
    document.body.append(back, el);
    P = { sel, id: sel.id, el, back, q, list, foot, rows: [], on: -1, ws: [] };
    if (seed) { q.value = seed; P.ws = words(seed); }
    build(); place();

    q.addEventListener('input', () => { P.ws = words(q.value); build(); });
    q.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'PageDown') { e.preventDefault(); for (let k = 0; k < 8; k++) move(1); }
      else if (e.key === 'PageUp') { e.preventDefault(); for (let k = 0; k < 8; k++) move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); if (P.on >= 0) choose(P.on); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') { close(false); }
    });
    x.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); close(true); });
    back.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); });
    back.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); close(false); });   // on click, so the tap can't land on whatever is underneath
    el.addEventListener('pointerdown', e => e.stopPropagation());
    el.addEventListener('mousedown', e => { if (e.target !== q) e.preventDefault(); });   // keep the search box focused while picking
    const fq = () => { if (P && P.q === q) { try { q.focus({ preventScroll: true }); if (seed) q.setSelectionRange(seed.length, seed.length); } catch (e) {} } };
    fq(); setTimeout(fq, 0);   // focus at once too, so phones raise the keyboard from the same tap
  }

  function close(refocus) {
    if (!P) return; const { el, back, sel } = P; P = null;
    el.remove(); back.remove();
    if (refocus && sel.isConnected) { try { sel.focus({ preventScroll: true }); } catch (e) {} }
  }

  /* keep the panel beside its drop-down while the page scrolls or the keyboard opens */
  let raf = 0; const re = () => { if (P && !raf) raf = requestAnimationFrame(() => { raf = 0; place(); }); };
  window.addEventListener('resize', re); window.addEventListener('scroll', e => { if (P && !(P.el.contains(e.target))) re(); }, true);
  if (window.visualViewport) { visualViewport.addEventListener('resize', re); visualViewport.addEventListener('scroll', re); }
  new MutationObserver(() => { if (P && !P.sel.isConnected) re(); }).observe(document.documentElement, { childList: true, subtree: true });

  /* ---------- taking over the drop-downs (one set of listeners for the whole page) ---------- */
  let swallow = null, touch = null;   // swallow: the click that follows a mousedown/tap we already handled
  const target = e => { const t = e.target; return t && t.tagName === 'SELECT' && isPick(t) ? t : null; };

  document.addEventListener('mousedown', e => {        // mouse: stop the plain list and open the searchable one
    const s = target(e); if (!s || e.button !== 0) return;
    e.preventDefault(); swallow = { s, t: Date.now() };
    if (P && P.sel === s) close(true); else { try { s.focus({ preventScroll: true }); } catch (x) {} open(s); }
  }, true);
  document.addEventListener('touchstart', e => {
    const s = target(e); touch = s ? { s, x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false } : null;
  }, { capture: true, passive: true });
  document.addEventListener('touchmove', e => {
    if (!touch) return; const t = e.touches[0]; if (Math.abs(t.clientX - touch.x) > 10 || Math.abs(t.clientY - touch.y) > 10) touch.moved = true;
  }, { capture: true, passive: true });
  document.addEventListener('touchend', e => {         // phones: a tap opens the searchable list; a scroll over it does nothing
    const s = target(e); if (!s || !touch || touch.s !== s) { touch = null; return; }
    const moved = touch.moved; touch = null; e.preventDefault(); if (moved) return;
    swallow = { s, t: Date.now() }; open(s);
  }, { capture: true, passive: false });
  document.addEventListener('click', e => {             // a click on the drop-down's label text, or anything that got through
    let s = target(e);
    if (!s) { const l = e.target && e.target.closest && e.target.closest('label'); const c = l && l.control;
      if (c && c.tagName === 'SELECT' && isPick(c) && !(e.target.closest('input,select,textarea,button,a'))) s = c; }
    if (!s) return;
    if (swallow && swallow.s === s && Date.now() - swallow.t < 1000) { swallow = null; e.preventDefault(); return; }
    swallow = null;
    if (!P) { e.preventDefault(); open(s); }
  }, true);
  document.addEventListener('keydown', e => {           // keyboard: Enter, Space, arrows or typing a letter opens it
    const s = target(e); if (!s || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp' || k === 'F4' || (e.altKey && k === 'ArrowDown')) { e.preventDefault(); e.stopPropagation(); open(s); }
    else if (k.length === 1 && !e.altKey && /\S/.test(k)) { e.preventDefault(); e.stopPropagation(); open(s, k); }
  }, true);
  document.addEventListener('keydown', e => { if (P && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); } }, true);

  window.SLATEPick = { isPick, open: s => open(s), close: () => close(false) };
})();
