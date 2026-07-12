/* Wonder Jar service worker — network-first (stale caches have burned this family before) */
const CACHE = 'wonderjar-v1';
const CORE = ['./', './index.html', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

/* ---- reminder support (periodic background sync) ---- */
function azToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix' }).format(new Date());
}
function azHour() {
  return parseInt(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Phoenix', hour12: false, hour: '2-digit' })
      .format(new Date()),
    10
  );
}

function openMeta() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('wonderjar-sw', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('meta');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readLastEntries() {
  return openMeta().then((db) => new Promise((resolve) => {
    const get = db.transaction('meta', 'readonly').objectStore('meta').get('lastEntryByKid');
    get.onsuccess = () => resolve(get.result || null);
    get.onerror = () => resolve(null);
  })).catch(() => null);
}

self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'lastEntryByKid') {
    openMeta().then((db) => {
      db.transaction('meta', 'readwrite').objectStore('meta').put(e.data.value, 'lastEntryByKid');
    }).catch(() => {});
  }
});

self.addEventListener('periodicsync', (e) => {
  if (e.tag !== 'jar-reminder') return;
  e.waitUntil((async () => {
    if (azHour() < 16) return; // only nudge from late afternoon on
    const last = await readLastEntries();
    if (!last) return;
    const today = azToday();
    const waiting = Object.entries(last).filter(([, d]) => d !== today).map(([name]) => name);
    if (!waiting.length) return;
    await self.registration.showNotification('Wonder Jar ✨', {
      body: waiting.length === 1
        ? `${waiting[0]}'s jar is waiting for tonight's happy thought!`
        : 'The jars are waiting for tonight\'s happy thoughts!',
      icon: './icon.svg',
      badge: './icon.svg',
      tag: 'jar-reminder'
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return clients.openWindow('./');
    })
  );
});
