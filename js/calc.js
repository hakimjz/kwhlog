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
export function idFor(type, ts) { return (type === 'topup' ? 't-' : 'r-') + ts.replace(/[-T:]/g, ''); }

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
  const STEP = 15 * 6e4;
  for (const x of valid) {
    for (let t = +x.start; t < +x.end; t += STEP) {
      const e = Math.min(t + STEP, +x.end), hh = (e - t) / 36e5, kwh = x.kw * hh;
      const d = new Date(t + (e - t) / 2), s = slotOf(d.getHours());
      slotT[s] += kwh; slotC[s] += kwh * x.rate;
      const dk = dayKey(new Date(+d - 5 * 36e5));
      (days[dk] || (days[dk] = { pagi: 0, siang: 0, sore: 0, malam: 0, cov: 0 }))[s] += kwh; days[dk].cov += hh;
    }
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
