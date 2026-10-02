// Render + event. Hitungan ada di calc.js, penyimpanan di store.js.
import { TAGS, TAGLABEL, SLOTS, compute, parseTs, fmtTs, dayKey, num, rpNum, idFor, inferTags, pad, shiftPeriod, periodSpan, periodReport } from './calc.js';
import * as store from './store.js';

const $ = id => document.getElementById(id);

/* ---------- format ---------- */
const nf = (n, d = 0) => Number(n).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const rp = n => 'Rp' + nf(Math.round(n));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function fmtDT(d) { return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function fmtHM(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
const pend = id => store.isPending(id) ? ' <span class="pend" title="Belum terkirim ke cloud">● belum terkirim</span>' : '';
function dur(h) { const m = Math.round(h * 60); return Math.floor(m / 60) + ':' + pad(m % 60); }

/* ---------- render ---------- */
function calc() { return compute(store.getEntries(), store.getSettings()); }

function render() {
  const c = calc();
  renderMeter(c); renderSummary(c); renderPola(c); renderReport(c); renderHist(c);
  if (document.activeElement !== $('setTarif')) $('setTarif').value = store.getSettings().tarif;
}

function renderMeter(c) {
  if (!c.last) { $('tokenNum').textContent = '---'; $('tokenSub').textContent = 'Belum ada catatan. Mulai dengan Catat meter.'; $('lastRead').textContent = ''; $('warn').hidden = true; return; }
  $('tokenNum').textContent = nf(c.token, 2);
  if (c.valid.length < 1) {
    // baru satu catatan (saldo awal): belum ada interval, jangan menebak
    $('tokenSub').textContent = 'Saldo awal tercatat. Catat lagi nanti untuk menghitung pemakaian.';
  } else if (c.daily7 && c.daily7 > 0) {
    const days = c.token / c.daily7, out = new Date(+c.lastD + days * 864e5);
    $('tokenSub').textContent = `Cukup ±${nf(days, 0)} hari lagi, habis sekitar ${out.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' })}`;
  } else $('tokenSub').textContent = 'Catat lagi untuk menghitung perkiraan habis.';
  const ago = (Date.now() - c.lastD) / 36e5;
  $('lastRead').textContent = `Catatan terakhir ${fmtDT(c.lastD)}, ${ago < 1 ? 'kurang dari 1 jam' : nf(ago, 0) + ' jam'} yang lalu`;
  const w = $('warn');
  if (ago > 14) { w.hidden = false; w.textContent = `Sudah ${nf(ago, 0)} jam sejak catatan terakhir. Catat sekarang supaya pemakaian siang dan malam bisa dipisahkan.`; }
  else w.hidden = true;
}

function renderSummary(c) {
  if (c.valid.length < 1) { $('stats').innerHTML = ''; $('slots').innerHTML = '<p class="lead">Catat minimal dua angka meter untuk mulai melihat pemakaian.</p>'; $('insights').innerHTML = ''; return; }
  const proj = c.daily7Cost ? c.daily7Cost * 30 : c.daily7 * c.curRate * 30;
  $('stats').innerHTML = `
    <div class="stat"><div class="k">Rata-rata 7 hari terakhir</div><div class="v">${nf(c.daily7, 1)} kWh/hari</div><div class="s">${rp(c.daily7Cost || c.daily7 * c.curRate)} per hari</div></div>
    <div class="stat"><div class="k">Perkiraan 30 hari</div><div class="v">${rp(proj)}</div><div class="s">${nf(c.daily7 * 30, 0)} kWh</div></div>
    <div class="stat"><div class="k">Seluruh periode</div><div class="v">${nf(c.totalKwh, 1)} kWh</div><div class="s">${rp(c.totalCost)} dalam ${nf(c.spanDays, 1)} hari</div></div>
    <div class="stat"><div class="k">Tarif dipakai</div><div class="v">${rp(c.curRate)}</div><div class="s">${c.hasTopupRate ? 'dari pembelian token terakhir' : 'tarif default, per kWh'}</div></div>`;
  const tot = SLOTS.reduce((s, x) => s + c.slotT[x.k], 0) || 1;
  $('slots').innerHTML = `<div class="slotbar" role="img" aria-label="Pembagian pemakaian per waktu">${SLOTS.map(s => `<span style="width:${c.slotT[s.k] / tot * 100}%;background:${s.c}"></span>`).join('')}</div>
    <div class="slotrows">${SLOTS.map(s => `<div><span class="sw" style="background:${s.c}"></span>${s.label} <span class="dim">${s.range}</span></div><div></div><div class="num">${nf(c.slotT[s.k], 1)} kWh</div><div class="num"><b>${nf(c.slotT[s.k] / tot * 100, 0)}%</b></div>`).join('')}</div>`;
  const li = [];
  const nightPct = (c.slotT.sore + c.slotT.malam) / tot * 100;
  li.push(`${nf(nightPct, 0)}% pemakaian terjadi antara 17:00 dan 05:00. Penghematan paling terasa kalau dimulai dari jam-jam ini.`);
  if (c.baseline) li.push(`Beban dasar saat rumah sepi sekitar ${nf(c.baseline * 1000, 0)} W (kulkas, modem, CCTV, dan standby), setara ${rp(c.baseline * 24 * c.curRate)} per hari atau ${rp(c.baseline * 24 * 30 * c.curRate)} per bulan.`);
  if (c.acKw) {
    const extra = Math.max(0, c.acKw - (c.baseline || 0));
    li.push(`Saat AC aktif, beban rumah sekitar ${nf(c.acKw, 2)} kW atau ${rp(c.acKw * c.curRate)} per jam. Tambahan dari AC kira-kira ${nf(extra, 2)} kW, jadi 8 jam AC semalam ≈ ${rp(extra * 8 * c.curRate)}.`);
  } else li.push('Beri label AC nyala saat mencatat supaya biaya AC per jam bisa dihitung.');
  if (c.flagged) li.push(`${c.flagged} interval ditandai tidak wajar. Cek di tab Riwayat.`);
  if (c.longCount) li.push(`${c.longCount} interval lebih dari 14 jam. Catat di jam tetap (misalnya 07:00, 17:00, 22:00) agar pola lebih jelas.`);
  $('insights').innerHTML = li.map(x => `<li>${x}</li>`).join('');
}

function renderPola(c) {
  const keys = Object.keys(c.days).sort();
  $('legend').innerHTML = SLOTS.map(s => `<span><span class="sw" style="background:${s.c}"></span>${s.label} ${s.range}</span>`).join('');
  if (!keys.length) { $('chart').innerHTML = '<p class="lead" style="padding:8px">Belum ada data.</p>'; $('tagtable').innerHTML = ''; return; }
  const tots = keys.map(k => SLOTS.reduce((s, x) => s + c.days[k][x.k], 0));
  const max = Math.max(...tots, 1), top = Math.ceil(max / 2) * 2, step = top <= 6 ? 1 : 2;
  const padL = 30, padB = 24, padT = 10, H = 220, bw = 30, W = padL + keys.length * bw + 8;
  const y = v => padT + (H - padT - padB) * (1 - v / top);
  let g = '';
  for (let v = 0; v <= top; v += step) { g += `<line x1="${padL}" x2="${W - 4}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${padL - 6}" y="${y(v) + 3}" text-anchor="end">${v}</text>`; }
  keys.forEach((k, i) => {
    const d = c.days[k], x = padL + i * bw + 5, w = bw - 10, full = d.cov >= 20; let acc = 0;
    const title = `${new Date(k + 'T12:00').toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' })}: ${nf(tots[i], 2)} kWh (${rp(tots[i] * c.curRate)})${full ? '' : ', data belum penuh'}`;
    let bars = '';
    for (const s of SLOTS) { const v = d[s.k]; if (v <= 0) continue; const y1 = y(acc + v), y0 = y(acc); bars += `<rect x="${x}" y="${y1}" width="${w}" height="${Math.max(0, y0 - y1)}" fill="${s.c}"/>`; acc += v; }
    g += `<g opacity="${full ? 1 : .4}"><title>${esc(title)}</title>${bars}</g><text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${+k.slice(8)}</text>`;
  });
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="min-width:${W}px;display:block" role="img" aria-label="Grafik pemakaian harian">${g}<text x="4" y="${padT + 4}">kWh</text></svg>`;
  const rows = c.tagStats.slice();
  if (c.baseline) rows.push({ label: 'Beban dasar (siang, dihitung)', kw: c.baseline, n: null, h: null });
  $('tagtable').innerHTML = rows.length ? `<table><thead><tr><th>Kondisi</th><th class="num">Beban</th><th class="num">Biaya/jam</th><th class="num">Data</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${nf(r.kw, 2)} kW</td><td class="num">${rp(r.kw * c.curRate)}</td><td class="num dim">${r.n ? r.n + '× / ' + nf(r.h, 0) + ' jam' : '—'}</td></tr>`).join('')}</tbody></table>` : '<p class="lead" style="padding:10px 12px;margin:0">Belum ada catatan berlabel.</p>';
}

/* ---------- laporan ---------- */
let rpKind = 'week', rpStart = null; // rpStart null = periode terakhir yang punya data
const MONTHS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const dShort = d => d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
const sgn = v => (v > 0 ? '+' : v < 0 ? '−' : '') + nf(Math.abs(v), 1) + '%';
const STATUS_NOTE = {
  berjalan: 'Periode ini masih berjalan atau datanya belum sampai ke akhir periode.',
  parsial: 'Data belum mencakup seluruh periode ini.'
};

function periodLabel(kind, start) {
  if (kind === 'month') return MONTHS[start.getMonth()] + ' ' + start.getFullYear();
  const last = new Date(+shiftPeriod('week', start, 1) - 6 * 36e5); // hari listrik terakhir (Minggu)
  return dShort(start) + ' – ' + dShort(last) + ' ' + last.getFullYear();
}

function renderReport(c) {
  const span = periodSpan(c, rpKind);
  $('rpKind').querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === rpKind ? 'true' : 'false'));
  if (!span) {
    $('rpTitle').textContent = '';
    $('rpPrev').disabled = $('rpNext').disabled = true;
    $('rpBody').innerHTML = '<p class="lead">Catat minimal dua angka meter untuk melihat laporan.</p>';
    return;
  }
  const start = rpStart && +rpStart >= +span.first && +rpStart <= +span.last ? rpStart : span.last;
  rpStart = +start === +span.last ? null : start;
  $('rpTitle').textContent = periodLabel(rpKind, start);
  $('rpPrev').disabled = +start <= +span.first;
  $('rpNext').disabled = +start >= +span.last;

  const r = periodReport(c, rpKind, start);
  const unit = rpKind === 'month' ? 'bulan' : 'minggu';
  if (r.status === 'kosong') { $('rpBody').innerHTML = '<div class="rpnote">Belum ada data di periode ini.</div>'; return; }
  let html = '';
  if (r.status !== 'penuh') html += `<div class="rpnote"><b>Data belum penuh.</b> ${STATUS_NOTE[r.status]} Tercakup ${nf(r.covH / 24, 1)} dari ${nf(r.lenH / 24, 0)} hari, jadi total di bawah bukan angka satu ${unit} penuh.</div>`;

  html += `<div class="stats">
    <div class="stat"><div class="k">Total pemakaian</div><div class="v">${nf(r.kwh, 1)} kWh</div><div class="s">${rp(r.cost)}</div></div>
    <div class="stat"><div class="k">Rata-rata harian</div><div class="v">${r.avgDaily == null ? '—' : nf(r.avgDaily, 1) + ' kWh'}</div><div class="s">${r.avgDailyCost == null ? '' : rp(r.avgDailyCost) + ' per hari'}</div></div>
  </div>`;

  const tot = SLOTS.reduce((s, x) => s + r.slotKwh[x.k], 0) || 1;
  html += `<h2>Kapan listrik terpakai</h2>
    <div class="slotbar" role="img" aria-label="Pembagian pemakaian per waktu">${SLOTS.map(s => `<span style="width:${r.slotKwh[s.k] / tot * 100}%;background:${s.c}"></span>`).join('')}</div>
    <div class="slotrows">${SLOTS.map(s => `<div><span class="sw" style="background:${s.c}"></span>${s.label} <span class="dim">${s.range}</span></div><div></div><div class="num">${nf(r.slotKwh[s.k], 1)} kWh</div><div class="num"><b>${nf(r.slotKwh[s.k] / tot * 100, 0)}%</b></div>`).join('')}</div>`;

  const prevLabel = periodLabel(rpKind, r.prev.start), cmp = r.compare;
  html += `<h2>Dibanding ${unit} sebelumnya</h2>`;
  if (cmp.comparable) {
    html += `<div class="cmp"><div>Total kWh</div><div class="delta">${sgn(cmp.kwhPct)}</div>
      <div>Total rupiah</div><div class="delta">${sgn(cmp.rpPct)}</div>
      <div>Rata-rata harian</div><div class="delta">${sgn(cmp.dailyPct)}</div></div>
      <p class="lead">Dibanding ${esc(prevLabel)} (${nf(r.prev.kwh, 1)} kWh, ${rp(r.prev.cost)}). Tarif bisa berbeda di antara dua periode.</p>`;
  } else if (cmp.dailyPct != null) {
    html += `<div class="cmp"><div>Rata-rata harian</div><div class="delta">${sgn(cmp.dailyPct)}</div></div>
      <p class="lead">Total tidak dibandingkan karena ${r.status !== 'penuh' ? 'periode ini' : 'periode sebelumnya (' + esc(prevLabel) + ')'} belum penuh. Rata-rata harian dihitung per jam yang tercakup data (${nf(r.avgDaily, 1)} lawan ${nf(r.prev.avgDaily, 1)} kWh/hari).</p>`;
  } else {
    html += `<p class="lead">Belum bisa dibandingkan: ${r.prev.covH < 24 ? 'data ' + unit + ' sebelumnya (' + esc(prevLabel) + ') kurang dari satu hari' : 'data periode ini kurang dari satu hari'}.</p>`;
  }

  const t = r.topups;
  html += '<h2>Pembelian token</h2>';
  if (!t.count) html += '<p class="lead">Tidak ada pembelian token di periode ini.</p>';
  else {
    html += `<p class="lead">${t.count} kali beli, +${nf(t.added, 1)} kWh${t.rp ? ', ' + rp(t.rp) : ''}${t.avgRate ? ', rata-rata ' + rp(t.avgRate) + '/kWh' : ''}.</p>
      <div class="tblwrap"><table><thead><tr><th>Waktu</th><th class="num">kWh masuk</th><th class="num">Nominal</th><th class="num">Per kWh</th></tr></thead><tbody>${t.list.map(x => `<tr><td>${fmtDT(parseTs(x.ts))}</td><td class="num">+${nf(x.added, 2)}</td><td class="num">${x.rp ? rp(x.rp) : '—'}</td><td class="num">${x.rate ? rp(x.rate) : '—'}</td></tr>`).join('')}</tbody></table></div>`;
  }
  $('rpBody').innerHTML = html;
}

$('rpKind').addEventListener('click', e => { const b = e.target.closest('.chip'); if (!b || b.dataset.kind === rpKind) return; rpKind = b.dataset.kind; rpStart = null; render(); });
$('rpPrev').onclick = () => { const span = periodSpan(calc(), rpKind); if (span) { rpStart = shiftPeriod(rpKind, rpStart || span.last, -1); render(); } };
$('rpNext').onclick = () => { const span = periodSpan(calc(), rpKind); if (span) { rpStart = shiftPeriod(rpKind, rpStart || span.last, 1); render(); } };

function renderHist(c) {
  const items = [];
  for (const x of c.iv) {
    const topup = x.cur.type === 'topup';
    const sameDay = dayKey(x.start) === dayKey(x.end);
    const range = `${fmtDT(x.start)} – ${sameDay ? fmtHM(x.end) : fmtDT(x.end)}`;
    const tags = [...x.tags.map(t => TAGLABEL[t] + (t === 'ac' && x.cur.suhu ? ' ' + x.cur.suhu + '°C' : ''))];
    items.push(`<li class="${topup ? 'topup' : ''}">
      <div class="hrow"><div class="htime">${range} <span class="dim">(${dur(x.h)})</span>${pend(x.cur.id)}</div><div class="hval">${x.bad ? '—' : rp(x.cost)}</div></div>
      <div class="hmeta">${x.bad ? '' : `${nf(x.used, 2)} kWh, rata-rata ${nf(x.kw, 2)} kW`}${topup ? `${x.bad ? '' : '. '}Beli token ${x.cur.rp ? rp(x.cur.rp) + ', ' : ''}+${nf(x.cur.added || 0, 2)} kWh` : ''}</div>
      ${tags.length ? `<div class="tags">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}
      ${x.cur.note ? `<div class="hmeta">${esc(x.cur.note)}</div>` : ''}
      ${x.flags.map(f => `<div class="flag ${f.bad ? 'bad' : ''}">${esc(f.t)}</div>`).join('')}
      <div class="hbtns"><button class="btn small" data-edit="${esc(x.cur.id)}">Ubah</button><button class="btn small danger" data-del="${esc(x.cur.id)}">Hapus</button></div>
    </li>`);
  }
  if (c.first) items.push(`<li><div class="hrow"><div class="htime">${fmtDT(parseTs(c.first.ts))}${pend(c.first.id)}</div><div class="hval">${nf(c.first.kwh, 2)} kWh</div></div><div class="hmeta">Catatan awal</div><div class="hbtns"><button class="btn small" data-edit="${esc(c.first.id)}">Ubah</button><button class="btn small danger" data-del="${esc(c.first.id)}">Hapus</button></div></li>`);
  $('hist').innerHTML = items.length ? items.slice(0, -1).reverse().concat(items.slice(-1)).join('') : '<li class="dim">Belum ada catatan.</li>';
}

/* ---------- tabs ---------- */
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.setAttribute('aria-selected', x === b ? 'true' : 'false'));
  document.querySelectorAll('.pane').forEach(p => p.hidden = p.id !== 'pane-' + b.dataset.tab);
}));

/* ---------- dialog ---------- */
let mode = 'read', editId = null, selTags = new Set();
$('fTags').innerHTML = TAGS.map(t => `<button type="button" class="chip" data-tag="${t.k}" aria-pressed="false">${t.label}</button>`).join('');
$('fTags').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return; const k = b.dataset.tag;
  if (selTags.has(k)) selTags.delete(k); else { selTags.add(k); if (k === 'ac') selTags.delete('noac'); if (k === 'noac') selTags.delete('ac'); }
  syncChips();
});
function syncChips() { $('fTags').querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', selTags.has(b.dataset.tag) ? 'true' : 'false')); $('suhuWrap').hidden = !selTags.has('ac'); }
function setMode(m) {
  mode = m; $('topupFields').hidden = m !== 'topup'; $('readFields').hidden = m === 'topup';
  $('dlgTitle').textContent = (editId ? 'Ubah ' : '') + (m === 'topup' ? 'catatan beli token' : 'catatan meter');
  $('fKwhLabel').textContent = m === 'topup' ? 'Angka di meter setelah token masuk (kWh)' : 'Angka di meter (kWh)';
}
function openDlg(m, entry) {
  editId = entry ? entry.id : null;
  $('fTs').value = entry ? entry.ts : fmtTs(new Date());
  $('fKwh').value = entry ? String(entry.kwh).replace('.', ',') : '';
  $('fAdded').value = entry && entry.added ? String(entry.added).replace('.', ',') : '';
  $('fRp').value = entry && entry.rp ? entry.rp : '';
  $('fNote').value = entry ? entry.note || '' : '';
  $('fSuhu').value = entry && entry.suhu ? entry.suhu : '';
  selTags = new Set(entry ? entry.tags || [] : []); syncChips();
  $('fMsg').textContent = ''; setMode(m);
  $('dlg').showModal(); setTimeout(() => $('fKwh').focus(), 50);
}
$('btnRead').onclick = () => openDlg('read');
$('btnTopup').onclick = () => openDlg('topup');
$('fCancel').onclick = () => $('dlg').close();
$('dlg').addEventListener('click', e => { if (e.target === $('dlg')) $('dlg').close(); });
$('fMsg').addEventListener('click', e => { if (e.target.dataset.switch) { setMode('topup'); $('fMsg').textContent = ''; $('fAdded').focus(); } });
$('fSave').onclick = async () => {
  const entries = store.getEntries();
  const ts = $('fTs').value, kwh = num($('fKwh').value);
  if (!ts || isNaN(parseTs(ts))) { $('fMsg').textContent = 'Isi waktu pencatatan.'; return; }
  if (!(kwh >= 0)) { $('fMsg').textContent = 'Isi angka meter, contoh 164,54.'; return; }
  const prev = entries.filter(e => e.id !== editId && e.ts < ts).sort((a, b) => a.ts < b.ts ? 1 : -1)[0];
  let obj;
  if (mode === 'read') {
    if (prev && kwh > prev.kwh + 0.005) { $('fMsg').innerHTML = `Angka ini lebih besar dari catatan sebelumnya (${nf(prev.kwh, 2)}). Kalau kamu baru isi token, <button class="btn small" data-switch="1">Catat sebagai beli token</button>`; return; }
    obj = { type: 'reading', ts, kwh, tags: [...selTags], note: $('fNote').value.trim() };
    if (selTags.has('ac') && $('fSuhu').value) obj.suhu = +$('fSuhu').value;
  } else {
    const added = num($('fAdded').value), paid = rpNum($('fRp').value);
    if (!(added > 0)) { $('fMsg').textContent = 'Isi jumlah kWh yang masuk dari token.'; return; }
    obj = { type: 'topup', ts, kwh, added, note: $('fNote').value.trim() };
    if (paid > 0) obj.rp = paid;
  }
  // ts tidak berubah saat edit: pertahankan id yang sama (update baris yang sama, tanpa delete).
  const old = editId && entries.find(e => e.id === editId);
  obj.id = old && old.ts === ts ? editId : idFor(ts);
  // unik per ts di database, jadi cek berdasarkan ts, bukan id
  const dup = entries.find(e => e.ts === ts && e.id !== obj.id);
  if (dup) { $('fMsg').textContent = 'Sudah ada catatan di menit yang sama. Ubah waktunya sedikit.'; return; }
  $('fSave').disabled = true;
  try {
    await store.put(obj);
    if (editId && editId !== obj.id) await store.del(editId);
    $('dlg').close();
  } catch (e) { $('fMsg').textContent = 'Gagal menyimpan. Coba lagi.'; }
  $('fSave').disabled = false;
};

/* ---------- aksi riwayat ---------- */
$('hist').addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit]'), de = e.target.closest('[data-del]');
  if (ed) { const en = store.getEntries().find(x => x.id === ed.dataset.edit); if (en) openDlg(en.type === 'topup' ? 'topup' : 'read', en); }
  if (de) {
    if (de.dataset.armed !== '1') { de.dataset.armed = '1'; de.textContent = 'Yakin hapus?'; setTimeout(() => { if (de.isConnected) { de.dataset.armed = ''; de.textContent = 'Hapus'; } }, 3000); return; }
    try { await store.del(de.dataset.del); } catch (err) { de.textContent = 'Gagal'; }
  }
});

/* ---------- pengaturan ---------- */
$('saveTarif').onclick = async () => {
  const v = num($('setTarif').value);
  if (!(v > 0)) { $('tarifMsg').textContent = 'Isi tarif yang valid.'; return; }
  try { await store.saveSettings(Object.assign({}, store.getSettings(), { tarif: v })); $('tarifMsg').textContent = 'Tarif disimpan.'; } catch (e) { $('tarifMsg').textContent = 'Gagal menyimpan tarif.'; }
};

/* ---------- impor ---------- */
$('doImport').onclick = async () => {
  const lines = $('importText').value.split(/\r?\n/); const out = [];
  for (const line of lines) {
    let c = line.split('\t'); if (c.length < 3) c = line.split(/;|,(?=\s*\d{1,2}[:.]\d{2})|\s{2,}/);
    const i = c.findIndex(x => /^\s*\d{4}-\d{2}-\d{2}\s*$/.test(x)); if (i < 0) continue;
    const date = c[i].trim(), tm = (c[i + 1] || '').trim().replace('.', ':'); const tmm = /^(\d{1,2}):(\d{2})/.exec(tm); if (!tmm) continue;
    const kIdx = /^\s*\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}/.test(c[i + 2] || '') ? i + 3 : i + 2;
    const kwh = num(c[kIdx]); if (!(kwh >= 0)) continue;
    let note = ''; const lastCol = (c[c.length - 1] || '').trim();
    if (c.length - 1 > kIdx && lastCol && isNaN(num(lastCol)) && !/^-?[\d.,:]+$/.test(lastCol)) note = lastCol;
    const ts = date + 'T' + pad(tmm[1]) + ':' + tmm[2];
    out.push({ id: idFor(ts), type: 'reading', ts, kwh, tags: inferTags(note), note });
  }
  if (!out.length) { $('importMsg').textContent = 'Tidak ada baris yang bisa dibaca. Pastikan ada kolom tanggal (2026-09-22), jam (7:10), dan kWh.'; return; }
  const have = new Set(store.getEntries().map(e => e.id)); const fresh = out.filter(o => !have.has(o.id));
  $('importMsg').textContent = `Menambahkan ${fresh.length} baris…`;
  let ok = 0; try { await store.putMany(fresh); ok = fresh.length; } catch (e) { /* gagal semua: ok tetap 0 */ }
  $('importMsg').textContent = `${ok} baris ditambahkan, ${out.length - fresh.length} dilewati karena sudah ada.`;
  if (ok) $('importText').value = '';
};

/* ---------- ekspor ---------- */
function csv() {
  const c = calc(); const rows = [['tanggal', 'waktu', 'jenis', 'kwh_meter', 'kwh_masuk', 'nominal_rp', 'pemakaian_kwh', 'durasi_jam', 'beban_kw', 'biaya_rp', 'kondisi', 'suhu_ac', 'catatan']];
  const byEnd = new Map(c.iv.map(x => [x.cur.id, x]));
  for (const e of c.list) {
    const x = byEnd.get(e.id); const d = parseTs(e.ts);
    rows.push([dayKey(d), fmtHM(d), e.type === 'topup' ? 'beli token' : 'catat', e.kwh, e.added || '', e.rp || '', x && !x.bad ? x.used.toFixed(2) : '', x ? x.h.toFixed(2) : '', x && !x.bad ? x.kw.toFixed(3) : '', x && !x.bad ? Math.round(x.cost) : '', (e.tags || []).map(t => TAGLABEL[t]).join(' | '), e.suhu || '', e.note || '']);
  }
  return rows.map(r => r.map(v => { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n');
}
$('dlCsv').onclick = () => {
  try {
    const url = URL.createObjectURL(new Blob([csv()], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'kwhlog-' + dayKey(new Date()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    $('exportMsg').textContent = 'File diunduh.';
  } catch (e) { $('exportMsg').textContent = 'Unduhan tidak tersedia. Pakai Salin CSV.'; }
};
$('copyCsv').onclick = async () => {
  try { await navigator.clipboard.writeText(csv()); $('exportMsg').textContent = 'CSV disalin. Tempel di Excel atau Sheets.'; } catch (e) { $('exportMsg').textContent = 'Browser tidak mengizinkan menyalin otomatis.'; }
};

/* ---------- start ---------- */
const STATUS = {
  init: ['Memuat…', false, 'Memuat…'],
  nocfg: ['Hanya di perangkat ini', true, 'Supabase belum diisi di js/config.js, jadi data disimpan di browser perangkat ini saja.'],
  offline: ['Offline', true, 'Tidak ada koneksi ke cloud. Data ditampilkan dari cache di perangkat ini; catatan baru masuk antrean dan dikirim sendiri saat online.'],
  out: ['Belum masuk', true, 'Belum masuk, jadi catatan baru disimpan di perangkat ini dan akan dikirim ke cloud setelah kamu masuk.'],
  sync: ['Menyinkronkan…', false, 'Sedang menyinkronkan dengan cloud.'],
  ok: ['Tersinkron', false, 'Data tersimpan di cloud dan tersinkron antara HP dan laptop. Cache di perangkat ini membuat halaman langsung tampil.'],
  error: ['Sinkron gagal', true, 'Pengiriman ke cloud gagal. Data aman di perangkat ini dan akan dicoba lagi otomatis.']
};
function renderStatus() {
  const st = store.getStatus(), u = store.getUser();
  const [label, off, info] = STATUS[st];
  // header: email kalau sudah masuk, keadaan sinkron hanya bila bermasalah, dan jumlah yang belum terkirim
  const n = store.getPending();
  const parts = [u ? u.email : label];
  if (u && st !== 'ok') parts.push(label);
  if (n) parts.push(n + ' belum terkirim');
  $('sync').textContent = parts.join(' · ');
  $('sync').classList.toggle('off', u ? (st === 'error' || st === 'offline') : off);
  $('btnLogout').hidden = !u;
  $('storageInfo').textContent = info;
  $('loginCard').hidden = st !== 'out';
}
function showLoginForm(sent) { $('loginForm').hidden = sent; $('loginSent').hidden = !sent; }
$('loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const email = $('loginEmail').value.trim();
  if (!email) { $('loginMsg').textContent = 'Isi email.'; return; }
  $('loginSend').disabled = true; $('loginMsg').textContent = '';
  try { await store.signIn(email); showLoginForm(true); }
  catch (err) { $('loginMsg').textContent = 'Gagal mengirim link: ' + (err && err.message ? err.message : 'coba lagi'); }
  $('loginSend').disabled = false;
});
$('loginAgain').onclick = () => { showLoginForm(false); $('loginEmail').focus(); };
$('btnLogout').onclick = () => store.signOut();
if (store.getAuthError()) $('loginMsg').textContent = 'Link login tidak berlaku atau sudah kedaluwarsa. Kirim link baru.';

store.subscribe(() => { render(); renderStatus(); });
renderStatus();
setInterval(() => renderMeter(calc()), 60000);
store.init();

/* ---------- PWA: service worker + tombol pasang ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { /* tanpa SW aplikasi tetap jalan online */ }));
}
let installEvt = null;
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('btnInstall').hidden = false; $('installInfo').textContent = 'Pasang supaya terbuka seperti aplikasi, layar penuh, dan tetap bisa dibuka tanpa sinyal.'; });
window.addEventListener('appinstalled', () => { installEvt = null; $('btnInstall').hidden = true; $('installInfo').textContent = 'Sudah terpasang.'; });
$('btnInstall').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice; installEvt = null; $('btnInstall').hidden = true; };
$('installInfo').textContent = standalone ? 'Sudah dibuka sebagai aplikasi.'
  : isIOS ? 'Di iPhone: ketuk tombol Bagikan di Safari, lalu pilih "Tambah ke Layar Utama".'
  : 'Di Chrome Android: menu ⋮, lalu "Instal aplikasi" atau "Tambahkan ke layar utama".';
