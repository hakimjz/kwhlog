// Semua rumus hitungan kWh Log. Murni: tanpa DOM, tanpa jaringan, tanpa penyimpanan.
// Waktu disimpan sebagai string jam dinding WIB "YYYY-MM-DDTHH:mm" tanpa timezone.

export const DEFAULT_TARIF = 1444.70;

export const TAGS = [
  { k: 'ac', label: 'AC nyala' },
  { k: 'noac', label: 'Tanpa AC' },
  { k: 'kosong', label: 'Rumah kosong' },
  { k: 'cuci', label: 'Mesin cuci' },
  { k: 'pompa', label: 'Pompa air' }
];
export const TAGLABEL = Object.fromEntries(TAGS.map(t => [t.k, t.label]));

export const SLOTS = [
  { k: 'pagi', label: 'Pagi', range: '05–09', c: 'var(--pagi)' },
  { k: 'siang', label: 'Siang', range: '09–17', c: 'var(--siang)' },
  { k: 'sore', label: 'Sore', range: '17–22', c: 'var(--sore)' },
  { k: 'malam', label: 'Malam', range: '22–05', c: 'var(--malam)' }
];

/* ---------- helpers ---------- */
export const pad = n => String(n).padStart(2, '0');

export function parseTs(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5]) : new Date(NaN);
}
export function fmtTs(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
export function dayKey(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

// Terima angka gaya Indonesia ("164,54") maupun gaya spreadsheet ("1,234.5").
export function num(s) {
  if (s == null) return NaN;
  s = String(s).trim().replace(/\s/g, '');
  if (!s) return NaN;
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) s = s.replace(',', '.');
  return parseFloat(s);
}
export function rpNum(s) { return parseFloat(String(s || '').replace(/[^\d]/g, '')); }
// Id hanya bergantung pada ts (semua tipe berprefix 'r-'), karena (user_id, ts) harus unik.
export function idFor(ts) { return 'r-' + ts.replace(/[-T:]/g, ''); }

export function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export function slotOf(h) {
  if (h >= 5 && h < 9) return 'pagi';
  if (h >= 9 && h < 17) return 'siang';
  if (h >= 17 && h < 22) return 'sore';
  return 'malam';
}
export function inferTags(note) {
  const n = (note || '').toLowerCase();
  const t = [];
  if (/no ac|tanpa ac/.test(n)) t.push('noac');
  else if (/\bac (on|nyala)\b|ac baru mati|ac nyala \d/.test(n) && !/ac nyala jam/.test(n)) t.push('ac');
  if (/ditinggal|kosong|baru balik/.test(n)) t.push('kosong');
  if (/mesin cuci|nyuci|cuci/.test(n)) t.push('cuci');
  if (/pompa/.test(n)) t.push('pompa');
  return t;
}

/* ---------- potongan 15 menit ---------- */
// Satu interval dibagi per 15 menit (dihitung dari awal interval, beban dianggap rata). Tiap potongan
// dimiliki oleh titik tengahnya: dipakai untuk slot waktu, hari listrik, dan periode laporan,
// jadi semua penjumlahan saling cocok. fn(titikTengah: Date, jam, kwh, slot).
const STEP = 15 * 6e4;
export function forEachChunk(x, fn) {
  for (let t = +x.start; t < +x.end; t += STEP) {
    const e = Math.min(t + STEP, +x.end), hh = (e - t) / 36e5;
    const d = new Date(t + (e - t) / 2);
    fn(d, hh, x.kw * hh, slotOf(d.getHours()));
  }
}

/* ---------- hitungan utama ---------- */
export function compute(entries, settings = {}) {
  const tarif = settings.tarif || DEFAULT_TARIF;
  const list = entries.filter(e => e && e.ts && isFinite(e.kwh)).slice().sort((a, b) => a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0);
  const topups = list.filter(e => e.type === 'topup' && e.rp > 0 && e.added > 0);
  const rateFor = t => { let r = tarif; for (const tp of topups) { if (tp.ts <= t) r = tp.rp / tp.added; } return r; };
  const iv = [];
  for (let i = 1; i < list.length; i++) {
    const prev = list[i - 1], cur = list[i];
    const start = parseTs(prev.ts), end = parseTs(cur.ts);
    const h = (end - start) / 36e5; if (!(h > 0)) continue;
    const used = cur.type === 'topup' ? prev.kwh - (cur.kwh - (cur.added || 0)) : prev.kwh - cur.kwh;
    const rate = rateFor(prev.ts);
    iv.push({ prev, cur, start, end, h, used, kw: used / h, cost: used * rate, rate, bad: used < -0.005, tags: cur.tags || [], flags: [] });
  }
  const valid = iv.filter(x => !x.bad);
  const midHour = x => new Date((+x.start + +x.end) / 2).getHours();
  let baseline = median(valid.filter(x => x.h >= 3 && midHour(x) >= 9 && midHour(x) < 17).map(x => x.kw));
  if (baseline == null && valid.length) { const s = valid.map(x => x.kw).sort((a, b) => a - b); baseline = s[Math.floor(s.length * .2)]; }
  const longMed = median(valid.filter(x => x.h >= 6).map(x => x.kw));
  for (const x of iv) {
    if (x.bad) { x.flags.push({ bad: true, t: 'Angka meter naik tanpa catatan beli token. Interval ini tidak dihitung.' }); continue; }
    if (baseline && x.h >= 3 && x.kw < baseline * .5) x.flags.push({ bad: true, t: 'Di bawah beban dasar. Mungkin MCB dimatikan atau salah catat.' });
    if (longMed && x.h >= 6 && x.kw > longMed * 2) x.flags.push({ bad: true, t: 'Lebih dari 2× rata-rata interval panjang lainnya. Cek AC atau angka meter.' });
    if (x.h > 14) x.flags.push({ t: 'Interval lebih dari 14 jam, jadi pembagian siang/malam kurang akurat.' });
  }
  const first = list[0], last = list[list.length - 1];
  const lastD = last ? parseTs(last.ts) : null;
  const totalKwh = valid.reduce((s, x) => s + x.used, 0), totalCost = valid.reduce((s, x) => s + x.cost, 0), totalH = valid.reduce((s, x) => s + x.h, 0);
  const avgDaily = totalH ? totalKwh / totalH * 24 : null;
  // jendela 7×24 jam terakhir, memakai irisan tiap interval
  let k7 = 0, h7 = 0, c7 = 0;
  if (lastD) {
    const from = +lastD - 7 * 864e5;
    for (const x of valid) {
      const o = (Math.min(+x.end, +lastD) - Math.max(+x.start, from)) / 36e5;
      if (o > 0) { k7 += x.kw * o; h7 += o; c7 += x.kw * o * x.rate; }
    }
  }
  const daily7 = h7 ? k7 / h7 * 24 : avgDaily, daily7Cost = h7 ? c7 / h7 * 24 : null;
  const curRate = lastD ? rateFor(last.ts) : tarif;
  // slot waktu & hari listrik (batas 05:00), potongan 15 menit
  const slotT = { pagi: 0, siang: 0, sore: 0, malam: 0 }, slotC = { pagi: 0, siang: 0, sore: 0, malam: 0 }, days = {};
  for (const x of valid) {
    forEachChunk(x, (d, hh, kwh, s) => {
      slotT[s] += kwh; slotC[s] += kwh * x.rate;
      const dk = dayKey(new Date(+d - 5 * 36e5));
      (days[dk] || (days[dk] = { pagi: 0, siang: 0, sore: 0, malam: 0, cov: 0 }))[s] += kwh; days[dk].cov += hh;
    });
  }
  // beban per tag
  const tagStats = [];
  for (const t of TAGS) {
    let xs = valid.filter(x => x.tags.includes(t.k)); if (t.k === 'ac') xs = xs.filter(x => x.h <= 4);
    if (!xs.length) continue;
    const k = xs.reduce((s, x) => s + x.used, 0), hh = xs.reduce((s, x) => s + x.h, 0);
    tagStats.push({ k: t.k, label: t.label + (t.k === 'ac' ? ' (aktif)' : ''), kw: k / hh, n: xs.length, h: hh });
  }
  const acS = tagStats.find(t => t.k === 'ac');
  return {
    list, iv, valid, baseline, totalKwh, totalCost, totalH, avgDaily, daily7, daily7Cost, curRate, slotT, slotC, days, tagStats, acKw: acS ? acS.kw : null,
    first, last, lastD, token: last ? last.kwh : null,
    spanDays: first && last ? (parseTs(last.ts) - parseTs(first.ts)) / 864e5 : 0,
    flagged: iv.filter(x => x.flags.some(f => f.bad)).length, longCount: iv.filter(x => x.h > 14).length,
    hasTopupRate: topups.length > 0
  };
}

/* ---------- laporan periode (hari / minggu / bulan) ---------- */
// Batas periode jatuh pada jam 05:00 (batas hari listrik), bukan tengah malam.
// Hari mulai 05:00; minggu mulai Senin 05:00; bulan mulai tanggal 1 05:00. Interval yang melewati batas dibagi per potongan
// 15 menit (forEachChunk), tiap potongan masuk ke periode yang memuat titik tengahnya.
// kind: 'day' (hari listrik 05:00-05:00), 'week', atau 'month'.
// Periode yang sudah lewat dianggap penuh bila cakupan datanya cukup: minggu/bulan >= 95% jamnya,
// hari >= 20 dari 24 jam (aturan "hari belum penuh" di CLAUDE.md, sama dengan grafik harian).
export const FULL_RATIO = 0.95;
export const DAY_FULL_RATIO = 20 / 24;

// Awal periode yang memuat waktu d.
export function periodStart(kind, d) {
  const x = new Date(+d - 5 * 36e5); // sebelum 05:00 masih termasuk hari listrik sebelumnya
  if (kind === 'day') return new Date(x.getFullYear(), x.getMonth(), x.getDate(), 5, 0);
  if (kind === 'month') return new Date(x.getFullYear(), x.getMonth(), 1, 5, 0);
  const dow = (x.getDay() + 6) % 7; // Senin = 0
  return new Date(x.getFullYear(), x.getMonth(), x.getDate() - dow, 5, 0);
}
// Awal periode n langkah dari `start` (n negatif = sebelumnya).
export function shiftPeriod(kind, start, n) {
  if (kind === 'day') return new Date(start.getFullYear(), start.getMonth(), start.getDate() + n, 5, 0);
  if (kind === 'month') return new Date(start.getFullYear(), start.getMonth() + n, 1, 5, 0);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * n, 5, 0);
}
// Rentang periode yang punya data: awal periode catatan pertama sampai periode catatan terakhir.
export function periodSpan(c, kind) {
  if (!c.first) return null;
  return { first: periodStart(kind, parseTs(c.first.ts)), last: periodStart(kind, c.lastD) };
}

// Total satu periode dari hasil compute(). status: kosong | berjalan | parsial | penuh.
export function aggregatePeriod(c, kind, start) {
  const end = shiftPeriod(kind, start, 1);
  const lenH = (end - start) / 36e5;
  const slotKwh = { pagi: 0, siang: 0, sore: 0, malam: 0 };
  const slotCost = { pagi: 0, siang: 0, sore: 0, malam: 0 };
  let kwh = 0, cost = 0, covH = 0;
  for (const x of c.valid) {
    if (+x.end <= +start || +x.start >= +end) continue;
    forEachChunk(x, (d, hh, k, s) => {
      if (+d < +start || +d >= +end) return;
      kwh += k; cost += k * x.rate; covH += hh; slotKwh[s] += k; slotCost[s] += k * x.rate;
    });
  }
  const tops = c.list.filter(e => e.type === 'topup' && parseTs(e.ts) >= start && parseTs(e.ts) < end)
    .map(e => ({ id: e.id, ts: e.ts, kwh: e.kwh, added: e.added || 0, rp: e.rp || 0, rate: e.rp > 0 && e.added > 0 ? e.rp / e.added : null }));
  const paid = tops.filter(t => t.rate != null);
  const topups = {
    list: tops, count: tops.length,
    added: tops.reduce((s, t) => s + t.added, 0),
    rp: tops.reduce((s, t) => s + t.rp, 0),
    avgRate: paid.length ? paid.reduce((s, t) => s + t.rp, 0) / paid.reduce((s, t) => s + t.added, 0) : null
  };
  const ended = !!c.lastD && +c.lastD >= +end;
  const status = covH <= 0 ? 'kosong' : !ended ? 'berjalan' : covH / lenH < (kind === 'day' ? DAY_FULL_RATIO : FULL_RATIO) ? 'parsial' : 'penuh';
  return {
    kind, start, end, lenH, covH, coverage: covH / lenH, status,
    kwh, cost, slotKwh, slotCost,
    avgDaily: covH > 0 ? kwh / covH * 24 : null, // total / jam tercakup x 24, bukan dibagi jumlah tanggal
    avgDailyCost: covH > 0 ? cost / covH * 24 : null,
    topups
  };
}

const pct = (a, b) => (b > 0 && a != null ? (a - b) / b * 100 : null);

// Laporan satu periode + perbandingan dengan periode sebelumnya.
// Total (kWh dan Rp) hanya dibandingkan kalau KEDUA periode penuh; kalau tidak, hanya rata-rata harian
// (itu pun hanya bila masing-masing punya data >= 24 jam; untuk hari >= 12 jam), karena total periode yang belum
// penuh tidak setara.
export function periodReport(c, kind, start) {
  const cur = aggregatePeriod(c, kind, start);
  const prev = aggregatePeriod(c, kind, shiftPeriod(kind, start, -1));
  const comparable = cur.status === 'penuh' && prev.status === 'penuh';
  const minH = kind === 'day' ? 12 : 24;
  const dailyOk = cur.covH >= minH && prev.covH >= minH;
  return {
    ...cur, prev,
    compare: {
      comparable,
      kwhPct: comparable ? pct(cur.kwh, prev.kwh) : null,
      rpPct: comparable ? pct(cur.cost, prev.cost) : null,
      dailyPct: dailyOk ? pct(cur.avgDaily, prev.avgDaily) : null
    }
  };
}
