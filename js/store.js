// Penyimpanan data: Supabase (sumber kebenaran) + localStorage (cache dan fallback).
//
// - Halaman langsung tampil dari cache localStorage, lalu diperbarui saat data Supabase datang.
// - Belum login (atau Supabase belum diisi): tulis ke cache saja, ditandai `dirty`, lalu dikirim saat login.
// - Login: magic link. Setelah login: baca semua, lalu realtime (postgres_changes) memicu baca ulang.
// - Antarmuka (getEntries/put/del/subscribe/...) sama seperti tahap 1, jadi app.js nyaris tidak berubah.
import { DEFAULT_TARIF } from './calc.js';
import { toRow, fromRow } from './rows.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const LS_KEY = 'kwhlog.v1';
const SUPABASE_CDN = 'https://esm.sh/@supabase/supabase-js@2';
const T_READ = 'kwhlog_readings';
const T_SET = 'kwhlog_settings';
const PAGE = 1000;

let entries = [];
let settings = { tarif: DEFAULT_TARIF };
let dirty = {};            // id -> 'put' | 'del': perubahan yang dibuat saat belum login, belum terkirim
let settingsDirty = false;

let sb = null;             // client Supabase (null kalau belum dikonfigurasi atau CDN tak terjangkau)
let user = null;
let channel = null;
let started = false;       // sinkronisasi remote sudah berjalan untuk sesi ini
// 'nocfg' | 'offline' | 'out' | 'sync' | 'ok' | 'error'
let status = 'nocfg';
const listeners = new Set();

const emit = () => listeners.forEach(fn => fn());
function setStatus(s) { status = s; emit(); }
function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ entries, settings, dirty, settingsDirty })); } catch (e) { /* kuota penuh / mode privat */ }
}
function configured() {
  return /^https:\/\//.test(SUPABASE_URL) && !SUPABASE_URL.includes('YOUR-') && !!SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.startsWith('YOUR-');
}

export const getEntries = () => entries;
export const getSettings = () => settings;
export const getStatus = () => status;
export const getUser = () => user;
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

  if (!configured()) { setStatus('nocfg'); return; }
  try {
    const { createClient } = await import(SUPABASE_CDN);
    sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  } catch (e) { setStatus('offline'); return; } // CDN tak terjangkau: tetap jalan dari cache

  setStatus('out');
  // Jangan memanggil API Supabase langsung di dalam callback ini (bisa deadlock): tunda dengan setTimeout.
  sb.auth.onAuthStateChange((event, session) => {
    user = session ? session.user : null;
    if (user) setTimeout(startRemote, 0);
    else if (event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') { stopRemote(); setStatus('out'); }
  });
  window.addEventListener('online', () => { if (user && !started) startRemote(); });
}

async function startRemote() {
  if (started || !sb || !user) return;
  started = true;
  setStatus('sync');
  try {
    await flush();
    await refresh();
    subscribeRealtime();
    setStatus('ok');
  } catch (e) {
    started = false;
    setStatus('error');
  }
}

function stopRemote() {
  started = false;
  if (channel && sb) { sb.removeChannel(channel); channel = null; }
}

/* ---------- baca / sinkron ---------- */
// Kirim perubahan yang dibuat saat belum login.
async function flush() {
  const ids = Object.keys(dirty);
  const puts = ids.filter(i => dirty[i] === 'put').map(i => entries.find(e => e.id === i)).filter(Boolean);
  const dels = ids.filter(i => dirty[i] === 'del');
  if (puts.length) {
    const { error } = await sb.from(T_READ).upsert(puts.map(toRow), { onConflict: 'user_id,id' });
    if (error) throw error;
  }
  if (dels.length) {
    const { error } = await sb.from(T_READ).delete().in('id', dels);
    if (error) throw error;
  }
  if (settingsDirty) {
    const { error } = await sb.from(T_SET).upsert({ tarif: settings.tarif }, { onConflict: 'user_id' });
    if (error) throw error;
    settingsDirty = false;
  }
  dirty = {};
  persist();
}

// Ambil semua baris (per halaman 1000) dan ganti cache.
async function refresh() {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(T_READ).select('*').order('ts').range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  entries = rows.map(fromRow).filter(e => e.ts);
  const { data: s, error: se } = await sb.from(T_SET).select('tarif').maybeSingle();
  if (se) throw se;
  if (s) settings = Object.assign({}, settings, { tarif: Number(s.tarif) });
  persist();
  emit();
}

function subscribeRealtime() {
  if (channel) sb.removeChannel(channel);
  let timer = null;
  const kick = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { refresh().then(() => setStatus('ok')).catch(() => setStatus('error')); }, 300);
  };
  channel = sb.channel('kwhlog')
    .on('postgres_changes', { event: '*', schema: 'public', table: T_READ }, kick)
    .on('postgres_changes', { event: '*', schema: 'public', table: T_SET }, kick)
    .subscribe();
}

/* ---------- tulis ---------- */
const remoteOn = () => !!(sb && user);

export async function putMany(list) {
  if (remoteOn()) {
    const { error } = await sb.from(T_READ).upsert(list.map(toRow), { onConflict: 'user_id,id' });
    if (error) throw error;
  } else {
    for (const e of list) dirty[e.id] = 'put';
  }
  const ids = new Set(list.map(e => e.id));
  entries = entries.filter(x => !ids.has(x.id)).concat(list);
  persist(); emit();
}
export const put = e => putMany([e]);

export async function del(id) {
  if (remoteOn()) {
    const { error } = await sb.from(T_READ).delete().eq('id', id);
    if (error) throw error;
  } else {
    dirty[id] = 'del';
  }
  entries = entries.filter(x => x.id !== id);
  persist(); emit();
}

export async function saveSettings(s) {
  if (remoteOn()) {
    const { error } = await sb.from(T_SET).upsert({ tarif: s.tarif }, { onConflict: 'user_id' });
    if (error) throw error;
  } else {
    settingsDirty = true;
  }
  settings = s;
  persist(); emit();
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
