// Bukti angka tabel verifikasi di CLAUDE.md. Jalankan: npm test  (atau node test/calc.test.js)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compute, DEFAULT_TARIF } from '../js/calc.js';

const csvPath = fileURLToPath(new URL('../data/readings-seed.csv', import.meta.url));
const [head, ...lines] = readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
const cols = head.split(',');
const entries = lines.map(line => {
  const c = line.split(',');
  const r = Object.fromEntries(cols.map((k, i) => [k, c[i]]));
  const e = { id: r.id, ts: r.ts.replace(' ', 'T').slice(0, 16), type: r.type, kwh: parseFloat(r.kwh), tags: r.tags ? r.tags.split('|') : [], note: r.note };
  if (r.added) e.added = parseFloat(r.added);
  if (r.rp) e.rp = parseFloat(r.rp);
  if (r.suhu) e.suhu = parseFloat(r.suhu);
  return e;
});

const c = compute(entries, { tarif: DEFAULT_TARIF });
let fail = 0;
function check(name, actual, expected, digits) {
  const ok = typeof expected === 'number' ? Number(actual).toFixed(digits) === Number(expected).toFixed(digits) : actual === expected;
  if (!ok) fail++;
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${name}: ${typeof actual === 'number' ? actual.toFixed(digits ?? 4) : actual} (harapan ${expected})`);
}

check('jumlah baris seed', entries.length, 61);
check('Total pemakaian (kWh)', c.totalKwh, 131.79, 2);
check('Total biaya (Rp)', c.totalCost, 190397, 0);
check('Rata-rata harian seluruh periode', c.avgDaily, 6.734, 3);
check('Rata-rata 7 hari terakhir', c.daily7, 6.537, 3);
check('Baseline (kW)', c.baseline, 0.0702, 4);
check('Beban AC aktif (kW)', c.acKw, 0.8731, 4);
check('kWh slot pagi', c.slotT.pagi, 17.89, 2);
check('kWh slot siang', c.slotT.siang, 22.07, 2);
check('kWh slot sore', c.slotT.sore, 41.53, 2);
check('kWh slot malam', c.slotT.malam, 50.30, 2);
check('Interval mencurigakan', c.flagged, 2);
check('Interval > 14 jam', c.longCount, 5);

// Dua interval mencurigakan harus tepat (tanggal = akhir interval, saat angka dicatat): 11 Sep rendah, 13 Sep tinggi
const sus = c.iv.filter(x => x.flags.some(f => f.bad)).map(x => x.end.getDate() + ' Sep ' + (x.kw < c.baseline ? 'rendah' : 'tinggi'));
check('Mencurigakan = 11 Sep rendah, 13 Sep tinggi', sus.join(', '), '11 Sep rendah, 13 Sep tinggi');

if (fail) { console.error(`\n${fail} pemeriksaan gagal`); process.exit(1); }
console.log('\nSemua angka verifikasi lulus');
