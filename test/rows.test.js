// Konversi ts dua arah (App <-> Supabase). Jalankan: node test/rows.test.js
import assert from 'node:assert/strict';
import { tsToDb, tsFromDb, toRow, fromRow } from '../js/rows.js';

// tulis: format 'YYYY-MM-DD HH:MM:00' apa adanya
assert.equal(tsToDb('2026-09-02T17:27'), '2026-09-02 17:27:00');
assert.equal(tsToDb('2026-09-22T05:00'), '2026-09-22 05:00:00');
assert.throws(() => tsToDb('bukan tanggal'));

// baca: jam dinding tidak bergeser, apa pun bentuk dari server
assert.equal(tsFromDb('2026-09-02T17:27:00'), '2026-09-02T17:27');
assert.equal(tsFromDb('2026-09-02 17:27:00'), '2026-09-02T17:27');
assert.equal(tsFromDb('2026-09-02T17:27:00.123456'), '2026-09-02T17:27');
assert.equal(tsFromDb(null), null);

// dua arah, termasuk dekat batas hari yang rawan kalau ada pergeseran zona
for (const ts of ['2026-09-02T00:00', '2026-09-02T04:59', '2026-09-02T17:27', '2026-12-31T23:59']) {
  assert.equal(tsFromDb(tsToDb(ts)), ts);
}

// baris: user_id tidak ikut terkirim, kolom null tidak jadi properti
const e = { id: 'r-202609021727', ts: '2026-09-02T17:27', type: 'reading', kwh: 296.33, tags: ['ac'], suhu: 25, note: 'AC on' };
const row = toRow(e);
assert.equal('user_id' in row, false);
assert.equal(row.ts, '2026-09-02 17:27:00');
assert.deepEqual(fromRow({ ...row, kwh: '296.33', user_id: 'x', updated_at: 'y' }), e);

const topup = { id: 't-202609101200', ts: '2026-09-10T12:00', type: 'topup', kwh: 300, added: 68.5, rp: 100000, tags: [], note: '' };
assert.deepEqual(fromRow(toRow(topup)), topup);

console.log('OK   konversi ts dan baris Supabase');
