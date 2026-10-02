# kwhlog

Nama tampilan: kWh Log. Aplikasi pencatat pemakaian listrik rumah (meter token prabayar PLN, pascabayar belum didukung).
Pemakai tunggal: satu rumah, dicatat dari HP di depan meteran dan dilihat juga dari laptop.

Prototipe yang sudah jalan dan sudah diuji ada di `reference/prototype.html` (satu file, vanilla JS).
Logika hitungannya sudah terbukti benar terhadap 61 baris data asli. **Pindahkan logikanya, jangan tulis ulang dari nol.**

## Tujuan repo ini

Memindahkan prototipe menjadi aplikasi statis multi-file yang datanya di Supabase,
di-deploy ke Vercel dari GitHub.

Target struktur:

```
index.html     # markup + tab
style.css
js/calc.js     # semua rumus hitungan, murni, tanpa DOM dan tanpa jaringan
js/store.js    # Supabase: auth, read, write, realtime
js/app.js      # render + event
js/config.js   # SUPABASE_URL dan SUPABASE_ANON_KEY (boleh di-commit, lihat Keamanan)
supabase/schema.sql
data/          # data awal
```

## Aturan domain (jangan diubah tanpa diminta)

**Meter token menghitung turun.** Angka meter berkurang seiring pemakaian.

- Pemakaian satu interval = `kwh(sebelumnya) - kwh(sekarang)`.
- Kalau catatan sekarang bertipe `topup`: `kwh(sebelumnya) - (kwh(sekarang) - added)`.
- Kalau hasilnya negatif dan tipenya bukan `topup`, interval ditandai tidak valid dan **tidak** ikut dihitung di total mana pun.

**Label kondisi (`tags`) berlaku untuk interval yang baru selesai**, bukan untuk waktu ke depan.
Tag yang dipakai: `ac`, `noac`, `kosong`, `cuci`, `pompa`. `suhu` hanya relevan bersama `ac`.

**Tarif.** Default Rp1.444,70/kWh (tarif R1 1.300–2.200 VA).
Kalau ada catatan `topup` yang punya `rp` dan `added`, tarif untuk interval sesudahnya = `rp / added`
(sudah termasuk PPJ dan admin). Pakai topup terakhir yang `ts`-nya tidak lebih baru dari awal interval.

**Slot waktu:** pagi 05–09, siang 09–17, sore 17–22, malam 22–05.
Pemakaian satu interval dibagi ke slot secara proporsional per potongan 15 menit, dengan asumsi beban rata.

**Batas hari 05:00.** Satu "hari listrik" = 05:00 sampai 05:00 berikutnya, supaya pemakaian malam
masuk ke hari yang sama dengan sorenya. Hari dengan cakupan data < 20 jam ditandai belum penuh.

**Beban dasar (baseline)** = median kW dari interval berdurasi ≥ 3 jam yang titik tengahnya antara jam 09 dan 17.
Kalau tidak ada, pakai persentil 20 dari semua interval.

**Beban AC** = rata-rata tertimbang (total kWh / total jam) dari interval ber-tag `ac` yang durasinya ≤ 4 jam.
Batas 4 jam itu disengaja, supaya jam tanpa AC tidak ikut tercampur.

**Penanda anomali:**
- interval > 14 jam → peringatan ringan (pembagian slot jadi kasar)
- durasi ≥ 3 jam dan kW < 0,5 × baseline → mencurigakan (MCB mati atau salah catat)
- durasi ≥ 6 jam dan kW > 2 × median kW interval ≥ 6 jam → mencurigakan (bandingkan panjang dengan panjang)

**Rata-rata 7 hari** dihitung dari jendela 7×24 jam terakhir, memakai irisan setiap interval,
bukan rata-rata per baris. Rata-rata harian = total kWh / total jam × 24 — **jangan** membagi dengan jumlah tanggal.

## Verifikasi (wajib lulus setelah refaktor)

Pakai `data/readings-seed.csv` (61 baris, 2–22 Sep 2026). Angka dari prototipe:

| Besaran | Nilai |
|---|---|
| Total pemakaian | 131,79 kWh |
| Total biaya (tarif default) | Rp190.397 |
| Rata-rata harian seluruh periode | 6,734 kWh/hari |
| Rata-rata 7 hari terakhir | 6,537 kWh/hari |
| Baseline | 0,0702 kW |
| Beban AC aktif | 0,8731 kW |
| kWh slot pagi / siang / sore / malam | 17,89 / 22,07 / 41,53 / 50,30 |
| Interval ditandai mencurigakan | 2 (11 Sep rendah, 13 Sep tinggi) |
| Interval > 14 jam | 5 |

Buat `calc.js` tanpa ketergantungan DOM supaya angka-angka di atas bisa diuji dengan `node`.
Tulis skrip uji sederhana (`npm test` atau `node test/calc.test.js`) sebelum menyentuh bagian Supabase.

## Urutan kerja yang diinginkan

1. Pecah prototipe jadi file terpisah, masih pakai localStorage. Pastikan tabel verifikasi di atas lulus.
2. Pasang Supabase: auth magic link, baca/tulis/hapus, realtime. localStorage dijadikan cache offline.
3. Antrean offline: catatan disimpan lokal dulu, dikirim saat online. Ini penting karena area meteran sering tanpa sinyal.
4. PWA: manifest + service worker, supaya bisa Add to Home Screen.
5. Baru fitur baru (lihat Ide, bahas dulu sebelum dikerjakan).

## Keamanan

- `SUPABASE_ANON_KEY` aman berada di kode browser **selama RLS aktif**. Boleh di-commit.
- `service_role` key tidak boleh masuk repo, tidak boleh masuk kode browser, titik.
- Nama tabel diberi prefix `kwhlog_` supaya satu project Supabase bisa dipakai aplikasi lain.
- Setiap tabel baru harus langsung diberi RLS dan policy `auth.uid() = user_id`.

## Batasan teknis

- Statis dulu, tanpa framework dan tanpa build step. Vanilla JS dan ES module.
- Supabase JS client lewat CDN (`esm.sh` atau `jsdelivr`), bukan npm, selama belum ada build step.
- Naik ke Next.js hanya kalau benar-benar butuh sisi server (contoh: notifikasi push, cron).
- Mobile first, desktop menyusul. Jangan memakai layout yang mengandalkan hover.
- Bahasa UI: Indonesia. Angka format `id-ID`. Waktu lokal WIB, disimpan tanpa timezone — jangan diubah ke UTC, karena semua batas slot waktu bergantung pada jam dinding.

## Daftar fitur

Sudah ada di prototipe, harus tetap ada setelah migrasi:

- **Mobile first.** Input dilakukan sambil berdiri di depan meteran, satu tangan memegang HP.
  Tombol besar, keyboard angka (`inputmode="decimal"`), aman terhadap notch dan home indicator
  (`viewport-fit=cover` + `env(safe-area-inset-*)`), ikut tema terang/gelap perangkat.
- **Saldo awal (open balance).** Catatan pertama adalah angka meter saat mulai mencatat,
  tidak perlu perlakuan khusus: interval baru dihitung sejak catatan kedua.
  Pastikan tampilan tidak menyesatkan saat baru ada satu baris.
- **Catat pengisian token** beserta kWh yang masuk dan nominal rupiahnya.
  Tarif riil = `rp / added`, dipakai untuk interval sesudahnya.
- **Pengaturan**: tarif default per kWh.

Belum ada, dikerjakan di tahap 5 ke atas:

- **Laporan mingguan dan bulanan.** Total kWh dan rupiah per minggu/bulan, perbandingan dengan
  periode sebelumnya, rata-rata harian, pembagian slot waktu, dan rekap pembelian token di periode itu.
  Catatan: periode dipotong memakai batas hari 05:00, bukan tengah malam, supaya konsisten dengan grafik harian.
  Minggu dimulai hari Senin.
- **Pengaturan lanjutan**: ambang peringatan sisa token, target pemakaian bulanan, batas jam tiap slot.
  (Kurs mata uang belum jelas perlunya — semua nilai dalam rupiah. Konfirmasi dulu sebelum dibuat.)
- **Notifikasi** saat sisa token di bawah ambang tertentu. Ini satu-satunya yang menuntut sisi server.
- **Catatan tagihan rumah lain** (air, internet) — kemungkinan besar jadi aplikasi terpisah,
  berbagi project Supabase. Jangan dikerjakan di repo ini tanpa diminta.
