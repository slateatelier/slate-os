/* SLATE OS — Supabase connector
   Gives the original SLATE OS page the same `db` and `user` services it used as a
   Claude artifact (window.claude.use), backed by Supabase. Access rules live in the
   database; this file only moves documents and keeps the screen live. */
(function () {
  'use strict';
  // Installable app: register the service worker (home-screen launch, offline shell).
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  // An invite or password-reset link lands here with its type in the URL; read it before the client clears it.
  const LINK_TYPE = (/[#&?]type=(recovery|invite)\b/.exec(location.hash + location.search) || [])[1] || null;
  let needPassword = !!LINK_TYPE;
  const CFG = window.SLATE_CONFIG;
  const sb = window.supabase.createClient(CFG.url, CFG.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  window.slateSupabase = sb;

  /* ---------------- small utilities ---------------- */
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
  function deepMerge(a, b) {
    if (!isObj(a) || !isObj(b)) return clone(b);
    const out = { ...a };
    for (const k of Object.keys(b)) out[k] = (k in a) ? deepMerge(a[k], b[k]) : clone(b[k]);
    return out;
  }
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  function newId() {
    const r = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(r, x => ABC[x % ABC.length]).join('');
  }
  const parentOf = path => path.split('/').slice(0, -1).join('/');
  const lastOf = path => path.split('/').pop();
  function friendly(err) {
    const m = (err && (err.message || err.error_description || err.msg)) || String(err || 'Something went wrong');
    return new Error(m.replace(/^not-found:\s*/, 'Not found: '));
  }

  /* ---------------- local mirror of what this user may see ---------------- */
  const store = new Map();          // path -> data (documents)
  const people = new Map();         // id -> profile row
  const docSubs = new Map();        // path -> Set(callback)
  const collSubs = new Map();       // collection path -> Set(callback)
  let me = null;                    // my profile row
  let authUser = null;

  const PEOPLE_KEYS = ['roster', 'managers', 'approvers', 'privateIds', 'ownerId'];

  function ownerProfile() {
    for (const p of people.values()) if (p.designation === 'principal' && p.active) return p;
    return null;
  }
  function settingsData() {
    const base = store.get('config/settings');
    const owner = ownerProfile();
    if (!base && !owner) return null;
    const roster = {}, managers = [], approvers = [], privateIds = [];
    for (const p of people.values()) {
      const r = { team: p.team || '', role: p.role_label || '' };
      if (p.label) r.label = p.label;
      if (p.team_at) r.teamAt = p.team_at;
      roster[p.id] = r;
      if (p.is_manager || p.designation === 'pod_leader') managers.push(p.id);
      if (p.is_approver || p.designation === 'coo') approvers.push(p.id);
      if (p.is_private) privateIds.push(p.id);
    }
    return { target: 90, ...(base || {}), ownerId: owner ? owner.id : null, roster, managers, approvers, privateIds };
  }
  function membersDocs() {
    const out = [];
    for (const p of people.values()) {
      out.push([p.id, { icon: p.icon || null, iconAt: p.icon_at || null, joinedAt: p.created_at, active: p.active }]);
    }
    return out;
  }
  function readDoc(path) {
    if (path === 'config/settings') return settingsData();
    const seg = path.split('/');
    if (seg[0] === 'members' && seg.length === 2) {
      const p = people.get(seg[1]);
      return p ? { icon: p.icon || null, iconAt: p.icon_at || null, joinedAt: p.created_at, active: p.active } : null;
    }
    const d = store.get(path);
    return d === undefined ? null : d;
  }
  function readColl(collPath) {
    if (collPath === 'members') return membersDocs();
    const pre = collPath + '/', depth = collPath.split('/').length + 1, out = [];
    for (const [path, data] of store) {
      if (path.startsWith(pre) && path.split('/').length === depth) out.push([lastOf(path), data]);
    }
    return out;
  }

  /* ---------------- snapshots ---------------- */
  function docSnap(path) {
    const d = readDoc(path);
    return { id: lastOf(path), ref: docRef(path), exists: d !== null, data: () => clone(d) || undefined };
  }
  function collSnap(collPath) {
    const docs = readColl(collPath).map(([id, d]) => ({ id, ref: docRef(collPath + '/' + id), exists: true, data: () => clone(d) }));
    return { docs, size: docs.length, empty: !docs.length, forEach: fn => docs.forEach(fn) };
  }

  /* ---------------- change notification (batched) ---------------- */
  const dirty = new Set(); let flushQueued = false;
  function touch(path) { dirty.add(path); if (!flushQueued) { flushQueued = true; queueMicrotask(flush); } }
  function touchPeople() { touch('config/settings'); touch('members/*'); }
  function flush() {
    flushQueued = false;
    const paths = [...dirty]; dirty.clear();
    const colls = new Set();
    for (const p of paths) {
      if (p === 'members/*') { colls.add('members'); for (const k of docSubs.keys()) if (k.startsWith('members/')) fire(docSubs, k, docSnap(k)); continue; }
      fire(docSubs, p, docSnap(p));
      colls.add(parentOf(p));
    }
    for (const c of colls) fire(collSubs, c, collSnap(c));
  }
  function fire(map, key, snap) {
    const set = map.get(key); if (!set) return;
    for (const cb of [...set]) { try { cb(snap); } catch (e) { console.error(e); } }
  }
  function subscribe(map, key, cb, snapFn) {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(cb);
    queueMicrotask(() => { if (map.get(key) && map.get(key).has(cb)) { try { cb(snapFn()); } catch (e) { console.error(e); } } });
    return () => { const s = map.get(key); if (s) { s.delete(cb); if (!s.size) map.delete(key); } };
  }

  /* ---------------- loading and live updates ---------------- */
  async function loadAll() {
    const docs = new Map();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('docs').select('path,data').order('path').range(from, from + 999);
      if (error) throw friendly(error);
      data.forEach(r => docs.set(r.path, r.data));
      if (data.length < 1000) break;
    }
    const { data: ppl, error: pe } = await sb.from('profiles').select('*');
    if (pe) throw friendly(pe);
    // diff so only what changed re-renders
    for (const [p, d] of docs) if (JSON.stringify(store.get(p)) !== JSON.stringify(d)) { store.set(p, d); touch(p); }
    for (const p of [...store.keys()]) if (!docs.has(p)) { store.delete(p); touch(p); }
    let peopleChanged = people.size !== ppl.length;
    for (const r of ppl) { if (JSON.stringify(people.get(r.id)) !== JSON.stringify(r)) peopleChanged = true; people.set(r.id, r); }
    for (const id of [...people.keys()]) if (!ppl.some(r => r.id === id)) { people.delete(id); peopleChanged = true; }
    me = people.get(authUser.id) || null;
    if (peopleChanged) touchPeople();
  }
  let channel = null;
  function goLive() {
    channel = sb.channel('slate-os-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, ev => {
        if (ev.eventType === 'DELETE') { const p = ev.old && ev.old.path; if (p && store.delete(p)) touch(p); return; }
        const r = ev.new; if (!r || !r.path) return;
        store.set(r.path, r.data); touch(r.path);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, ev => {
        if (ev.eventType === 'DELETE') { if (ev.old && ev.old.id) people.delete(ev.old.id); }
        else if (ev.new && ev.new.id) { people.set(ev.new.id, ev.new); if (authUser && ev.new.id === authUser.id) me = ev.new; }
        touchPeople();
      })
      .subscribe();
    // Visibility can change without a row changing (a new pod, a new project lead), so resync regularly.
    setInterval(() => { if (document.visibilityState === 'visible') loadAll().catch(() => {}); }, 120000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadAll().catch(() => {}); });
  }

  /* ---------------- writes ---------------- */
  async function rpcWrite(path, data, mode) {
    const { error } = await sb.rpc('doc_write', { p_path: path, p_data: clone(data) || {}, p_mode: mode });
    if (error) throw friendly(error);
    const cur = store.get(path);
    store.set(path, mode === 'set' ? clone(data) : deepMerge(cur || {}, data));
    touch(path);
    // The database fills some fields itself (project codes); show its version straight away.
    if (/^projects\/[^/]+$/.test(path)) {
      const { data: row } = await sb.from('docs').select('data').eq('path', path).maybeSingle();
      if (row) { store.set(path, row.data); touch(path); }
    }
  }
  async function writeSettings(data) {
    const peoplePart = {}, rest = {};
    for (const [k, v] of Object.entries(data || {})) (PEOPLE_KEYS.includes(k) ? peoplePart : rest)[k] = v;
    delete peoplePart.ownerId;
    if (Object.keys(peoplePart).length) {
      const { error } = await sb.rpc('apply_roster', { p_patch: clone(peoplePart) });
      if (error) throw friendly(error);
      await loadAll();
    }
    if (Object.keys(rest).length) await rpcWrite('config/settings', rest, 'merge');
  }
  async function writeMember(id, patch) {
    const upd = {};
    if ('icon' in patch) upd.icon = patch.icon;
    if ('iconAt' in patch) upd.icon_at = patch.iconAt;
    if (!Object.keys(upd).length) return;
    const { error } = await sb.from('profiles').update(upd).eq('id', id);
    if (error) throw friendly(error);
    const p = people.get(id); if (p) { people.set(id, { ...p, ...upd }); touchPeople(); }
  }

  function docRef(path) {
    const seg = path.split('/');
    const isSettings = path === 'config/settings', isMember = seg[0] === 'members' && seg.length === 2;
    return {
      id: lastOf(path), path,
      async get() { return docSnap(path); },
      async set(data, opts) {
        if (isSettings) return writeSettings(data);
        if (isMember) return writeMember(seg[1], data || {});
        return rpcWrite(path, data, opts && opts.merge ? 'merge' : 'set');
      },
      async update(patch) {
        if (isSettings) return writeSettings(patch);
        if (isMember) return writeMember(seg[1], patch || {});
        return rpcWrite(path, patch, 'update');
      },
      async delete() {
        const { error } = await sb.from('docs').delete().eq('path', path);
        if (error) throw friendly(error);
        if (store.delete(path)) touch(path);
      },
      onSnapshot(cb, onErr) { return subscribe(docSubs, path, cb, () => docSnap(path)); },
      collection(sub) { return collRef(path + '/' + sub); }
    };
  }
  function collRef(path) {
    return {
      id: lastOf(path), path,
      doc(id) { return docRef(path + '/' + (id || newId())); },
      async add(data) { const ref = docRef(path + '/' + newId()); await ref.set(data); return ref; },
      async get() { return collSnap(path); },
      onSnapshot(cb, onErr) { return subscribe(collSubs, path, cb, () => collSnap(path)); }
    };
  }

  const db = { doc: docRef, collection: collRef };

  const displayName = p => (p && (p.label || p.full_name || (p.email || '').split('@')[0])) || 'Team member';
  const user = {
    async me() {
      return me ? { id: me.id, name: displayName(me), email: me.email, isOwner: me.designation === 'principal' && me.active }
                : { id: authUser ? authUser.id : null, name: authUser && authUser.email, isOwner: false };
    },
    async can(what) { return what === 'data.write' ? !!(me && me.active) : true; },
    async profiles(ids) {
      const out = {};
      for (const id of ids || []) { const p = people.get(id); if (p) out[id] = { id, name: displayName(p) }; }
      return out;
    }
  };


  /* ---------------- notifications: push to this device + the number on the app icon ---------------- */
  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const urlB64 = s => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); };
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} } };

  function notifStatus() {
    if (!pushSupported()) return isIOS() && !isStandalone() ? 'install-first' : 'unsupported';
    if (isIOS() && !isStandalone()) return 'install-first';
    return Notification.permission;                    // 'default' | 'granted' | 'denied'
  }
  async function enableNotifications() {
    if (notifStatus() === 'install-first') throw new Error('On iPhone, add SLATE OS to your Home Screen first, then open it from there.');
    if (!pushSupported()) throw new Error('This browser can’t receive notifications.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? 'Notifications are blocked for SLATE OS. Allow them in your phone or browser settings.' : 'Notifications were not turned on.');
    const { data: key, error } = await sb.rpc('push_public_key');
    if (error || !key) throw new Error('The notification service isn’t ready. Try again shortly.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64(key) });
    const j = sub.toJSON();
    const { error: e2 } = await sb.from('push_subs').upsert({ endpoint: j.endpoint, user_id: authUser.id, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' });
    if (e2) throw friendly(e2);
    ls.set('slate-notif-asked', '1');
    return 'granted';
  }
  // Keep this device's subscription saved (it can change after a browser update).
  async function refreshSubscription() {
    if (notifStatus() !== 'granted') return;
    try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription();
      if (!sub) return enableNotifications(); const j = sub.toJSON();
      await sb.from('push_subs').upsert({ endpoint: j.endpoint, user_id: authUser.id, p256dh: j.keys.p256dh, auth: j.keys.auth, ua: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' });
    } catch (_) {}
  }
  // The icon number: while the app is open it mirrors the bell; opening the app marks pushes as seen.
  function syncBadge() {
    if (document.visibilityState !== 'visible') return;
    let n = 0; try { n = typeof window.newCount === 'function' ? Number(window.newCount()) || 0 : 0; } catch (_) {}
    try { if ('setAppBadge' in navigator) (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch (_) {}
  }
  function markSeen() { if (document.visibilityState === 'visible') sb.rpc('notifications_seen').then(() => {}, () => {}); }
  function notifBanner() {
    const st = notifStatus();
    if (ls.get('slate-notif-asked') || !(st === 'default' || st === 'install-first')) return;
    const place = () => {
      const main = document.querySelector('main'); if (!main || document.getElementById('slate-notif-banner')) return;
      const msg = st === 'install-first' ? 'Get notifications on this iPhone: tap Share → Add to Home Screen, then open SLATE OS from the icon.' : 'Get notified about tasks and approvals, even when SLATE OS is closed.';
      const on = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Turn on');
      const later = el('button', { class: 'btn btn-sm', type: 'button', style: 'background:#fff' }, 'Not now');
      const b = el('div', { id: 'slate-notif-banner', class: 'banner' }, el('span', {}, msg), el('div', { class: 'actions' }, ...(st === 'default' ? [on] : []), later));
      on.addEventListener('click', async () => { on.disabled = true; try { await enableNotifications(); b.remove(); } catch (e) { on.disabled = false; alertMsg(b, e.message); } });
      later.addEventListener('click', () => { ls.set('slate-notif-asked', '1'); b.remove(); });
      main.prepend(b);
    };
    new MutationObserver(place).observe(document.body, { childList: true, subtree: true }); place();
  }
  function alertMsg(box, text) { let m = box.querySelector('.slate-err'); if (!m) { m = el('div', { class: 'slate-err', style: 'color:#ff3b30;font-size:13px;width:100%' }); box.append(m); } m.textContent = text; }
  function setupNotifications() {
    window.slateNotif = { status: notifStatus, enable: enableNotifications };
    refreshSubscription(); markSeen(); syncBadge(); notifBanner();
    document.addEventListener('visibilitychange', () => { markSeen(); syncBadge(); });
    setInterval(syncBadge, 4000);
  }

  /* ---------------- sign-in gate ---------------- */
  const CSS = `
  .slate-sheet{position:fixed;inset:0;z-index:1000;background:#fff;display:grid;place-items:center;
    font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#000;padding:16px}
  .slate-sheet .box{width:min(360px,100%);display:grid;gap:14px}
  .slate-sheet .brand{text-align:center;margin-bottom:6px}
  .slate-sheet .brand b{display:block;font-family:Futura,"Futura PT","Century Gothic",sans-serif;font-size:26px;letter-spacing:.14em;font-weight:600}
  .slate-sheet .brand i{display:block;width:30px;height:3px;background:#d7262b;margin:12px auto}
  .slate-sheet .brand span{font-size:12px;color:#8e8e93;letter-spacing:.04em}
  .slate-sheet label{display:grid;gap:6px;font-size:12px;font-weight:600;color:#8e8e93}
  .slate-sheet input{font:inherit;font-size:16px;background:#f2f2f7;border:0;border-radius:10px;padding:12px 14px;color:#000}
  .slate-sheet input:focus{outline:2px solid #000}
  .slate-sheet button{font:inherit;font-size:15px;font-weight:600;border:0;border-radius:10px;padding:12px 16px;cursor:pointer}
  .slate-sheet .primary{background:#000;color:#fff}
  .slate-sheet .link{background:none;color:#000;padding:4px;font-weight:500;text-decoration:underline;text-decoration-color:#c7c7cc;text-underline-offset:3px}
  .slate-sheet .row{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap}
  .slate-sheet .msg{font-size:13.5px;min-height:18px}
  .slate-sheet .msg.err{color:#ff3b30}
  .slate-sheet button[disabled]{opacity:.5}
  #slate-acct{position:absolute;top:calc(10px + env(safe-area-inset-top,0px));right:max(12px,env(safe-area-inset-right,0px));z-index:6;
    font:500 12.5px -apple-system,BlinkMacSystemFont,sans-serif;background:#f2f2f7;color:#000;border:0;border-radius:999px;padding:6px 12px;cursor:pointer}
  @media (max-width:560px){#slate-acct{top:auto;bottom:calc(14px + env(safe-area-inset-bottom,0px));position:fixed}}`;

  function addCss() { if (!document.getElementById('slate-css')) document.head.append(el('style', { id: 'slate-css' }, CSS)); }
  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) { if (k === 'on') for (const [e, f] of Object.entries(v)) n.addEventListener(e, f); else if (v != null) n.setAttribute(k, v); }
    for (const c of kids) n.append(c);
    return n;
  }
  function authScreen(mode, onDone) {
    let root = document.getElementById('slate-auth');
    if (!root) { addCss(); root = el('div', { id: 'slate-auth', class: 'slate-sheet', role: 'dialog', 'aria-label': 'Sign in to SLATE OS' }); document.body.append(root); }
    root.innerHTML = '';
    const msg = el('div', { class: 'msg', role: 'status' });
    const say = (t, err) => { msg.textContent = t || ''; msg.className = 'msg' + (err ? ' err' : ''); };
    const brand = el('div', { class: 'brand' }, el('b', {}, 'SLATE OS'), el('i', {}), el('span', {}, 'Design with purpose'));
    const box = el('form', { class: 'box', novalidate: '' });
    if (mode === 'recovery') {
      const pw = el('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: '' });
      const go = el('button', { class: 'primary', type: 'submit' }, 'Set password and continue');
      box.append(brand, el('label', {}, 'New password (8+ characters)', pw), go, msg);
      box.addEventListener('submit', async e => {
        e.preventDefault(); if (pw.value.length < 8) return say('Use at least 8 characters.', true);
        go.disabled = true; say('Saving…');
        const { error } = await sb.auth.updateUser({ password: pw.value });
        go.disabled = false; if (error) return say(friendly(error).message, true);
        onDone();
      });
      root.append(box); pw.focus(); return root;
    }
    const email = el('input', { type: 'email', autocomplete: 'username', required: '', inputmode: 'email' });
    const pw = el('input', { type: 'password', autocomplete: 'current-password', required: '' });
    const go = el('button', { class: 'primary', type: 'submit' }, 'Sign in');
    const magic = el('button', { class: 'link', type: 'button' }, 'Email me a sign-in link');
    const forgot = el('button', { class: 'link', type: 'button' }, 'Forgot password?');
    box.append(brand, el('label', {}, 'Studio email', email), el('label', {}, 'Password', pw), go, el('div', { class: 'row' }, magic, forgot), msg);
    box.addEventListener('submit', async e => {
      e.preventDefault(); if (!email.value || !pw.value) return say('Enter your email and password.', true);
      go.disabled = true; say('Signing in…');
      const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
      go.disabled = false; if (error) return say(error.message === 'Invalid login credentials' ? 'That email and password don’t match.' : friendly(error).message, true);
    });
    magic.addEventListener('click', async () => {
      if (!email.value) return say('Enter your studio email first.', true);
      say('Sending…');
      const { error } = await sb.auth.signInWithOtp({ email: email.value.trim(), options: { shouldCreateUser: false, emailRedirectTo: location.origin } });
      say(error ? friendly(error).message : 'Check your inbox for the sign-in link.', !!error);
    });
    forgot.addEventListener('click', async () => {
      if (!email.value) return say('Enter your studio email first.', true);
      say('Sending…');
      const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin });
      say(error ? friendly(error).message : 'If that address has an account, a reset link is on its way.', !!error);
    });
    root.append(box); email.focus(); return root;
  }
  function hideAuth() { const r = document.getElementById('slate-auth'); if (r) r.remove(); }

  function notifRow() {
    const st = notifStatus();
    const text = { granted: 'Notifications are on for this device.', denied: 'Notifications are blocked. Allow them for SLATE OS in your phone or browser settings.',
      'install-first': 'On iPhone, add SLATE OS to your Home Screen (Share → Add to Home Screen), then open it from the icon to turn on notifications.',
      unsupported: 'This browser can’t receive notifications.', default: 'Get notified about tasks and approvals, even when SLATE OS is closed.' }[st];
    const box = el('div', { style: 'display:grid;gap:8px;background:#f2f2f7;border-radius:10px;padding:12px 14px;font-size:14px' },
      el('b', {}, 'Notifications'), el('span', { style: 'color:#3c3c43' }, text));
    if (st === 'default') {
      const b = el('button', { class: 'primary', type: 'button' }, 'Turn on notifications');
      b.addEventListener('click', async () => { b.disabled = true; try { await enableNotifications(); box.replaceWith(notifRow()); } catch (e) { b.disabled = false; alertMsg(box, e.message); } });
      box.append(b);
    }
    return box;
  }
  function accountPanel() {
    if (document.getElementById('slate-acct-panel')) return;
    const msg = el('div', { class: 'msg', role: 'status' });
    const say = (t, err) => { msg.textContent = t || ''; msg.className = 'msg' + (err ? ' err' : ''); };
    const pw1 = el('input', { type: 'password', autocomplete: 'new-password', minlength: '8' });
    const pw2 = el('input', { type: 'password', autocomplete: 'new-password', minlength: '8' });
    const save = el('button', { class: 'primary', type: 'submit' }, 'Change password');
    const out = el('button', { class: 'link', type: 'button' }, 'Sign out');
    const close = el('button', { class: 'link', type: 'button' }, 'Close');
    const form = el('form', { class: 'box', novalidate: '' },
      el('div', { class: 'brand' }, el('b', {}, 'Account'), el('i', {}), el('span', {}, authUser ? authUser.email : '')),
      notifRow(),
      el('label', {}, 'New password (8+ characters)', pw1), el('label', {}, 'Type it again', pw2), save,
      el('div', { class: 'row' }, out, close), msg);
    const root = el('div', { id: 'slate-acct-panel', class: 'slate-sheet', role: 'dialog', 'aria-label': 'Account' }, form);
    document.body.append(root);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (pw1.value.length < 8) return say('Use at least 8 characters.', true);
      if (pw1.value !== pw2.value) return say('The two passwords don’t match.', true);
      save.disabled = true; say('Saving…');
      const { error } = await sb.auth.updateUser({ password: pw1.value });
      save.disabled = false;
      if (error) return say(friendly(error).message, true);
      pw1.value = pw2.value = ''; say('Password changed. Use it next time you sign in.');
    });
    out.addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    close.addEventListener('click', () => root.remove());
    pw1.focus();
  }
  function accountButton() {
    addCss();
    const place = () => {
      const chrome = document.querySelector('.chrome');
      if (!chrome || chrome.querySelector('#slate-acct')) return;
      const b = el('button', { id: 'slate-acct', type: 'button', title: 'Signed in as ' + (authUser && authUser.email) }, 'Account');
      b.addEventListener('click', accountPanel);
      chrome.append(b);
    };
    new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
    place();
  }

  let resolveReady;
  const ready = new Promise(r => { resolveReady = r; });
  let started = false;
  async function start(session) {
    if (started) return; started = true;
    authUser = session.user;
    try { await loadAll(); } catch (e) { started = false; authScreen('signin'); return; }
    hideAuth(); goLive(); addCss(); window.slateAccount = accountPanel;
    setupNotifications();
    // Dashboard averages: anonymous score inputs for tasks this person can't see.
    window.slateDashRows = async (from, to) => {
      const { data, error } = await sb.rpc('dash_rows', { p_from: from, p_to: to });
      if (error) throw friendly(error);
      return data || [];
    };
    resolveReady({ db, user });
  }

  const whenBody = fn => document.body ? fn() : document.addEventListener('DOMContentLoaded', fn);
  function askPassword(session) {
    whenBody(() => authScreen('recovery', () => { needPassword = false; history.replaceState(null, '', location.pathname); start(session); }));
  }
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') { location.reload(); return; }
    if (!session) return;
    if (event === 'PASSWORD_RECOVERY' || needPassword) { needPassword = true; askPassword(session); return; }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') start(session);
  });
  (async () => {
    const { data } = await sb.auth.getSession();
    if (data.session) { if (needPassword) askPassword(data.session); else start(data.session); }
    else if (!LINK_TYPE) whenBody(() => { if (!started) authScreen('signin'); });
    else setTimeout(() => { if (!started && !document.getElementById('slate-auth')) whenBody(() => authScreen('signin')); }, 4000);
  })();

  // The page asks for its services exactly as it did inside the artifact.
  window.claude = { use: async name => { const s = await ready; return s[name] || null; } };
})();
