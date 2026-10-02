// Penyimpanan data. Tahap 1: localStorage saja.
// Antarmuka sengaja async dan berbasis subscribe supaya tahap 2 (Supabase) cukup mengganti isi file ini.
import { DEFAULT_TARIF } from './calc.js';

const LS_KEY = 'kwhlog.v1';

let entries = [];
let settings = { tarif: DEFAULT_TARIF };
const listeners = new Set();

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ entries, settings })); } catch (e) { /* kuota penuh / mode privat */ }
}
function emit() { listeners.forEach(fn => fn()); }

export const mode = 'local';
export const getEntries = () => entries;
export const getSettings = () => settings;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export async function init() {
  try {
    const j = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (j) { entries = j.entries || []; settings = Object.assign(settings, j.settings || {}); }
  } catch (e) { /* data rusak: mulai kosong */ }
  emit();
}

export async function put(e) {
  entries = entries.filter(x => x.id !== e.id);
  entries.push(e);
  persist(); emit();
}
export async function del(id) {
  entries = entries.filter(x => x.id !== id);
  persist(); emit();
}
export async function saveSettings(s) {
  settings = s;
  persist(); emit();
}
