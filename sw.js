// Service worker kWh Log: supaya aplikasi bisa dibuka tanpa sinyal (di depan meteran).
//
// - File aplikasi (satu origin): jaringan dulu, tapi kalau lambat (> 3 dtk) atau mati, pakai salinan terakhir.
//   Jadi setelah deploy, versi baru langsung terpakai saat online dan tidak ada nomor versi yang perlu dinaikkan.
// - Font Google dan modul Supabase dari esm.sh: pakai salinan tersimpan, diperbarui di belakang layar.
// - Panggilan ke Supabase (REST, auth, realtime) sengaja TIDAK disentuh. Antrean offline ada di store.js.
const SHELL = 'kwhlog-shell';
const CDN = 'kwhlog-cdn';
const CDN_HOSTS = ['esm.sh', 'fonts.googleapis.com', 'fonts.gstatic.com'];
const SLOW_MS = 3000;
const SHELL_FILES = [
  './', 'index.html', 'style.css', 'manifest.webmanifest',
  'js/app.js', 'js/calc.js', 'js/store.js', 'js/rows.js', 'js/config.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== CDN).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) e.respondWith(networkFirst(req));
  else if (CDN_HOSTS.includes(url.hostname)) e.respondWith(staleWhileRevalidate(e, req));
});

async function networkFirst(req) {
  const cache = await caches.open(SHELL);
  const net = fetch(req).then(res => { if (res.ok) cache.put(req, res.clone()); return res; });
  net.catch(() => {}); // kegagalan susulan setelah kita pindah ke cache tidak perlu jadi galat tak tertangani
  const slow = new Promise((_, reject) => setTimeout(reject, SLOW_MS));
  try {
    return await Promise.race([net, slow]);
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' })
      || (req.mode === 'navigate' ? await cache.match('index.html') : undefined);
    return hit || net; // tak ada salinan: tunggu jaringan apa adanya
  }
}

async function staleWhileRevalidate(e, req) {
  const cache = await caches.open(CDN);
  const hit = await cache.match(req);
  const net = fetch(req).then(res => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; });
  e.waitUntil(net.catch(() => {}));
  return hit || net;
}
