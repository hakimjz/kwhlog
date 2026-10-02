// Logika service worker (sw.js) dengan Cache API dan fetch tiruan. Jalankan: node test/sw.test.js
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const code = readFileSync(new URL('sw.js', root), 'utf8');
const ORIGIN = 'https://app.test';

/* ---- Cache API tiruan ---- */
const abs = u => new URL(typeof u === 'string' ? u : u.url, ORIGIN + '/').href;
class FakeCache {
  constructor() { this.m = new Map(); }
  async match(req, opts = {}) {
    let k = abs(req);
    if (opts.ignoreSearch) { const u = new URL(k); u.search = ''; k = u.href; for (const [kk, v] of this.m) { const x = new URL(kk); x.search = ''; if (x.href === k) return v.clone(); } return undefined; }
    const v = this.m.get(k); return v ? v.clone() : undefined;
  }
  async put(req, res) { this.m.set(abs(req), res); }
  async addAll(list) { for (const f of list) this.m.set(abs(f), new Response('shell:' + (f === './' ? 'index.html' : f))); }
}
const stores = new Map();
const caches = {
  open: async n => { if (!stores.has(n)) stores.set(n, new FakeCache()); return stores.get(n); },
  keys: async () => [...stores.keys()],
  delete: async n => stores.delete(n)
};

/* ---- muat sw.js ---- */
let netMode = 'online'; // online | offline | hang
let netCalls = [];
const fakeFetch = async req => {
  netCalls.push(abs(req));
  if (netMode === 'offline') throw new TypeError('Failed to fetch');
  if (netMode === 'hang') return new Promise(() => {});
  return new Response('NET:' + abs(req));
};
const listeners = {};
const sandbox = {
  self: { addEventListener: (t, f) => { listeners[t] = f; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
  location: { origin: ORIGIN }, caches, fetch: fakeFetch, URL, Response, Request, Promise, setTimeout
};
vm.runInNewContext(code, sandbox);

async function dispatch(request) {
  let result;
  listeners.fetch({ request, respondWith: p => { result = p; }, waitUntil: () => {} });
  return result === undefined ? undefined : await result;
}
const get = (url, extra = {}) => ({ method: 'GET', url: ORIGIN + url, mode: 'cors', ...extra });

/* ---- semua file prakas harus ada, kalau tidak install SW gagal total ---- */
const shell = /const SHELL_FILES = \[([\s\S]*?)\];/.exec(code)[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
for (const f of shell) if (f !== './') assert.ok(existsSync(fileURLToPath(new URL(f, root))), 'file prakas tidak ada: ' + f);
const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', root), 'utf8'));
for (const i of manifest.icons) assert.ok(existsSync(fileURLToPath(new URL(i.src, root))), 'ikon manifest tidak ada: ' + i.src);
for (const f of ['index.html', 'js/app.js', 'js/calc.js', 'js/store.js', 'js/rows.js', 'js/config.js', 'style.css']) assert.ok(shell.includes(f), f + ' belum masuk daftar prakas');

/* ---- install: semua file prakas masuk cache ---- */
{
  let p; listeners.install({ waitUntil: x => { p = x; } }); await p;
  assert.equal((await caches.open('kwhlog-shell')).m.size, shell.length);
}

/* ---- file aplikasi: jaringan dulu ---- */
{
  netMode = 'online';
  const r = await dispatch(get('/js/app.js'));
  assert.equal(await r.text(), 'NET:' + ORIGIN + '/js/app.js');                 // versi terbaru dipakai saat online
  assert.equal(await (await (await caches.open('kwhlog-shell')).match(get('/js/app.js'))).text(), 'NET:' + ORIGIN + '/js/app.js'); // dan cache ikut diperbarui

  netMode = 'offline';
  assert.equal(await (await dispatch(get('/js/app.js'))).text(), 'NET:' + ORIGIN + '/js/app.js'); // offline: salinan terakhir

  // navigasi offline ke URL mana pun (termasuk dengan query/hash dari magic link) jatuh ke index.html
  const nav = await dispatch(get('/?x=1', { mode: 'navigate' }));
  assert.equal(await nav.text(), 'shell:index.html');
  const nav2 = await dispatch(get('/belum-ada-di-cache', { mode: 'navigate' }));
  assert.equal(await nav2.text(), 'shell:index.html');

  // file yang sama sekali tidak ada di cache dan offline: gagal (tidak dikarang)
  await assert.rejects(() => dispatch(get('/tidak-ada.js')));
}

/* ---- jaringan menggantung (sinyal jelek): jatuh ke cache setelah ~3 detik ---- */
{
  netMode = 'hang';
  const t0 = Date.now();
  const r = await dispatch(get('/style.css'));
  const dt = Date.now() - t0;
  assert.equal(await r.text(), 'shell:style.css');
  assert.ok(dt >= 2900 && dt < 4500, 'batas lambat ~3 dtk, aktual ' + dt + ' ms');
}

/* ---- CDN: salinan tersimpan dulu, diperbarui di belakang ---- */
{
  netMode = 'online';
  const u = 'https://esm.sh/@supabase/supabase-js@2';
  const first = await dispatch({ method: 'GET', url: u, mode: 'cors' });
  assert.equal(await first.text(), 'NET:' + u);
  netMode = 'hang'; // jaringan mati/menggantung: harus langsung dari cache tanpa menunggu
  const t0 = Date.now();
  const second = await dispatch({ method: 'GET', url: u, mode: 'cors' });
  assert.equal(await second.text(), 'NET:' + u);
  assert.ok(Date.now() - t0 < 500, 'cache CDN harus langsung');
}

/* ---- yang tidak boleh disentuh ---- */
netMode = 'online'; netCalls = [];
assert.equal(await dispatch({ method: 'POST', url: ORIGIN + '/js/app.js', mode: 'cors' }), undefined);   // bukan GET
assert.equal(await dispatch({ method: 'GET', url: 'https://abc.supabase.co/rest/v1/kwhlog_readings', mode: 'cors' }), undefined); // API Supabase
assert.equal(await dispatch({ method: 'GET', url: 'https://example.com/x.js', mode: 'cors' }), undefined); // origin lain
assert.deepEqual(netCalls, []);

console.log('OK   service worker (jaringan dulu, cache saat offline/lambat, CDN, file prakas lengkap)');
process.exit(0); // timer 3 dtk dari balapan jaringan menggantung tidak perlu ditunggu
