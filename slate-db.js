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
  // Chrome / Edge / Samsung offer an install prompt; keep it for our own button.
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; try { window.dispatchEvent(new Event('slate-installable')); } catch (_) {} });
  window.addEventListener('appinstalled', () => { installEvt = null; try { localStorage.setItem('slate-installed', '1'); } catch (_) {}
    const b = document.getElementById('slate-install-banner'); if (b) b.remove(); });
  const CFG = window.SLATE_CONFIG;
  // "Keep me signed in": ticked (default) keeps the session on this device; unticked ends it when the app is closed.
  const remember = () => { try { return localStorage.getItem('slate-remember') !== '0'; } catch (_) { return true; } };
  const safe = s => ({ getItem: k => { try { return s.getItem(k); } catch (_) { return null; } },
                       setItem: (k, v) => { try { s.setItem(k, v); } catch (_) {} }, removeItem: k => { try { s.removeItem(k); } catch (_) {} } });
  const L_ = safe(window.localStorage), S_ = safe(window.sessionStorage);
  const authStore = {
    getItem: k => (remember() ? L_.getItem(k) : null) || S_.getItem(k),
    setItem: (k, v) => { if (remember()) { L_.setItem(k, v); S_.removeItem(k); } else { S_.setItem(k, v); L_.removeItem(k); } },
    removeItem: k => { L_.removeItem(k); S_.removeItem(k); }
  };
  /* Session lock kept inside this page. A lock shared across pages let a frozen page (iPhone Safari's
     back/forward cache) hold up the next one. Supabase accepts two pages refreshing at the same moment. */
  const sessionLock = (() => { let tail = Promise.resolve();
    return (_name, _t, fn) => { const run = tail.then(() => fn()); tail = run.catch(() => {}); return run; }; })();
  /* No call waits for ever on a weak signal: a save gives up after 15 seconds, a load after 30,
     so the app never stays locked and the person is told to try again. */
  const TIMEOUT_MSG = 'Not saved: the connection is too slow. Check your signal and try again.';
  const timedFetch = (input, init = {}) => {
    const method = String(init.method || (input && input.method) || 'GET').toUpperCase();
    const ms = method === 'GET' || method === 'HEAD' ? 30000 : 15000;
    const ctl = new AbortController(), outer = init.signal;
    if (outer) { if (outer.aborted) ctl.abort(); else outer.addEventListener('abort', () => ctl.abort(), { once: true }); }
    let timedOut = false;
    const t = setTimeout(() => { timedOut = true; ctl.abort(); }, ms);
    return fetch(input, { ...init, signal: ctl.signal })
      .catch(e => { throw timedOut ? new Error(method === 'GET' ? 'The connection is too slow to load SLATE OS right now. Try again in a moment.' : TIMEOUT_MSG) : e; })
      .finally(() => clearTimeout(t));
  };
  const sb = window.supabase.createClient(CFG.url, CFG.key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storage: authStore, lock: sessionLock },
    global: { fetch: timedFetch }
  });
  addEventListener('pagehide', () => { try { sb.auth.stopAutoRefresh(); } catch (_) {} });
  addEventListener('pageshow', () => { try { sb.auth.startAutoRefresh(); } catch (_) {} });
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
    let m = (err && (err.message || err.error_description || err.msg)) || String(err || 'Something went wrong');
    m = m.replace(/^(?:\w*Error:\s*)+/, '');
    if (/^(Failed to fetch|NetworkError|Load failed|network error)/i.test(m)) m = 'No connection, so this wasn’t saved. Check your signal and try again.';
    // a pod leader acting outside their pod's projects
    if (/Only the pod leader or COO (edits|reassigns) this task/.test(m)) m = 'You can change this only on your own pod’s projects. Ask the project’s pod leader or the COO.';
    return new Error(m.replace(/^not-found:\s*/, 'Not found: '));
  }

  /* ---------------- local mirror of what this user may see ---------------- */
  const store = new Map();          // path -> data (documents)
  const people = new Map();         // id -> profile row
  const docSubs = new Map();        // path -> Set(callback)
  const collSubs = new Map();       // collection path -> Set(callback)
  let me = null;                    // my profile row
  let authUser = null;

  const PEOPLE_KEYS = ['roster', 'managers', 'approvers', 'privateIds', 'chalkLeads', 'ownerId'];

  function ownerProfile() {
    for (const p of people.values()) if (p.designation === 'principal' && p.active) return p;
    return null;
  }
  function settingsData() {
    const base = store.get('config/settings');
    const owner = ownerProfile();
    if (!base && !owner) return null;
    const roster = {}, managers = [], approvers = [], privateIds = [], chalkLeads = [];
    for (const p of people.values()) {
      const r = { team: p.team || '', role: p.role_label || '' };
      if (p.label) r.label = p.label;
      if (p.team_at) r.teamAt = p.team_at;
      roster[p.id] = r;
      if (p.is_manager || p.designation === 'pod_leader') managers.push(p.id);
      if (p.is_approver || p.designation === 'coo') approvers.push(p.id);
      if (p.is_private) privateIds.push(p.id);
      if (p.is_chalk_lead) chalkLeads.push(p.id);
    }
    return { target: 90, ...(base || {}), ownerId: owner ? owner.id : null, roster, managers, approvers, privateIds, chalkLeads };
  }
  function membersDocs() {
    const out = [];
    for (const p of people.values()) {
      out.push([p.id, { icon: p.icon || null, iconAt: p.icon_at || null, joinedAt: p.created_at, active: p.active, leftOn: p.left_on || null }]);
    }
    return out;
  }
  // Agreement details live in agreements/<id>, readable only by the Principal and the COO; show them on the project for them.
  function withAgreement(path, d) {
    if (!d || !/^projects\/[^/]+$/.test(path)) return d;
    const a = store.get('agreements/' + lastOf(path));
    return a ? { ...d, ...a } : d;
  }
  function readDoc(path) {
    if (path === 'config/settings') return settingsData();
    const seg = path.split('/');
    if (seg[0] === 'members' && seg.length === 2) {
      const p = people.get(seg[1]);
      return p ? { icon: p.icon || null, iconAt: p.icon_at || null, joinedAt: p.created_at, active: p.active } : null;
    }
    const d = store.get(path);
    return d === undefined ? null : withAgreement(path, d);
  }
  function readColl(collPath) {
    if (collPath === 'members') return membersDocs();
    const pre = collPath + '/', depth = collPath.split('/').length + 1, out = [];
    for (const [path, data] of store) {
      if (path.startsWith(pre) && path.split('/').length === depth) out.push([lastOf(path), withAgreement(path, data)]);
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
  function touch(path) { dirty.add(path); if (path.startsWith('agreements/')) dirty.add('projects/' + lastOf(path)); if (!flushQueued) { flushQueued = true; queueMicrotask(flush); } }
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
      const ag = 'agreements/' + lastOf(path);
      const { data: arow } = await sb.from('docs').select('data').eq('path', ag).maybeSingle();
      if (arow) { store.set(ag, arow.data); touch(ag); }
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
    n += myMessages.length;
    try { if ('setAppBadge' in navigator) (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch (_) {}
  }
  function markSeen() { if (document.visibilityState === 'visible') sb.rpc('notifications_seen').then(() => {}, () => {}); }
  function notifBanner() {
    const st = notifStatus();
    if (ls.get('slate-notif-asked') || st !== 'default') return;          // iPhone not yet installed: the install banner covers it
    let done = false;
    const place = () => {
      if (done || ls.get('slate-notif-asked') || notifStatus() !== 'default') return;
      const main = document.querySelector('main'); if (!main || document.getElementById('slate-notif-banner')) return;
      const msg = st === 'install-first' ? 'Get notifications on this iPhone: tap Share → Add to Home Screen, then open SLATE OS from the icon.' : 'Get notified about tasks and approvals, even when SLATE OS is closed.';
      const on = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Turn on');
      const later = el('button', { class: 'btn btn-sm', type: 'button', style: 'background:#fff' }, 'Not now');
      const b = el('div', { id: 'slate-notif-banner', class: 'banner' }, el('span', {}, msg), el('div', { class: 'actions' }, ...(st === 'default' ? [on] : []), later));
      on.addEventListener('click', async () => { on.disabled = true; try { await enableNotifications(); done = true; b.remove(); } catch (e) { on.disabled = false; alertMsg(b, e.message); } });
      later.addEventListener('click', () => { done = true; ls.set('slate-notif-asked', '1'); b.remove(); });
      main.prepend(b);
    };
    new MutationObserver(place).observe(document.body, { childList: true, subtree: true }); place();
  }
  function alertMsg(box, text) { let m = box.querySelector('.slate-err'); if (!m) { m = el('div', { class: 'slate-err', style: 'color:#ff3b30;font-size:13px;width:100%' }); box.append(m); } m.textContent = text; }
  function setupNotifications() {
    window.slateNotif = { status: notifStatus, enable: enableNotifications };
    refreshSubscription(); markSeen(); syncBadge(); notifBanner(); installBanner();
    document.addEventListener('visibilitychange', () => { markSeen(); syncBadge(); });
    setInterval(syncBadge, 4000);
  }


  /* ---------------- who is online, away or last seen (Home and People) ----------------
     Online: SLATE OS is open on screen. Away: still open but minimised or in the background (stays
     connected on a computer; phones usually suspend the app, so it then shows "last seen").
     A heartbeat records when each person last had SLATE OS open. */
  let onlineIds = [], awayIds = [], seenMap = new Map();
  const seenOf = id => {
    if (onlineIds.includes(id)) return { st: 'on', label: 'Online' };
    if (awayIds.includes(id)) return { st: 'away', label: 'Away · app open' };
    const r = seenMap.get(id); if (!r) return { st: 'off', label: 'Not signed in yet' };
    return { st: 'off', label: 'Last seen ' + ago(r.seen_at), at: r.seen_at };
  };
  window.slateSeen = seenOf;
  function ago(t) {
    const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
    if (s < 90) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    if (s < 7 * 86400) { const d = Math.round(s / 86400); return d === 1 ? 'yesterday' : d + ' days ago'; }
    return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
  }
  async function loadSeen() {
    const { data } = await sb.from('presence_seen').select('user_id,seen_at,active_at');
    if (data) { seenMap = new Map(data.map(r => [r.user_id, r])); placeOnline(true); try { if (S.view === 'people') render(true); } catch (_) {} }
  }
  function setupPresence(session) {
    try { if (session && session.access_token && sb.realtime && sb.realtime.setAuth) sb.realtime.setAuth(session.access_token); } catch (_) {}
    const ch = sb.channel('slate:presence', { config: { private: true, presence: { key: authUser.id } } });
    const vis = () => document.visibilityState === 'visible';
    const track = () => { ch.track({ at: Date.now(), st: vis() ? 'on' : 'away' }).catch(() => {}); };
    const beat = () => sb.rpc('touch_seen', { p_active: vis() }).then(() => {}, () => {});
    ch.on('presence', { event: 'sync' }, () => {
        const st = ch.presenceState(); onlineIds = []; awayIds = [];
        for (const [id, metas] of Object.entries(st)) (metas.some(m => m.st !== 'away') ? onlineIds : awayIds).push(id);
        placeOnline(true); try { if (S.view === 'people') render(true); } catch (_) {}
      })
      .subscribe(s => { if (s === 'SUBSCRIBED') track(); });
    document.addEventListener('visibilitychange', () => { track(); beat(); if (vis()) loadSeen(); });
    window.addEventListener('pagehide', () => { try { beat(); ch.untrack(); } catch (_) {} });
    beat(); loadSeen();
    setInterval(beat, 60000);
    setInterval(() => { if (vis()) loadSeen(); }, 120000);
    new MutationObserver(() => placeOnline(false)).observe(document.body, { childList: true, subtree: true });
  }
  /* Home: "Online now" lists only the people who have SLATE OS open on screen; the Team tab shows everyone's status */
  function placeOnline(force) {
    if (force) { try { if (S.view === 'team' && !S.sheet) render(true); } catch (_) {} }
    const home = (() => { try { return S.view === 'mine'; } catch (_) { return false; } })();
    const old = document.getElementById('slate-online');
    const name = id => { try { return nameOf(id); } catch (_) { return displayName(people.get(id)); } };
    const on = onlineIds.filter(id => id !== authUser.id && people.has(id) && people.get(id).active).sort((a, b) => name(a).localeCompare(name(b)));
    if (!home || !on.length) { if (old) old.remove(); return; }
    const head = document.querySelector('main .page-h'); if (!head) return;
    if (old && !force && old.previousElementSibling === head) return;
    const chip = id => { let a = null; try { a = avaEl(id, isLeadP(people.get(id))); } catch (_) {}
      return el('span', { class: 'chip', style: 'padding:4px 12px 4px 4px;background:#fff;gap:8px' },
        el('span', { style: 'position:relative;display:inline-grid' }, ...(a ? [a] : []),
          el('i', { style: 'position:absolute;right:-1px;bottom:-1px;width:11px;height:11px;border-radius:50%;background:#34C759;border:2px solid #fff' })),
        name(id)); };
    const all = el('button', { class: 'linkish', type: 'button', style: 'font-size:12.5px' }, 'Everyone’s status');
    all.addEventListener('click', () => { try { S.view = 'team'; S.tv = 'status'; render(true); window.scrollTo(0, 0); } catch (_) {} });
    const box = el('section', { id: 'slate-online', class: 'sec' },
      el('div', { class: 'sec-h' }, el('h2', {}, 'Online now · ' + on.length), all),
      el('div', { class: 'chips', style: 'background:var(--group);border-radius:10px;padding:10px' }, ...on.map(chip)));
    if (old) old.replaceWith(box); else head.after(box);
  }


  /* ---------------- install button, by device ---------------- */
  function installKind() {
    if (isStandalone()) return 'installed';
    const ua = navigator.userAgent;
    if (installEvt) return 'prompt';                                         // Chrome, Edge, Samsung: real install prompt
    if (isIOS()) return 'ios';                                               // iPhone / iPad: Share → Add to Home Screen
    if (/Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'mac-safari';
    if (/Android/.test(ua) && /Firefox/.test(ua)) return 'android-firefox';
    if (/Android/.test(ua)) return 'android-menu';                           // Chrome before its prompt is ready
    if (/Firefox/.test(ua)) return 'none';                                   // desktop Firefox cannot install web apps
    return 'desktop-menu';
  }
  const INSTALL_STEPS = {
    ios: ['Tap the Share button <svg viewBox="0 0 24 24" width="20" height="20" style="vertical-align:-4px" fill="none" stroke="#007AFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-label="Share"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg> — at the bottom of Safari on iPhone, at the top right on iPad.', 'Scroll down and tap <b>Add to Home Screen</b>.', 'Tap <b>Add</b>. Then open SLATE OS from the red icon and turn on notifications.'],
    'mac-safari': ['In the menu bar choose <b>File → Add to Dock</b>.', 'Click <b>Add</b>. SLATE OS gets its own Dock icon and window.'],
    'android-menu': ['Tap the <b>⋮</b> menu at the top right of Chrome.', 'Tap <b>Install app</b> (or <b>Add to Home screen</b> → <b>Install</b>).', 'Open SLATE OS from the new red icon.'],
    'android-firefox': ['Tap the <b>⋮</b> menu.', 'Tap <b>Install</b> (or <b>Add to Home screen</b>).'],
    'desktop-menu': ['Click the install icon at the right end of the address bar, or open the browser menu.', 'Choose <b>Install SLATE OS</b> (Edge: <b>Apps → Install this site as an app</b>).']
  };
  const installLabel = k => k === 'ios' ? 'Add to Home Screen' : k === 'mac-safari' ? 'Add to Dock' : 'Install SLATE OS';
  async function runInstall(k) {
    if (k === 'prompt' && installEvt) {
      const e = installEvt; installEvt = null;
      e.prompt(); const r = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
      return r.outcome === 'accepted';
    }
    showInstallSteps(k); return false;
  }
  function showInstallSteps(k) {
    const steps = INSTALL_STEPS[k]; if (!steps) return;
    addCss();
    const close = el('button', { class: 'primary', type: 'button' }, 'Got it');
    const list = el('ol', { style: 'margin:0;padding-left:22px;display:grid;gap:10px;font-size:16px;line-height:1.4' });
    steps.forEach(s => { const li = document.createElement('li'); li.innerHTML = s; list.append(li); });
    const root = el('div', { id: 'slate-install-sheet', class: 'slate-sheet', role: 'dialog', 'aria-label': installLabel(k) },
      el('div', { class: 'box' }, el('div', { class: 'brand' }, el('b', { style: 'font-size:22px;letter-spacing:.04em' }, installLabel(k)), el('i', {}), el('span', {}, 'SLATE OS on this device')), list, close));
    close.addEventListener('click', () => root.remove());
    document.body.append(root);
  }
  function installBanner() {
    let done = false;
    const place = () => {
      const k = installKind();
      if (done || k === 'installed' || k === 'none' || ls.get('slate-install-later') || ls.get('slate-installed')) return;
      const main = document.querySelector('main'); if (!main || document.getElementById('slate-install-banner')) return;
      const text = k === 'ios' ? 'Add SLATE OS to your Home Screen: it opens like an app and can send you notifications.'
                 : 'Install SLATE OS on this device: it opens in its own window with its own icon.';
      const go = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, installLabel(k));
      const later = el('button', { class: 'btn btn-sm', type: 'button', style: 'background:#fff' }, 'Not now');
      const b = el('div', { id: 'slate-install-banner', class: 'banner' }, el('span', {}, text), el('div', { class: 'actions' }, go, later));
      go.addEventListener('click', async () => { if (await runInstall(installKind())) { done = true; b.remove(); } });
      later.addEventListener('click', () => { done = true; ls.set('slate-install-later', '1'); b.remove(); });
      main.prepend(b);
    };
    new MutationObserver(place).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('slate-installable', () => { const b = document.getElementById('slate-install-banner'); if (b) b.remove(); place(); });
    place();
  }
  function installRow() {
    const k = installKind();
    if (k === 'none') return el('span');
    const box = el('div', { style: 'display:grid;gap:8px;background:#f2f2f7;border-radius:10px;padding:12px 14px;font-size:14px' }, el('b', {}, 'App'));
    if (k === 'installed') { box.append(el('span', { style: 'color:#3c3c43' }, 'SLATE OS is installed on this device.')); return box; }
    const b = el('button', { class: 'primary', type: 'button' }, installLabel(k));
    b.addEventListener('click', () => runInstall(installKind()));
    box.append(el('span', { style: 'color:#3c3c43' }, 'Open SLATE OS like an app, with its own icon.'), b);
    return box;
  }


  /* ---------------- People tab: pick people, send a notification ---------------- */
  const PS = { sel: new Set(), msg: '', q: '', busy: false, note: '' };
  window.slatePeopleState = PS;
  function canMessageClient(p) {
    if (!me || !p || !p.active || p.id === me.id) return false;
    return me.designation === 'principal' || me.designation === 'coo' || !!me.is_approver;   // only the Principal and the COO send
  }
  const isLeadP = p => !!p && ['principal', 'coo', 'pod_leader', 'design_associate_lead'].includes(p.designation);
  const REPLY_L = { on_it: 'On it', done: 'Done', already: 'Already done', later: 'Will do it later', will: 'Will do it', help: 'Need help', remind: 'Reminder set', task: 'Made it a task' };
  const when = t => new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  /* People: two tabs. Send = message box on top, team shortcuts, people as compact chips. Sent = what was sent and the replies. */
  function peopleView() {
    const nm = p => { try { return nameOf(p.id); } catch (_) { return displayName(p); } };
    const rerender = () => { try { render(true); } catch (_) {} };
    const all = [...people.values()].filter(canMessageClient);
    const order = t => t === "Principal's Office" ? '0' : /^Pod/.test(t || '') ? '1' + t : t ? '2' + t : '9';
    all.sort((a, b) => order(a.team).localeCompare(order(b.team)) || (isLeadP(b) - isLeadP(a)) || nm(a).localeCompare(nm(b)));
    const groups = new Map(); all.forEach(p => { const t = p.team || 'No team'; if (!groups.has(t)) groups.set(t, []); groups.get(t).push(p); });
    for (const id of [...PS.sel]) if (!people.has(id) || !canMessageClient(people.get(id))) PS.sel.delete(id);
    const tab = PS.tab || 'send';
    const acctBtn = canAdmin() ? el('button', { class: 'btn', type: 'button', id: 'slate-accounts-btn' }, 'Accounts and passwords') : null;
    if (acctBtn) acctBtn.addEventListener('click', accountsSheet);
    if (!sentLoaded) loadSent();
    const nSent = new Set(sent.map(r => r.body + '|' + r.created_at)).size;
    const tabs = el('div', { class: 'seg', role: 'group', 'aria-label': 'People' }, ...[['send', 'Send a message'], ['sent', 'Sent and replies' + (nSent ? ' · ' + nSent : '')]].map(([k, l]) => {
      const b = el('button', { type: 'button', 'aria-pressed': String(tab === k) }, l); b.addEventListener('click', () => { PS.tab = k; rerender(); }); return b; }));
    const headEl = el('div', { class: 'page-h' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Studio'), el('h1', { class: 'h1' }, 'People')), ...(acctBtn ? [acctBtn] : []));
    if (tab === 'sent') return [headEl, tabs, sent.length ? sentView() : el('p', { class: 'muted' }, 'Nothing sent yet.')];
    const n = PS.sel.size;
    const ta = el('textarea', { id: 'slate-people-msg', maxlength: '300', rows: '2', placeholder: 'Message, e.g. Site visit moved to 3 pm today', 'aria-label': 'Message' }); ta.value = PS.msg;
    const send = el('button', { class: 'btn btn-primary', type: 'button' }, n ? `Notify ${n} ${n === 1 ? 'person' : 'people'}` : 'Notify');
    if (!n || PS.busy) send.disabled = true;
    const count = el('span', { class: 'f-hint' }, `${ta.value.length}/300`);
    ta.addEventListener('input', () => { PS.msg = ta.value; count.textContent = `${ta.value.length}/300`; send.disabled = !PS.sel.size || PS.busy; });
    const note = el('div', { class: PS.note.startsWith('!') ? 'err' : 'f-hint', role: 'status' }, PS.note.replace(/^!/, ''));
    send.addEventListener('click', async () => {
      PS.msg = ta.value; if (!PS.msg.trim()) { PS.note = '!Write a message first.'; return rerender(); }
      PS.busy = true; rerender();
      const { data, error } = await sb.rpc('send_message', { p_to: [...PS.sel], p_message: PS.msg });
      PS.busy = false;
      if (error) PS.note = '!' + friendly(error).message;
      else { PS.note = `Sent to ${data} ${data === 1 ? 'person' : 'people'}. Replies show under Sent and replies.`; PS.msg = ''; PS.sel.clear(); loadSent(); }
      rerender();
    });
    const compose = el('div', { class: 'form', style: 'gap:10px' }, ta,
      el('div', { class: 'bar', style: 'justify-content:space-between' }, el('span', { class: 'f-hint' }, n ? `To ${n}: ${[...PS.sel].map(id => nm(people.get(id))).join(', ')}` : 'Choose people below', ' · ', count), send), note);
    // one card per team in a grid; tap the card's heading to select or clear the whole team
    const DOT = { on: '#34C759', away: '#FF9F0A' };
    const everyone = (() => { const on = all.length && all.every(p => PS.sel.has(p.id));
      const b = el('button', { class: 'linkish', type: 'button', style: 'font-size:13.5px' }, on ? 'Clear everyone' : 'Select everyone');
      b.addEventListener('click', () => { all.forEach(p => on ? PS.sel.delete(p.id) : PS.sel.add(p.id)); rerender(); }); return b; })();
    const tile = p => { const on = PS.sel.has(p.id), sn = seenOf(p.id); let a = null; try { a = avaEl(p.id, false); } catch (_) {}
      const b = el('button', { class: 'slate-pt' + (on ? ' on' : ''), type: 'button', 'aria-pressed': String(on), title: sn.label },
        el('span', { class: 'slate-pt-a' }, ...(a ? [a] : []), ...(DOT[sn.st] ? [el('i', { style: `background:${DOT[sn.st]}` })] : [])),
        el('span', { class: 'slate-pt-t' }, el('b', {}, nm(p)), el('span', {}, p.role_label || '')),
        el('span', { class: 'slate-pt-c', 'aria-hidden': 'true' }, on ? '✓' : ''));
      b.addEventListener('click', () => { on ? PS.sel.delete(p.id) : PS.sel.add(p.id); rerender(); }); return b; };
    const card = ([t, ps]) => { let label = t; try { label = podLabel(t); } catch (_) {}
      const allOn = ps.every(p => PS.sel.has(p.id)), n2 = ps.filter(p => PS.sel.has(p.id)).length;
      const hb = el('button', { class: 'slate-pc-h', type: 'button' }, el('b', {}, label), el('span', {}, allOn ? 'Clear' : n2 ? `${n2} of ${ps.length} · select all` : 'Select all'));
      hb.addEventListener('click', () => { ps.forEach(p => allOn ? PS.sel.delete(p.id) : PS.sel.add(p.id)); rerender(); });
      return el('div', { class: 'slate-pc' + (allOn ? ' on' : '') }, hb, el('div', { class: 'slate-pc-b' }, ...ps.map(tile))); };
    const grid = el('div', { class: 'slate-pgrid' }, ...[...groups.entries()].map(card));
    return [headEl, tabs, compose, el('div', { class: 'bar', style: 'justify-content:space-between' }, el('span', { class: 'f-hint' }, 'Tap a person, or a team’s heading to choose the whole team.'), everyone), grid];
  }
  /* what I sent, with each person's reply; follow up anyone who hasn't finished */
  let sent = [], sentLoaded = false;
  const FU = {};                                   // follow-up drafts by message group
  async function loadSent() {
    sentLoaded = true;
    const { data } = await sb.rpc('my_sent_messages', { p_limit: 120 });
    sent = data || []; try { if (S.view === 'people' || S.view === 'cal') render(true); } catch (_) {}
  }
  const finished = r => !!r.done_at || r.reply === 'task';
  function replyText(r) {
    const d = x => when(x);
    if (r.reply === 'done') return r.due_at ? (new Date(r.done_at) <= new Date(r.due_at) ? 'Done on time' : 'Done late') : 'Done';
    if (r.reply === 'already') return 'Already done · ' + d(r.done_at);
    if (r.reply === 'will') return (r.due_at && new Date(r.due_at) < new Date() ? 'Overdue · was due ' : 'Will do it by ') + dayOnly(r.due_at);
    if (r.reply === 'help') return 'Needs help' + (r.reply_note ? ': ' + r.reply_note : '');
    if (r.reply === 'task') return 'Made it a task';
    if (r.reply === 'remind') return 'Set a reminder';
    if (r.reply) return REPLY_L[r.reply] || r.reply;
    return r.read_at ? 'Seen' : 'Not seen yet';
  }
  const replyColor = r => r.done_at || r.reply === 'task' ? 'var(--ontime)' : r.reply === 'help' || (r.reply === 'will' && r.due_at && new Date(r.due_at) < new Date()) ? 'var(--overdue)' : r.reply ? 'var(--early)' : 'var(--muted)';
  function sentView() {
    if (!sent.length) return el('span');
    const nm = id => { try { return nameOf(id); } catch (_) { return displayName(people.get(id)); } };
    const groups = new Map();
    sent.forEach(r => { const k = r.body + '|' + r.created_at; if (!groups.has(k)) groups.set(k, { k, body: r.body, at: r.created_at, rows: [] }); groups.get(k).rows.push(r); });
    const shown = PS.more ? 40 : 6;
    const items = [...groups.values()].slice(0, shown).map(g => {
      const done = g.rows.filter(finished).length, open = g.rows.filter(r => !finished(r));
      const fu = g.rows.reduce((n, r) => Math.max(n, r.followups || 0), 0);
      const box = el('div', { class: 'card', style: 'border-radius:0;border-bottom:1px solid var(--line);gap:8px' },
        el('div', { class: 'bar', style: 'justify-content:space-between' }, el('b', { style: 'overflow-wrap:anywhere' }, g.body), el('span', { class: 'f-hint' }, when(g.at))),
        el('div', { class: 'f-hint' }, `${done} of ${g.rows.length} done` + (fu ? ` · followed up ${fu}×` : '')),
        el('div', { class: 'chips' }, ...g.rows.map(r => el('span', { class: 'chip', style: 'padding-right:12px;background:#fff;max-width:100%' }, el('b', { style: 'font-weight:600' }, nm(r.to_user)), el('span', { style: 'color:' + replyColor(r) + ';overflow-wrap:anywhere' }, '· ' + replyText(r))))));
      if (open.length) {
        const f = FU[g.k];
        if (!f) {
          const b = el('button', { class: 'btn btn-sm', type: 'button', style: 'justify-self:start;background:#fff' }, `Follow up ${open.length === g.rows.length ? (open.length === 1 ? '' : 'everyone') : 'the ' + open.length + ' not done'}`.trim());
          b.addEventListener('click', () => { FU[g.k] = { note: '', ids: open.map(r => r.id) }; render(true); });
          box.append(b);
        } else {
          const t = el('input', { maxlength: '300', placeholder: 'Add a note (optional), e.g. Need this by 4 pm', style: 'background:#fff' }); t.value = f.note;
          t.addEventListener('input', () => { f.note = t.value; });
          const pick = el('div', { class: 'chips' }, ...open.map(r => { const on = f.ids.includes(r.id);
            const c = el('button', { class: 'chip' + (on ? ' on' : ''), type: 'button', style: 'border:0;cursor:pointer;padding-right:12px' }, nm(r.to_user));
            c.addEventListener('click', () => { f.ids = on ? f.ids.filter(x => x !== r.id) : [...f.ids, r.id]; render(true); }); return c; }));
          const go = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Send follow-up'); if (!f.ids.length) go.disabled = true;
          const no = el('button', { class: 'btn btn-sm', type: 'button', style: 'background:#fff' }, 'Cancel');
          go.addEventListener('click', async () => { go.disabled = true;
            const { data, error } = await sb.rpc('message_followup', { p_ids: f.ids, p_note: f.note || null });
            if (error) { go.disabled = false; try { toast(friendly(error).message); } catch (_) {} return; }
            delete FU[g.k]; try { toast(`Follow-up sent to ${data} ${data === 1 ? 'person' : 'people'}`); } catch (_) {} loadSent(); });
          no.addEventListener('click', () => { delete FU[g.k]; render(true); });
          box.append(el('div', { class: 'callout', style: 'display:grid;gap:8px' }, el('div', { class: 'lbl' }, 'Follow up'), pick, t, el('div', { class: 'actions' }, go, no)));
        }
      }
      return box;
    });
    const moreBtn = groups.size > shown ? (() => { const b = el('button', { class: 'btn btn-sm', type: 'button', style: 'justify-self:start;background:#fff' }, 'Show older messages'); b.addEventListener('click', () => { PS.more = true; render(true); }); return b; })() : el('span');
    return el('section', { class: 'sec' }, el('div', { class: 'list' }, ...items), moreBtn);
  }

  /* my reminders (from "Remind me…"), shown on my Calendar at the chosen time */
  let myReminders = [];
  async function loadReminders() {
    const { data } = await sb.from('notifications').select('id,title,body,remind_at,reminded_at,sender').eq('user_id', authUser.id).not('remind_at', 'is', null).order('remind_at', { ascending: true }).limit(300);
    myReminders = data || [];
    try { if (S.view === 'cal') render(true); } catch (_) {}
  }
  window.slateReminders = () => myReminders;
  /* messages I answered with Done / Already done / Will do it: on my Calendar; open "will do" items stay on Home */
  let myAnswered = [];
  async function loadAnswered() {
    const { data } = await sb.from('notifications').select('id,title,body,created_at,sender,reply,replied_at,done_at,due_at,reply_note,task_ref')
      .eq('user_id', authUser.id).eq('kind', 'message').is('ref_id', null).not('reply', 'is', null).order('created_at', { ascending: false }).limit(300);
    myAnswered = data || [];
    placeMessages(true);
    try { if (S.view === 'cal') render(true); } catch (_) {}
  }
  /* calendar items from messages: mine as the person asked, and (Principal / COO) everything I sent */
  window.slateMsgCal = () => {
    const out = [];
    for (const r of myAnswered) {
      if (r.done_at) out.push({ at: r.done_at, done: true, ok: !r.due_at || new Date(r.done_at) <= new Date(r.due_at), body: r.body, who: r.sender, mine: true, r });
      else if (r.reply === 'will' && r.due_at) out.push({ at: r.due_at, done: false, body: r.body, who: r.sender, mine: true, r });
    }
    for (const r of sent) {
      if (r.done_at) out.push({ at: r.done_at, done: true, ok: !r.due_at || new Date(r.done_at) <= new Date(r.due_at), body: r.body, who: r.to_user, mine: false, r });
      else if (r.reply === 'will' && r.due_at) out.push({ at: r.due_at, done: false, body: r.body, who: r.to_user, mine: false, r });
    }
    return out;
  };
  window.slateMsgOpen = item => msgSheet(item);
  function msgSheet(item) {
    const r = item.r; addCss();
    const old = document.getElementById('slate-msg-sheet'); if (old) old.remove();
    const close = el('button', { class: 'link', type: 'button' }, 'Close');
    const nm = id => { try { return nameOf(id); } catch (_) { return displayName(people.get(id)); } };
    const box = el('div', { class: 'box' }, el('div', { class: 'brand' }, el('b', { style: 'font-size:20px;letter-spacing:.04em' }, item.mine ? 'Message from ' + nm(r.sender) : 'Sent to ' + nm(r.to_user)), el('i', {}), el('span', {}, when(r.created_at))),
      el('p', { style: 'margin:0;font-size:16px;white-space:pre-wrap;overflow-wrap:anywhere' }, r.body),
      el('div', { style: 'font-weight:600;color:' + replyColor(r) }, replyText(r)), r.reply_note && r.reply !== 'help' ? el('div', { class: 'f' }, r.reply_note) : el('span'));
    if (item.mine && r.reply === 'will' && !r.done_at) {
      const b = el('button', { class: 'primary', type: 'button' }, '✓ Done now');
      b.addEventListener('click', async () => { b.disabled = true; const { error } = await sb.rpc('message_reply', { p_id: r.id, p_choice: 'done' }); if (error) { b.disabled = false; return; }
        try { toast('Marked as done'); } catch (_) {} root.remove(); loadAnswered(); });
      box.append(b);
    }
    box.append(el('div', { class: 'row' }, close));
    const root = el('div', { id: 'slate-msg-sheet', class: 'slate-sheet', role: 'dialog', 'aria-label': 'Message' }, box);
    close.addEventListener('click', () => root.remove());
    document.body.append(root);
  }
  /* messages, replies and reminders for me: cards on Home until answered or dismissed */
  let myMessages = [];
  async function loadMessages() {
    const { data } = await sb.from('notifications').select('id,kind,title,body,created_at,ref_id,reply,sender').in('kind', ['message', 'reply', 'reminder']).is('read_at', null).order('created_at', { ascending: false }).limit(15);
    myMessages = data || []; placeMessages(true); msgRefresh(); syncBadge();
  }
  function remindChoices() {
    const now = new Date(), at = (d, h, m) => { const x = new Date(now); x.setDate(x.getDate() + d); x.setHours(h, m || 0, 0, 0); return x; };
    const out = [['In 1 hour', new Date(now.getTime() + 3600e3)], ['In 3 hours', new Date(now.getTime() + 3 * 3600e3)]];
    if (now.getHours() < 17) out.push(['This evening, 6 pm', at(0, 18)]);
    out.push(['Tomorrow, 10 am', at(1, 10)]);
    return out;
  }
  const pad2 = n => String(n).padStart(2, '0');
  const localDT = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const localD = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const dayOnly = t => new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
  async function sendReply(msgId, choice, extra) {
    const { error } = await sb.rpc('message_reply', { p_id: msgId, p_choice: choice, p_remind_at: (extra && extra.remindAt) ? extra.remindAt.toISOString() : null,
      p_at: (extra && extra.at) ? extra.at.toISOString() : null, p_note: (extra && extra.note) || null, p_task: (extra && extra.task) || null });
    if (error) throw friendly(error);
  }
  window.slateReplyTask = async (msgId, path) => { await sendReply(msgId, 'task', { task: path }); myMessages = myMessages.filter(y => y.id !== msgId); loadAnswered(); loadMessages(); };
  /* a message answered or dismissed (on Home or in the bell) leaves both, and the counts update */
  function msgGone(id) {
    myMessages = myMessages.filter(y => y.id !== id); bellCards.delete(id);
    placeMessages(true); syncBadge(); msgRefresh();
  }
  function msgRefresh() { try { schedule(); } catch (_) {} try { if (S.sheet && S.sheet.type === 'notif') renderSheet(); } catch (_) {} }
  const msgNm = id => { try { return nameOf(id); } catch (_) { return displayName(people.get(id)); } };
  function msgCard(m) {
    const msgId = m.kind === 'reminder' ? m.ref_id : m.kind === 'message' ? m.id : null;
    const status = el('div', { class: 'f-hint', role: 'status' });
    const actions = el('div', { class: 'actions' });
    const lock = on => actions.querySelectorAll('button,input,textarea').forEach(b => { b.disabled = on; });
    const reply = async (choice, label, extra) => {
      lock(true);
      try { await sendReply(msgId, choice, extra); }
      catch (e) { status.textContent = e.message; status.className = 'err'; lock(false); return; }
      if (m.kind === 'reminder') await sb.rpc('message_read', { p_id: m.id });
      if (choice === 'remind') loadReminders(); else loadAnswered();
      try { toast(choice === 'remind' ? 'Reminder set for ' + when(extra.remindAt) + ' · added to your Calendar'
        : choice === 'done' || choice === 'already' ? 'Reply sent: ' + label + ' · on your Calendar'
        : choice === 'will' ? 'Reply sent · due ' + dayOnly(extra.at) + ' on your Calendar' : 'Reply sent: ' + label); } catch (_) {}
      msgGone(m.id);
    };
    const mini = (label, primary) => el('button', { class: 'btn btn-sm' + (primary ? ' btn-primary' : ''), type: 'button', style: primary ? '' : 'background:#fff' }, label);
    const panel = (title, input, go, note) => {
      const back = mini('Back');
      back.addEventListener('click', () => { actions.replaceChildren(...buttons()); status.textContent = ''; });
      actions.replaceChildren(el('div', { style: 'display:grid;gap:8px;width:100%' }, el('div', { class: 'lbl' }, title), input, note || el('span'), el('div', { class: 'actions' }, go, back)));
      try { input.focus(); } catch (_) {}
    };
    const buttons = () => {
      const out = [];
      const done = mini('✓ Done', true); done.addEventListener('click', () => reply('done', 'Done')); out.push(done);
      const al = mini('Already done…'); al.addEventListener('click', () => {
        const i = el('input', { type: 'datetime-local', max: localDT(new Date()), style: 'background:#fff' }); i.value = localDT(new Date());
        const go = mini('Send', true); go.addEventListener('click', () => { if (!i.value) return (status.textContent = 'Choose when it was done.'); const at = new Date(i.value); if (at > new Date()) return (status.textContent = 'That time is in the future.'); reply('already', 'Already done', { at }); });
        panel('When was it done?', i, go); }); out.push(al);
      const wl = mini('Will do it…'); wl.addEventListener('click', () => {
        const tm = new Date(); tm.setDate(tm.getDate() + 1);
        const i = el('input', { type: 'date', min: localD(new Date()), style: 'background:#fff' }); i.value = localD(tm);
        const go = mini('Send', true); go.addEventListener('click', () => { if (!i.value) return (status.textContent = 'Choose the finish date.'); const at = new Date(i.value + 'T18:00'); reply('will', 'Will do it', { at }); });
        panel('By when will you finish it?', i, go, el('div', { class: 'f-hint' }, 'It goes on your Calendar; tap ✓ Done there when it’s finished.')); }); out.push(wl);
      const hp = mini('Need help…'); hp.addEventListener('click', () => {
        const i = el('textarea', { maxlength: '300', rows: '2', placeholder: 'What help do you need?', style: 'background:#fff' });
        const go = mini('Send', true); go.addEventListener('click', () => { if (!i.value.trim()) return (status.textContent = 'Write what help you need.'); reply('help', 'Need help', { note: i.value.trim() }); });
        panel('Need help', i, go); }); out.push(hp);
      const rb = mini('Remind me…'); rb.addEventListener('click', () => {
        actions.replaceChildren(...remindChoices().map(([l, d]) => { const b = mini(l); b.addEventListener('click', () => reply('remind', l, { remindAt: d })); return b; }), (() => { const b = mini('Back'); b.addEventListener('click', () => actions.replaceChildren(...buttons())); return b; })()); }); out.push(rb);
      if (typeof window.slateMsgTaskSheet === 'function') { const tk = mini('Make it a task…'); tk.addEventListener('click', () => window.slateMsgTaskSheet({ id: msgId, body: m.kind === 'reminder' ? m.body : m.body, sender: m.sender })); out.push(tk); }
      return out;
    };
    if (msgId) actions.append(...buttons());
    else {
      const x = mini('Dismiss');
      x.addEventListener('click', async () => { msgGone(m.id); await sb.rpc('message_read', { p_id: m.id }); });
      actions.append(x);
    }
    const color = m.kind === 'reply' ? '#007AFF' : m.kind === 'reminder' ? '#FF9500' : '#d7262b';
    return el('div', { class: 'callout', style: 'box-shadow:inset 3px 0 0 ' + color },
      el('div', { class: 'bar', style: 'justify-content:space-between' }, el('b', {}, m.title), el('span', { class: 'f-hint' }, when(m.created_at))),
      el('div', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, m.body), actions, status);
  }

  /* the bell lists the same messages, each with the same reply buttons; cards are kept so an open reply stays open */
  const bellCards = new Map();
  window.slateMsgCount = () => myMessages.length;
  window.slateMsgCards = () => {
    if (!myMessages.length) return null;
    for (const id of [...bellCards.keys()]) if (!myMessages.some(m => m.id === id)) bellCards.delete(id);
    return el('div', { class: 'n-msgs' }, el('div', { class: 'n-day' }, myMessages.length === 1 ? 'Message for you' : `Messages for you · ${myMessages.length}`),
      ...myMessages.map(m => { if (!bellCards.has(m.id)) bellCards.set(m.id, msgCard(m)); return bellCards.get(m.id); }));
  };
  function placeMessages(force) {
    const home = (() => { try { return S.view === 'mine'; } catch (_) { return false; } })();
    const old = document.getElementById('slate-messages');
    const open = myAnswered.filter(r => r.reply === 'will' && !r.done_at && r.due_at).sort((a, b) => a.due_at.localeCompare(b.due_at));
    if (!home || (!myMessages.length && !open.length)) { if (old) old.remove(); return; }
    const main = document.querySelector('main'); if (!main) return;
    if (old && !force && main.contains(old)) return;
    const nm = msgNm;
    const commit = r => {
      const late = new Date(r.due_at) < new Date();
      const b = el('button', { class: 'btn btn-sm btn-primary', type: 'button' }, '✓ Done');
      b.addEventListener('click', async () => { b.disabled = true; try { await sendReply(r.id, 'done'); try { toast('Marked as done'); } catch (_) {} loadAnswered(); } catch (e) { b.disabled = false; try { toast(e.message); } catch (_) {} } });
      return el('div', { class: 'card', style: 'border-radius:0;border-bottom:1px solid var(--line);gap:6px' },
        el('div', { class: 'bar', style: 'justify-content:space-between' }, el('b', { style: 'overflow-wrap:anywhere;font-weight:500' }, r.body), el('span', { class: 'pill ' + (late ? 's-overdue' : 's-open') }, (late ? 'Overdue · ' : 'Due ') + dayOnly(r.due_at))),
        el('div', { class: 'bar', style: 'justify-content:space-between' }, el('span', { class: 'f-hint' }, 'From ' + nm(r.sender)), b));
    };
    const box = el('section', { id: 'slate-messages', class: 'sec' }, ...myMessages.map(m => msgCard(m)),
      ...(open.length ? [el('div', { class: 'sec-h' }, el('h2', {}, 'Messages you said you’d do'), el('span', { class: 'cnt' }, String(open.length))), el('div', { class: 'list' }, ...open.map(commit))] : []));
    if (old) old.replaceWith(box);
    else { // under the page title and the "waiting on you" line, not above them
      const anchor = main.querySelector('.q-banner') || main.querySelector('.page-h');
      if (anchor) anchor.after(box); else main.prepend(box); }
  }
  function setupMessages() {
    window.slatePeopleView = peopleView;
    loadMessages(); loadReminders(); loadAnswered();
    if (canAdmin()) loadSent();
    sb.channel('slate-my-messages').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: 'user_id=eq.' + authUser.id },
      ev => { if (ev.new && ['message', 'reply', 'reminder'].includes(ev.new.kind)) { myMessages = [ev.new, ...myMessages.filter(m => m.id !== ev.new.id)]; placeMessages(true); msgRefresh(); syncBadge(); if (ev.new.kind === 'reply') loadSent(); if (ev.new.kind === 'reminder') loadReminders(); } }).subscribe();
    new MutationObserver(() => placeMessages(false)).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { loadMessages(); loadReminders(); loadAnswered(); } });
  }

  /* ---------------- accounts: the Principal and the COO reset passwords and add people ---------------- */
  const canAdmin = () => !!me && me.active !== false && (me.designation === 'principal' || me.designation === 'coo');
  window.slateAdminCall = b => adminCall(b);
  async function adminCall(body) {
    const { data, error } = await sb.functions.invoke('admin-users', { body });
    if (error) { let m = error.message; try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (_) {} throw new Error(m); }
    if (data && data.error) throw new Error(data.error);
    return data;
  }
  function accountsSheet() {
    addCss();
    const old = document.getElementById('slate-accounts'); if (old) old.remove();
    const boss = me.designation === 'principal';
    const nm = p => { try { return nameOf(p.id); } catch (_) { return displayName(p); } };
    const root = el('div', { id: 'slate-accounts', class: 'slate-sheet slate-acc', role: 'dialog', 'aria-label': 'Accounts and passwords' });
    const box = el('div', { class: 'box' });
    const result = el('div');
    const showResult = (title, email, pw, name) => {
      const copy = el('button', { class: 'primary', type: 'button' }, 'Copy password');
      copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(pw); copy.textContent = 'Copied'; } catch (_) { copy.textContent = 'Select and copy it above'; } });
      const msgTxt = `SLATE OS: sign in at ${location.origin} with ${email} and the temporary password ${pw}. You'll choose your own password straight after.`;
      const share = el('button', { class: 'link', type: 'button' }, 'Share…');
      share.addEventListener('click', async () => { try { if (navigator.share) await navigator.share({ text: msgTxt }); else { await navigator.clipboard.writeText(msgTxt); share.textContent = 'Message copied'; } } catch (_) {} });
      result.replaceChildren(el('div', { class: 'slate-acc-res', role: 'status' },
        el('b', {}, title), el('span', {}, `${name} · ${email}`),
        el('code', {}, pw), el('div', { class: 'row', style: 'justify-content:flex-start;gap:16px' }, copy, share),
        el('span', { class: 'f' }, 'Shown only this once. Give it to them in person or on WhatsApp. When they sign in, SLATE OS makes them choose their own password, so you never know it. This is in the audit trail.')));
      result.scrollIntoView({ block: 'nearest' });
    };
    // add a person
    const roles = (() => { try { return ROLE_SUGGEST; } catch (_) { return ['COO', 'Pod Leader', 'Junior Architect', 'Design Associate Lead', 'Design Associate', 'Visualizer', 'Intern', 'Others']; } })()
      .filter(r => r !== 'Principal' && (boss || r !== 'COO'));
    const tms = (() => { try { return teams(); } catch (_) { return []; } })();
    const fName = el('input', { type: 'text', maxlength: '80', autocomplete: 'off' });
    const fEmail = el('input', { type: 'email', inputmode: 'email', autocomplete: 'off', placeholder: 'name@slate-atelier.com' });
    const fRole = el('select', {}, el('option', { value: '' }, 'Choose…'), ...roles.map(r => el('option', { value: r }, r)));
    const fTeam = el('select', {}, el('option', { value: '' }, 'No team yet'), ...tms.map(t => { let l = t; try { l = podLabel(t); } catch (_) {} return el('option', { value: t }, l); }));
    const addMsg = el('div', { class: 'msg', role: 'status' });
    const addGo = el('button', { class: 'primary', type: 'submit' }, 'Create account');
    const addForm = el('form', { class: 'slate-acc-card', novalidate: '' }, el('b', {}, 'Add a person'),
      el('label', {}, 'Name', fName), el('label', {}, 'Studio email', fEmail),
      el('div', { class: 'slate-acc-2' }, el('label', {}, 'Designation', fRole), el('label', {}, 'Team', fTeam)), addGo, addMsg);
    addForm.addEventListener('submit', async e => {
      e.preventDefault(); addMsg.className = 'msg err';
      if (!fName.value.trim()) return (addMsg.textContent = 'Enter their name.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fEmail.value.trim())) return (addMsg.textContent = 'Enter a valid email address.');
      if (!fRole.value) return (addMsg.textContent = 'Choose their designation.');
      addGo.disabled = true; addMsg.className = 'msg'; addMsg.textContent = 'Creating…';
      try {
        const r = await adminCall({ action: 'create', email: fEmail.value.trim(), full_name: fName.value.trim(), role_label: fRole.value, team: fTeam.value });
        addMsg.textContent = ''; showResult('Account created', r.email, r.password, fName.value.trim());
        fName.value = fEmail.value = ''; fRole.value = fTeam.value = '';
      } catch (err) { addMsg.className = 'msg err'; addMsg.textContent = err.message; }
      addGo.disabled = false;
    });
    // reset someone's password
    const q = el('input', { type: 'search', placeholder: 'Search people', 'aria-label': 'Search people' });
    const list = el('div', { class: 'slate-acc-list' });
    const draw = () => {
      const t = q.value.trim().toLowerCase();
      const ps = [...people.values()].filter(p => p.id !== me.id && p.active !== false && (!t || (nm(p) + ' ' + (p.email || '')).toLowerCase().includes(t)))
        .sort((a, b) => nm(a).localeCompare(nm(b)));
      list.replaceChildren(...ps.map(p => {
        const locked = !boss && (p.designation === 'principal' || p.designation === 'coo');
        const st = el('div', { class: 'msg', role: 'status' });
        const b = el('button', { class: 'link', type: 'button' }, locked ? 'Principal only' : 'Reset password');
        if (locked) b.disabled = true;
        let armed = false;
        b.addEventListener('click', async () => {
          if (!armed) { armed = true; b.textContent = 'Tap again to reset'; b.classList.add('danger'); setTimeout(() => { if (armed && b.isConnected && !b.disabled) { armed = false; b.textContent = 'Reset password'; b.classList.remove('danger'); } }, 4000); return; }
          armed = false; b.disabled = true; b.textContent = 'Resetting…';
          try { const r = await adminCall({ action: 'reset', user_id: p.id }); showResult('Password reset', r.email, r.password, nm(p)); b.textContent = 'Reset done'; }
          catch (err) { st.className = 'msg err'; st.textContent = err.message; b.disabled = false; b.textContent = 'Reset password'; }
          b.classList.remove('danger');
        });
        const off = p.designation === 'principal' || (!boss && p.designation === 'coo') ? null : el('button', { class: 'link', type: 'button' }, window.slateLeaveSheet ? 'Leaving SLATE…' : 'Deactivate');
        if (off && window.slateLeaveSheet) off.addEventListener('click', () => { root.remove(); window.slateLeaveSheet(p.id); });
        else if (off) {
          let armedOff = false;
          off.addEventListener('click', async () => {
            if (!armedOff) { armedOff = true; off.textContent = 'Tap again: they can’t sign in'; off.classList.add('danger'); setTimeout(() => { if (armedOff && off.isConnected && !off.disabled) { armedOff = false; off.textContent = 'Deactivate'; off.classList.remove('danger'); } }, 4000); return; }
            armedOff = false; off.disabled = true; off.textContent = 'Deactivating…';
            try { await adminCall({ action: 'deactivate', user_id: p.id }); p.active = false; try { people.set(p.id, { ...p, active: false }); } catch (_) {} draw(); drawOff(); }
            catch (err) { st.className = 'msg err'; st.textContent = err.message; off.disabled = false; off.textContent = 'Deactivate'; off.classList.remove('danger'); }
          });
        }
        return el('div', { class: 'slate-acc-row' }, el('div', { style: 'min-width:0' }, el('div', { class: 'n' }, nm(p)), el('div', { class: 'e' }, [p.role_label, p.email].filter(Boolean).join(' · ')), st), el('div', { class: 'slate-acc-btns' }, b, off));
      }));
    };
    // people who have left: deactivated accounts, which can be brought back
    const offList = el('div', { class: 'slate-acc-list' });
    const offCard = el('div', { class: 'slate-acc-card' }, el('b', {}, 'Deactivated accounts'),
      el('span', { class: 'f' }, 'They can’t sign in and get no notifications. Their tasks, history and minutes stay. Reassign their open tasks first.'), offList);
    const drawOff = () => {
      const ps = [...people.values()].filter(p => p.id !== me.id && p.active === false && p.designation !== 'principal').sort((a, b) => nm(a).localeCompare(nm(b)));
      offCard.hidden = !ps.length;
      offList.replaceChildren(...ps.map(p => {
        const st = el('div', { class: 'msg', role: 'status' });
        const locked = !boss && p.designation === 'coo';
        const on = el('button', { class: 'link', type: 'button' }, locked ? 'Principal only' : 'Reactivate');
        if (locked) on.disabled = true;
        on.addEventListener('click', async () => {
          on.disabled = true; on.textContent = 'Reactivating…';
          try { await adminCall({ action: 'reactivate', user_id: p.id }); p.active = true; try { people.set(p.id, { ...p, active: true }); } catch (_) {} draw(); drawOff(); }
          catch (err) { st.className = 'msg err'; st.textContent = err.message; on.disabled = false; on.textContent = 'Reactivate'; }
        });
        return el('div', { class: 'slate-acc-row' }, el('div', { style: 'min-width:0' }, el('div', { class: 'n' }, nm(p)), el('div', { class: 'e' }, [p.role_label, p.left_on ? 'left ' + p.left_on : '', p.email].filter(Boolean).join(' · ')), st), on);
      }));
    };
    q.addEventListener('input', draw); draw(); drawOff();
    const close = el('button', { class: 'link', type: 'button' }, 'Close');
    close.addEventListener('click', () => root.remove());
    const close2 = el('button', { class: 'link', type: 'button', style: 'justify-self:end' }, 'Close');
    close2.addEventListener('click', () => root.remove());
    box.append(close2, el('div', { class: 'brand' }, el('b', {}, 'Accounts'), el('i', {}), el('span', {}, boss ? 'Principal' : 'COO')),
      el('p', { class: 'f', style: 'margin:0' }, 'Someone forgot their password? Reset it here and give them the temporary one. ' + (boss ? 'You can reset anyone’s.' : 'Only the Principal can reset the Principal’s password.')),
      result, addForm, el('div', { class: 'slate-acc-card' }, el('b', {}, 'Reset a password, or someone leaving'), el('span', { class: 'f' }, 'Someone leaving? Tap Leaving SLATE: hand over their work, then their account closes. Their records stay.'), q, list), offCard, el('div', { class: 'row' }, close));
    root.append(box); document.body.append(root);
  }
  window.slateAccounts = accountsSheet;

  /* ---------------- audit trail: every change, notification and message, from the database log ---------------- */
  const AU = { rows: [], loaded: false, busy: false, kind: '', more: true, err: '' };
  const AU_KINDS = [['', 'Everything'], ['msg', 'Messages'], ['notification', 'Notifications'], ['projects', 'Projects'], ['tasks', 'Tasks'], ['people', 'People'], ['reports', 'Reports'], ['other', 'Other']];
  const AU_TABLES = { msg: ['message'], notification: ['notification'], projects: ['projects', 'project', 'pmeetings'], tasks: ['tasks', 'lead', 'tasklib'], people: ['profiles', 'podnames', 'podreq', 'podjoin', 'rolereq', 'account'], reports: ['issue'] };
  async function loadAudit(reset) {
    if (AU.busy) return; AU.busy = true; if (reset) { AU.rows = []; AU.more = true; }
    let q = sb.from('activity_log').select('id,at,actor,table_name,row_id,action,subject_user,before,after').order('id', { ascending: false }).limit(150);
    if (AU.rows.length) q = q.lt('id', AU.rows[AU.rows.length - 1].id);
    if (AU.kind && AU_TABLES[AU.kind]) q = q.in('table_name', AU_TABLES[AU.kind]);
    else if (AU.kind === 'other') q = q.not('table_name', 'in', '(' + Object.values(AU_TABLES).flat().join(',') + ')');
    const { data, error } = await q;
    AU.busy = false; AU.loaded = true; AU.err = error ? friendly(error).message : '';
    if (data) { AU.rows = AU.rows.concat(data); AU.more = data.length === 150; }
    try { if (S.view === 'activity') render(true); } catch (_) {}
  }
  const AU_COLL = { projects: 'project', tasks: 'task', lead: 'private task', pmeetings: 'client meeting minutes', meetings: 'weekly meeting minutes', tasklib: 'standard task', types: 'project type', podnames: 'pod nickname', podreq: 'pod member request', podjoin: 'pod move decision', rolereq: 'designation request', farlog: 'FAR calculation', config: 'studio settings', meetcfg: 'meeting rotation', members: 'profile' };
  const SKIP_KEYS = ['history', 'updatedAt', 'updatedBy', 'at'];
  function auditLine(r) {
    const nm = id => { if (!id) return 'SLATE OS'; try { return nameOf(id); } catch (_) { return displayName(people.get(id)); } };
    const a = r.after || {}, b = r.before || {}, d = Object.keys(a).length ? a : b;
    const label = x => (x && (x.title || [x.code, x.name].filter(Boolean).join(' · ') || x.pod || x.nick)) || '';
    const changed = () => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => !SKIP_KEYS.includes(k) && JSON.stringify(a[k]) !== JSON.stringify(b[k]));
    if (r.table_name === 'message') {
      if (r.action === 'send') return [`${nm(r.actor)} sent a message to ${(a.to || []).map(nm).join(', ')}`, a.message];
      if (r.action === 'read') return [`${nm(r.actor)} read ${nm(a.from)}’s message`, a.message];
      if (r.action === 'reply') return [`${nm(r.actor)} replied “${a.reply}” to ${nm(a.from)}`, a.message];
      if (r.action === 'remind') return [`${nm(r.actor)} set a reminder${a.remind_at ? ' for ' + when(a.remind_at) : ''}`, a.message];
      if (r.action === 'followup') return [`${nm(r.actor)} sent a follow-up`, a.note || ''];
    }
    if (r.table_name === 'issue') return r.action === 'report' ? [`${nm(r.actor)} reported an issue${a.screen ? ' on ' + a.screen : ''}`, a.message] : [`${nm(r.actor)} marked a report ${a.status}`, [a.message, a.note].filter(Boolean).join(' · ')];
    if (r.table_name === 'account') {
      const who = nm(r.subject_user);
      if (r.action === 'password_reset') return [`${nm(r.actor)} reset ${who}’s password`, a.email];
      if (r.action === 'account_create') return [`${nm(r.actor)} created an account for ${who}`, a.email];
      if (r.action === 'account_deactivate') return [`${nm(r.actor)} deactivated ${who}’s account`, a.email];
      if (r.action === 'account_reactivate') return [`${nm(r.actor)} reactivated ${who}’s account`, a.email];
      if (r.action === 'password_chosen') return [`${who} chose a new password`, ''];
    }
    if (r.table_name === 'notification') return [`Notification to ${nm(r.subject_user)}${r.actor ? ' · from ' + nm(r.actor) : ''}: ${a.title || ''}`, a.body];
    if (r.table_name === 'profiles') {
      const who = nm((a.id || b.id) || r.subject_user);
      if (r.action === 'insert') return [`${who} joined SLATE OS`, a.email];
      const ks = changed().filter(k => !['updated_at', 'last_seen_at'].includes(k));
      return [`${nm(r.actor)} updated ${who}’s profile`, ks.map(k => `${k.replace(/_/g, ' ')}: ${b[k] == null ? '—' : b[k]} → ${a[k] == null ? '—' : a[k]}`).join(' · ')];
    }
    const what = AU_COLL[r.table_name] || r.table_name.replace(/_/g, ' ');
    const verb = { insert: 'created', update: 'updated', delete: 'deleted', delete_project: 'deleted' }[r.action] || r.action;
    const name = label(d);
    let note = '';
    if (r.action === 'update') {
      const ks = changed();
      if (r.table_name === 'projects' && ks.includes('delReq')) return [a.delReq ? `${nm(r.actor)} asked to delete project ${name}` : `${nm(r.actor)} cleared the deletion request on ${name}`, a.delReq && a.delReq.reason];
      const ev = (a.history || []).slice((b.history || []).length);
      note = ev.length ? ev.map(e => [e.type, e.to, e.note].filter(Boolean).join(' ')).join(' · ') : ks.length ? 'Changed: ' + ks.join(', ') : '';
    }
    if (r.action === 'delete' && r.table_name === 'projects') note = 'Full copy kept here' + (b.delReq && b.delReq.reason ? ' · ' + b.delReq.reason : '');
    return [`${nm(r.actor)} ${verb} ${what}${name ? ' “' + name + '”' : ''}`, note];
  }
  function auditView() {
    if (!AU.loaded && !AU.busy) loadAudit(true);
    const seg = el('div', { class: 'chips' }, ...AU_KINDS.map(([k, l]) => { const b = el('button', { class: 'chip' + (AU.kind === k ? ' on' : ''), type: 'button', style: 'border:0;cursor:pointer;padding:6px 12px' }, l);
      b.addEventListener('click', () => { AU.kind = k; loadAudit(true); }); return b; }));
    const out = [seg, el('p', { class: 'f-hint', style: 'margin:0' }, (() => { let t = ''; try { t = logLine(); } catch (_) {} return 'Recorded by the database. Nothing here can be edited or removed. ' + t; })())];
    if (AU.err) out.push(el('div', { class: 'err' }, AU.err));
    if (!AU.rows.length) { out.push(el('p', { class: 'muted' }, AU.busy || !AU.loaded ? 'Loading…' : 'Nothing recorded yet.')); return out; }
    out.push(el('div', { class: 'tl' }, ...AU.rows.map(r => { const [t, n] = auditLine(r);
      const it = el('div', { class: 'tl-item' }, el('time', {}, when(r.at)), el('div', {}, t));
      if (n) it.append(el('div', { class: 'tl-note' }, String(n).slice(0, 400)));
      return it; })));
    if (AU.more) { const m = el('button', { class: 'btn btn-sm', type: 'button', style: 'justify-self:start' }, AU.busy ? 'Loading…' : 'Load more'); m.addEventListener('click', () => loadAudit(false)); out.push(m); }
    return out;
  }
  window.slateAuditView = auditView;
  window.slateAuditReload = () => loadAudit(true);

  /* ---------------- report an issue: a floating button on every screen; reports kept in More → Report log ---------------- */
  const RP = { rows: [], loaded: false, busy: false, err: '', notes: {} };
  const RST = { open: 'Open', fixing: 'Being fixed', fixed: 'Fixed', closed: 'Closed' };
  async function loadReports() {
    RP.busy = true;
    const { data, error } = await sb.from('issue_reports').select('*').order('created_at', { ascending: false }).limit(200);
    RP.busy = false; RP.loaded = true; RP.at = Date.now(); RP.err = error ? friendly(error).message : '';
    if (data) RP.rows = data;
    try { if (S.view === 'reports' || S.view === 'more') render(true); } catch (_) {}
  }
  window.slateOpenReports = () => RP.rows.filter(r => r.status === 'open').length;
  function screenName() {
    try {
      const v = S.view, names = { mine: 'Home', all: 'Tasks', board: 'Board', gantt: 'Timeline', projects: 'Projects', cal: 'Calendar', dash: 'Dashboard', people: 'People', more: 'More', team: 'Team', activity: 'Log', setup: 'Settings', meet: 'Weekly meeting', std: 'Standard process', help: 'How to use', far: 'FAR calculator', chalk: 'Chalk Create', reports: 'Report log' };
      const sh = S.sheet && S.sheet.type ? ' · ' + ({ task: 'task', newTask: 'new task', project: 'project form', projView: 'project page', meeting: 'meeting minutes', pmeet: 'project meeting', notif: 'notifications', msgTask: 'message task' }[S.sheet.type] || S.sheet.type) : '';
      return ((names[v] || v || '') + sh).slice(0, 80);
    } catch (_) { return ''; }
  }
  function reportSheet() {
    addCss();
    const old = document.getElementById('slate-report-sheet'); if (old) old.remove();
    const where = screenName();
    const msg = el('div', { class: 'msg', role: 'status' });
    const ta = el('textarea', { maxlength: '2000', rows: '5', placeholder: 'What went wrong? What did you expect to happen?', style: 'font:inherit;font-size:16px;background:#f2f2f7;border:0;border-radius:10px;padding:12px 14px;resize:vertical' });
    const go = el('button', { class: 'primary', type: 'submit' }, 'Send report');
    const close = el('button', { class: 'link', type: 'button' }, 'Cancel');
    const form = el('form', { class: 'box', novalidate: '' },
      el('div', { class: 'brand' }, el('b', { style: 'font-size:22px;letter-spacing:.04em' }, 'Report an issue'), el('i', {}), el('span', {}, where ? 'On: ' + where : 'SLATE OS')),
      el('label', {}, 'Describe the problem', ta),
      el('span', { class: 'f', style: 'font-size:13px;color:#6e6e73' }, 'The screen you were on and your device are added automatically. The Principal and the COO see every report; you can follow yours in More → Report log.'),
      go, el('div', { class: 'row' }, close), msg);
    const root = el('div', { id: 'slate-report-sheet', class: 'slate-sheet', role: 'dialog', 'aria-label': 'Report an issue' }, form);
    close.addEventListener('click', () => root.remove());
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const t = ta.value.trim(); if (t.length < 3) { msg.className = 'msg err'; msg.textContent = 'Write a few words about the problem.'; return; }
      go.disabled = true; msg.className = 'msg'; msg.textContent = 'Sending…';
      const device = `${navigator.userAgent.slice(0, 180)} · ${screen.width}×${screen.height}${isStandalone() ? ' · app' : ' · browser'}`.slice(0, 240);
      const { error } = await sb.from('issue_reports').insert({ message: t, screen: where || null, device });
      if (error) { go.disabled = false; msg.className = 'msg err'; msg.textContent = friendly(error).message; return; }
      root.remove(); try { toast('Report sent. Thank you.'); } catch (_) {} loadReports();
    });
    document.body.append(root); ta.focus();
  }
  function reportButton() {
    if (document.getElementById('slate-report')) return;
    const b = el('button', { id: 'slate-report', type: 'button', 'aria-label': 'Report an issue', title: 'Report an issue' },
      el('span', { 'aria-hidden': 'true', class: 'ri' }, '!'), el('span', { class: 'rt' }, 'Report an issue'));
    b.addEventListener('click', reportSheet);
    document.body.append(b);
  }
  function reportView() {
    if (!RP.busy && (!RP.loaded || Date.now() - (RP.at || 0) > 10000)) loadReports();
    const boss = canAdmin(), nm = id => { try { return nameOf(id); } catch (_) { return displayName(people.get(id)); } };
    const out = [el('div', { class: 'page-h' }, el('div', {}, el('div', { class: 'eyebrow' }, boss ? 'Everyone’s reports' : 'Your reports'), el('h1', { class: 'h1' }, 'Report log'),
      el('p', { class: 'lead' }, boss ? 'Problems the team reported with the Report an issue button. Mark each one as it’s handled; the reporter is told.' : 'Problems you reported and where each one stands.')),
      (() => { const b = el('button', { class: 'btn btn-primary', type: 'button' }, 'Report an issue'); b.addEventListener('click', reportSheet); return b; })())];
    if (RP.err) out.push(el('div', { class: 'err' }, RP.err));
    if (!RP.rows.length) { out.push(el('p', { class: 'muted' }, RP.busy || !RP.loaded ? 'Loading…' : 'No reports yet.')); return out; }
    const counts = Object.keys(RST).map(k => [k, RP.rows.filter(r => r.status === k).length]).filter(x => x[1]);
    out.push(el('div', { class: 'chips' }, ...counts.map(([k, n]) => el('span', { class: 'chip', style: 'padding:6px 12px;background:#fff' }, `${RST[k]} ${n}`))));
    const col = { open: 'var(--overdue)', fixing: 'var(--late)', fixed: 'var(--ontime)', closed: 'var(--muted)' };
    out.push(el('div', { class: 'list' }, ...RP.rows.map(r => {
      const card = el('div', { class: 'card', style: 'border-radius:0;border-bottom:1px solid var(--line);gap:8px;box-shadow:inset 3px 0 0 ' + col[r.status] },
        el('div', { class: 'bar', style: 'justify-content:space-between' }, el('b', {}, boss ? nm(r.reporter) : 'You'), el('span', { class: 'pill', style: 'color:' + col[r.status] }, RST[r.status] || r.status)),
        el('div', { style: 'white-space:pre-wrap;overflow-wrap:anywhere' }, r.message),
        el('div', { class: 'f-hint' }, [when(r.created_at), r.screen ? 'on ' + r.screen : '', boss && r.device ? r.device.replace(/Mozilla\/5\.0 \(([^)]*)\).*/, '$1') : ''].filter(Boolean).join(' · ')),
        r.note ? el('p', { class: 'quote' }, r.note) : el('span'),
        r.updated_by ? el('div', { class: 'f-hint' }, `Updated by ${nm(r.updated_by)} · ${when(r.updated_at)}`) : el('span'));
      if (boss) {
        const note = el('input', { maxlength: '1000', placeholder: 'Note for the reporter (optional)', style: 'background:#fff' }); note.value = RP.notes[r.id] != null ? RP.notes[r.id] : (r.note || '');
        note.addEventListener('input', () => { RP.notes[r.id] = note.value; });
        const set = st => async () => {
          const { error } = await sb.from('issue_reports').update({ status: st, note: (RP.notes[r.id] != null ? RP.notes[r.id] : r.note || '').trim() || null }).eq('id', r.id);
          if (error) { try { toast(friendly(error).message); } catch (_) {} return; }
          delete RP.notes[r.id]; try { toast('Marked ' + RST[st].toLowerCase()); } catch (_) {} loadReports();
        };
        const btn = (st, l, primary) => { const b = el('button', { class: 'btn btn-sm' + (primary ? ' btn-primary' : ''), type: 'button', style: primary ? '' : 'background:#fff' }, l); b.addEventListener('click', set(st)); return b; };
        const acts = r.status === 'open' ? [btn('fixing', 'Being fixed'), btn('fixed', 'Fixed', true), btn('closed', 'Close')]
                   : r.status === 'fixing' ? [btn('fixed', 'Fixed', true), btn('closed', 'Close'), btn('open', 'Reopen')]
                   : [btn('open', 'Reopen')];
        card.append(note, el('div', { class: 'actions' }, ...acts));
      }
      return card;
    })));
    return out;
  }
  window.slateReportView = reportView;
  function setupReports() {
    reportButton(); loadReports();
    sb.channel('slate-reports').on('postgres_changes', { event: '*', schema: 'public', table: 'issue_reports' }, () => loadReports()).subscribe();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadReports(); });
  }

  /* ---------------- weekly backup: the Principal and the COO download all data (More → Backup) ---------------- */
  const BK = { last: null, loaded: false, busy: false, msg: '' };
  async function loadBackups() {
    const { data } = await sb.from('backup_log').select('at,by_user,rows_total,format').order('at', { ascending: false }).limit(10);
    BK.list = data || []; BK.last = (data && data[0]) || null; BK.loaded = true;
    placeBackupBanner(true); try { if (S.view === 'backup') render(true); } catch (_) {}
  }
  const bkDue = () => BK.loaded && (!BK.last || Date.now() - new Date(BK.last.at).getTime() > 7 * 864e5);
  function saveFile(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500); }
  function loadXlsxLib() { return window.XLSX ? Promise.resolve(window.XLSX) : new Promise((ok, bad) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = () => ok(window.XLSX); s.onerror = () => bad(new Error('Couldn’t load the Excel tool. Check the connection and try again.')); document.head.append(s); }); }
  async function downloadBackup(fmt) {
    if (BK.busy) return; BK.busy = true; BK.msg = 'Preparing the backup…'; try { render(true); } catch (_) {}
    try {
      const { data, error } = await sb.rpc('backup_export', { p_format: fmt });
      if (error) throw friendly(error);
      const day = new Date().toISOString().slice(0, 10);
      if (fmt === 'json') saveFile(`SLATE_OS_backup_${day}.json`, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
      else {
        const X = await loadXlsxLib();
        const pn = {}; (data.profiles || []).forEach(p => { pn[p.id] = p.label || p.full_name || p.email; });
        const nm = id => pn[id] || id || '';
        const docs = data.docs || [], by = c => docs.filter(d => d.path.split('/')[0] === c);
        const projs = {}; by('projects').forEach(d => { projs[d.path.split('/')[1]] = d.data; });
        const ag = {}; by('agreements').forEach(d => { ag[d.path.split('/')[1]] = d.data; });
        const pl = id => projs[id] ? [projs[id].code, projs[id].name].filter(Boolean).join(' · ') : '';
        const st = t => t.legacy ? 'Before SLATE OS' : t.archived ? 'Archived' : t.doneAt ? (t.target ? (t.doneAt < t.target ? 'Done early' : t.doneAt === t.target ? 'Done on time' : 'Done late') : 'Done') : t.target ? (t.target < day ? 'Overdue' : 'Open') : 'No date';
        const sheets = {
          Projects: Object.entries(projs).map(([id, p]) => ({ Code: p.code, Name: p.name, Status: p.status, Closed: p.closed ? 'Yes' : '', Stage: p.entry || '', Type: p.type, Pod: p.pod, 'Other pods': [p.pod2, ...(p.pods || [])].filter(x => x && x !== p.pod).join(', '), Katha: p.katha, Client: p.client, Contact: p.contact, Phone: p.phone, Location: p.location,
            'Agreement status': (ag[id] || {}).agStatus || '', 'Agreement date': (ag[id] || {}).agDate || '', 'Agreement ref': (ag[id] || {}).agRef || '', 'Contract completion': p.dueDate || '', Scope: (p.scope || []).join(', '), Members: Object.entries(p.members || {}).filter(([k, m]) => m).map(([k, m]) => nm(k) + (m.status !== 'approved' ? ' (pending)' : '')).join(', '), Created: p.createdAt || '', Note: p.note || '' })),
          Tasks: [...by('tasks'), ...by('lead')].map(d => { const t = d.data; return { Project: pl(t.projectId), Task: t.title, Type: t.kind, Phase: t.phase, 'Assigned to': nm(t.assignee), Target: t.target || '', 'Original target': t.originalTarget || '', Revisions: t.revisions || 0, Completed: t.doneAt || '', Status: st(t), Private: d.path.startsWith('lead/') ? 'Yes' : '', Created: t.createdAt || '', 'Created by': nm(t.createdBy) }; }),
          Submissions: Object.values(projs).flatMap(p => (p.subs || []).map(x => ({ Project: [p.code, p.name].join(' · '), Submitted: x.what, Date: x.date, Revision: x.rev, Approved: x.ok === false ? 'Waiting' : 'Yes', Note: x.note || '' }))),
          Meetings: by('meetings').map(d => { const m = d.data; return { Date: m.date, No: m.no || '', Organiser: nm(m.organiser), Status: m.status, Present: Object.entries(m.attendance || {}).filter(([k, v]) => v === 'present' || v === 'late').map(([k, v]) => nm(k) + (v === 'late' ? ' (late)' : '')).join(', '), Decisions: (m.decisionList || []).map(x => x.text).join(' | ') || m.decisions || '', Actions: (m.actions || []).map(a => `${a.text} [${(a.owners || [a.owner]).map(nm).join(', ')}${a.due ? ', ' + a.due : ''}]`).join(' | '), Notes: m.notes || '' }; }),
          'Studio rules': ((by('meetcfg').find(d => d.path === 'meetcfg/rules') || {}).data || { items: [] }).items.map(x => ({ Rule: x.text, Category: x.cat, Since: x.since })),
          People: (data.profiles || []).map(p => ({ Name: pn[p.id], Email: p.email, Designation: p.role_label, Team: p.team, Active: p.active ? 'Yes' : 'No', Joined: p.created_at })),
          Messages: (data.notifications_sent || []).map(x => ({ Sent: x.created_at, From: nm(x.from), To: nm(x.to), Message: x.body, Reply: x.reply || '', 'Replied at': x.replied_at || '', 'Done at': x.done_at || '', 'Due': x.due_at || '', Note: x.reply_note || '' })),
          Reports: (data.issue_reports || []).map(r => ({ Reported: r.created_at, By: nm(r.reporter), Screen: r.screen, Issue: r.message, Status: r.status, Note: r.note || '' })),
          'Activity log': (data.activity_log || []).map(a => ({ At: a.at, By: nm(a.actor), Area: a.table_name, Action: a.action, Item: a.row_id || '' }))
        };
        // Finance comes back only for the Principal and the COO.
        if (Array.isArray(data.finance)) {
          const fin = c => data.finance.filter(d => d.path.split('/')[0] === c).map(d => ({ ...d.data, _id: d.path.split('/')[1] }));
          const fp = {}; fin('projects').forEach(p => { fp[p._id] = p; });
          const fi = {}; fin('invoices').forEach(i => { fi[i._id] = i; });
          const fpl = id => fp[id] ? `${fp[id].code} · ${fp[id].name}` : '';
          sheets['Finance projects'] = fin('projects').map(p => ({ Code: p.code, Name: p.name, Client: p.client, Status: p.status || 'active', 'Fee (BDT)': p.fee, Milestones: (p.milestones || []).map(m => `${m.label} ${m.pct}%`).join(' | '), Note: p.note || '' }));
          sheets['Finance invoices'] = fin('invoices').map(i => ({ No: i.no, Date: i.date, Due: i.due, Project: fpl(i.projectId), Description: i.desc, 'Fee (BDT)': i.amount, 'VAT %': i.vatPct, Status: i.status, 'Void reason': i.voidReason || '' }));
          sheets['Finance payments'] = fin('receipts').map(r => ({ Date: r.date, Invoice: (fi[r.invoiceId] || {}).no || '', Project: fpl(r.projectId), Received: r.received, AIT: r.ait, VDS: r.vds, Method: r.method, Ref: r.ref || '', 'Recorded by': nm(r.createdBy) }));
          sheets['Finance change log'] = (data.finance_log || []).map(a => ({ At: a.at, By: nm(a.actor), Record: a.path, Change: a.op }));
        }
        const wb = X.utils.book_new();
        wb.Props = { Title: 'SLATE OS backup ' + day, Author: data.exportedBy };
        X.utils.book_append_sheet(wb, X.utils.json_to_sheet([{ 'SLATE OS backup': day, 'Exported by': data.exportedBy, Note: data.note + '. The JSON backup holds every field; this workbook is the readable version.' }]), 'About');
        for (const [n, rows] of Object.entries(sheets)) X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows.length ? rows : [{ '': 'Nothing yet' }]), n);
        X.writeFile(wb, `SLATE_OS_backup_${day}.xlsx`);
      }
      BK.msg = 'Backup downloaded. Keep it somewhere safe, e.g. the studio Google Drive.';
      try { toast('Backup downloaded'); } catch (_) {}
      loadBackups();
    } catch (e) { BK.msg = '!' + e.message; }
    BK.busy = false; try { render(true); } catch (_) {}
  }
  function backupView() {
    if (!BK.loaded) loadBackups();
    const nm = id => { try { return nameOf(id); } catch (_) { return displayName(people.get(id)); } };
    const b = (fmt, label, primary) => { const x = el('button', { class: 'btn' + (primary ? ' btn-primary' : ''), type: 'button' }, BK.busy ? 'Preparing…' : label); if (BK.busy) x.disabled = true; x.addEventListener('click', () => downloadBackup(fmt)); return x; };
    const out = [el('div', { class: 'page-h' }, el('div', {}, el('div', { class: 'eyebrow' }, 'Principal and COO'), el('h1', { class: 'h1' }, 'Backup'),
      el('p', { class: 'lead' }, 'Download all SLATE OS data once a week and keep it somewhere safe. The COO gets a reminder every Thursday if no backup was taken that week.')))];
    out.push(el('div', { class: 'card', style: 'gap:6px' }, el('b', {}, BK.last ? 'Last backup: ' + when(BK.last.at) + ' by ' + nm(BK.last.by_user) : BK.loaded ? 'No backup taken yet' : 'Checking…'),
      bkDue() ? el('div', { style: 'color:var(--overdue);font-weight:500' }, 'A backup is due.') : el('span')));
    out.push(el('div', { class: 'actions' }, b('xlsx', 'Download as Excel', true), b('json', 'Download full backup (JSON)')));
    if (BK.msg) out.push(el('div', { class: BK.msg.startsWith('!') ? 'err' : 'f-hint' }, BK.msg.replace(/^!/, '')));
    out.push(el('p', { class: 'f-hint', style: 'margin:0' }, 'Excel is the readable copy: projects, tasks, submissions, meetings, studio rules, people, messages, reports and the activity log, one sheet each. The JSON file holds every field and can be used to restore the data. Each download is recorded in the log. ' + (S.isOwner ? '' : 'The Principal’s private tasks are not included in your backup.')));
    if ((BK.list || []).length) out.push(el('section', { class: 'sec' }, el('div', { class: 'sec-h' }, el('h2', {}, 'Recent backups')),
      el('div', { class: 'list' }, ...BK.list.map(r => el('div', { class: 'card', style: 'border-radius:0;border-bottom:1px solid var(--line);grid-template-columns:minmax(0,1fr) auto' }, el('span', {}, `${when(r.at)} · ${nm(r.by_user)}`), el('span', { class: 'f-hint' }, (r.format || '').toUpperCase()))))));
    return out;
  }
  window.slateBackupView = backupView;
  window.slateBackupDue = () => bkDue();
  /* a reminder on the COO's Home when the weekly backup is due */
  function placeBackupBanner(force) {
    const show = (() => { try { return S.view === 'mine' && me && me.designation === 'coo' && bkDue(); } catch (_) { return false; } })();
    const old = document.getElementById('slate-backup-banner');
    if (!show) { if (old) old.remove(); return; }
    const main = document.querySelector('main'); if (!main || (old && !force && main.contains(old))) return;
    const go = el('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Download now');
    go.addEventListener('click', () => { try { S.view = 'backup'; render(true); window.scrollTo(0, 0); } catch (_) {} });
    const box = el('div', { id: 'slate-backup-banner', class: 'banner' }, el('span', {}, 'Weekly backup due' + (BK.last ? ' · last one ' + when(BK.last.at) : ' · none taken yet')), go);
    if (old) old.replaceWith(box); else main.prepend(box);
  }
  function setupBackup() {
    if (!canAdmin()) return;
    loadBackups();
    new MutationObserver(() => placeBackupBanner(false)).observe(document.body, { childList: true, subtree: true });
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
  .slate-prow{display:grid;grid-template-columns:22px 38px minmax(0,1fr);gap:12px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line);cursor:pointer}
  .slate-prow:last-child{border-bottom:0}
.slate-pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
  .slate-pc{background:var(--group);border-radius:14px;padding:6px;display:grid;gap:4px;align-content:start;box-shadow:inset 0 0 0 1.5px transparent}
  .slate-pc.on{box-shadow:inset 0 0 0 1.5px #34C759}
  .slate-pc-h{appearance:none;border:0;background:transparent;font:inherit;color:inherit;cursor:pointer;display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:8px 10px 6px;text-align:left}
  .slate-pc-h b{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#3a3a3c}
  .slate-pc-h span{font-size:12.5px;color:var(--muted)}
  .slate-pc-b{display:grid;gap:4px}
  .slate-pt{appearance:none;border:0;background:#fff;border-radius:10px;font:inherit;color:inherit;cursor:pointer;display:grid;grid-template-columns:auto minmax(0,1fr) 22px;gap:10px;align-items:center;padding:8px 10px;text-align:left}
  .slate-pt:hover{background:#fafafa}
  .slate-pt.on{background:#fff;box-shadow:inset 0 0 0 1.5px #34C759}
  .slate-pt-a{position:relative;display:inline-grid;line-height:0}
  .slate-pt-a i{position:absolute;right:-1px;bottom:-1px;width:10px;height:10px;border-radius:50%;border:2px solid #fff}
  .slate-pt-t{display:grid;min-width:0;line-height:1.25}
  .slate-pt-t b{font-size:14.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .slate-pt-t span{font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .slate-pt-c{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;color:#fff;background:transparent;box-shadow:inset 0 0 0 1.5px #d1d1d6}
  .slate-pt.on .slate-pt-c{background:#34C759;box-shadow:none}
  .slate-bubs{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:6px;background:var(--group);border-radius:12px;padding:12px 8px}
  .slate-bub{appearance:none;border:0;background:transparent;border-radius:12px;padding:8px 4px;display:grid;justify-items:center;gap:3px;cursor:pointer;font:inherit;color:inherit;min-width:0}
  .slate-bub:hover{background:rgba(0,0,0,.04)}
  .slate-bub-a{position:relative;display:grid;place-items:center;box-sizing:border-box;width:66px;height:66px;border-radius:50%;border:2.5px solid transparent;line-height:0;transition:border-color .15s}
  .slate-bub-a .ava{width:56px;height:56px;font-size:19px;line-height:1;margin:0;vertical-align:top}
  .slate-bub-a .ava:not(.lead):not(.ic){background:#fff;color:#3a3a3c;box-shadow:inset 0 0 0 1px var(--border)}
  .slate-bub.on .slate-bub-a{border-color:#34C759}
  .slate-bub-on{position:absolute;right:3px;bottom:3px;width:13px;height:13px;border-radius:50%;background:#34C759;border:2px solid var(--group)}
  .slate-bub-ck{position:absolute;right:-2px;top:-2px;width:22px;height:22px;border-radius:50%;background:#34C759;color:#fff;font-size:12px;line-height:1;display:grid;place-items:center;border:2px solid var(--group)}
  .slate-bub-n{font-size:14px;font-weight:600;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
  .slate-bub-r{font-size:11.5px;color:var(--muted);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .slate-bub.on .slate-bub-n{color:#000}
  .slate-acc{display:block;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-block:max(24px,env(safe-area-inset-top,0px)) 40px}
  .slate-acc .box{width:min(560px,100%);margin:0 auto}
  .slate-acc .f{font-size:13.5px;color:#6e6e73;line-height:1.4}
  .slate-acc-card{display:grid;gap:12px;background:#f2f2f7;border-radius:14px;padding:16px}
  .slate-acc-card>b{font-size:16px}
  .slate-acc-card input,.slate-acc-card select{background:#fff}
  .slate-acc select{font:inherit;font-size:16px;background:#fff;border:0;border-radius:10px;padding:12px 10px;color:#000;width:100%}
  .slate-acc-2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  @media (max-width:440px){.slate-acc-2{grid-template-columns:1fr}}
  .slate-acc-list{display:grid;background:#fff;border-radius:10px;overflow:hidden}
  .slate-acc-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:11px 14px;border-top:1px solid #e5e5ea}
  .slate-acc-row:first-child{border-top:0}
  .slate-acc-btns{display:flex;flex-direction:column;align-items:flex-end;gap:4px}
  .slate-acc-btns .link:last-child:not(:first-child){color:#8e8e93;font-size:13px}
  .slate-acc-row .n{font-weight:600;font-size:15px}
  .slate-acc-row .e{font-size:12.5px;color:#8e8e93;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .slate-acc-row .link{white-space:nowrap}
  .slate-acc-row .link.danger{color:#d7262b}
  .slate-acc-row .link:disabled{color:#c7c7cc;cursor:default}
  .slate-acc-res{display:grid;gap:8px;background:#fff;border:2px solid #34C759;border-radius:14px;padding:16px}
  .slate-acc-res code{font:600 22px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.06em;background:#f2f2f7;border-radius:10px;padding:12px;text-align:center;user-select:all;-webkit-user-select:all}
  .slate-prow input{width:20px;height:20px;margin:0;accent-color:#000}
  #slate-acct{position:absolute;top:calc(10px + env(safe-area-inset-top,0px));right:max(12px,env(safe-area-inset-right,0px));z-index:6;
    font:500 12.5px -apple-system,BlinkMacSystemFont,sans-serif;background:#f2f2f7;color:#000;border:0;border-radius:999px;padding:6px 12px;cursor:pointer}
  @media (max-width:560px){#slate-acct{top:auto;bottom:calc(14px + env(safe-area-inset-bottom,0px));position:fixed}}
  #slate-report{position:fixed;left:max(14px,env(safe-area-inset-left,0px));bottom:calc(18px + env(safe-area-inset-bottom,0px));z-index:14;display:flex;align-items:center;gap:8px;
    font:600 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#fff;color:#1c1c1e;border:0;border-radius:999px;padding:6px 14px 6px 6px;cursor:pointer;
    box-shadow:0 4px 14px rgba(0,0,0,.16),0 0 0 1px rgba(0,0,0,.06)}
  #slate-report .ri{width:26px;height:26px;border-radius:50%;background:#d7262b;color:#fff;display:grid;place-items:center;font-size:15px;font-weight:800}
  @media (max-width:560px){#slate-report{padding:6px}#slate-report .rt{display:none}}
  body.locked #slate-report{display:none}
  @media print{#slate-report{display:none}}`;

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
    if (mode === 'recovery' || mode === 'temp') {
      const temp = mode === 'temp';
      const pw = el('input', { type: 'password', autocomplete: 'new-password', minlength: '8', required: '' });
      const pw2 = el('input', { type: 'password', autocomplete: 'new-password', minlength: '8' });
      const go = el('button', { class: 'primary', type: 'submit' }, 'Set password and continue');
      const out = el('button', { class: 'link', type: 'button' }, 'Sign out');
      out.addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
      box.append(brand, temp ? el('p', { style: 'margin:0;font-size:15px;line-height:1.4;text-align:center' }, 'You signed in with a temporary password. Choose your own to continue. Only you will know it.') : el('span'),
        el('label', {}, 'New password (8+ characters)', pw), el('label', {}, 'Type it again', pw2), go, temp ? el('div', { class: 'row' }, out) : el('span'), msg);
      box.addEventListener('submit', async e => {
        e.preventDefault(); if (pw.value.length < 8) return say('Use at least 8 characters.', true);
        if (pw.value !== pw2.value) return say('The two passwords don’t match.', true);
        go.disabled = true; say('Saving…');
        const { error } = await sb.auth.updateUser({ password: pw.value });
        go.disabled = false;
        if (error) return say(/different/i.test(error.message) ? 'Choose a password different from the temporary one.' : friendly(error).message, true);
        if (temp) { try { await sb.rpc('temp_password_pending'); } catch (_) {} }
        onDone();
      });
      root.append(box); pw.focus(); return root;
    }
    const email = el('input', { type: 'email', autocomplete: 'username', required: '', inputmode: 'email' });
    const pw = el('input', { type: 'password', autocomplete: 'current-password', required: '' });
    const keep = el('input', { type: 'checkbox', style: 'width:20px;height:20px;accent-color:#000;margin:0' });
    keep.checked = remember();
    const keepRow = el('label', { style: 'display:flex;gap:10px;align-items:center;font-size:15px;font-weight:500;color:#000' }, keep, 'Keep me signed in');
    const go = el('button', { class: 'primary', type: 'submit' }, 'Sign in');
    const magic = el('button', { class: 'link', type: 'button' }, 'Email me a sign-in link');
    const forgot = el('button', { class: 'link', type: 'button' }, 'Forgot password?');
    box.append(brand, el('label', {}, 'Studio email', email), el('label', {}, 'Password', pw), keepRow, go, el('div', { class: 'row' }, magic, forgot), msg);
    const setKeep = () => { try { localStorage.setItem('slate-remember', keep.checked ? '1' : '0'); } catch (_) {} };
    keep.addEventListener('change', setKeep);
    magic.addEventListener('click', setKeep);
    box.addEventListener('submit', async e => {
      e.preventDefault(); setKeep(); if (!email.value || !pw.value) return say('Enter your email and password.', true);
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
      installRow(), notifRow(),
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
    try { const { data: tp } = await sb.rpc('temp_password_pending'); if (tp === true) await new Promise(r => whenBody(() => authScreen('temp', r))); } catch (_) {}
    try { await loadAll(); } catch (e) { started = false; authScreen('signin'); return; }
    hideAuth(); goLive(); addCss(); window.slateAccount = accountPanel;
    setupNotifications();
    setupPresence(session);
    setupMessages();
    setupReports();
    setupBackup();
    // Finance is a separate page; only ask whether to show its link. Anyone else gets null and sees nothing.
    sb.rpc('fin_role').then(({ data }) => { window.slateFinanceRole = ['principal', 'coo'].includes(data) ? data : null;
      try { if (window.slateFinanceRole && S.view === 'more') render(true); } catch (_) {} }, () => {});
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
