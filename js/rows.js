// Konversi antara bentuk di aplikasi dan baris tabel Supabase. Murni, tanpa jaringan.
//
// Kolom ts bertipe `timestamp` (tanpa timezone) dan berisi jam dinding WIB.
// Di aplikasi ts berbentuk "YYYY-MM-DDTHH:mm". Konversi dilakukan murni sebagai teks:
// JANGAN pernah lewat new Date(string), karena JS bisa menganggapnya UTC dan menggeser jam 7 jam.

// App -> DB: "2026-09-02T17:27" -> "2026-09-02 17:27:00"
export function tsToDb(ts) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(ts));
  if (!m) throw new Error('ts tidak valid: ' + ts);
  return m[1] + ' ' + m[2] + ':00';
}

// DB -> App: terima "2026-09-02T17:27:00", "2026-09-02 17:27:00", atau dengan pecahan detik. Tidak valid -> null.
export function tsFromDb(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(s ?? ''));
  return m ? m[1] + 'T' + m[2] : null;
}

// user_id sengaja tidak dikirim: default-nya auth.uid() di database.
export function toRow(e) {
  return {
    id: e.id,
    ts: tsToDb(e.ts),
    type: e.type || 'reading',
    kwh: e.kwh,
    added: e.added ?? null,
    rp: e.rp ?? null,
    tags: e.tags || [],
    suhu: e.suhu ?? null,
    note: e.note || null
  };
}

// Kolom null dibuang supaya bentuknya sama dengan entri buatan aplikasi.
export function fromRow(r) {
  const e = { id: r.id, ts: tsFromDb(r.ts), type: r.type, kwh: Number(r.kwh), tags: r.tags || [], note: r.note || '' };
  if (r.added != null) e.added = Number(r.added);
  if (r.rp != null) e.rp = Number(r.rp);
  if (r.suhu != null) e.suhu = Number(r.suhu);
  return e;
}
