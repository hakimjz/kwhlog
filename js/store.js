// Penyimpanan data: Supabase (sumber kebenaran) + localStorage (cache dan antrean offline).
//
// - Halaman langsung tampil dari cache localStorage, lalu diperbarui saat data Supabase datang.
// - Setiap tulis/hapus: cache dulu, render langsung, baru dikirim ke Supabase di belakang layar.
// - `dirty` adalah satu-satunya antrean: id -> 'put' | 'del' untuk perubahan yang belum terkirim.
//   Dipakai sama untuk kondisi belum login, jaringan mati, maupun server menolak. Disimpan di localStorage,
//   jadi tahan reload. Konflik: yang terakhir dikirim menang (upsert menimpa).
// - Kirim ulang otomatis: saat aplikasi dimuat/sesi pulih, event `online`, tab terlihat lagi, dan percobaan
//   ulang bertahap (jeda membesar, berhenti setelah beberapa kali sampai ada pemicu berikutnya).
import { DEFAULT_TARIF } from './calc.js';
import { toRow, fromRow } from './rows.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const LS_KEY = 'kwhlog.v1';
const SUPABASE_CDN = 'https://esm.sh/@supabase/supabase-js@2';
const T_READ = 'kwhlog_readings';
const T_SET = 'kwhlog_settings';
const PAGE = 1000;
const RETRY_MS = [3000, 10000, 30000, 60000, 120000];

let entries = [];
let settings = { tarif: DEFAULT_TARIF };
let dirty = {};            // id -> 'put' | 'del'
let settingsDirty = false;
let localGen = 0;          // bertambah tiap tulis lokal; dipakai agar baca ulang tidak menimpa tulisan yang baru

let sb = null;             // client Supabase (null kalau belum dikonfigurasi atau CDN tak terjangkau)
let user = null;
let channel = null;
// 'init' | 'nocfg' | 'offline' | 'out' | 'sync' | 'ok' | 'error'
let status = 'init';
const listeners = new Set();

let busy = false, queuedFull = false, queuedFlush = false;
let needsRefresh = true;   // belum pernah membaca dari server pada sesi ini
let attempt = 0, retryTimer = null, authTimer = null;

// Hasil callback magic link ada di URL (#access_token=... atau #error_description=...).
// Galat dibaca sekarang, sebelum client Supabase menyentuh URL; token dibersihkan setelah sesi terbentuk.
const AUTH_URL_RE = /access_token|refresh_token|error_description|[?&]code=/;
function cleanUrl() {
  if (AUTH_URL_RE.test(location.hash + location.search)) history.replaceState(null, '', location.pathname);
}
const authError = new URLSearchParams(location.hash.slice(1) + '&' + location.search.slice(1)).get('error_description');
if (authError) cleanUrl(); // tidak ada token yang perlu dijaga pada kasus galat

const emit = () => listeners.forEach(fn => fn());
function setStatus(s) { status = s; emit(); }
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ entries, settings, dirty, settingsDirty })); return true; } catch (e) { return false; }
}
function configured() {
  return /^https:\/\//.test(SUPABASE_URL) && !SUPABASE_URL.includes('YOUR-') && !!SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('YOUR-');
}
const remoteOn = () => !!(sb && user);

export const getEntries = () => entries;
export const getSettings = () => settings;
export const getStatus = () => status;
export const getUser = () => user;
export const getAuthError = () => authError;
export const getPending = () => Object.keys(dirty).length + (settingsDirty ? 1 : 0);
export const isPending = id => id in dirty;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/* ---------- start ---------- */
export async function init() {
  try {
    const j = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (j) {
      entries = j.entries || [];
      settings = Object.assign(settings, j.settings || {});
      dirty = j.dirty || {};
      settingsDirty = !!j.settingsDirty;
    }
  } catch (e) { /* cache rusak: mulai kosong */ }
  emit(); // tampil dulu dari cache

  window.addEventListener('online', trigger);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') trigger(); });

  if (!configured()) { setStatus('nocfg'); return; }
  await connect();
}

// Muat client Supabase. Bisa gagal saat offline; dicoba lagi oleh trigger().
async function connect() {
  if (sb) return true;
  try {
    const { createClient } = await import(SUPABASE_CDN);
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) { setStatus('offline'); return false; }
  // Status 'out' baru ditetapkan oleh INITIAL_SESSION (tanpa sesi), supaya form login tidak berkedip saat sesi tersimpan.
  // Jangan memanggil API Supabase langsung di dalam callback ini (bisa deadlock): tunda dengan setTimeout
  // (sekaligus menggabungkan event yang datang berurutan jadi satu sinkron).
  sb.auth.onAuthStateChange((event, session) => {
    const was = user;
    user = session ? session.user : null;
    if (user) {
      cleanUrl();
      // SIGNED_IN ikut terpicu setelah INITIAL_SESSION dan saat tab fokus: cukup sekali per sesi
      if (event === 'INITIAL_SESSION' || (event === 'SIGNED_IN' && !was)) { clearTimeout(authTimer); authTimer = setTimeout(() => run(true), 50); }
    } else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') { stopRemote(); setStatus('out'); }
  });
  return true;
}

// Pemicu kirim ulang: aplikasi dimuat/pulih, kembali online, tab terlihat lagi.
async function trigger() {
  if (!configured()) return;
  attempt = 0;
  if (!sb && !(await connect())) return;
  run(true);
}

function stopRemote() {
  needsRefresh = true;
  clearTimeout(retryTimer);
  if (channel && sb) { sb.removeChannel(channel); channel = null; }
}

/* ---------- sinkron: kirim antrean, lalu (opsional) baca ulang ---------- */
// full=true: kirim antrean lalu baca ulang semua dari server. full=false: hanya kirim antrean (setelah tulis lokal).
async function run(full) {
  if (!remoteOn()) return;
  if (busy) { if (full) queuedFull = true; else queuedFlush = true; return; }
  if (!navigator.onLine) { if (getPending()) setStatus('offline'); return; }
  busy = true;
  let ok = false;
  if (full && status !== 'ok') setStatus('sync');
  try {
    await flush();
    if (full || needsRefresh) { await refresh(); needsRefresh = false; }
    ensureRealtime();
    attempt = 0; clearTimeout(retryTimer);
    setStatus('ok');
    ok = true;
  } catch (e) {
    console.warn('kwhlog: sinkron gagal', e);
    setStatus(navigator.onLine ? 'error' : 'offline');
    if (navigator.onLine && attempt < RETRY_MS.length) { clearTimeout(retryTimer); retryTimer = setTimeout(() => run(true), RETRY_MS[attempt++]); }
  } finally {
    busy = false;
    const f = queuedFull, q = queuedFlush;
    queuedFull = queuedFlush = false;
    // kalau gagal, jangan langsung mengulang: jadwal percobaan ulang bertahap di atas yang menangani
    if (ok) { if (f) run(true); else if (q) run(false); }
  }
}

// Galat jaringan dari postgrest-js tidak punya `code`; penolakan server (RLS, unique, tipe data) punya.
const isNet = err => !err.code;

// Kirim satu kelompok. Kalau ditolak server, coba satu per satu supaya satu baris buruk tidak memblokir sisanya.
async function sendAll(items, fn) {
  const { error } = await fn(items);
  if (!error) return { ok: items, failed: false };
  if (isNet(error) || items.length === 1) return { ok: [], failed: true };
  const ok = []; let failed = false;
  for (const it of items) {
    const { error: e } = await fn([it]);
    if (e) { failed = true; if (isNet(e)) break; } else ok.push(it);
  }
  return { ok, failed };
}

// Hapus dulu, baru simpan (menghindari tabrakan unique (user_id, ts)). Item dikeluarkan dari antrean
// hanya kalau tidak berubah lagi selama pengiriman.
async function flush() {
  let failed = false;
  const delIds = Object.keys(dirty).filter(i => dirty[i] === 'del');
  if (delIds.length) {
    const r = await sendAll(delIds, ch => sb.from(T_READ).delete().in('id', ch));
    for (const id of r.ok) if (dirty[id] === 'del') delete dirty[id];
    failed = r.failed;
  }
  if (!failed) {
    const puts = [];
    for (const id of Object.keys(dirty)) {
      if (dirty[id] !== 'put') continue;
      const e = entries.find(x => x.id === id);
      if (e) puts.push(e); else delete dirty[id];
    }
    if (puts.length) {
      const r = await sendAll(puts, ch => sb.from(T_READ).upsert(ch.map(toRow), { onConflict: 'user_id,id' }));
      for (const e of r.ok) if (dirty[e.id] === 'put' && entries.find(x => x.id === e.id) === e) delete dirty[e.id];
      failed = r.failed;
    }
  }
  if (!failed && settingsDirty) {
    const sent = settings.tarif;
    const { error } = await sb.from(T_SET).upsert({ tarif: sent }, { onConflict: 'user_id' });
    if (error) failed = true; else if (settings.tarif === sent) settingsDirty = false;
  }
  persist(); emit();
  if (failed) throw new Error('masih ada yang belum terkirim');
}

// Ambil semua baris (per halaman 1000). Perubahan lokal yang belum terkirim ditumpangkan di atas hasilnya.
async function refresh() {
  for (let tries = 0; tries < 3; tries++) {
    const gen = localGen;
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(T_READ).select('*').order('ts').range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) break;
    }
    const { data: s, error: se } = await sb.from(T_SET).select('tarif').maybeSingle();
    if (se) throw se;
    if (gen !== localGen && tries < 2) continue; // ada tulisan lokal saat membaca: ulangi
    const byId = new Map(rows.map(fromRow).filter(e => e.ts).map(e => [e.id, e]));
    for (const [id, op] of Object.entries(dirty)) {
      if (op === 'del') byId.delete(id);
      else { const l = entries.find(e => e.id === id); if (l) byId.set(id, l); }
    }
    entries = [...byId.values()];
    if (s && !settingsDirty) settings = Object.assign({}, settings, { tarif: Number(s.tarif) });
    persist(); emit();
    return;
  }
}

function ensureRealtime() {
  if (channel) return;
  let timer = null;
  const kick = () => { clearTimeout(timer); timer = setTimeout(() => run(true), 300); };
  channel = sb.channel('kwhlog')
    .on('postgres_changes', { event: '*', schema: 'public', table: T_READ }, kick)
    .on('postgres_changes', { event: '*', schema: 'public', table: T_SET }, kick)
    .subscribe();
}

/* ---------- tulis: lokal dulu, kirim di belakang ---------- */
function commit() {
  localGen++;
  if (!persist()) throw new Error('Penyimpanan di perangkat ini penuh atau diblokir');
  emit();
  attempt = 0;
  run(false);
}

export async function putMany(list) {
  const ids = new Set(list.map(e => e.id));
  entries = entries.filter(x => !ids.has(x.id)).concat(list);
  for (const e of list) dirty[e.id] = 'put';
  commit();
}
export const put = e => putMany([e]);

export async function del(id) {
  entries = entries.filter(x => x.id !== id);
  dirty[id] = 'del';
  commit();
}

export async function saveSettings(s) {
  settings = s;
  settingsDirty = true;
  commit();
}

/* ---------- auth ---------- */
export async function signIn(email) {
  if (!sb) throw new Error('Supabase belum siap');
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  if (error) throw error;
}
export async function signOut() {
  if (sb) await sb.auth.signOut();
}
