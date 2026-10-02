# kwhlog

Pencatat pemakaian listrik rumah untuk meter token prabayar: catat angka meter dari HP,
lihat biaya per interval, pola pagi/siang/sore/malam, beban AC, dan perkiraan kapan token habis.

Nama tampilan aplikasi (manifest PWA): **kWh Log**.

- Prototipe yang sudah jalan: `reference/prototype.html` (buka langsung di browser, data di localStorage)
- Rencana dan aturan hitungan: `CLAUDE.md`
- Skema database: `supabase/schema.sql` (tabel `kwhlog_readings`, `kwhlog_settings`)
- Data awal 2-22 Sep 2026: `data/readings-seed.csv` dan `data/readings-seed.sql`

Susunan: statis (HTML + ES module) di Vercel, data di Supabase, auth magic link, RLS aktif.
Tabel sengaja diberi prefix `kwhlog_` supaya satu project Supabase bisa dipakai aplikasi lain nanti.
