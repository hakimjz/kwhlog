// Laporan periode (minggu/bulan). Jalankan: node test/report.test.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compute, parseTs, fmtTs, periodStart, shiftPeriod, periodSpan, aggregatePeriod, periodReport } from '../js/calc.js';

const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} != ${b}`);
const at = s => parseTs(s);
const R = (id, ts, kwh, extra = {}) => ({ id, ts, type: 'reading', kwh, tags: [], ...extra });

/* ---- batas periode: 05:00, minggu mulai Senin ---- */
assert.equal(fmtTs(periodStart('week', at('2026-09-09T12:00'))), '2026-09-07T05:00');  // Rabu -> Senin 05:00
assert.equal(fmtTs(periodStart('week', at('2026-09-07T05:00'))), '2026-09-07T05:00');  // tepat batas -> periode baru
assert.equal(fmtTs(periodStart('week', at('2026-09-07T04:59'))), '2026-08-31T05:00');  // sebelum 05:00 -> minggu lalu
assert.equal(fmtTs(periodStart('week', at('2026-09-13T23:00'))), '2026-09-07T05:00');  // Minggu malam masih minggu itu
assert.equal(fmtTs(periodStart('month', at('2026-10-01T04:59'))), '2026-09-01T05:00');
assert.equal(fmtTs(periodStart('month', at('2026-10-01T05:00'))), '2026-10-01T05:00');
assert.equal(fmtTs(periodStart('day', at('2026-09-09T12:00'))), '2026-09-09T05:00');
assert.equal(fmtTs(periodStart('day', at('2026-09-09T04:59'))), '2026-09-08T05:00');  // dini hari masih hari listrik kemarin
assert.equal(fmtTs(periodStart('day', at('2026-09-09T05:00'))), '2026-09-09T05:00');
assert.equal(fmtTs(periodStart('day', at('2026-10-01T02:00'))), '2026-09-30T05:00');  // lintas bulan
assert.equal(fmtTs(shiftPeriod('day', at('2026-09-30T05:00'), 1)), '2026-10-01T05:00');
assert.equal(fmtTs(shiftPeriod('day', at('2026-01-01T05:00'), -1)), '2025-12-31T05:00');
assert.equal(fmtTs(shiftPeriod('week', at('2026-09-07T05:00'), -1)), '2026-08-31T05:00');
assert.equal(fmtTs(shiftPeriod('month', at('2026-01-01T05:00'), -1)), '2025-12-01T05:00');
assert.equal(fmtTs(shiftPeriod('month', at('2026-12-01T05:00'), 1)), '2027-01-01T05:00');

/* ---- interval melewati batas dibagi proporsional ---- */
{
  // 1 kW dari Senin 03:00 s.d. 07:00: 2 kWh sebelum batas 05:00, 2 kWh sesudahnya
  const c = compute([R('a', '2026-09-07T03:00', 100), R('b', '2026-09-07T07:00', 96)]);
  const w = at('2026-09-07T05:00');
  near(aggregatePeriod(c, 'week', w).kwh, 2, 1e-9, 'minggu baru');
  near(aggregatePeriod(c, 'week', shiftPeriod('week', w, -1)).kwh, 2, 1e-9, 'minggu lalu');
  // batas tidak sejajar potongan 15 menit: 04:50-05:20 -> potongan 04:50-05:05 (tengah 04:57:30) ke minggu lalu
  const c2 = compute([R('a', '2026-09-07T04:50', 100), R('b', '2026-09-07T05:20', 98)]);
  near(aggregatePeriod(c2, 'week', w).kwh, 1, 1e-9, 'tak sejajar, minggu baru');
  near(aggregatePeriod(c2, 'week', shiftPeriod('week', w, -1)).kwh, 1, 1e-9, 'tak sejajar, minggu lalu');
}

/* ---- perbandingan: dua minggu penuh, beban 1 kW lalu 2 kW ---- */
{
  const e = [R('a', '2026-08-31T05:00', 1000), R('b', '2026-09-07T05:00', 832), R('c', '2026-09-14T05:00', 496)];
  const c = compute(e, { tarif: 1000 });
  const r = periodReport(c, 'week', at('2026-09-07T05:00'));
  assert.equal(r.status, 'penuh');
  assert.equal(r.prev.status, 'penuh');
  near(r.kwh, 336, 1e-6, 'kWh minggu ke-2');
  near(r.cost, 336000, 1e-3, 'Rp minggu ke-2 (tarif 1000)');
  near(r.avgDaily, 48, 1e-9, 'rata-rata harian = kWh / jam x 24');
  near(r.slotKwh.pagi + r.slotKwh.siang + r.slotKwh.sore + r.slotKwh.malam, 336, 1e-6, 'slot menjumlah ke total');
  // beban rata 2 kW: pagi 4 jam, siang 8, sore 5, malam 7 jam per hari x 7 hari
  near(r.slotKwh.pagi, 2 * 4 * 7, 1e-6, 'slot pagi');
  near(r.slotKwh.malam, 2 * 7 * 7, 1e-6, 'slot malam');
  assert.equal(r.compare.comparable, true);
  near(r.compare.kwhPct, 100, 1e-6, '+100% kWh');
  near(r.compare.rpPct, 100, 1e-6, '+100% Rp');
  near(r.compare.dailyPct, 100, 1e-6, '+100% harian');
}

/* ---- harian: hari listrik 05:00-05:00, rupiah per slot ---- */
{
  // 1 kW hari pertama, 2 kW hari kedua, tarif 1000
  const e = [R('a', '2026-09-08T05:00', 1000), R('b', '2026-09-09T05:00', 976), R('c', '2026-09-10T05:00', 928)];
  const c = compute(e, { tarif: 1000 });
  const d2 = periodReport(c, 'day', at('2026-09-09T05:00'));
  assert.equal(d2.status, 'penuh');
  near(d2.kwh, 48, 1e-6, 'kWh hari ke-2');
  near(d2.cost, 48000, 1e-3, 'Rp hari ke-2');
  near(d2.slotKwh.sore, 2 * 5, 1e-6, 'sore 5 jam x 2 kW');
  near(d2.slotCost.sore, 2 * 5 * 1000, 1e-3, 'Rp sore');
  near(d2.slotCost.malam, 2 * 7 * 1000, 1e-3, 'Rp malam');
  assert.equal(d2.compare.comparable, true);
  near(d2.compare.kwhPct, 100, 1e-6, 'hari ke-2 +100%');
  near(d2.compare.rpPct, 100, 1e-6, 'Rp hari ke-2 +100%');
  // hari yang baru berjalan 13 jam: total tidak dibandingkan, per jam tetap (>= 12 jam)
  const c2 = compute([R('a', '2026-09-08T05:00', 1000), R('b', '2026-09-09T05:00', 976), R('c', '2026-09-09T18:00', 950)], { tarif: 1000 });
  const run = periodReport(c2, 'day', at('2026-09-09T05:00'));
  assert.equal(run.status, 'berjalan');
  assert.equal(run.compare.kwhPct, null);
  near(run.compare.dailyPct, 100, 1e-6, 'per jam 1 kW -> 2 kW');
  // hari dengan 20 jam tercakup dianggap penuh, 19 jam belum
  const full = compute([R('a', '2026-09-09T05:00', 100), R('b', '2026-09-10T05:00', 90)]);
  assert.equal(aggregatePeriod(full, 'day', at('2026-09-09T05:00')).status, 'penuh');
  const gap = compute([R('a', '2026-09-09T10:00', 100), R('b', '2026-09-10T06:00', 90)]); // mulai 10:00 -> 19 jam
  assert.equal(aggregatePeriod(gap, 'day', at('2026-09-09T05:00')).status, 'parsial');
}

/* ---- periode belum penuh tidak dibandingkan total ---- */
{
  // minggu ke-2 baru berjalan 2 hari: total tidak boleh dibandingkan, harian boleh
  const e = [R('a', '2026-08-31T05:00', 1000), R('b', '2026-09-07T05:00', 832), R('c', '2026-09-09T05:00', 736)];
  const c = compute(e);
  const r = periodReport(c, 'week', at('2026-09-07T05:00'));
  assert.equal(r.status, 'berjalan');
  assert.equal(r.compare.comparable, false);
  assert.equal(r.compare.kwhPct, null);
  assert.equal(r.compare.rpPct, null);
  near(r.compare.dailyPct, 100, 1e-6, 'harian tetap dibandingkan (1 kW -> 2 kW)');
  near(r.coverage, 48 / 168, 1e-9, 'cakupan');
  // data baru mulai di tengah minggu: periode sudah lewat tapi cakupan rendah -> parsial
  const c2 = compute([R('a', '2026-09-10T05:00', 500), R('b', '2026-09-15T05:00', 380)]);
  const p = aggregatePeriod(c2, 'week', at('2026-09-07T05:00'));
  assert.equal(p.status, 'parsial');
  // tanpa data sama sekali
  assert.equal(aggregatePeriod(c2, 'week', at('2026-08-24T05:00')).status, 'kosong');
  assert.equal(aggregatePeriod(c2, 'week', at('2026-08-24T05:00')).avgDaily, null);
  // dua-duanya tak punya >= 24 jam: tidak ada perbandingan sama sekali
  const c3 = compute([R('a', '2026-09-07T05:00', 100), R('b', '2026-09-07T10:00', 99)]);
  assert.equal(periodReport(c3, 'week', at('2026-09-07T05:00')).compare.dailyPct, null);
}

/* ---- rekap pembelian token ---- */
{
  const e = [
    R('a', '2026-09-07T04:00', 50),
    { id: 't1', ts: '2026-09-07T04:59', type: 'topup', kwh: 120, added: 70, rp: 100000, tags: [] }, // masih minggu lalu
    { id: 't2', ts: '2026-09-08T10:00', type: 'topup', kwh: 190, added: 68.5, rp: 100000, tags: [] },
    { id: 't3', ts: '2026-09-10T10:00', type: 'topup', kwh: 250, added: 50, tags: [] },             // tanpa nominal
    R('z', '2026-09-14T06:00', 240)
  ];
  const c = compute(e);
  const wk = aggregatePeriod(c, 'week', at('2026-09-07T05:00')).topups;
  assert.deepEqual(wk.list.map(t => t.id), ['t2', 't3']);
  assert.equal(wk.count, 2);
  near(wk.added, 118.5, 1e-9, 'kWh masuk');
  assert.equal(wk.rp, 100000);
  near(wk.avgRate, 100000 / 68.5, 1e-6, 'tarif rata-rata hanya dari yang ada nominal');
  const prevWk = aggregatePeriod(c, 'week', at('2026-08-31T05:00')).topups;
  assert.deepEqual(prevWk.list.map(t => t.id), ['t1']);
  assert.equal(aggregatePeriod(c, 'week', at('2026-09-14T05:00')).topups.count, 0);
}

/* ---- data seed: periode harus menjumlah persis ke total keseluruhan ---- */
{
  const csv = readFileSync(fileURLToPath(new URL('../data/readings-seed.csv', import.meta.url)), 'utf8').trim().split(/\r?\n/);
  const cols = csv[0].split(',');
  const entries = csv.slice(1).map(line => {
    const v = line.split(','), r = Object.fromEntries(cols.map((k, i) => [k, v[i]]));
    return { id: r.id, ts: r.ts.replace(' ', 'T').slice(0, 16), type: r.type, kwh: parseFloat(r.kwh), tags: r.tags ? r.tags.split('|') : [] };
  });
  const c = compute(entries);

  for (const kind of ['day', 'week', 'month']) {
    const span = periodSpan(c, kind);
    let sumK = 0, sumC = 0, sumH = 0; const sumS = { pagi: 0, siang: 0, sore: 0, malam: 0 }, sumSC = { pagi: 0, siang: 0, sore: 0, malam: 0 };
    for (let s = span.first; +s <= +span.last; s = shiftPeriod(kind, s, 1)) {
      const a = aggregatePeriod(c, kind, s);
      sumK += a.kwh; sumC += a.cost; sumH += a.covH;
      for (const k of Object.keys(sumS)) { sumS[k] += a.slotKwh[k]; sumSC[k] += a.slotCost[k]; }
      near(a.slotCost.pagi + a.slotCost.siang + a.slotCost.sore + a.slotCost.malam, a.cost, 1e-6, kind + ': rupiah slot menjumlah ke total periode');
    }
    near(sumK, c.totalKwh, 1e-9, kind + ': jumlah kWh semua periode');
    near(sumC, c.totalCost, 1e-6, kind + ': jumlah Rp semua periode');
    near(sumH, c.totalH, 1e-9, kind + ': jumlah jam semua periode');
    for (const k of Object.keys(sumS)) {
      near(sumS[k], c.slotT[k], 1e-9, kind + ': slot ' + k);
      near(sumSC[k], c.slotC[k], 1e-6, kind + ': rupiah slot ' + k);
    }
  }

  // Laporan harian = hari listrik di c.days (kunci tanggal mulai hari, batas 05:00)
  for (const d of ['2026-09-05', '2026-09-13', '2026-09-20']) {
    const k = c.days[d], a = aggregatePeriod(c, 'day', at(d + 'T05:00'));
    near(a.kwh, k.pagi + k.siang + k.sore + k.malam, 1e-9, 'hari ' + d + ' = c.days');
    near(a.covH, k.cov, 1e-9, 'hari ' + d + ': jam tercakup');
    assert.equal(a.status, k.cov >= 20 ? 'penuh' : 'parsial', 'hari ' + d + ': status ikut aturan 20 jam');
  }
  assert.equal(aggregatePeriod(c, 'day', at('2026-09-02T05:00')).status, 'parsial'); // data baru mulai 17:27
  assert.equal(aggregatePeriod(c, 'day', at('2026-09-22T05:00')).status, 'berjalan');

  // Minggu 14-21 Sep (05:00) penuh dan harus sama dengan jumlah hari listrik 14..20 Sep di c.days
  const w = periodStart('week', at('2026-09-16T12:00'));
  assert.equal(fmtTs(w), '2026-09-14T05:00');
  const a = aggregatePeriod(c, 'week', w);
  assert.equal(a.status, 'penuh');
  let viaDays = 0;
  for (let d = 14; d <= 20; d++) { const k = c.days['2026-09-' + d]; viaDays += k.pagi + k.siang + k.sore + k.malam; }
  near(a.kwh, viaDays, 1e-9, 'minggu 14-20 Sep = jumlah hari listrik');
  near(a.covH, 168, 0.25, 'penuh: jam tercakup ~168 (potongan di batas dimiliki oleh titik tengahnya)');
  near(a.avgDaily, a.kwh / a.covH * 24, 1e-9, 'rata-rata harian = kWh / jam tercakup x 24');

  // September: baru berjalan sampai 22 Sep, dan minggu pertama (mulai 2 Sep) belum penuh
  assert.equal(aggregatePeriod(c, 'month', at('2026-09-01T05:00')).status, 'berjalan');
  assert.equal(aggregatePeriod(c, 'week', at('2026-08-31T05:00')).status, 'parsial');
  assert.equal(aggregatePeriod(c, 'week', at('2026-09-21T05:00')).status, 'berjalan');
  const first = periodReport(c, 'week', at('2026-08-31T05:00'));
  assert.equal(first.compare.kwhPct, null); // tidak ada periode sebelumnya yang punya data
  assert.equal(first.compare.dailyPct, null);
}

console.log('OK   laporan periode (batas 05:00, pembagian proporsional, perbandingan, rekap token)');
