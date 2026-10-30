/* SLATE OS · Books host
   SLATE Books was written against a small host interface (window.claude.use: db, user, assets, downloads).
   Inside SLATE OS this file provides that interface on top of Supabase, so the Books code runs unchanged:
     db ........ every Books record is a row of books_docs (path = '<collection>/<id>', data = the record),
                 read once per collection and kept live through realtime; row security decides who sees what
     user ...... the signed-in SLATE OS account; the Books role comes from the database (books_role)
     assets .... files in the private storage bucket 'books', opened through short-lived signed links
     downloads . files saved straight to the device
   Same sign-in as SLATE OS: the session is shared with the app at /. */
(function () {
'use strict';
const CFG = window.SLATE_CONFIG;
const remember = () => { try { return localStorage.getItem('slate-remember') !== '0'; } catch (_) { return true; } };
const safe = s => ({ getItem: k => { try { return s.getItem(k); } catch (_) { return null; } },
  setItem: (k, v) => { try { s.setItem(k, v); } catch (_) {} }, removeItem: k => { try { s.removeItem(k); } catch (_) {} } });
const L_ = safe(window.localStorage), S_ = safe(window.sessionStorage);
const authStore = {
  getItem: k => (remember() ? L_.getItem(k) : null) || S_.getItem(k),
  setItem: (k, v) => { if (remember()) { L_.setItem(k, v); S_.removeItem(k); } else { S_.setItem(k, v); L_.removeItem(k); } },
  removeItem: k => { L_.removeItem(k); S_.removeItem(k); }
};
const sessionLock = (() => { let tail = Promise.resolve(); return (_n, _t, fn) => { const r = tail.then(() => fn()); tail = r.catch(() => {}); return r; }; })();
if (!window.supabase || !CFG) return;
const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: authStore, lock: sessionLock } });
addEventListener('pagehide', () => { try { sb.auth.stopAutoRefresh(); } catch (_) {} });
addEventListener('pageshow', () => { try { sb.auth.startAutoRefresh(); } catch (_) {} });

/* ---------- errors in the shape Books expects ---------- */
function hostErr(e) {
  const m = (e && (e.message || e.details || e.hint)) || String(e || '');
  const err = new Error(m);
  if (/row-level security|permission denied|violates row-level/i.test(m)) err.code = 'invalid_argument';
  else if (/closed up to|Only the Principal/i.test(m)) { err.code = 'rule'; err.userMsg = m.replace(/^.*?ERROR:\s*/, ''); }
  else if (/Failed to fetch|NetworkError|network/i.test(m)) err.userMsg = 'Couldn’t reach the server. Check the connection and try again.';
  else err.userMsg = m;
  return err;
}
const collOf = p => p.replace(/\/[^/]+$/, '');
const idOf = p => p.replace(/^.*\//, '');

/* ---------- db: books_docs with live updates ---------- */
const cache = new Map();            // collection path -> Map(id -> data)
const loading = new Map();          // collection path -> Promise
const collSubs = new Map();         // collection path -> Set(callback)
const docSubs = new Map();          // doc path -> Set(callback)
async function loadColl(coll) {
  if (cache.has(coll)) return cache.get(coll);
  if (loading.has(coll)) return loading.get(coll);
  const p = (async () => {
    const m = new Map();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('books_docs').select('path,data').eq('coll', coll).order('path').range(from, from + 999);
      if (error) throw hostErr(error);
      data.forEach(r => m.set(idOf(r.path), r.data));
      if (data.length < 1000) break;
    }
    cache.set(coll, m); loading.delete(coll); return m;
  })();
  loading.set(coll, p); return p;
}
const snapOf = m => ({ docs: [...m.entries()].map(([id, d]) => ({ id, exists: true, data: () => d })) });
function emitColl(coll) { const m = cache.get(coll), s = collSubs.get(coll); if (m && s) s.forEach(cb => { try { cb(snapOf(m)); } catch (e) { console.error(e); } }); }
function emitDoc(path) { const s = docSubs.get(path); if (!s) return; const m = cache.get(collOf(path)), d = m ? m.get(idOf(path)) : undefined;
  s.forEach(cb => { try { cb({ id: idOf(path), exists: d !== undefined, data: () => d }); } catch (e) { console.error(e); } }); }
function applyRow(path, data) {   // data undefined = deleted
  const coll = collOf(path), m = cache.get(coll); if (!m) return;
  if (data === undefined) m.delete(idOf(path)); else m.set(idOf(path), data);
  emitColl(coll); emitDoc(path);
}
let live = null;
function startLive() {
  if (live) return;
  live = sb.channel('books-docs').on('postgres_changes', { event: '*', schema: 'public', table: 'books_docs' }, pl => {
    if (pl.eventType === 'DELETE') { const p = pl.old && pl.old.path; if (p) applyRow(p, undefined); }
    else if (pl.new && pl.new.path) applyRow(pl.new.path, pl.new.data);
  }).subscribe();
}
/* a refresh when the page comes back into view, in case a live update was missed while it slept */
async function refreshAll() { for (const coll of [...cache.keys()]) { cache.delete(coll); try { await loadColl(coll); emitColl(coll); [...docSubs.keys()].filter(p => collOf(p) === coll).forEach(emitDoc); } catch (_) {} } }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshAll(); });

function docRef(path) {
  return {
    id: idOf(path),
    onSnapshot(cb, onErr) {
      if (!docSubs.has(path)) docSubs.set(path, new Set()); docSubs.get(path).add(cb); startLive();
      loadColl(collOf(path)).then(() => emitDoc(path)).catch(e => { if (onErr) onErr(e); });
      return () => docSubs.get(path).delete(cb);
    },
    async get() {
      const { data, error } = await sb.from('books_docs').select('data').eq('path', path).maybeSingle();
      if (error) throw hostErr(error);
      return { id: idOf(path), exists: !!data, data: () => data ? data.data : undefined };
    },
    async set(data) {
      const row = { path, coll: collOf(path), doc_id: idOf(path), data };
      const { error } = await sb.from('books_docs').upsert(row, { onConflict: 'path' });
      if (error) throw hostErr(error);
      applyRow(path, data);
    },
    async update(patch) {
      const { data: cur, error: e1 } = await sb.from('books_docs').select('data').eq('path', path).maybeSingle();
      if (e1) throw hostErr(e1);
      if (!cur) { const err = new Error('not found'); err.code = 'invalid_argument'; throw err; }
      const next = Object.assign({}, cur.data, patch);
      const { data: out, error } = await sb.from('books_docs').update({ data: next }).eq('path', path).select('path');
      if (error) throw hostErr(error);
      if (!out || !out.length) { const err = new Error('not allowed'); err.code = 'invalid_argument'; throw err; }
      applyRow(path, next);
    },
    async delete() {
      const { error } = await sb.from('books_docs').delete().eq('path', path);
      if (error) throw hostErr(error);
      applyRow(path, undefined);
    }
  };
}
const db = {
  collection(coll) {
    return {
      doc: id => docRef(coll + '/' + id),
      onSnapshot(cb, onErr) {
        if (!collSubs.has(coll)) collSubs.set(coll, new Set()); collSubs.get(coll).add(cb); startLive();
        loadColl(coll).then(() => emitColl(coll)).catch(e => { if (onErr) onErr(e); });
        return () => collSubs.get(coll).delete(cb);
      }
    };
  },
  doc: path => docRef(path)
};

/* ---------- user ---------- */
let ME = null, ROLE = null, PEOPLE = {};
async function loadPeople() {
  const { data } = await sb.from('profiles').select('id,full_name,label,designation,active');
  PEOPLE = {}; (data || []).forEach(p => { PEOPLE[p.id] = p; });
}
const user = {
  async me() { return ME; },
  async can(what) { return what === 'data.write' ? ROLE !== 'Viewer' : true; },
  async profiles(ids) { const out = {}; ids.forEach(id => { const p = PEOPLE[id]; if (p) out[id] = { name: p.label || p.full_name }; }); return out; }
};

/* ---------- files: private bucket, signed links ---------- */
const urls = new Map();   // storage path -> { url, until }
let rerender = null;
function fileUrl(id) {
  if (!id) return '';
  const hit = urls.get(id); if (hit && hit.until > Date.now()) return hit.url;
  if (!hit || hit.until !== 0) {
    urls.set(id, { url: hit ? hit.url : '', until: 0 });
    sb.storage.from('books').createSignedUrl(id, 3600).then(({ data }) => {
      if (data && data.signedUrl) { urls.set(id, { url: data.signedUrl, until: Date.now() + 50 * 60000 }); if (rerender) rerender(); }
    });
  }
  return hit ? hit.url : '';
}
const assets = {
  async upload(blob) {
    const ext = ((blob.name || '').match(/\.(\w+)$/) || [, (blob.type || '').split('/')[1] || 'bin'])[1].toLowerCase().slice(0, 5);
    const path = ME.id + '/' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.' + ext;
    const { error } = await sb.storage.from('books').upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false });
    if (error) throw hostErr(error);
    return { id: path, contentType: blob.type || '', sizeBytes: blob.size || 0 };
  }
};
const downloads = {
  async save({ filename, data }) {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    return { status: 'saved' };
  }
};

/* ---------- spaces: Studio · Business · Books (Principal and COO) ---------- */
function spaceSwitch() {
  if (!(ROLE === 'Principal' || (ME && PEOPLE[ME.id] && PEOPLE[ME.id].designation === 'coo'))) return null;
  const el = document.createElement('div'); el.className = 'space-sw'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Space');
  [['Studio', '/'], ['Business', '/?space=biz'], ['Books', null]].forEach(([l, href]) => {
    const b = document.createElement(href ? 'a' : 'span'); b.className = 'space-b' + (href ? '' : ' on'); b.textContent = l;
    if (href) b.href = href; else b.setAttribute('aria-current', 'page');
    el.append(b);
  });
  return el;
}
/* the left of the header, as in Studio: your profile icon and the bell (Studio keeps the count; the bell opens Studio's inbox) */
function headLeft(fallbackAva) {
  if (!spaceSwitch()) return [];
  let hd = null; try { hd = JSON.parse(localStorage.getItem('slate-hdr') || 'null'); } catch (_) {}
  if (hd && ME && hd.uid !== ME.id) hd = null;
  const me = document.createElement('button'); me.className = 'mebtn'; me.type = 'button'; me.title = 'Sign out'; me.setAttribute('aria-label', 'Your account: sign out');
  if (hd && hd.ava) { const t = document.createElement('template'); t.innerHTML = hd.ava; me.append(t.content.firstElementChild || fallbackAva()); } else me.append(fallbackAva());
  me.onclick = () => { if (confirm('Sign out of SLATE OS?')) signOut(); };
  const n = hd ? +hd.n || 0 : 0;
  const bell = document.createElement('button'); bell.type = 'button'; bell.className = 'bell' + (n ? ' has' : '');
  bell.setAttribute('aria-label', n ? 'Notifications, ' + n + ' new' : 'Notifications');
  bell.innerHTML = '<span class="bi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg></span>' + (n ? '<span class="bn">' + (n > 99 ? '99+' : n) + '</span>' : '');
  bell.onclick = () => { location.href = '/?go=inbox'; };
  return [me, bell];
}
async function signOut() { try { await sb.auth.signOut(); } catch (_) {} location.href = '/'; }

/* ---------- start ---------- */
const ready = (async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { signedOut: true };
  await loadPeople();
  const { data: role } = await sb.rpc('books_role');
  ROLE = role || null;
  const p = PEOPLE[session.user.id] || {};
  ME = { id: session.user.id, name: p.label || p.full_name || session.user.email, isOwner: ROLE === 'Principal',
    canEdit: ['Principal', 'COO', 'Accountant', 'Viewer'].includes(ROLE) };
  document.body.classList.toggle('has-spaces', !!spaceSwitch());
  return { ok: true };
})();

window.BooksHost = {
  ready, sb, fileUrl, spaceSwitch, signOut, headLeft,
  onChange(fn) { rerender = fn; },
  isCOO: id => !!(PEOPLE[id] && PEOPLE[id].designation === 'coo'),
  role: () => ROLE
};
window.claude = {
  async use(name) {
    const st = await ready;
    if (!st.ok) return null;
    return { db, user, assets, downloads }[name] || null;
  }
};
})();
