/* SLATE OS · Finance (billing core, ported from SLATE Ledger)
   A separate page from the team's app. It reads and writes only the fin_docs table, which the
   database opens to the Principal and the COO alone; for anyone else it loads nothing. */
(function () {
'use strict';

/* ---------- connection: same sign-in as SLATE OS ---------- */
const CFG = window.SLATE_CONFIG;
const remember = () => { try { return localStorage.getItem('slate-remember') !== '0'; } catch (_) { return true; } };
const safe = s => ({ getItem: k => { try { return s.getItem(k); } catch (_) { return null; } },
  setItem: (k, v) => { try { s.setItem(k, v); } catch (_) {} }, removeItem: k => { try { s.removeItem(k); } catch (_) {} } });
const L_ = safe(window.localStorage), S_ = safe(window.sessionStorage);
const authStore = {
  getItem: k => (remember() ? L_.getItem(k) : null) || S_.getItem(k),
  setItem: (k, v) => { if (remember()) { L_.setItem(k, v); S_.removeItem(k); } else { S_.setItem(k, v); L_.removeItem(k); } },
  removeItem: k => { L_.removeItem(k); S_.removeItem(k); }
};
/* Session lock with a time limit. iPhone Safari can freeze the previous page (back/forward cache)
   while it holds the sign-in lock, which left the next page waiting forever. Wait up to 3 s, then go on. */
const sessionLock = async (name, _t, fn) => {
  if (!(typeof navigator !== 'undefined' && navigator.locks && window.AbortController)) return fn();
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 3000);
  let got = false;
  try { return await navigator.locks.request(name, { mode: 'exclusive', signal: ac.signal }, async () => { got = true; clearTimeout(timer); return await fn(); }); }
  catch (e) { if (!got && e && e.name === 'AbortError') return fn(); throw e; }
  finally { clearTimeout(timer); }
};
if (!window.supabase || !CFG) { document.getElementById('app').innerHTML = '<div class="notice"><strong>Couldn’t load finance</strong>The page didn’t finish loading. Check your connection and reload.<div style="margin-top:12px"><a class="btn" href="/finance">Reload</a></div></div>'; return; }
const sb = window.supabase.createClient(CFG.url, CFG.key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage: authStore, lock: sessionLock } });
/* Let go of the session while this page is hidden or frozen, so SLATE OS never waits on it. */
addEventListener('pagehide', () => { try { sb.auth.stopAutoRefresh(); } catch (_) {} });
addEventListener('pageshow', () => { try { sb.auth.startAutoRefresh(); } catch (_) {} });

/* ---------- helpers ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const nfUS = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const tk = n => '৳ ' + nf.format(Math.round(+n || 0));
function compact(n) { n = +n || 0; const a = Math.abs(n);
  if (a >= 1e7) return '৳ ' + (n / 1e7).toFixed(2) + ' Cr';
  if (a >= 1e5) return '৳ ' + (n / 1e5).toFixed(2) + ' L';
  return tk(n); }
const pad = n => String(n).padStart(2, '0');
const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 864e5);
const fyOf = s => { const y = +s.slice(0, 4), m = +s.slice(5, 7); return m >= 7 ? y : y - 1; };
const fyLabel = y => y + '–' + pad((y + 1) % 100);
const inFY = (s, fy) => !!s && fyOf(s) === fy;
const fmtDate = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtShort = s => s ? new Date(s + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—';
const fmtWhen = t => t ? new Date(t).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
const monthKey = (fy, i) => { const m = (6 + i) % 12 + 1; const y = i < 6 ? fy : fy + 1; return y + '-' + pad(m); };
const lines = t => String(t || '').split('\n').map(s => s.trim()).filter(Boolean);
const mid = () => Math.random().toString(36).slice(2, 9);
const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(20)), x => ABC[x % ABC.length]).join('');

const METHODS = ['Bank transfer', 'Cheque', 'Cash', 'bKash / MFS'];
const PTYPES = ['Residential', 'Commercial', 'Mixed use', 'Interior', 'Master planning', 'Real estate consultancy', 'Other'];
const DEFAULT_MS = [['Signing advance', 25], ['Final architectural design', 25], ['Authority (RAJUK) drawings', 25], ['Working drawings', 25]];
const STUDIO = { name: 'SLATE Architecture & Design', addr: 'House SW (I) 3/A, Road 2, Gulshan 1, Dhaka 1212', phone: '01749-390284', email: 'info@slate-atelier.com', web: 'slate-atelier.com', tag: 'Design with purpose' };
const INTERNAL_TYPES = ['studioops', 'studiodev', 'studiomgmt'];

/* ---------- state ---------- */
const DEFAULT_SETTINGS = { vatPct: 15, termsDays: 15, prefix: 'SLATE', bank: '', invNote: 'The amount above is net to SLATE. VAT and AIT, where applicable, are borne by the client.', signName: 'Syed Mohammed Imran', signTitle: 'Principal Architect', bin: '', lockedFYs: [] };
const S = {
  role: null, uid: null, projects: [], invoices: [], receipts: [], settings: { ...DEFAULT_SETTINGS }, settingsRow: false,
  os: [], people: {}, audit: null, loaded: false, fy: fyOf(today()), tab: 'overview',
  f: { inv: 'open', prj: 'active', q: '' }
};
const isPrincipal = () => S.role === 'principal';

/* ---------- derived ---------- */
const prj = id => S.projects.find(p => p.id === id);
const invTotal = i => (+i.amount || 0) * (1 + (+i.vatPct || 0) / 100);
const recsOf = i => S.receipts.filter(r => r.invoiceId === i.id);
const invSettled = i => recsOf(i).reduce((s, r) => s + (+r.received || 0) + (+r.ait || 0) + (+r.vds || 0), 0);
function invStatus(i) {
  if (i.status === 'void') return 'void';
  if (i.status === 'draft' || !i.status) return 'draft';
  const t = invTotal(i), p = invSettled(i);
  if (p >= t - 1) return 'paid';
  if (i.due && i.due < today()) return 'overdue';
  return p > 0 ? 'part' : 'issued';
}
const invOpen = i => ['issued', 'part', 'overdue'].includes(invStatus(i));
const invDue = i => invOpen(i) ? Math.max(0, invTotal(i) - invSettled(i)) : 0;
const ST_LABEL = { draft: 'Draft', issued: 'Issued', part: 'Part paid', paid: 'Paid', overdue: 'Overdue', void: 'Void' };
function projStats(p) {
  const inv = S.invoices.filter(i => i.projectId === p.id && !['void', 'draft'].includes(invStatus(i)));
  let billed = 0, collected = 0;
  for (const i of inv) { const t = invTotal(i) || 1; billed += +i.amount || 0; collected += Math.min(invSettled(i), t) * (+i.amount || 0) / t; }
  const fee = +p.fee || 0;
  return { fee, billed, collected, outstanding: billed - collected, unbilled: Math.max(0, fee - billed) };
}
const locked = d => !!d && (S.settings.lockedFYs || []).map(Number).includes(fyOf(d));
function nextInvNo(date) {
  const pre = `${S.settings.prefix || 'SLATE'}/INV/${fyLabel(fyOf(date)).replace('–', '-')}/`;
  const used = S.invoices.filter(x => (x.no || '').startsWith(pre)).map(x => +(x.no.slice(pre.length)) || 0);
  return pre + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
}
const msInvoiced = (p, m, exceptId) => S.invoices.some(x => x.projectId === p.id && x.milestoneId === m.id && invStatus(x) !== 'void' && x.id !== exceptId);

/* ---------- data ---------- */
function friendly(e) {
  const m = (e && (e.message || e.error_description)) || String(e || '');
  if (/fin_inv_no/.test(m)) return 'That invoice number is already used.';
  if (/fin_proj_code/.test(m)) return 'Another project already uses that code.';
  if (/fin_proj_os/.test(m)) return 'That SLATE OS project already has its fees set up.';
  if (/row-level security|permission denied/i.test(m)) return 'Finance is limited to the Principal and the COO.';
  if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Couldn’t reach the server. Check the connection and try again.';
  return m || 'Couldn’t save. Try again.';
}
async function load() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('fin_docs').select('path,data').order('path').range(from, from + 999);
    if (error) throw error;
    rows.push(...data); if (data.length < 1000) break;
  }
  const by = c => rows.filter(r => r.path.startsWith(c + '/')).map(r => ({ ...r.data, id: r.path.split('/')[1] }));
  S.projects = by('projects'); S.invoices = by('invoices'); S.receipts = by('receipts');
  const st = rows.find(r => r.path === 'config/settings');
  S.settingsRow = !!st; S.settings = { ...DEFAULT_SETTINGS, ...(st ? st.data : {}) };
  S.loaded = true;
}
async function loadAux() {
  const [os, ppl] = await Promise.all([
    sb.from('docs').select('doc_id,data').eq('coll', 'projects'),
    sb.from('profiles').select('id,full_name,label')
  ]);
  S.os = (os.data || []).filter(r => !INTERNAL_TYPES.includes((r.data || {}).type)).map(r => ({ id: r.doc_id, ...r.data }))
    .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  S.people = {}; (ppl.data || []).forEach(p => { S.people[p.id] = p.label || p.full_name || 'Someone'; });
}
async function loadAudit() {
  const { data, error } = await sb.from('fin_audit').select('*').order('id', { ascending: false }).limit(300);
  if (error) { toast(friendly(error)); return; }
  S.audit = data || []; if (S.tab === 'activity') render();
}
const strip = r => { const { id, ...rest } = r; return rest; };
async function addDoc(coll, data) {
  const id = newId();
  const { error } = await sb.from('fin_docs').insert({ path: coll + '/' + id, coll, doc_id: id, data });
  if (error) throw error;
  return id;
}
async function putDoc(coll, id, data) {
  const { data: out, error } = await sb.from('fin_docs').update({ data }).eq('path', coll + '/' + id).select('path');
  if (error) throw error;
  if (!out || !out.length) throw new Error('Finance is limited to the Principal and the COO.');
}
async function delDoc(coll, id) {
  const { data: out, error } = await sb.from('fin_docs').delete().eq('path', coll + '/' + id).select('path');
  if (error) throw error;
  if (!out || !out.length) throw new Error('Couldn’t delete that record.');
}
async function saveSettings(data) {
  if (S.settingsRow) await putDoc('config', 'settings', data);
  else { const { error } = await sb.from('fin_docs').insert({ path: 'config/settings', coll: 'config', doc_id: 'settings', data }); if (error) throw error; }
}
// Run a write, refresh from the server, report the outcome.
async function run(fn, ok) {
  try { await fn(); await load(); if (S.audit) loadAudit(); render(); if (ok) toast(ok); return true; }
  catch (e) { toast(friendly(e)); try { await load(); render(); } catch (_) {} return false; }
}

/* ---------- ui primitives ---------- */
let toastT;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3200); }
function openSheet(html, bind) {
  $('#sheetPanel').innerHTML = html; $('#sheet').hidden = false; document.body.style.overflow = 'hidden';
  bind && bind($('#sheetPanel'));
  const f = $('#sheetPanel input:not([type=hidden]), #sheetPanel select'); if (f && matchMedia('(min-width:700px)').matches) f.focus();
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetPanel').innerHTML = ''; document.body.style.overflow = ''; }
const sheetHead = (t, sub) => `<div class="sheet-h"><div><h2>${esc(t)}</h2>${sub ? `<p>${sub}</p>` : ''}</div><button class="btn ghost sm" type="button" data-act="close">Close</button></div>`;
const chip = (cls, text) => `<span class="chip ${cls}">${esc(text)}</span>`;
const opt = (v, l, sel) => `<option value="${esc(v)}"${sel ? ' selected' : ''}>${esc(l)}</option>`;
const who = id => !id ? '—' : id === S.uid ? 'you' : esc(S.people[id] || 'Someone');
function armed(btn) {
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1'; btn.dataset.orig = btn.textContent; btn.textContent = 'Tap again to confirm';
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = btn.dataset.orig; } }, 3500);
  return false;
}
function saveFile(name, data, type) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([data], { type: type || 'text/plain' })); a.download = name;
  document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const fileSafe = s => String(s || '').replace(/[^\w.-]+/g, '-');

/* ---------- render ---------- */
let rq = 0;
const schedule = () => { if (!rq) rq = requestAnimationFrame(() => { rq = 0; render(); }); };
const TABS = [['overview', 'Overview'], ['billing', 'Projects'], ['invoices', 'Invoices'], ['reports', 'Reports'], ['activity', 'Change log'], ['settings', 'Settings']];
function renderChrome() {
  const fys = new Set([fyOf(today()), S.fy]);
  [...S.invoices.map(i => i.date), ...S.receipts.map(r => r.date)].forEach(d => d && fys.add(fyOf(d)));
  $('#fySel').innerHTML = [...fys].sort((a, b) => b - a).map(y => opt(y, 'FY ' + fyLabel(y), y === S.fy)).join('');
  $('#fyWrap').hidden = !S.loaded;
  const overdueCt = S.invoices.filter(i => invStatus(i) === 'overdue').length;
  $('#tabs').innerHTML = S.loaded ? TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}${k === 'invoices' && overdueCt ? `<span class="ct">${overdueCt}</span>` : ''}</button>`).join('') : '';
  $('#who').textContent = S.role ? (S.people[S.uid] || 'You') + ' · ' + (isPrincipal() ? 'Principal' : 'COO') : '';
}
function render() {
  renderChrome();
  if (!S.loaded) return;
  const v = { overview, billing, invoices, reports, activity, settings }[S.tab] || overview;
  $('#app').innerHTML = v();
}
function notice(title, body, link) {
  $('#app').innerHTML = `<div class="notice"><strong>${esc(title)}</strong>${body}${link ? `<div style="margin-top:12px"><a class="btn" href="/">Open SLATE OS</a></div>` : ''}</div>`;
}

/* ----- Overview ----- */
function overview() {
  const fy = S.fy, t = today();
  const open = S.invoices.filter(invOpen);
  const recv = open.reduce((s, i) => s + invDue(i), 0);
  const overdue = open.filter(i => invStatus(i) === 'overdue');
  const overdueAmt = overdue.reduce((s, i) => s + invDue(i), 0);
  const recFY = S.receipts.filter(r => inFY(r.date, fy));
  const cashIn = recFY.reduce((s, r) => s + (+r.received || 0), 0);
  const withheld = recFY.reduce((s, r) => s + (+r.ait || 0) + (+r.vds || 0), 0);
  const billedFY = S.invoices.filter(i => !['void', 'draft'].includes(invStatus(i)) && inFY(i.date, fy));
  const billed = billedFY.reduce((s, i) => s + (+i.amount || 0), 0);
  const active = S.projects.filter(p => (p.status || 'active') === 'active');
  const unbilled = active.reduce((s, p) => s + projStats(p).unbilled, 0);
  const next = [];
  for (const p of active) { const m = (p.milestones || []).find(m => !msInvoiced(p, m)); if (m) next.push({ p, m }); }
  const empty = !S.projects.length;
  const starter = empty ? `<div class="panel"><div class="empty"><strong>Finance is open and empty</strong>Start by adding a project's fee and payment milestones. Pick it from SLATE OS so the project code matches, then raise invoices against each milestone.
    <div class="actions" style="justify-content:center"><button class="btn pri" data-act="new-project">Add first project fee</button></div></div></div>` : '';
  return `
  <div class="head"><div><h2>Studio billing</h2><p>FY ${fyLabel(fy)} · July to June · figures in BDT</p></div>
    <div class="actions"><button class="btn" data-act="new-project">Add project fee</button><button class="btn pri" data-act="new-invoice" ${S.projects.length ? '' : 'disabled'}>New invoice</button></div></div>
  ${starter}
  <div class="kpis">
    <div class="kpi"><div class="lb">Receivable now</div><div class="v">${compact(recv)}</div><div class="s">${overdue.length ? `<b class="bad">${compact(overdueAmt)}</b> overdue on ${overdue.length}` : `${open.length} open invoice${open.length === 1 ? '' : 's'}`}</div></div>
    <div class="kpi"><div class="lb">Received · FY</div><div class="v">${compact(cashIn)}</div><div class="s">${compact(withheld)} withheld (AIT/VDS)</div></div>
    <div class="kpi"><div class="lb">Billed · FY</div><div class="v">${compact(billed)}</div><div class="s">${billedFY.length} invoice${billedFY.length === 1 ? '' : 's'} · excl. VAT</div></div>
    <div class="kpi"><div class="lb">Not yet billed</div><div class="v">${compact(unbilled)}</div><div class="s">across ${active.length} active project${active.length === 1 ? '' : 's'}</div></div>
  </div>
  <div class="panel"><div class="ph"><h3>Billed and received by month</h3><div class="legend"><span style="--c:var(--muted)">Billed</span><span style="--c:var(--red)">Received</span></div></div>
    <div class="pb chart">${cashChart(fy)}</div></div>
  <div class="grid2">
    <div class="panel"><div class="ph"><h3>Collections to chase</h3><span class="meta">oldest first</span></div>
      ${open.length ? `<div class="rows">${open.sort((a, b) => (a.due || '').localeCompare(b.due || '')).slice(0, 6).map(i => {
        const p = prj(i.projectId), st = invStatus(i), late = i.due ? daysBetween(i.due, t) : 0;
        return `<button class="row r-mini" data-act="open-invoice" data-id="${i.id}"><div style="min-width:0"><div class="t">${esc(p ? p.client || p.name : 'Unknown project')}</div><div class="sub mono">${esc(i.no)} · ${late > 0 ? `${late} days late` : `due ${fmtShort(i.due)}`}</div></div>${chip(st, ST_LABEL[st])}<div class="amt">${tk(invDue(i))}</div></button>`; }).join('')}</div>`
      : `<div class="empty">Nothing outstanding. Issued invoices with a balance show here.</div>`}
    </div>
    <div class="panel"><div class="ph"><h3>Receivables ageing</h3><span class="meta">by days past due</span></div><div class="pb">${aging(open)}</div>
      <div class="ph" style="border-top:1px solid var(--line)"><h3>Next milestones to bill</h3><span class="meta">${next.length} project${next.length === 1 ? '' : 's'}</span></div>
      ${next.length ? `<div class="rows">${next.slice(0, 5).map(({ p, m }) => `<button class="row r-mini" data-act="invoice-ms" data-id="${p.id}" data-ms="${m.id}"><div style="min-width:0"><div class="t">${esc(p.name)}</div><div class="sub"><span class="mono">${esc(p.code)}</span> · ${esc(m.label)} · ${m.pct}%</div></div><span class="btn sm">Invoice</span><div class="amt">${tk((+p.fee || 0) * m.pct / 100)}</div></button>`).join('')}</div>` : `<div class="empty">${active.length ? 'Every active milestone has been invoiced.' : 'No active project fees yet.'}</div>`}
    </div>
  </div>`;
}
function aging(open) {
  const t = today(), b = [['Not due', 0, 'var(--inflow)'], ['1–30', 0, 'var(--warn)'], ['31–60', 0, 'var(--warn)'], ['61–90', 0, 'var(--bad)'], ['90+', 0, 'var(--bad)']];
  for (const i of open) { const d = i.due ? daysBetween(i.due, t) : 0; b[d <= 0 ? 0 : d <= 30 ? 1 : d <= 60 ? 2 : d <= 90 ? 3 : 4][1] += invDue(i); }
  const max = Math.max(1, ...b.map(x => x[1]));
  return `<div class="aging">${b.map(([l, v, c]) => `<div class="ag"><span class="muted">${l}</span><div class="bar2"><i style="width:${(v / max * 100).toFixed(1)}%;background:${c}"></i></div><span class="num">${compact(v)}</span></div>`).join('')}</div>`;
}
function niceStep(x) { const p = Math.pow(10, Math.floor(Math.log10(x || 1))); const n = x / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
function axisLbl(v) { if (v >= 1e7) return (v / 1e7).toFixed(v % 1e7 ? 1 : 0) + ' Cr'; if (v >= 1e5) return (v / 1e5).toFixed(v % 1e5 ? 1 : 0) + ' L'; if (v >= 1e3) return (v / 1e3).toFixed(0) + 'k'; return String(v); }
function cashChart(fy) {
  const bil = Array(12).fill(0), inn = Array(12).fill(0);
  const idx = d => { if (!inFY(d, fy)) return -1; const m = +d.slice(5, 7); return (m + 5) % 12; };
  S.invoices.forEach(i => { if (['void', 'draft'].includes(invStatus(i))) return; const k = idx(i.date); if (k >= 0) bil[k] += +i.amount || 0; });
  S.receipts.forEach(r => { const k = idx(r.date); if (k >= 0) inn[k] += +r.received || 0; });
  const raw = Math.max(...bil, ...inn);
  if (!raw) return `<div class="empty" style="padding:18px">Nothing billed or received in FY ${fyLabel(fy)} yet. Invoices and payments will chart here month by month.</div>`;
  const step = niceStep(raw / 3), max = step * Math.ceil(raw / step);
  const W = 720, H = 230, L = 64, R = 8, T = 12, B = 30, cw = (W - L - R) / 12, bw = Math.min(18, cw * 0.32);
  const y = v => T + (H - T - B) * (1 - v / max);
  let g = '';
  for (let v = 0; v <= max + 1; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${axisLbl(v)}</text>`;
  const cur = today().slice(0, 7); let bars = '';
  for (let i = 0; i < 12; i++) {
    const cx = L + cw * i + cw / 2, isCur = monthKey(fy, i) === cur;
    bars += `<rect x="${cx - bw - 1}" y="${y(bil[i])}" width="${bw}" height="${Math.max(0, y(0) - y(bil[i]))}" fill="var(--muted)" opacity=".55"><title>${MONTHS[i]} billed ${tk(bil[i])}</title></rect>`;
    bars += `<rect x="${cx + 1}" y="${y(inn[i])}" width="${bw}" height="${Math.max(0, y(0) - y(inn[i]))}" fill="var(--red)"><title>${MONTHS[i]} received ${tk(inn[i])}</title></rect>`;
    bars += `<text x="${cx}" y="${H - 10}" text-anchor="middle" font-size="11" fill="${isCur ? 'var(--ink)' : 'var(--muted)'}" font-weight="${isCur ? 600 : 400}" font-family="IBM Plex Sans, sans-serif">${MONTHS[i]}</text>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly billed and received, FY ${fyLabel(fy)}">${g}${bars}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)"/></svg>`;
}

/* ----- Projects ----- */
function billing() {
  const f = S.f.prj;
  const list = S.projects.filter(p => f === 'all' || (p.status || 'active') === f).sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  const tot = list.reduce((a, p) => { const s = projStats(p); a.fee += s.fee; a.billed += s.billed; a.col += s.collected; return a; }, { fee: 0, billed: 0, col: 0 });
  return `
  <div class="head"><div><h2>Projects & fees</h2><p>Fee schedules, milestone billing and what's been collected. Amounts exclude VAT. The team never sees these figures.</p></div>
    <div class="actions"><button class="btn pri" data-act="new-project">Add project fee</button></div></div>
  <div class="filters"><div class="seg">${[['active', 'Active'], ['on-hold', 'On hold'], ['closed', 'Closed'], ['all', 'All']].map(([k, l]) => `<button data-act="f-prj" data-v="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
    <span class="hint">${list.length} project${list.length === 1 ? '' : 's'} · fee ${compact(tot.fee)} · billed ${compact(tot.billed)} · collected ${compact(tot.col)}</span></div>
  <div class="panel">${list.length ? `<div class="rows">${list.map(p => { const s = projStats(p);
    return `<button class="row r-prj" data-act="open-project" data-id="${p.id}"><div style="min-width:0"><div class="t">${esc(p.name)}</div><div class="sub"><span class="mono">${esc(p.code)}</span> · ${esc(p.client || '—')}${p.osId ? '' : ' · <span class="warnt">not linked to SLATE OS</span>'}</div></div>
      <div class="c2" style="min-width:0"><div class="prog" title="Billed ${tk(s.billed)} · collected ${tk(s.collected)}"><i style="width:${s.fee ? Math.min(100, s.billed / s.fee * 100) : 0}%"></i><b style="width:${s.fee ? Math.min(100, s.collected / s.fee * 100) : 0}%"></b></div><div class="sub" style="margin-top:4px">${s.fee ? Math.round(s.billed / s.fee * 100) : 0}% billed · ${s.fee ? Math.round(s.collected / s.fee * 100) : 0}% collected</div></div>
      <div class="amt">${tk(s.fee)}<small>${s.outstanding > 0 ? `${compact(s.outstanding)} due` : 'nothing due'}</small></div></button>`; }).join('')}</div>`
    : `<div class="empty"><strong>No ${f === 'all' ? '' : f.replace('-', ' ') + ' '}projects</strong>Add a project's total fee and milestone split to start billing against it.</div>`}</div>`;
}
const mlRow = m => `<div class="ml"><input type="hidden" name="ml_id" value="${esc(m.id)}"><input name="ml_label" aria-label="Milestone" placeholder="Milestone" value="${esc(m.label)}"><input name="ml_pct" aria-label="Percent of fee" type="number" min="0" max="100" step="0.5" value="${esc(m.pct)}"><button class="btn ghost sm" type="button" data-ml="del" aria-label="Remove milestone">×</button></div>`;
function bindMl(root, feeInput) {
  root = feeInput.form;   // listen on the form, not the shared sheet panel, so nothing lingers after it closes
  const upd = () => {
    const sum = [...root.querySelectorAll('[name=ml_pct]')].map(x => +x.value || 0).reduce((a, b) => a + b, 0), fee = +feeInput.value || 0;
    const el = $('#mlSum', root); el.textContent = `${sum}% of fee${fee ? ' · ' + tk(fee * sum / 100) : ''}${sum !== 100 ? ' · should total 100%' : ''}`; el.className = 'hint' + (sum !== 100 ? ' err' : '');
  };
  root.addEventListener('input', upd); upd();
  root.addEventListener('click', e => { const b = e.target.closest('[data-ml]'); if (!b) return;
    if (b.dataset.ml === 'add') { $('#mlBox', root).insertAdjacentHTML('beforeend', mlRow({ id: mid(), label: '', pct: 0 })); upd(); }
    if (b.dataset.ml === 'del') { if (b.closest('.ml').dataset.locked) { toast('That milestone has an invoice, so it stays.'); return; } b.closest('.ml').remove(); upd(); } });
}
function readMl(root) {
  const ids = [...root.querySelectorAll('[name=ml_id]')].map(x => x.value), labels = [...root.querySelectorAll('[name=ml_label]')].map(x => x.value.trim()), pcts = [...root.querySelectorAll('[name=ml_pct]')].map(x => +x.value || 0);
  return ids.map((id, i) => ({ id, label: labels[i], pct: pcts[i] })).filter(m => m.label);
}
function projectForm(p) {
  const src = p || {};
  const ms = src.milestones || DEFAULT_MS.map(([label, pct]) => ({ id: mid(), label, pct }));
  const linked = new Set(S.projects.map(x => x.osId).filter(Boolean));
  const osList = S.os.filter(o => !linked.has(o.id) || o.id === src.osId);
  openSheet(`${sheetHead(p ? 'Edit project fee' : 'Add project fee', p ? `<span class="mono">${esc(p.code)}</span>` : 'Pick the project from SLATE OS so the code and name match. The fee stays here, never in SLATE OS.')}
  <form id="pf">
    <label class="f" for="p_os">SLATE OS project<select id="p_os" name="osId"><option value="">Not in SLATE OS yet (enter below)</option>${osList.map(o => opt(o.id, `${o.code || '—'} · ${o.name || ''}${o.closed ? ' (completed)' : ''}`, o.id === src.osId)).join('')}</select></label>
    <div class="fg">
      <label class="f" for="p_code">Project code<input id="p_code" name="code" required value="${esc(src.code)}" placeholder="e.g. RES-GUL-2601" style="text-transform:uppercase"></label>
      <label class="f" for="p_type">Type<select id="p_type" name="type">${PTYPES.map(t => opt(t, t, src.type === t)).join('')}</select></label>
    </div>
    <label class="f" for="p_name">Project name<input id="p_name" name="name" required value="${esc(src.name)}"></label>
    <div class="fg">
      <label class="f" for="p_client">Client (bill to)<input id="p_client" name="client" required value="${esc(src.client)}"></label>
      <label class="f" for="p_loc">Site<input id="p_loc" name="location" value="${esc(src.location)}"></label>
    </div>
    <label class="f" for="p_caddr">Client billing address<textarea id="p_caddr" name="clientAddress" rows="2" placeholder="Printed under Bill to on invoices">${esc(src.clientAddress)}</textarea></label>
    <div class="fg">
      <label class="f" for="p_area">Construction area (sft)<input id="p_area" name="areaSft" type="number" min="0" step="1" value="${esc(src.areaSft)}"></label>
      <label class="f" for="p_rate">Design rate (BDT/sft)<input id="p_rate" name="rate" type="number" min="0" step="any" value="${esc(src.rate)}"></label>
    </div>
    <label class="f" for="p_fee">Total design fee (BDT, excl. VAT)<input id="p_fee" name="fee" type="number" min="0" step="1" required value="${esc(src.fee)}"></label>
    <div class="sec-t">Payment milestones</div>
    <div id="mlBox" style="display:flex;flex-direction:column;gap:6px">${ms.map(m => { const lockedM = p && msInvoiced(p, m); return lockedM ? mlRow(m).replace('<div class="ml">', '<div class="ml" data-locked="1">') : mlRow(m); }).join('')}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><button class="btn sm" type="button" data-ml="add">Add milestone</button><span class="hint" id="mlSum"></span></div>
    ${p ? `<label class="f" for="p_status">Status<select id="p_status" name="status">${[['active', 'Active'], ['on-hold', 'On hold'], ['closed', 'Closed']].map(([v, l]) => opt(v, l, (p.status || 'active') === v)).join('')}</select></label>` : ''}
    <label class="f" for="p_note">Notes<textarea id="p_note" name="note">${esc(src.note)}</textarea></label>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">${p ? 'Save' : 'Add project fee'}</button></div>
  </form>`, root => {
    const f = $('#pf', root);
    bindMl(root, f.fee);
    f.osId.addEventListener('change', () => { const o = S.os.find(x => x.id === f.osId.value); if (!o) return;
      f.code.value = o.code || ''; f.name.value = o.name || ''; if (o.client) f.client.value = o.client; if (o.location) f.location.value = o.location; });
    const autoFee = () => { if (+f.areaSft.value && +f.rate.value) { f.fee.value = Math.round(f.areaSft.value * f.rate.value); f.fee.dispatchEvent(new Event('input', { bubbles: true })); } };
    f.areaSft.addEventListener('input', autoFee); f.rate.addEventListener('input', autoFee);
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const milestones = readMl(root);
      if (Math.round(milestones.reduce((a, m) => a + m.pct, 0)) !== 100) { toast('Milestones need to add up to 100%.'); return; }
      const data = { osId: f.osId.value, code: f.code.value.trim().toUpperCase(), name: f.name.value.trim(), client: f.client.value.trim(), location: f.location.value.trim(), clientAddress: f.clientAddress.value.trim(),
        type: f.type.value, areaSft: +f.areaSft.value || 0, rate: +f.rate.value || 0, fee: +f.fee.value || 0, milestones, note: f.note.value.trim(), status: f.status ? f.status.value : (p?.status || 'active') };
      if (S.projects.some(x => x.code === data.code && x.id !== p?.id)) { toast('Another project already uses that code.'); return; }
      const ok = p ? await run(() => putDoc('projects', p.id, { ...strip(p), ...data }), 'Project saved') : await run(() => addDoc('projects', data), 'Project fee added');
      if (ok) closeSheet(); });
  });
}
function projectSheet(p) {
  const s = projStats(p), inv = S.invoices.filter(i => i.projectId === p.id).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const msRows = (p.milestones || []).map(m => {
    const mi = inv.filter(i => i.milestoneId === m.id && invStatus(i) !== 'void');
    const st = mi.length ? invStatus(mi[mi.length - 1]) : null;
    return `<div class="row r-mini" style="cursor:default"><div style="min-width:0"><div class="t">${esc(m.label)}</div><div class="sub">${m.pct}% of fee${mi.length ? ` · <span class="mono">${esc(mi.map(i => i.no).join(', '))}</span>` : ''}</div></div>
      ${st ? chip(st, ST_LABEL[st]) : `<button class="btn sm" data-act="invoice-ms" data-id="${p.id}" data-ms="${m.id}">Invoice</button>`}<div class="amt">${tk((+p.fee || 0) * m.pct / 100)}</div></div>`; }).join('');
  const os = p.osId ? S.os.find(o => o.id === p.osId) : null;
  openSheet(`${sheetHead(p.name, `<span class="mono">${esc(p.code)}</span> · ${esc(p.client || '—')} · ${esc(p.type)}`)}
    <dl class="kv" style="margin-bottom:12px"><dt>SLATE OS</dt><dd class="txt">${os ? `Linked · ${esc(os.code)}` : p.osId ? 'Linked project no longer in SLATE OS' : '<span class="warnt">Not linked</span>'}</dd>
      ${p.location ? `<dt>Site</dt><dd class="txt">${esc(p.location)}</dd>` : ''}${p.clientAddress ? `<dt>Billing address</dt><dd class="txt">${esc(p.clientAddress)}</dd>` : ''}
      ${p.areaSft ? `<dt>Area</dt><dd>${nfUS.format(p.areaSft)} sft${p.rate ? ` · BDT ${p.rate}/sft` : ''}</dd>` : ''}</dl>
    <dl class="kv"><dt>Total fee</dt><dd>${tk(s.fee)}</dd><dt>Billed (excl. VAT)</dt><dd>${tk(s.billed)}</dd><dt>Collected</dt><dd>${tk(s.collected)}</dd><dt>Not yet billed</dt><dd>${tk(s.unbilled)}</dd><dt class="tot">Outstanding</dt><dd class="tot">${tk(s.outstanding)}</dd></dl>
    <div class="sec-t" style="margin-top:18px">Milestones</div>
    <div class="mini-list rows" style="margin-top:10px">${msRows || `<div class="empty">No milestones set.</div>`}</div>
    ${inv.length ? `<div class="sec-t" style="margin-top:18px">Invoices</div><div class="mini-list rows" style="margin-top:10px">${inv.map(invRow).join('')}</div>` : ''}
    ${p.note ? `<p class="hint" style="margin-top:14px">${esc(p.note)}</p>` : ''}
    <p class="hint">Added by ${who(p.createdBy)} · ${fmtDate((p.createdAt || '').slice(0, 10))}</p>
    <div class="foot">${!inv.length ? `<button class="btn danger" data-act="del-project" data-id="${p.id}">Delete</button>` : ''}<button class="btn" data-act="edit-project" data-id="${p.id}">Edit</button><button class="btn pri" data-act="new-invoice" data-pid="${p.id}">New invoice</button></div>`);
}

/* ----- Invoices ----- */
function invoices() {
  const f = S.f.inv, q = S.f.q.toLowerCase();
  const list = S.invoices.filter(i => {
    const st = invStatus(i);
    if (f === 'open' && !invOpen(i)) return false;
    if (f === 'overdue' && st !== 'overdue') return false;
    if (f === 'draft' && st !== 'draft') return false;
    if (f === 'paid' && st !== 'paid') return false;
    if (f === 'void' && st !== 'void') return false;
    if (f === 'fy' && !inFY(i.date, S.fy)) return false;
    if (q) { const p = prj(i.projectId); if (![i.no, i.desc, p && p.name, p && p.client, p && p.code].join(' ').toLowerCase().includes(q)) return false; }
    return true; }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.no || '').localeCompare(a.no || ''));
  const sum = list.reduce((s, i) => s + (f === 'open' || f === 'overdue' ? invDue(i) : invTotal(i)), 0);
  return `
  <div class="head"><div><h2>Invoices</h2><p>Raise against project milestones, then record what the client pays, including tax deducted at source. Issued invoices are fixed: void and re-issue to correct one.</p></div>
    <div class="actions"><button class="btn" data-act="export-inv">Export CSV</button><button class="btn pri" data-act="new-invoice" ${S.projects.length ? '' : 'disabled'}>New invoice</button></div></div>
  <div class="filters"><div class="seg">${[['open', 'Open'], ['overdue', 'Overdue'], ['draft', 'Drafts'], ['paid', 'Paid'], ['void', 'Void'], ['fy', `FY ${fyLabel(S.fy)}`]].map(([k, l]) => `<button data-act="f-inv" data-v="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
    <input type="search" id="q" placeholder="Search client, project, number" value="${esc(S.f.q)}"></div>
  <div class="panel"><div class="ph"><h3>${list.length} invoice${list.length === 1 ? '' : 's'}</h3><span class="meta num">${f === 'open' || f === 'overdue' ? 'balance ' : 'total '}${tk(sum)}</span></div>
  ${list.length ? `<div class="rows">${list.map(invRow).join('')}</div>` : `<div class="empty"><strong>No invoices here</strong>${S.projects.length ? 'Raise one from a project milestone with New invoice.' : 'Add a project fee first, then invoice its milestones.'}</div>`}</div>`;
}
function invRow(i) {
  const p = prj(i.projectId), st = invStatus(i), bal = invDue(i);
  return `<button class="row r-inv" data-act="open-invoice" data-id="${i.id}"><div style="min-width:0"><div class="t">${esc(p ? p.client : 'Unknown')} · ${esc(p ? p.name : '')}</div><div class="sub"><span class="mono">${esc(i.no)}</span> · ${esc(i.desc)}</div></div>
    <div class="c2 sub">${fmtDate(i.date)}<br>due ${fmtShort(i.due)}</div>${chip(st, ST_LABEL[st])}<div class="amt">${tk(invTotal(i))}${bal && st !== 'paid' ? `<small>${tk(bal)} due</small>` : ''}</div></button>`;
}
function invoiceForm(i, preset = {}) {
  if (i && invStatus(i) !== 'draft') { toast('Issued invoices are fixed. Void it and issue a corrected one.'); return; }
  const active = S.projects.filter(p => (p.status || 'active') !== 'closed' || p.id === (i?.projectId || preset.pid));
  if (!active.length) { toast('Add a project fee first.'); return; }
  const d = i?.date || today(), pid = i?.projectId || preset.pid || active[0].id;
  openSheet(`${sheetHead(i ? 'Edit draft invoice' : 'New invoice', i ? esc(i.no) : 'Pick the project and the milestone you’re billing.')}
  <form id="if">
    <label class="f" for="i_proj">Project<select id="i_proj" name="projectId">${active.map(p => opt(p.id, `${p.code} · ${p.client || p.name}`, p.id === pid)).join('')}</select></label>
    <label class="f" for="i_ms">Milestone<select id="i_ms" name="milestoneId"></select></label>
    <label class="f" for="i_desc">Description on invoice<input id="i_desc" name="desc" required value="${esc(i?.desc)}"></label>
    <div class="fg">
      <label class="f" for="i_no">Invoice number<input id="i_no" name="no" required value="${esc(i?.no || nextInvNo(d))}" class="mono"></label>
      <label class="f" for="i_amt">Amount (BDT, excl. VAT)<input id="i_amt" name="amount" type="number" min="0" step="1" required value="${esc(i?.amount)}"></label>
      <label class="f" for="i_date">Invoice date<input id="i_date" name="date" type="date" required value="${d}"></label>
      <label class="f" for="i_due">Due date<input id="i_due" name="due" type="date" required value="${i?.due || addDays(d, +S.settings.termsDays || 0)}"></label>
    </div>
    <label class="check" for="i_vat"><input id="i_vat" name="vat" type="checkbox" ${i && +i.vatPct ? 'checked' : ''}> Add VAT at ${i && +i.vatPct ? i.vatPct : S.settings.vatPct}% <span class="hint">(only when the client asks for a VAT invoice)</span></label>
    <dl class="kv" id="iTot"></dl>
    <p class="hint" id="iLock"></p>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn" type="submit" value="draft">Save as draft</button><button class="btn pri" type="submit" value="issued">Issue invoice</button></div>
  </form>`, root => {
    const f = $('#if', root); const vatRate = i && +i.vatPct ? +i.vatPct : +S.settings.vatPct;
    const fillMs = keep => { const p = prj(f.projectId.value); const ms = p?.milestones || [];
      f.milestoneId.innerHTML = ms.map(m => opt(m.id, `${m.label} · ${m.pct}%${msInvoiced(p, m, i?.id) ? ' (invoiced)' : ''}`, (keep || preset.ms) === m.id)).join('') + opt('', 'Other / not a milestone', keep === '');
      if (!keep && keep !== '' && !preset.ms) { const first = ms.find(m => !msInvoiced(p, m, i?.id)); if (first) f.milestoneId.value = first.id; } };
    const fillAmt = () => { const p = prj(f.projectId.value), m = p?.milestones?.find(x => x.id === f.milestoneId.value);
      if (m) { f.amount.value = Math.round((+p.fee || 0) * m.pct / 100); f.desc.value = `${m.label} (${m.pct}% of design fee) · ${p.name}`; } tot(); };
    const tot = () => { const a = +f.amount.value || 0, v = f.vat.checked ? a * vatRate / 100 : 0;
      $('#iTot', root).innerHTML = `<dt>Fee</dt><dd>${tk(a)}</dd><dt>VAT ${f.vat.checked ? vatRate : 0}%</dt><dd>${tk(v)}</dd><dt class="tot">Invoice total</dt><dd class="tot">${tk(a + v)}</dd>`;
      $('#iLock', root).textContent = locked(f.date.value) ? `FY ${fyLabel(fyOf(f.date.value))} is closed. Pick a date in an open year, or ask the Principal to reopen it.` : '';
      $('#iLock', root).className = 'hint err'; };
    fillMs(i ? (i.milestoneId || '') : null); if (!i) fillAmt(); else tot();
    f.projectId.addEventListener('change', () => { preset = {}; fillMs(null); fillAmt(); });
    f.milestoneId.addEventListener('change', fillAmt);
    f.amount.addEventListener('input', tot); f.vat.addEventListener('change', tot);
    f.date.addEventListener('change', () => { f.due.value = addDays(f.date.value, +S.settings.termsDays || 0); if (!i) f.no.value = nextInvNo(f.date.value); tot(); });
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const mode = ev.submitter?.value || 'issued', no = f.no.value.trim();
      if (S.invoices.some(x => x.no === no && x.id !== i?.id)) { toast('That invoice number is already used.'); return; }
      if (!(+f.amount.value > 0)) { toast('Enter the invoice amount.'); return; }
      if (f.due.value < f.date.value) { toast('The due date is before the invoice date.'); return; }
      const data = { projectId: f.projectId.value, milestoneId: f.milestoneId.value, desc: f.desc.value.trim(), no, amount: +f.amount.value || 0, date: f.date.value, due: f.due.value, vatPct: f.vat.checked ? vatRate : 0, status: mode };
      const msg = mode === 'draft' ? 'Draft saved' : 'Invoice issued';
      const ok = i ? await run(() => putDoc('invoices', i.id, { ...strip(i), ...data }), msg) : await run(() => addDoc('invoices', data), msg);
      if (ok) closeSheet(); });
  });
}
function invoiceSheet(i) {
  const p = prj(i.projectId), st = invStatus(i), recs = recsOf(i).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const vat = (+i.amount || 0) * (+i.vatPct || 0) / 100, bal = Math.max(0, invTotal(i) - invSettled(i));
  const lk = locked(i.date);
  openSheet(`${sheetHead(i.no, `${esc(p ? p.client : '')} · ${esc(p ? p.name : '')}`)}
    <div style="display:flex;gap:8px;align-items:center;margin:-6px 0 14px;flex-wrap:wrap">${chip(st, ST_LABEL[st])}<span class="hint">${st === 'draft' ? 'Draft, not sent' : 'Issued'} ${fmtDate(i.date)} · due ${fmtDate(i.due)}</span>${lk ? chip('', 'FY closed') : ''}</div>
    <p style="margin:0 0 12px">${esc(i.desc)}</p>
    <dl class="kv"><dt>Fee</dt><dd>${tk(i.amount)}</dd><dt>VAT ${+i.vatPct || 0}%</dt><dd>${tk(vat)}</dd><dt class="tot">Invoice total</dt><dd class="tot">${tk(invTotal(i))}</dd>
      ${st !== 'draft' ? `<dt>Settled so far</dt><dd>${tk(invSettled(i))}</dd><dt class="tot">Balance</dt><dd class="tot" style="color:var(${bal > 0 && st !== 'void' ? '--bad' : '--good'})">${tk(st === 'void' ? 0 : bal)}</dd>` : ''}</dl>
    ${st === 'void' ? `<p class="hint" style="margin-top:10px">Voided ${fmtDate(i.voidedOn)}${i.voidReason ? ` · ${esc(i.voidReason)}` : ''}</p>` : ''}
    ${st !== 'draft' ? `<div class="sec-t" style="margin-top:18px">Payments received</div>
    <div class="mini-list rows" style="margin-top:10px">${recs.length ? recs.map(r => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto auto;cursor:default"><div style="min-width:0"><div class="t">${fmtDate(r.date)} · ${esc(r.method)}</div><div class="sub">${r.ref ? `Ref ${esc(r.ref)} · ` : ''}${+r.ait ? `AIT ${tk(r.ait)} · ` : ''}${+r.vds ? `VDS ${tk(r.vds)} · ` : ''}by ${who(r.createdBy)}</div></div><div class="amt">${tk(r.received)}</div>${!locked(r.date) ? `<button class="btn ghost sm danger" data-act="del-receipt" data-id="${r.id}">Remove</button>` : '<span></span>'}</div>`).join('') : `<div class="empty" style="padding:14px">No payments recorded yet.</div>`}</div>` : ''}
    <p class="hint">Raised by ${who(i.createdBy)}${i.updatedBy && i.updatedAt !== i.createdAt ? ` · last change by ${who(i.updatedBy)}, ${fmtWhen(i.updatedAt)}` : ''}</p>
    <div class="foot">
      ${st !== 'void' ? `<button class="btn" data-act="doc-invoice" data-id="${i.id}">${st === 'draft' ? 'Preview' : 'Print / PDF'}</button>` : ''}
      ${st === 'draft' && !lk ? `<button class="btn danger" data-act="del-invoice" data-id="${i.id}">Delete draft</button><button class="btn" data-act="edit-invoice" data-id="${i.id}">Edit</button><button class="btn pri" data-act="issue-invoice" data-id="${i.id}">Issue invoice</button>` : ''}
      ${['issued', 'part', 'overdue'].includes(st) && !lk ? `<button class="btn" data-act="due-invoice" data-id="${i.id}">Change due date</button>` : ''}
      ${['issued', 'overdue'].includes(st) && !recs.length && !lk ? `<button class="btn danger" data-act="void-invoice" data-id="${i.id}">Void</button>` : ''}
      ${['issued', 'part', 'overdue'].includes(st) ? `<button class="btn pri" data-act="new-receipt" data-id="${i.id}">Record payment</button>` : ''}
    </div>`);
}
function voidForm(i) {
  openSheet(`${sheetHead('Void ' + i.no, 'The number stays on record as void and is never reused. Issue a corrected invoice after this.')}
  <form id="vf"><label class="f" for="v_r">Reason<input id="v_r" name="r" required placeholder="e.g. wrong amount, re-issued as the next number"></label>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn danger" type="submit">Void invoice</button></div></form>`, root => {
    $('#vf', root).addEventListener('submit', async ev => { ev.preventDefault();
      if (await run(() => putDoc('invoices', i.id, { ...strip(i), status: 'void', voidReason: ev.target.r.value.trim(), voidedOn: today() }), 'Invoice voided')) closeSheet(); });
  });
}
function dueForm(i) {
  openSheet(`${sheetHead('Change due date', esc(i.no))}
  <form id="df"><label class="f" for="d_d">New due date<input id="d_d" name="d" type="date" required min="${esc(i.date)}" value="${esc(i.due)}"></label>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Save</button></div></form>`, root => {
    $('#df', root).addEventListener('submit', async ev => { ev.preventDefault();
      if (await run(() => putDoc('invoices', i.id, { ...strip(i), due: ev.target.d.value }), 'Due date changed')) invoiceSheet(S.invoices.find(x => x.id === i.id) || i); });
  });
}
function receiptForm(i) {
  const bal = Math.max(0, invTotal(i) - invSettled(i));
  openSheet(`${sheetHead('Record payment', `${esc(i.no)} · balance ${tk(bal)}`)}
  <form id="rf">
    <div class="fg">
      <label class="f" for="r_date">Date received<input id="r_date" name="date" type="date" required value="${today()}"></label>
      <label class="f" for="r_method">Method<select id="r_method" name="method">${METHODS.map(m => opt(m, m)).join('')}</select></label>
      <label class="f" for="r_amt">Amount received (BDT)<input id="r_amt" name="received" type="number" min="0" step="1" required value="${Math.round(bal)}"></label>
      <label class="f" for="r_ref">Cheque / transaction ref<input id="r_ref" name="ref"></label>
      <label class="f" for="r_ait">AIT deducted by client<input id="r_ait" name="ait" type="number" min="0" step="1" value="0"></label>
      <label class="f" for="r_vds">VAT deducted by client (VDS)<input id="r_vds" name="vds" type="number" min="0" step="1" value="0"></label>
    </div>
    <p class="hint">Fill AIT and VDS only if the client deducted tax at source and gave you a challan or certificate for it.</p>
    <p class="hint" id="rHint"></p>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Record payment</button></div>
  </form>`, root => {
    const f = $('#rf', root);
    const upd = () => { const s = (+f.received.value || 0) + (+f.ait.value || 0) + (+f.vds.value || 0), left = bal - s;
      const h = $('#rHint', root); h.textContent = locked(f.date.value) ? `FY ${fyLabel(fyOf(f.date.value))} is closed.` : left > 1 ? `Leaves ${tk(left)} outstanding.` : left < -1 ? `That's ${tk(-left)} more than the balance.` : 'Settles this invoice in full.';
      h.className = 'hint' + (left < -1 || locked(f.date.value) ? ' err' : ''); };
    f.addEventListener('input', e => { if (e.target === f.ait || e.target === f.vds) f.received.value = Math.max(0, Math.round(bal - (+f.ait.value || 0) - (+f.vds.value || 0))); upd(); }); upd();
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const data = { invoiceId: i.id, projectId: i.projectId, date: f.date.value, method: f.method.value, received: +f.received.value || 0, ait: +f.ait.value || 0, vds: +f.vds.value || 0, ref: f.ref.value.trim() };
      if (await run(() => addDoc('receipts', data), 'Payment recorded')) invoiceSheet(S.invoices.find(x => x.id === i.id) || i); });
  });
}

/* ----- invoice document (opens in a new tab: print or save as PDF) ----- */
function invoiceDoc(i) {
  const p = prj(i.projectId) || {}, vat = (+i.amount || 0) * (+i.vatPct || 0) / 100, st = S.settings, draft = invStatus(i) === 'draft';
  const body = `<h1>Invoice${draft ? ' <span class="dr">Draft</span>' : ''}</h1>
  <div class="ref"><span>No <b>${esc(i.no)}</b></span><span>Date <b>${fmtDate(i.date)}</b></span><span>Due <b>${fmtDate(i.due)}</b></span>${st.bin && +i.vatPct ? `<span>BIN <b>${esc(st.bin)}</b></span>` : ''}</div>
  <div class="to">Bill to<b>${esc(p.client || '')}</b>${p.clientAddress ? `<span class="pre">${esc(p.clientAddress)}</span><br>` : ''}Project: ${esc(p.name || '')} (${esc(p.code || '')})${p.location ? `<br>Site: ${esc(p.location)}` : ''}</div>
  <table><thead><tr><th>Description</th><th class="n">Amount (BDT)</th></tr></thead><tbody>
  <tr><td>${esc(i.desc)}</td><td class="n">${nf.format(Math.round(+i.amount || 0))}</td></tr>
  ${+i.vatPct ? `<tr><td>VAT ${i.vatPct}%</td><td class="n">${nf.format(Math.round(vat))}</td></tr>` : ''}
  <tr class="tot"><td>Total payable</td><td class="n">${nf.format(Math.round(invTotal(i)))}</td></tr></tbody></table>
  <p class="words">In words: ${esc(takaWords(invTotal(i)))}</p>
  ${st.bank ? `<h2>Payment details</h2><pre>${esc(st.bank)}</pre>` : ''}
  ${st.invNote ? `<p class="note">${esc(st.invNote)}</p>` : ''}
  <div class="sig"><div><b>${esc(st.signName || '')}</b>${esc(st.signTitle || '')}<br>${esc(STUDIO.name)}</div></div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invoice ${esc(i.no)}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400&display=swap">
<style>
@page{size:A4;margin:0}*{box-sizing:border-box}
body{margin:0;background:#E6E8EA;color:#1A1D21;font:10.5pt/1.5 "IBM Plex Sans",system-ui,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.bar{position:sticky;top:0;display:flex;gap:8px;justify-content:center;padding:10px;background:#1A1D21}.bar button{font:500 13px system-ui;padding:8px 14px;border-radius:6px;border:0;cursor:pointer}.bar .p{background:#C41E29;color:#fff}
.page{width:210mm;min-height:297mm;margin:12mm auto;background:#fff;padding:16mm 18mm 20mm;position:relative}
@media print{body{background:#fff}.bar{display:none}.page{margin:0;width:auto}}
@media (max-width:820px){.page{width:auto;margin:0;padding:24px 18px}}
.lh{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;padding-bottom:10mm;border-bottom:1.5pt solid #C41E29}
.brand{display:flex;align-items:center;gap:10px}.brand i{width:14px;height:14px;background:#C41E29;display:block}
.brand b{font:600 17pt "Futura","Jost",sans-serif;letter-spacing:.24em}
.brand small{display:block;font:400 8pt "Futura","Jost",sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#5F6670;margin-top:2px}
.addr{text-align:right;font-size:8.5pt;color:#5F6670;line-height:1.55}
h1{font:500 15pt "Futura","Jost",sans-serif;letter-spacing:.04em;margin:9mm 0 1mm;text-transform:uppercase}.dr{color:#C41E29;font-size:10pt;border:1pt solid #C41E29;padding:1px 6px;margin-left:6px;vertical-align:middle}
.ref{display:flex;justify-content:space-between;gap:20px;font-size:9pt;color:#5F6670;margin-bottom:7mm;flex-wrap:wrap}.ref span b{color:#1A1D21;font-family:"IBM Plex Mono",monospace;font-weight:400}
.to{margin-bottom:6mm}.to b{display:block;font-weight:600}.pre{white-space:pre-line}
h2{font:500 9pt "Futura","Jost",sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#C41E29;margin:7mm 0 2.5mm}
table{width:100%;border-collapse:collapse;font-size:9.5pt}
th{font:500 7.5pt "Jost",sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#5F6670;text-align:left;padding:2mm 0;border-bottom:.75pt solid #1A1D21}
td{padding:2.2mm 0;border-bottom:.5pt solid #D8DCE0;vertical-align:top}td.n,th.n{text-align:right;font-family:"IBM Plex Mono",monospace;font-variant-numeric:tabular-nums}
tr.tot td{border-bottom:0;border-top:1pt solid #1A1D21;font-weight:600}
.words{font-size:9pt;color:#5F6670;margin:3mm 0 0}
.sig{display:flex;gap:20mm;margin-top:16mm}.sig div{min-width:60mm;border-top:.75pt solid #1A1D21;padding-top:2mm;font-size:9pt}.sig b{display:block;font-weight:600}
.foot{position:absolute;left:18mm;right:18mm;bottom:9mm;display:flex;justify-content:space-between;font:400 7.5pt "Jost",sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#8A9098}
@media (max-width:820px){.foot{position:static;margin-top:24px}}
.note{font-size:8.5pt;color:#5F6670;margin-top:5mm}pre{font:inherit;white-space:pre-wrap;margin:0}
</style></head><body><div class="bar"><button class="p" onclick="print()">Print or save as PDF</button><button onclick="close()">Close</button></div><div class="page">
<div class="lh"><div class="brand"><i></i><div><b>SLATE</b><small>Architecture &amp; Design</small></div></div>
<div class="addr">${esc(STUDIO.addr)}<br>${esc(STUDIO.phone)} · ${esc(STUDIO.email)}<br>${esc(STUDIO.web)}</div></div>
${body}
<div class="foot"><span>${esc(STUDIO.tag)}</span><span>Invoice ${esc(i.no)}</span></div>
</div></body></html>`;
}
function takaWords(n) {
  n = Math.round(+n || 0);
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = x => x < 20 ? ones[x] : tens[Math.floor(x / 10)] + (x % 10 ? '-' + ones[x % 10] : '');
  const three = x => (x >= 100 ? ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : '') + (x % 100 ? two(x % 100) : '');
  const cr = Math.floor(n / 1e7), lk = Math.floor(n % 1e7 / 1e5), th = Math.floor(n % 1e5 / 1e3), r = n % 1000;
  const p = []; if (cr) p.push((cr >= 1000 ? nf.format(cr) : three(cr)) + ' Crore'); if (lk) p.push(two(lk) + ' Lakh'); if (th) p.push(two(th) + ' Thousand'); if (r) p.push(three(r));
  return 'Taka ' + (p.join(' ') || 'Zero') + ' only';
}
function openDoc(html, name) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const w = window.open(url, '_blank');
  if (!w) { saveFile(name, html, 'text/html'); toast('Pop-ups are blocked, so the invoice was downloaded instead.'); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ----- Reports ----- */
function reports() {
  const fy = S.fy;
  const rows = Array.from({ length: 12 }, (_, i) => ({ k: monthKey(fy, i), m: MONTHS[i], billed: 0, vat: 0, recv: 0, wh: 0 }));
  const at = d => rows.find(r => d && d.startsWith(r.k));
  S.invoices.forEach(i => { if (['void', 'draft'].includes(invStatus(i))) return; const r = at(i.date); if (r) { r.billed += +i.amount || 0; r.vat += (+i.amount || 0) * (+i.vatPct || 0) / 100; } });
  S.receipts.forEach(x => { const r = at(x.date); if (r) { r.recv += +x.received || 0; r.wh += (+x.ait || 0) + (+x.vds || 0); } });
  const T = rows.reduce((a, r) => ({ billed: a.billed + r.billed, vat: a.vat + r.vat, recv: a.recv + r.recv, wh: a.wh + r.wh }), { billed: 0, vat: 0, recv: 0, wh: 0 });
  const byProj = S.projects.map(p => ({ p, s: projStats(p) })).filter(x => x.s.billed || x.s.fee).sort((a, b) => b.s.outstanding - a.s.outstanding);
  const n = v => v ? nf.format(Math.round(v)) : '–';
  return `
  <div class="head"><div><h2>Reports · FY ${fyLabel(fy)}</h2><p>Billed on the invoice date, excluding VAT. Received on the day the money came in.</p></div>
    <div class="actions"><button class="btn" data-act="export-pl">Export CSV</button></div></div>
  <div class="panel"><div class="ph"><h3>Monthly billing statement</h3><span class="meta">BDT</span></div><div class="tbl"><table>
    <thead><tr><th>Month</th><th>Billed</th><th>VAT billed</th><th>Received</th><th>AIT / VDS withheld</th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${r.m} ${r.k.slice(2, 4)}</td><td>${n(r.billed)}</td><td>${n(r.vat)}</td><td>${n(r.recv)}</td><td>${n(r.wh)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td><td>${n(T.billed)}</td><td>${n(T.vat)}</td><td>${n(T.recv)}</td><td>${n(T.wh)}</td></tr></tfoot>
  </table></div></div>
  <div class="panel"><div class="ph"><h3>Project fee position</h3><span class="meta">all time</span></div>
    ${byProj.length ? `<div class="tbl"><table><thead><tr><th>Project</th><th>Fee</th><th>Billed</th><th>Collected</th><th>Due</th><th>Unbilled</th></tr></thead><tbody>${byProj.map(({ p, s }) => `<tr><td><span class="mono">${esc(p.code)}</span> · ${esc(p.name)}</td><td>${n(s.fee)}</td><td>${n(s.billed)}</td><td>${n(s.collected)}</td><td class="${s.outstanding > 0 ? 'neg' : ''}">${n(s.outstanding)}</td><td>${n(s.unbilled)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="empty">Projects with fees appear here.</div>`}</div>
  <p class="hint">AIT and VDS deducted by clients are tax credits, not lost income. Keep the challan or certificate for each and reconcile them at year end.</p>`;
}
const csv = rows => rows.map(r => r.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\n');
const saveCsv = (name, rows) => saveFile(name, '﻿' + csv(rows), 'text/csv');
function exportInv() {
  const r = [['Invoice no', 'Date', 'Due', 'Project code', 'Client', 'Description', 'Fee', 'VAT %', 'Total', 'Received', 'AIT', 'VDS', 'Balance', 'Status']];
  S.invoices.filter(i => inFY(i.date, S.fy)).sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(i => { const p = prj(i.projectId), rc = recsOf(i);
    const sm = k => rc.reduce((s, x) => s + (+x[k] || 0), 0);
    r.push([i.no, i.date, i.due, p?.code, p?.client, i.desc, i.amount, i.vatPct, Math.round(invTotal(i)), sm('received'), sm('ait'), sm('vds'), Math.round(invDue(i)), ST_LABEL[invStatus(i)]]); });
  saveCsv(`SLATE-invoices-FY${fyLabel(S.fy).replace('–', '-')}.csv`, r);
}
function exportPL() {
  const r = [['Month', 'Billed', 'VAT billed', 'Received', 'AIT/VDS withheld']];
  for (let i = 0; i < 12; i++) { const k = monthKey(S.fy, i);
    const inv = S.invoices.filter(x => !['void', 'draft'].includes(invStatus(x)) && (x.date || '').startsWith(k));
    const rc = S.receipts.filter(x => (x.date || '').startsWith(k));
    r.push([k, inv.reduce((s, x) => s + (+x.amount || 0), 0), Math.round(inv.reduce((s, x) => s + (+x.amount || 0) * (+x.vatPct || 0) / 100, 0)), rc.reduce((s, x) => s + (+x.received || 0), 0), rc.reduce((s, x) => s + (+x.ait || 0) + (+x.vds || 0), 0)]); }
  saveCsv(`SLATE-billing-statement-FY${fyLabel(S.fy).replace('–', '-')}.csv`, r);
}

/* ----- Change log (audit trail, visible only to the Principal and the COO) ----- */
const FIELD = { amount: 'Amount', vatPct: 'VAT %', no: 'Number', date: 'Date', due: 'Due date', desc: 'Description', status: 'Status', fee: 'Fee', milestones: 'Milestones', name: 'Name', code: 'Code', client: 'Client', received: 'Received', ait: 'AIT', vds: 'VDS', method: 'Method', ref: 'Reference', note: 'Note', voidReason: 'Void reason', bin: 'BIN', bank: 'Bank details', prefix: 'Number prefix', termsDays: 'Payment terms', lockedFYs: 'Closed years', clientAddress: 'Billing address', location: 'Site', rate: 'Rate', areaSft: 'Area', osId: 'SLATE OS link', type: 'Type', invNote: 'Invoice note', signName: 'Signatory', signTitle: 'Signatory title', projectId: 'Project', milestoneId: 'Milestone', invoiceId: 'Invoice' };
const SKIP = ['createdAt', 'createdBy', 'updatedAt', 'updatedBy'];
function auditLine(a) {
  const [coll] = a.path.split('/'), d = a.after || a.before || {};
  const nm = coll === 'invoices' ? `invoice ${d.no || ''}` : coll === 'receipts' ? `payment of ${tk(d.received)} on ${(S.invoices.find(x => x.id === d.invoiceId) || {}).no || 'an invoice'}` : coll === 'projects' ? `project fee ${d.code || ''}` : 'finance settings';
  let verb = a.op === 'insert' ? 'added' : a.op === 'delete' ? 'removed' : 'changed';
  if (coll === 'invoices') {
    if (a.op === 'insert') verb = d.status === 'issued' ? 'issued' : 'drafted';
    else if (a.op === 'update' && a.before && a.after && a.before.status !== a.after.status) verb = a.after.status === 'void' ? 'voided' : a.after.status === 'issued' ? 'issued' : 'changed';
  }
  if (coll === 'receipts' && a.op === 'insert') verb = 'recorded';
  const changes = a.op === 'update' && a.before && a.after ? Object.keys({ ...a.before, ...a.after }).filter(k => !SKIP.includes(k) && JSON.stringify(a.before[k]) !== JSON.stringify(a.after[k])) : [];
  const val = (k, v) => v == null || v === '' ? '—' : ['amount', 'fee', 'received', 'ait', 'vds'].includes(k) ? tk(v) : k === 'milestones' ? (v || []).map(m => `${m.label} ${m.pct}%`).join(', ') : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;cursor:default"><div style="min-width:0"><div class="t" style="white-space:normal"><b style="font-weight:600">${who(a.actor)}</b> ${verb} ${esc(nm)}</div>
    ${changes.length ? `<div class="sub" style="white-space:normal">${changes.slice(0, 6).map(k => `${esc(FIELD[k] || k)}: ${esc(val(k, a.before[k]))} → ${esc(val(k, a.after[k]))}`).join(' · ')}</div>` : ''}</div><div class="sub">${fmtWhen(a.at)}</div></div>`;
}
function activity() {
  if (!S.audit) { loadAudit(); return `<div class="head"><div><h2>Change log</h2><p>Loading…</p></div></div>`; }
  return `<div class="head"><div><h2>Change log</h2><p>Every change to finance, with who made it and when. Only the Principal and the COO can see this. Entries can't be edited or removed.</p></div><div class="actions"><button class="btn" data-act="reload-audit">Refresh</button></div></div>
  <div class="panel">${S.audit.length ? `<div class="rows">${S.audit.map(auditLine).join('')}</div>` : `<div class="empty">No changes yet.</div>`}</div>`;
}

/* ----- Settings ----- */
function settings() {
  const s = S.settings, cur = fyOf(today());
  const fys = [...new Set([cur - 1, cur, ...S.invoices.map(i => fyOf(i.date || today())), ...(s.lockedFYs || []).map(Number)])].filter(y => y <= cur).sort((a, b) => b - a);
  return `
  <div class="head"><div><h2>Settings</h2><p>Defaults used on invoices. The Principal and the COO can change these.</p></div></div>
  <div class="panel"><div class="pb"><form id="setForm">
    <div class="fg">
      <label class="f" for="s_prefix">Invoice number prefix<input id="s_prefix" name="prefix" value="${esc(s.prefix)}" maxlength="12"></label>
      <label class="f" for="s_vat">VAT rate on fees (%)<input id="s_vat" name="vatPct" type="number" min="0" max="100" step="0.5" value="${esc(s.vatPct)}"></label>
      <label class="f" for="s_terms">Payment terms (days)<input id="s_terms" name="termsDays" type="number" min="0" max="180" value="${esc(s.termsDays)}"></label>
      <label class="f" for="s_bin">VAT registration (BIN)<input id="s_bin" name="bin" value="${esc(s.bin)}" placeholder="Printed on VAT invoices"></label>
    </div>
    <p class="hint">Numbers run per financial year, for example ${esc(s.prefix || 'SLATE')}/INV/${fyLabel(cur).replace('–', '-')}/001. A voided number is never reused.</p>
    <div class="fg"><label class="f" for="s_sname">Signatory on invoices<input id="s_sname" name="signName" value="${esc(s.signName)}"></label>
      <label class="f" for="s_stitle">Signatory title<input id="s_stitle" name="signTitle" value="${esc(s.signTitle)}"></label></div>
    <label class="f" for="s_bank">Bank details printed on invoices<textarea id="s_bank" name="bank" rows="4" placeholder="Account name, account number, bank, branch, routing number">${esc(s.bank)}</textarea></label>
    <label class="f" for="s_note">Note under the total<textarea id="s_note" name="invNote" rows="2">${esc(s.invNote)}</textarea></label>
    <div class="foot"><button class="btn pri" type="submit">Save settings</button></div>
  </form></div></div>
  <div class="panel"><div class="ph"><h3>Close a financial year</h3><span class="meta">${isPrincipal() ? 'Principal only' : 'The Principal closes and reopens years'}</span></div>
    <div class="pb hint" style="padding-bottom:4px">Once a year is closed, its invoices and payments can't be added, changed or removed. Reopen it for a late correction, then close it again.</div>
    <div class="rows">${fys.map(y => { const isL = (s.lockedFYs || []).map(Number).includes(y);
      return `<div class="row r-mini" style="cursor:default"><div class="t">FY ${fyLabel(y)}</div>${chip(isL ? 'paid' : '', isL ? 'Closed' : 'Open')}${isPrincipal() ? `<button class="btn sm" data-act="${isL ? 'fy-open' : 'fy-close'}" data-v="${y}" ${!isL && y === cur ? 'disabled title="The current year closes after 30 June"' : ''}>${isL ? 'Reopen' : 'Close year'}</button>` : '<span></span>'}</div>`; }).join('')}</div></div>
  <div class="panel"><div class="ph"><h3>Who can see finance</h3></div><div class="pb hint">Only the Principal and the COO (Mridula). The database itself enforces this: the team's accounts get nothing back from these records, the project list in SLATE OS never carries fees, and finance changes never appear in the team's log, notifications or messages. The accountant and office staff roles will be added only when the Principal approves them.</div></div>`;
}

/* ---------- events ---------- */
document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act],[data-tab]'); if (!b) return;
  if (b.dataset.tab) { S.tab = b.dataset.tab; S.f.q = ''; try { localStorage.setItem('slate-fin-tab', S.tab); } catch (_) {} schedule(); window.scrollTo(0, 0); return; }
  const a = b.dataset.act, id = b.dataset.id;
  const inv = () => S.invoices.find(x => x.id === id);
  switch (a) {
    case 'close': closeSheet(); break;
    case 'f-prj': S.f.prj = b.dataset.v; schedule(); break;
    case 'f-inv': S.f.inv = b.dataset.v; schedule(); break;
    case 'new-project': projectForm(); break;
    case 'edit-project': projectForm(prj(id)); break;
    case 'open-project': { const p = prj(id); if (p) projectSheet(p); break; }
    case 'del-project': if (armed(b) && await run(() => delDoc('projects', id), 'Project fee deleted')) closeSheet(); break;
    case 'new-invoice': invoiceForm(null, { pid: b.dataset.pid }); break;
    case 'invoice-ms': invoiceForm(null, { pid: id, ms: b.dataset.ms }); break;
    case 'open-invoice': { const i = inv(); if (i) invoiceSheet(i); break; }
    case 'edit-invoice': invoiceForm(inv()); break;
    case 'issue-invoice': { const i = inv(); if (i && await run(() => putDoc('invoices', id, { ...strip(i), status: 'issued' }), 'Invoice issued')) invoiceSheet(inv()); break; }
    case 'del-invoice': if (armed(b) && await run(() => delDoc('invoices', id), 'Draft deleted')) closeSheet(); break;
    case 'void-invoice': { const i = inv(); if (i) voidForm(i); break; }
    case 'due-invoice': { const i = inv(); if (i) dueForm(i); break; }
    case 'new-receipt': { const i = inv(); if (i) receiptForm(i); break; }
    case 'del-receipt': { const r = S.receipts.find(x => x.id === id); if (r && armed(b) && await run(() => delDoc('receipts', id), 'Payment removed')) { const i = S.invoices.find(x => x.id === r.invoiceId); if (i) invoiceSheet(i); else closeSheet(); } break; }
    case 'doc-invoice': { const i = inv(); if (i) openDoc(invoiceDoc(i), `${fileSafe(i.no)}.html`); break; }
    case 'export-inv': exportInv(); break;
    case 'export-pl': exportPL(); break;
    case 'reload-audit': loadAudit(); break;
    case 'fy-close': case 'fy-open': {
      const y = +b.dataset.v, cur = (S.settings.lockedFYs || []).map(Number);
      const next = a === 'fy-close' ? [...new Set([...cur, y])] : cur.filter(x => x !== y);
      await run(() => saveSettings({ ...S.settings, lockedFYs: next.sort() }), a === 'fy-close' ? `FY ${fyLabel(y)} closed` : `FY ${fyLabel(y)} reopened`); break; }
  }
});
document.addEventListener('input', ev => {
  if (ev.target.id === 'q') { S.f.q = ev.target.value; const pos = ev.target.selectionStart; render(); const q = $('#q'); if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) {} } }
});
document.addEventListener('change', ev => { if (ev.target.id === 'fySel') { S.fy = +ev.target.value; schedule(); } });
document.addEventListener('submit', async ev => {
  if (ev.target.id !== 'setForm') return; ev.preventDefault();
  const f = ev.target;
  const data = { ...S.settings, prefix: f.prefix.value.trim().toUpperCase() || 'SLATE', vatPct: +f.vatPct.value || 0, termsDays: +f.termsDays.value || 0, bank: f.bank.value.trim(), invNote: f.invNote.value.trim(), signName: f.signName.value.trim(), signTitle: f.signTitle.value.trim(), bin: f.bin.value.trim() };
  await run(() => saveSettings(data), 'Settings saved');
});
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

/* ---------- boot ---------- */
try { const t = localStorage.getItem('slate-fin-tab'); if (t && TABS.some(x => x[0] === t)) S.tab = t; } catch (_) {}
renderChrome();
const watchdog = setTimeout(() => { if (!S.loaded && /Opening finance/.test($('#app').textContent)) notice('Finance is taking too long', 'Couldn’t reach the studio database. Check your connection and try again.<div style="margin-top:12px;display:flex;gap:8px"><a class="btn pri" href="/finance">Try again</a></div>', true); }, 15000);
(async () => {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { notice('Sign in to SLATE OS first', 'Finance uses your SLATE OS account. Sign in there, then come back to this page.', true); return; }
  S.uid = session.user.id;
  const { data: role, error: re } = await sb.rpc('fin_role');
  if (re) { notice('Finance isn’t available yet', esc(friendly(re)), true); return; }
  if (!['principal', 'coo'].includes(role)) { notice('Finance is limited to the Principal and the COO', 'Your account doesn’t have access to studio finances.', true); return; }
  S.role = role;
  try { await Promise.all([load(), loadAux()]); }
  catch (e) { notice('Couldn’t open finance', esc(friendly(e)), true); return; }
  clearTimeout(watchdog);
  render();
  const refresh = () => { if (document.visibilityState === 'visible' && $('#sheet').hidden) load().then(render).catch(() => {}); };
  setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', refresh);
})().catch(e => { clearTimeout(watchdog); notice('Couldn’t open finance', esc(friendly(e)), true); });
window.slateFinanceTest = { S, render, invStatus, takaWords, nextInvNo };
})();
