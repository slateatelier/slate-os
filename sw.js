/* SLATE OS service worker: lets the app open from the home screen.
   The page and its scripts are fetched fresh whenever online (so updates arrive at once);
   the saved copy is used only when the network is unavailable. Data calls are never cached. */
const CACHE = 'slate-os-v176';
const SHELL = ['/', '/books', '/books-host.js', '/pin.js', '/slate-db.js', '/config.js', '/qr.js', '/manifest.webmanifest', '/icons/tile-black.png',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/icons/favicon-32.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('supabase.co')) return;                 // live data: always the network
  const isLib = url.hostname === 'cdn.jsdelivr.net';
  const isIcon = url.origin === self.location.origin && url.pathname.startsWith('/icons/');
  if (isLib || isIcon) {                                             // versioned files: saved copy first
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Books: the saved copy opens at once; a fresh copy is fetched behind it for next time (a release clears the saved copy)
  if (url.pathname === '/books' || url.pathname === '/books.html' || url.pathname === '/books-host.js') {
    const key = url.pathname === '/books-host.js' ? '/books-host.js' : '/books';
    const fresh = fetch(req).then(res => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(key, copy)); } return res; });
    e.respondWith(caches.match(key).then(hit => hit || fresh).catch(() => fresh));
    e.waitUntil(fresh.catch(() => {}));
    return;
  }
  // Other pages (Finance) are never stored, so they can't replace the saved copy of the app.
  if (req.mode === 'navigate' && url.pathname !== '/' && url.pathname !== '/index.html') return;
  if (/^\/finance(\.js|\.html)?$/.test(url.pathname)) return;
  e.respondWith(fetch(req).then(res => {                             // the app itself: network first
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req.mode === 'navigate' ? '/' : req, copy)); }
    return res;
  }).catch(() => caches.match(req.mode === 'navigate' ? '/' : req)));
});

/* Notifications: shown (with the phone's sound) even when SLATE OS is closed, and the icon number updated. */
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: 'SLATE OS', body: e.data ? e.data.text() : '' }; }
  const jobs = [self.registration.showNotification(d.title || 'SLATE OS', {
    body: d.body || '', tag: d.tag, renotify: true, silent: false,
    icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: d.url || '/' } })];
  if (typeof d.badge === 'number' && self.navigator && 'setAppBadge' in self.navigator) {
    jobs.push(d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge());
  }
  e.waitUntil(Promise.all(jobs).catch(() => {}));
});
/* Tapping a notification opens what it is about. Its tag is "<kind>-<id>"; the app looks the
   notification up and opens the task, approval, meeting or message behind it. */
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.notification.tag === 'still-working') {                    // "Are you still working?": any tap means yes
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      list.forEach(c => c.postMessage({ type: 'slate-still-here' }));
      const home = list[0]; return home ? home.focus() : self.clients.openWindow('/');
    }));
    return;
  }
  const m = /^([a-z_]+)-(\d+)$/.exec(e.notification.tag || '');
  const go = m ? `n:${m[2]}:${m[1]}` : '';
  const url = go ? '/?go=' + encodeURIComponent(go) : ((e.notification.data && e.notification.data.url) || '/');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
    const home = list.find(c => { try { const p = new URL(c.url).pathname; return p === '/' || p === '/index.html'; } catch (_) { return false; } });
    if (home) { if (go) home.postMessage({ type: 'slate-go', go }); return home.focus(); }
    const other = list.find(c => 'navigate' in c);
    if (other) { const c = await other.navigate(url).catch(() => null); if (c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
