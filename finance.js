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
/* Session lock kept inside this page. A lock shared across pages let a frozen page (iPhone Safari's
   back/forward cache) hold up the next one. Supabase accepts two pages refreshing at the same moment. */
const sessionLock = (() => { let tail = Promise.resolve();
  return (_name, _t, fn) => { const run = tail.then(() => fn()); tail = run.catch(() => {}); return run; }; })();
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
const EXP_CATS = ['Office rent', 'Utilities', 'Internet & software', 'Printing & plotting', 'Transport & site visits', 'Authority & approval fees', 'Client meetings & entertainment', 'Office supplies', 'Repairs & maintenance', 'Bank charges', 'Marketing', 'Staff welfare', 'Tax deposited (AIT/VDS withheld)', 'Other'];
const WO_TYPES = ['Structural consultant', 'MEP consultant', 'Survey & soil test', '3D visualisation', 'Model making', 'Printing & plotting', 'Specialist consultant', 'Other vendor'];
const DEFAULT_WO_TERMS = 'Deliverables to be submitted in the agreed format and reviewed by the project lead before acceptance.\nPayment is released against accepted deliverables, less applicable AIT and VDS deducted at source.\nAll drawings, data and information shared remain confidential and the property of SLATE.';
const PTYPES = ['Residential', 'Commercial', 'Mixed use', 'Interior', 'Master planning', 'Real estate consultancy', 'Other'];
const DEFAULT_MS = [['Signing advance', 25], ['Final architectural design', 25], ['Authority (RAJUK) drawings', 25], ['Working drawings', 25]];
const STUDIO = { name: 'SLATE', addr: 'House SW (I) 3/A, Road 2, Gulshan 1, Dhaka 1212', phone: '01749-390284', email: 'info@slate-atelier.com', web: 'slate-atelier.com', tag: 'Design with purpose' };
/* One company, two trading names, each with its own bank account. Each project bills as one of them;
   an invoice keeps the name and account it was issued with, so changing a project later affects new invoices only. */
const ENTITIES = ['SLATE', 'SLATE ATELIER'];
const entOf = x => ENTITIES.includes(x?.entity) ? x.entity : 'SLATE';
const INTERNAL_TYPES = ['studioops', 'studiodev', 'studiomgmt', 'studiobd', 'studiohr', 'studiofin'];

/* ---------- state ---------- */
const DEFAULT_WA_MSG = 'Dear {client},\n\nPlease find invoice {no} for {project}. Amount payable: BDT {amount}, due {due}.\n\nView and download: {link}\n\nThank you,\n{company}';
const DEFAULT_SETTINGS = { vatPct: 15, aitPct: 10, bankTaxMode: 'added', termsDays: 15, woTerms: DEFAULT_WO_TERMS, prefix: 'SLATE', bank: '', invNote: 'The amount above is net to SLATE. VAT and AIT, where applicable, are borne by the client.', signName: 'Syed Mohammed Imran', signTitle: 'Principal Architect', bin: '', lockedFYs: [], waOn: false, waMsg: DEFAULT_WA_MSG };
const S = {
  role: null, uid: null, projects: [], invoices: [], receipts: [], accounts: [], moves: [], recons: [], expenses: [], workorders: [], wopays: [], staff: [], advances: [], payruns: [], budgets: [], profiles: [], links: [], settings: { ...DEFAULT_SETTINGS }, settingsRow: false,
  os: [], people: {}, audit: null, pick: { accounts: [], projects: [] }, intakes: [], ledger: [], loaded: false, fy: fyOf(today()), tab: 'overview',
  f: { inv: 'open', prj: 'active', q: '', exp: 'all', expCat: '', wo: 'open', rep: 'pl', basis: 'billed', bm: '', guide: '' }
};
const isPrincipal = () => S.role === 'principal';

/* ---------- derived ---------- */
const prj = id => S.projects.find(p => p.id === id);
const invTotal = i => (+i.amount || 0) * (1 + (+i.vatPct || 0) / 100);
/* Tax maths for an invoice.
   Added on: the figure entered is the fee SLATE keeps. It is grossed up so that after the client deducts AIT
   the fee is still whole, and VAT goes on top of the grossed-up value.
   Inclusive: the figure entered is the whole invoice; VAT and AIT come out of it, so SLATE keeps less. */
function taxCalc({ entered, vatOn, aitOn, vatRate, aitRate, taxMode }) {
  const v = vatOn ? (+vatRate || 0) / 100 : 0, a = aitOn ? (+aitRate || 0) / 100 : 0, x = Math.max(0, +entered || 0);
  const base = taxMode === 'inclusive' ? Math.round(x / (1 + v)) : Math.round(a < 1 ? x / (1 - a) : x);
  const vat = base * v, ait = Math.round(base * a);
  return { base, vat, ait, total: base + vat, net: base - ait };
}
const invNet = i => i.net != null ? +i.net : +i.amount || 0;          // fee SLATE keeps from this invoice
const invAit = i => +i.ait || 0;                                          // AIT the client is expected to deduct
const MODE_LABEL = { cash: 'Cash', bank: 'Bank' };
const acct = id => S.accounts.find(a => a.id === id);
const bankAccts = ent => S.accounts.filter(a => a.kind === 'bank' && a.active !== false && entOf({ entity: a.title }) === ent);
const acctLabel = a => `${a.name}${a.number ? ' · ' + a.number.slice(-4) : ''}`;
const ACCT_KIND = { cash: 'Cash', petty: 'Petty cash box', bank: 'Bank account', mfs: 'Mobile wallet' };
const KIND_ORDER = { cash: 0, petty: 1, bank: 2, mfs: 3 };
const isCashLike = a => a && (a.kind === 'cash' || a.kind === 'petty');
const activeAccts = () => S.accounts.filter(a => a.active !== false).sort((a, b) => (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) || (a.name || '').localeCompare(b.name || ''));
const MOVE_LABEL = { transfer: 'Transfer', drawing: 'Owner\u2019s drawing', capital: 'Capital put in', income: 'Other income' };
function acctEntries(a) {
  const e = [];
  S.receipts.forEach(r => { const pt = recParts(r).filter(x => x.accountId === a.id); if (!pt.length) return; const i = S.invoices.find(x => x.id === r.invoiceId), p = i && prj(i.projectId);
    pt.forEach(x => e.push({ date: r.date, amt: +x.amount || 0, what: `Received · ${p ? p.client || p.name : 'client'}`, sub: `${r.mrNo || ''}${i ? ' · ' + i.no : ''}${recParts(r).length > 1 ? ' · part of ' + tk(r.received) : ''}`, kind: 'receipt', id: r.id, at: r.createdAt })); });
  S.moves.filter(m => !['pending', 'rejected'].includes(m.status)).forEach(m => {
    const other = id => (acct(id) || {}).name || 'another account';
    if (m.to === a.id) e.push({ date: m.date, amt: +m.amount || 0, what: m.type === 'transfer' ? `Transfer from ${other(m.from)}` : MOVE_LABEL[m.type], sub: m.note || m.ref || '', kind: 'move', id: m.id, at: m.createdAt });
    if (m.from === a.id) e.push({ date: m.date, amt: -(+m.amount || 0), what: m.type === 'transfer' ? `Transfer to ${other(m.to)}` : MOVE_LABEL[m.type], sub: m.note || m.ref || '', kind: 'move', id: m.id, at: m.createdAt });
  });
  S.expenses.filter(x => x.accountId === a.id && x.paidOn).forEach(x => e.push({ date: x.paidOn, amt: -(+x.amount || 0), what: x.desc, sub: `${x.category}${x.payee ? ' · ' + x.payee : ''}${x.status === 'pending' ? ' · awaiting approval' : ''}`, kind: 'expense', id: x.id, at: x.createdAt }));
  S.advances.filter(x => x.accountId === a.id && x.paidOn).forEach(x => e.push({ date: x.paidOn, amt: -(+x.amount || 0), what: `Advance to ${(S.staff.find(t => t.id === x.staffId) || {}).name || 'staff'}`, sub: x.note || x.ref || '', kind: 'advance', id: x.id, at: x.createdAt }));
  S.payruns.filter(r => r.status === 'paid').forEach(r => { const t = runTotals(r);
    if (r.cashAccountId === a.id && t.cash) e.push({ date: r.payDate, amt: -t.cash, what: `${runLabel(r)} · cash`, sub: `${t.cashN} staff`, kind: 'payrun', id: r.id, at: r.updatedAt });
    if (r.bankAccountId === a.id && t.bank) e.push({ date: r.payDate, amt: -t.bank, what: `${runLabel(r)} · bank`, sub: `${t.bankN} staff${r.payRef ? ' · ' + r.payRef : ''}`, kind: 'payrun', id: r.id, at: r.updatedAt }); });
  S.wopays.filter(x => x.accountId === a.id).forEach(x => { const w = S.workorders.find(o => o.id === x.woId) || {};
    e.push({ date: x.date, amt: -((+x.gross || 0) - (+x.ait || 0) - (+x.vds || 0)), what: `Paid ${w.vendor || 'vendor'}`, sub: `${w.no || ''}${+x.ait || +x.vds ? ` · ${tk((+x.ait || 0) + (+x.vds || 0))} tax withheld` : ''}`, kind: 'wopay', id: x.id, at: x.createdAt }); });
  e.sort((x, y) => (x.date || '').localeCompare(y.date || '') || (x.at || '').localeCompare(y.at || ''));
  let bal = +a.opening || 0; for (const x of e) { bal += x.amt; x.bal = bal; }
  return e;
}
const acctBal = (a, upto) => acctEntries(a).filter(x => !upto || x.date <= upto).reduce((s, x) => s + x.amt, +a.opening || 0);
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
  for (const i of inv) { const t = invTotal(i) || 1; billed += invNet(i); collected += Math.min(invSettled(i), t) * invNet(i) / t; }
  const fee = +p.fee || 0;
  return { fee, billed, collected, outstanding: billed - collected, unbilled: Math.max(0, fee - billed) };
}
const locked = d => !!d && (S.settings.lockedFYs || []).map(Number).includes(fyOf(d));
function nextNo(kind, list, key, date) {
  const pre = `${S.settings.prefix || 'SLATE'}/${kind}/${fyLabel(fyOf(date)).replace('–', '-')}/`;
  const used = list.filter(x => (x[key] || '').startsWith(pre)).map(x => +(x[key].slice(pre.length)) || 0);
  return pre + String((used.length ? Math.max(...used) : 0) + 1).padStart(3, '0');
}
const nextInvNo = date => nextNo('INV', S.invoices, 'no', date);
const nextMrNo = date => nextNo('MR', S.receipts, 'mrNo', date);
const nextWoNo = date => nextNo('WO', S.workorders, 'no', date);
const msInvoiced = (p, m, exceptId) => S.invoices.some(x => x.projectId === p.id && x.milestoneId === m.id && invStatus(x) !== 'void' && x.id !== exceptId);

/* ---------- data ---------- */
function friendly(e) {
  const m = (e && (e.message || e.error_description)) || String(e || '');
  if (/fin_inv_no/.test(m)) return 'That invoice number is already used.';
  if (/fin_proj_code/.test(m)) return 'Another project already uses that code.';
  if (/fin_proj_os/.test(m)) return 'That SLATE OS project already has its fees set up.';
  if (/fin_mr_no/.test(m)) return 'That money receipt number is already used.';
  if (/fin_wo_no/.test(m)) return 'That work order number is already used.';
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
  S.accounts = by('accounts'); S.moves = by('moves'); S.recons = by('recons');
  S.expenses = by('expenses'); S.workorders = by('workorders'); S.wopays = by('wopays');
  S.staff = by('staff'); S.advances = by('advances'); S.payruns = by('payruns'); S.budgets = by('budgets'); S.intakes = by('intakes');
  if (S.role === 'accountant') { await loadPick(); const { data: lg, error: le } = await sb.rpc('fin_ledger'); if (le) throw le; S.ledger = lg || []; }
  const st = rows.find(r => r.path === 'config/settings');
  S.settingsRow = !!st; S.settings = { ...DEFAULT_SETTINGS, ...(st ? st.data : {}) };
  S.loaded = true;
}
async function loadAux() {
  const [os, ppl, ags] = await Promise.all([
    sb.from('docs').select('doc_id,data').eq('coll', 'projects'),
    sb.from('profiles').select('id,full_name,label,designation,team,active'),
    sb.from('docs').select('doc_id,data').eq('coll', 'agreements')
  ]);
  // pro bono is an agreement detail in SLATE OS (Principal and COO only)
  const pb = new Set((ags.data || []).filter(r => (r.data || {}).proBono === 'yes').map(r => r.doc_id));
  S.os = (os.data || []).filter(r => !INTERNAL_TYPES.includes((r.data || {}).type) && (r.data || {}).pod !== 'Chalk Create').map(r => ({ id: r.doc_id, ...r.data, proBono: pb.has(r.doc_id) }))
    .sort((a, b) => (a.code || '').localeCompare(b.code || ''));
  S.people = {}; (ppl.data || []).forEach(p => { S.people[p.id] = p.label || p.full_name || 'Someone'; });
  S.profiles = (ppl.data || []).filter(p => p.active && p.team !== 'Chalk Create');
  await loadLinks();
}
async function loadLinks() {
  const { data, error } = await sb.from('fin_links').select('*').order('created_at', { ascending: false }).limit(1000);
  if (!error) S.links = data || [];
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
async function setDoc(coll, id, data, exists) {
  if (exists) return putDoc(coll, id, data);
  const { error } = await sb.from('fin_docs').insert({ path: coll + '/' + id, coll, doc_id: id, data });
  if (error) throw error;
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
const motionOff = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; } };
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; t.classList.remove('in', 'out'); void t.offsetWidth; if (!motionOff()) t.classList.add('in'); clearTimeout(toastT);
  toastT = setTimeout(() => { if (motionOff()) { t.hidden = true; return; } t.classList.add('out'); toastT = setTimeout(() => { t.hidden = true; t.classList.remove('out'); }, 160); }, 3200); }
let sheetT;
function openSheet(html, bind) {
  const sh = $('#sheet'), opening = sh.hidden || sh.classList.contains('out'); clearTimeout(sheetT); sh.classList.remove('out');
  $('#sheetPanel').innerHTML = html; sh.hidden = false; document.body.style.overflow = 'hidden';
  if (opening) finNavPush();
  if (opening && !motionOff()) { sh.classList.remove('in'); void sh.offsetWidth; sh.classList.add('in'); sheetT = setTimeout(() => sh.classList.remove('in'), 320); }
  bind && bind($('#sheetPanel'));
  const f = $('#sheetPanel input:not([type=hidden]), #sheetPanel select'); if (f && matchMedia('(min-width:700px)').matches) f.focus();
}
function closeSheet(fromBack) { const sh = $('#sheet'); clearTimeout(sheetT); sh.classList.remove('in');
  if (fromBack !== true) finNavPop();
  const done = () => { sh.classList.remove('out'); sh.hidden = true; $('#sheetPanel').innerHTML = ''; document.body.style.overflow = ''; };
  if (sh.hidden || motionOff()) return done(); sh.classList.add('out'); sheetT = setTimeout(done, 170); }
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
const TABS = [['overview', 'Overview'], ['dash', 'Dashboard'], ['billing', 'Projects'], ['invoices', 'Invoices'], ['expenses', 'Expenses'], ['workorders', 'Work orders'], ['payroll', 'Payroll'], ['petty', 'Petty cash'], ['cash', 'Cash & bank'], ['reports', 'Reports'], ['activity', 'Change log'], ['settings', 'Settings'], ['guide', 'Guide']];
function renderChrome() {
  const fys = new Set([fyOf(today()), S.fy]);
  [...S.invoices.map(i => i.date), ...S.receipts.map(r => r.date), ...S.moves.map(m => m.date), ...S.expenses.map(x => x.date), ...S.wopays.map(x => x.date), ...S.payruns.map(r => (r.month || '') + '-01')].forEach(d => d && fys.add(fyOf(d)));
  $('#fySel').innerHTML = [...fys].sort((a, b) => b - a).map(y => opt(y, 'FY ' + fyLabel(y), y === S.fy)).join('');
  $('#fyWrap').hidden = !S.loaded || isAcc();
  const overdueCt = S.invoices.filter(i => invStatus(i) === 'overdue').length;
  const badge = { cash: pendingMoves().length, invoices: overdueCt + pendingIntakes().length, expenses: pendingExp().length, workorders: S.workorders.filter(w => (w.status || 'pending') === 'pending').length, payroll: submittedRuns().length + pendingAdv().length };
  $('#tabs').innerHTML = S.loaded && isAcc() ? [['mine', 'My entries'], ['acash', 'Cash & bank']].map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('') : S.loaded ? TABS.map(([k, l]) => `<button class="tab" role="tab" data-tab="${k}" aria-selected="${S.tab === k}">${l}${badge[k] ? `<span class="ct">${badge[k]}</span>` : ''}</button>`).join('') : '';
  $('#who').textContent = S.role ? (S.people[S.uid] || 'You') + ' · ' + (isPrincipal() ? 'Principal' : isAcc() ? 'Accountant' : 'COO') : '';
}
function render() {
  renderChrome();
  if (!S.loaded) return;
  if (isAcc()) { $('#app').innerHTML = S.tab === 'acash' ? accCashView() : accView(); return; }
  const v = { overview, dash: dashboard, billing, invoices, expenses: expensesView, workorders: workordersView, payroll: payrollView, petty: pettyView, cash: cashbook, reports, activity, settings, guide: guideView }[S.tab] || overview;
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
  <div class="head"><div><h2>Studio finance</h2><p>FY ${fyLabel(fy)} · July to June · figures in BDT · billed ${compact(billed)} this year</p></div>
    <div class="actions"><button class="btn" data-act="new-project">Add project fee</button><button class="btn pri" data-act="new-invoice" ${S.projects.length ? '' : 'disabled'}>New invoice</button></div></div>
  ${starter}
  <div class="kpis">
    ${(() => { const ac = activeAccts(), tot = ac.reduce((s, a) => s + acctBal(a, t), 0), v = ac.filter(isCashLike).reduce((s, a) => s + acctBal(a, t), 0);
      return ac.length ? `<div class="kpi" data-tab="cash" role="link" tabindex="0" style="cursor:pointer"><div class="lb">Cash & bank now</div><div class="v">${compact(tot)}</div><div class="s">${compact(v)} cash · ${compact(tot - v)} bank</div></div>`
        : `<div class="kpi" data-tab="cash" role="link" tabindex="0" style="cursor:pointer"><div class="lb">Cash & bank</div><div class="v">—</div><div class="s"><b class="bad">Set up vault and bank</b></div></div>`; })()}
    <div class="kpi"><div class="lb">Receivable now</div><div class="v">${compact(recv)}</div><div class="s">${overdue.length ? `<b class="bad">${compact(overdueAmt)}</b> overdue on ${overdue.length}` : `${open.length} open invoice${open.length === 1 ? '' : 's'}`}</div></div>
    <div class="kpi"><div class="lb">Received · FY</div><div class="v">${compact(cashIn)}</div><div class="s">${compact(withheld)} withheld (AIT/VDS)</div></div>
    <div class="kpi"><div class="lb">Not yet billed</div><div class="v">${compact(unbilled)}</div><div class="s">across ${active.length} active project${active.length === 1 ? '' : 's'}</div></div>
  </div>
  ${(() => { const pe = pendingExp(), pw = S.workorders.filter(w => (w.status || 'pending') === 'pending'), pr = submittedRuns(), pa = pendingAdv(); if (!pe.length && !pw.length && !pr.length && !pa.length) return '';
    return `<div class="panel"><div class="ph"><h3>${isPrincipal() ? 'Waiting for your approval' : 'With the Principal for approval'}</h3><span class="meta">${pe.length + pw.length + pr.length + pa.length}</span></div><div class="rows">
      ${pr.map(r => `<button class="row r-mini" data-act="open-run" data-id="${r.id}"><div style="min-width:0"><div class="t">${esc(runLabel(r))}</div><div class="sub">Salary sheet · ${(r.lines || []).length} staff</div></div><span></span><div class="amt">${tk(runTotals(r).net)}</div></button>`).join('')}
      ${pa.map(a => `<button class="row r-mini" data-act="open-adv" data-id="${a.id}"><div style="min-width:0"><div class="t">Advance · ${esc((staffOf(a.staffId) || {}).name || '')}</div><div class="sub">${tk(a.installment)} a month · ${fmtShort(a.date)}</div></div><span></span><div class="amt">${tk(a.amount)}</div></button>`).join('')}
      ${pw.map(w => `<button class="row r-mini" data-act="open-wo" data-id="${w.id}"><div style="min-width:0"><div class="t">${esc(w.vendor)}</div><div class="sub">Work order · <span class="mono">${esc(w.no)}</span> · ${esc(w.type)}</div></div><span></span><div class="amt">${tk(w.amount)}</div></button>`).join('')}
      ${pe.slice(0, 8).map(x => `<button class="row r-mini" data-act="open-exp" data-id="${x.id}"><div style="min-width:0"><div class="t">${esc(x.desc)}</div><div class="sub">Expense · ${esc(x.category)} · ${fmtShort(x.date)}${x.accountId ? ' · already paid' : ''}</div></div><span></span><div class="amt">${tk(x.amount)}</div></button>`).join('')}
    </div></div>`; })()}
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
    return `<button class="row r-prj" data-act="open-project" data-id="${p.id}"><div style="min-width:0"><div class="t">${esc(p.name)}</div><div class="sub"><span class="mono">${esc(p.code)}</span> · ${esc(p.client || '—')}${p.osId ? ((S.os.find(o => o.id === p.osId) || {}).proBono ? ' · <b>Pro bono</b>' : '') : ' · <span class="warnt">not linked to SLATE OS</span>'}</div></div>
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
    <label class="f" for="p_os">SLATE OS project<select id="p_os" name="osId"><option value="">Not in SLATE OS yet (enter below)</option>${osList.map(o => opt(o.id, `${o.code || '—'} · ${o.name || ''}${o.closed ? ' (completed)' : ''}${o.proBono ? ' · pro bono' : ''}`, o.id === src.osId)).join('')}</select></label>
    <div class="fg">
      <label class="f" for="p_code">Project code<input id="p_code" name="code" required value="${esc(src.code)}" placeholder="e.g. RES-GUL-2601" style="text-transform:uppercase"></label>
      <label class="f" for="p_type">Type<select id="p_type" name="type">${PTYPES.map(t => opt(t, t, src.type === t)).join('')}</select></label>
    </div>
    <label class="f" for="p_name">Project name<input id="p_name" name="name" required value="${esc(src.name)}"></label>
    <div class="fg">
      <label class="f" for="p_client">Client (bill to)<input id="p_client" name="client" required value="${esc(src.client)}"></label>
      <label class="f" for="p_loc">Site<input id="p_loc" name="location" value="${esc(src.location)}"></label>
    </div>
    <div class="fg">
      <label class="f" for="p_ent">Bills as<select id="p_ent" name="entity">${ENTITIES.map(e => opt(e, e, entOf(src) === e)).join('')}</select></label>
      <label class="f" for="p_acct">Pays into (bank invoices)<select id="p_acct" name="payAcctId"></select></label>
    </div>
    <p class="hint" id="pEntHint" style="margin:-6px 0 0">${p ? 'Changing this applies to new invoices. Issued invoices keep the name and account they went out with.' : 'The name on this project’s invoices and the account clients pay into. You can change it later.'}</p>
    <label class="f" for="p_wa">Billing contact's WhatsApp<input id="p_wa" name="clientWa" inputmode="tel" autocomplete="off" placeholder="01XXXXXXXXX" value="${esc(src.clientWa ? '0' + String(src.clientWa).slice(3) : '')}"></label>
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
    /* fees for SLATE OS projects are set in SLATE OS › Business › Fees; here they are read-only */
    const lockFee = on => { ['areaSft', 'rate', 'fee'].forEach(n => { f[n].readOnly = on; });
      root.querySelectorAll('[name=ml_label],[name=ml_pct]').forEach(x => { x.readOnly = on; });
      root.querySelectorAll('[data-ml]').forEach(b => { b.style.display = on ? 'none' : ''; });
      let hn = $('#feeLockHint', root); if (on && !hn) { hn = document.createElement('p'); hn.id = 'feeLockHint'; hn.className = 'hint'; hn.style.margin = '-4px 0 0';
        hn.textContent = 'Fee, rate, area and milestones come from SLATE OS › Business › Fees. Change them there.'; f.fee.closest('label').after(hn); }
      if (!on && hn) hn.remove(); };
    lockFee(!!src.osId);
    const fillAcct = () => { const list = bankAccts(f.entity.value), keep = f.payAcctId.value || src.payAcctId;
      f.payAcctId.innerHTML = list.length ? list.map(a => opt(a.id, acctLabel(a), a.id === keep)).join('') : opt('', `No ${f.entity.value} bank account yet (add it in Cash & bank)`, true); };
    fillAcct(); f.entity.addEventListener('change', () => { f.payAcctId.value = ''; fillAcct(); });
    f.osId.addEventListener('change', () => { const o = S.os.find(x => x.id === f.osId.value); lockFee(!!o);
      if (o && S.projects.some(x => x.osId === o.id && x.id !== p?.id)) { toast('That project already has a fee record in Finance.'); f.osId.value = src.osId || ''; lockFee(!!src.osId); return; }
      if (!o) return;
      f.code.value = o.code || ''; f.name.value = o.name || ''; if (o.client) f.client.value = o.client; const site = [o.plotNo ? 'Plot ' + o.plotNo : '', o.roadNo ? 'Road ' + o.roadNo : '', o.blockSector ? (/^[A-Z]{1,2}$/i.test(o.blockSector) ? 'Block ' + o.blockSector : /^\d+[A-Z]?$/i.test(o.blockSector) ? 'Sector ' + o.blockSector : o.blockSector) : '', o.location || ''].filter(Boolean).join(', ');
      if (site) f.location.value = site;
      if (o.proBono && !+f.fee.value) { f.fee.value = 0; f.fee.dispatchEvent(new Event('input', { bubbles: true })); toast('Pro bono project: fee set to 0'); } });
    const autoFee = () => { if (+f.areaSft.value && +f.rate.value) { f.fee.value = Math.round(f.areaSft.value * f.rate.value); f.fee.dispatchEvent(new Event('input', { bubbles: true })); } };
    f.areaSft.addEventListener('input', autoFee); f.rate.addEventListener('input', autoFee);
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const milestones = readMl(root);
      if (Math.round(milestones.reduce((a, m) => a + m.pct, 0)) !== 100) { toast('Milestones need to add up to 100%.'); return; }
      const data = { osId: f.osId.value, code: f.code.value.trim().toUpperCase(), name: f.name.value.trim(), client: f.client.value.trim(), location: f.location.value.trim(), clientAddress: f.clientAddress.value.trim(),
        entity: f.entity.value, payAcctId: f.payAcctId.value, type: f.type.value, areaSft: +f.areaSft.value || 0, rate: +f.rate.value || 0, fee: +f.fee.value || 0, milestones, note: f.note.value.trim(), status: f.status ? f.status.value : (p?.status || 'active') };
      if (S.projects.some(x => x.code === data.code && x.id !== p?.id)) { toast('Another project already uses that code.'); return; }
      const wa = f.clientWa.value.trim(); data.clientWa = wa ? waNum(wa) : '';
      if (wa && !data.clientWa) { toast('Enter the WhatsApp number as a Bangladeshi mobile, e.g. 01712345678.'); f.clientWa.focus(); return; }
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
      <dt>Bills as</dt><dd class="txt">${esc(entOf(p))}${acct(p.payAcctId) ? ' · pays into ' + esc(acctLabel(acct(p.payAcctId))) : ''}</dd>
      ${p.location ? `<dt>Site</dt><dd class="txt">${esc(p.location)}</dd>` : ''}${p.clientAddress ? `<dt>Billing address</dt><dd class="txt">${esc(p.clientAddress)}</dd>` : ''}
      ${p.areaSft ? `<dt>Area</dt><dd>${nfUS.format(p.areaSft)} sft${p.rate ? ` · BDT ${p.rate}/sft` : ''}</dd>` : ''}</dl>
    ${(() => { const ex = S.expenses.filter(x => x.projectId === p.id && x.status !== 'rejected').reduce((t, x) => t + (+x.amount || 0), 0), wo = S.workorders.filter(w => w.projectId === p.id && !['rejected'].includes(w.status || 'pending')).reduce((t, w) => t + (+w.amount || 0), 0);
      return ex || wo ? `<p class="hint" style="margin:0 0 10px">Direct costs so far: ${tk(ex)} expenses · ${tk(wo)} in work orders</p>` : ''; })()}
    <dl class="kv"><dt>Total fee</dt><dd>${tk(s.fee)}</dd><dt>Billed (excl. VAT)</dt><dd>${tk(s.billed)}</dd><dt>Collected</dt><dd>${tk(s.collected)}</dd><dt>Not yet billed</dt><dd>${tk(s.unbilled)}</dd><dt class="tot">Outstanding</dt><dd class="tot">${tk(s.outstanding)}</dd></dl>
    <div class="sec-t" style="margin-top:18px">Milestones</div>
    <div class="mini-list rows" style="margin-top:10px">${msRows || `<div class="empty">No milestones set.</div>`}</div>
    ${(p.costs || []).length ? `<div class="sec-t" style="margin-top:18px">Cost budget <span class="hint" style="font-weight:400">· set in SLATE OS › Business › Fees</span></div>
    <div class="mini-list rows" style="margin-top:10px">${p.costs.map(c => { const ws = S.workorders.filter(o => o.projectId === p.id && o.costLineId === c.id && (o.status || 'pending') !== 'rejected'), wv = ws.reduce((s, o) => s + (+o.amount || 0), 0), act = +c.deal || wv, v = +c.budget && act ? +c.budget - act : null;
      return `<div class="row r-mini" style="cursor:default"><div style="min-width:0"><div class="t">${esc(c.label)}${c.vendor ? ' · ' + esc(c.vendor) : ''}</div><div class="sub">Budget ${tk(c.budget)}${act ? ' · closed at ' + tk(act) : ''}${ws.length ? ' · ' + ws.map(o => esc(o.no)).join(', ') : ''}</div></div>${v == null ? '' : v >= 0 ? chip('paid', v ? tk(v) + ' under' : 'On budget') : chip('overdue', tk(-v) + ' over')}<div class="amt">${tk(act || c.budget)}</div></div>`; }).join('')}</div>` : ''}
    ${p.visits && (p.visits.free != null || +p.visits.fee) ? `<p class="hint" style="margin-top:10px">Site visits: ${p.visits.free != null ? p.visits.free + ' free' : 'no limit agreed'}${+p.visits.fee ? ' · ' + tk(p.visits.fee) + ' per extra visit' : ''}</p>` : ''}
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
  ${intakesPanel()}
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
  const st = S.settings, d = i?.date || today(), pid = i?.projectId || preset.pid || active[0].id;
  // tax setup: an existing draft keeps its own; a new invoice starts as a bank invoice with the government rates
  const T = i && i.mode ? { mode: i.mode, vatOn: !!i.vatOn, aitOn: !!i.aitOn, vatRate: +i.vatRate || +st.vatPct, aitRate: +i.aitRate || +st.aitPct, taxMode: i.taxMode || 'added' }
    : { mode: 'bank', vatOn: true, aitOn: true, vatRate: +st.vatPct || 0, aitRate: +st.aitPct || 0, taxMode: st.bankTaxMode || 'added' };
  const segBtn = (grp, v, l) => `<button type="button" data-pick="${grp}" data-v="${v}" aria-pressed="false">${l}</button>`;
  openSheet(`${sheetHead(i ? 'Edit draft invoice' : 'New invoice', i ? esc(i.no) : 'Pick the project and the milestone you’re billing.')}
  <form id="if">
    <label class="f" for="i_proj">Project<select id="i_proj" name="projectId">${active.map(p => opt(p.id, `${p.code} · ${p.name}${p.client && p.client !== p.name ? ' (' + p.client + ')' : ''}`, p.id === pid)).join('')}</select></label>
    <label class="f" for="i_ms">Milestone<select id="i_ms" name="milestoneId"></select></label>
    <label class="f" for="i_desc">Description on invoice<input id="i_desc" name="desc" required value="${esc(i?.desc)}"></label>
    <div class="fg">
      <label class="f" for="i_no">Invoice number<input id="i_no" name="no" required value="${esc(i?.no || nextInvNo(d))}" class="mono"></label>
      <label class="f" for="i_date">Invoice date<input id="i_date" name="date" type="date" required value="${d}"></label>
    </div>
    <div class="sec-t">Payment</div>
    <div class="seg" role="group" aria-label="Payment">${segBtn('mode', 'bank', 'Bank')}${segBtn('mode', 'cash', 'Cash')}</div>
    <p class="hint" id="iModeHint" style="margin:-6px 0 0"></p>
    <label class="f" for="i_acct" id="iAcctWrap">Bank account for payment<select id="i_acct" name="payAcctId"></select></label>
    <p class="hint" id="iEnt" style="margin:-6px 0 0"></p>
    <div style="display:flex;gap:16px;flex-wrap:wrap">
      <label class="check" for="i_vat"><input id="i_vat" type="checkbox"> VAT <span class="num">${esc(T.vatRate)}%</span></label>
      <label class="check" for="i_ait"><input id="i_ait" type="checkbox"> AIT <span class="num">${esc(T.aitRate)}%</span></label>
    </div>
    <div id="iTaxModeWrap"><div class="seg" role="group" aria-label="How taxes are handled">${segBtn('taxMode', 'added', 'Added on top')}${segBtn('taxMode', 'inclusive', 'Inclusive')}</div>
      <p class="hint" id="iTaxHint" style="margin:6px 0 0"></p></div>
    <div class="fg">
      <label class="f" for="i_amt"><span id="iAmtLbl">Amount (BDT)</span><input id="i_amt" name="entered" type="number" min="0" step="1" required value="${esc(i ? (i.entered ?? i.amount) : '')}"></label>
      <label class="f" for="i_due">Due date<input id="i_due" name="due" type="date" required value="${i?.due || addDays(d, +st.termsDays || 0)}"></label>
    </div>
    <dl class="kv" id="iTot"></dl>
    <p class="hint" id="iLock"></p>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn" type="submit" value="draft">Save as draft</button><button class="btn pri" type="submit" value="issued">Issue invoice</button></div>
  </form>`, root => {
    const f = $('#if', root);
    const showPicks = () => root.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-pressed', String(T[b.dataset.pick] === b.dataset.v)));
    const calc = () => taxCalc({ entered: f.entered.value, ...T });
    const tot = () => {
      T.vatOn = f.querySelector('#i_vat').checked; T.aitOn = f.querySelector('#i_ait').checked;
      const anyTax = T.vatOn || T.aitOn, c = calc();
      $('#iTaxModeWrap', root).hidden = !anyTax;
      $('#iModeHint', root).textContent = T.mode === 'bank' ? 'Paid into a bank account. VAT and AIT apply as per government rules.' : 'Paid in cash. VAT and AIT are optional; tick them only if this client needs them.';
      $('#iTaxHint', root).textContent = T.taxMode === 'inclusive' ? 'The amount you enter is the whole invoice. VAT and AIT come out of it, so SLATE keeps less.' : 'The amount you enter is what SLATE keeps. The invoice is grossed up so the fee stays whole after the client deducts AIT.';
      $('#iAmtLbl', root).textContent = !anyTax ? 'Amount (BDT)' : T.taxMode === 'inclusive' ? 'Invoice total incl. taxes (BDT)' : 'Fee SLATE keeps (BDT)';
      $('#iTot', root).innerHTML = `<dt>Fee (taxable value)</dt><dd>${tk(c.base)}</dd>${T.vatOn ? `<dt>VAT ${T.vatRate}%</dt><dd>${tk(c.vat)}</dd>` : ''}<dt class="tot">Invoice total</dt><dd class="tot">${tk(c.total)}</dd>
        ${T.aitOn ? `<dt>AIT ${T.aitRate}% deducted by client</dt><dd>− ${tk(c.ait)}</dd>` : ''}${anyTax ? `<dt>Client pays</dt><dd>${tk(c.total - c.ait)}${T.vatOn ? `<br><small class="muted">or ${tk(c.net)} if they deduct VAT at source (VDS)</small>` : ''}</dd>` : ''}
        <dt class="tot">SLATE keeps</dt><dd class="tot" style="color:var(--good)">${tk(c.net)}</dd>`;
      $('#iLock', root).textContent = locked(f.date.value) ? `FY ${fyLabel(fyOf(f.date.value))} is closed. Pick a date in an open year, or ask the Principal to reopen it.` : '';
      $('#iLock', root).className = 'hint err'; showPicks(); };
    const setMode = m => { T.mode = m; const on = m === 'bank'; f.querySelector('#i_vat').checked = on; f.querySelector('#i_ait').checked = on; if (on) T.taxMode = st.bankTaxMode || 'added'; tot(); };
    f.querySelector('#i_vat').checked = T.vatOn; f.querySelector('#i_ait').checked = T.aitOn;
    f.addEventListener('click', e => { const b = e.target.closest('[data-pick]'); if (!b) return; if (b.dataset.pick === 'mode') setMode(b.dataset.v); else { T.taxMode = b.dataset.v; tot(); } });
    const fillMs = keep => { const p = prj(f.projectId.value); const ms = p?.milestones || [];
      f.milestoneId.innerHTML = ms.map(m => opt(m.id, `${m.label} · ${m.pct}%${msInvoiced(p, m, i?.id) ? ' (invoiced)' : ''}`, (keep || preset.ms) === m.id)).join('') + opt('', 'Other / not a milestone', keep === '');
      if (!keep && keep !== '' && !preset.ms) { const first = ms.find(m => !msInvoiced(p, m, i?.id)); if (first) f.milestoneId.value = first.id; } };
    const fillAmt = () => { const p = prj(f.projectId.value), m = p?.milestones?.find(x => x.id === f.milestoneId.value);
      if (m) { f.entered.value = Math.round((+p.fee || 0) * m.pct / 100); f.desc.value = `${m.label} (${m.pct}% of design fee) · ${p.name}`; } tot(); };
    const fillAcct = keep => { const p = prj(f.projectId.value), ent = entOf(p), list = bankAccts(ent);
      keep = keep || p?.payAcctId;
      f.payAcctId.innerHTML = list.length ? list.map(a => opt(a.id, acctLabel(a), a.id === keep)).join('') : opt('', `No ${ent} bank account yet`, true);
      $('#iEnt', root).textContent = `Bills as ${ent}, set on the project.${list.length ? '' : ' Add the account in Cash & bank so its details print on the invoice.'}`; };
    fillAcct(i?.payAcctId);
    fillMs(i ? (i.milestoneId || '') : null); if (!i) fillAmt(); else tot();
    f.projectId.addEventListener('change', () => { preset = {}; fillAcct(); fillMs(null); fillAmt(); });
    f.milestoneId.addEventListener('change', fillAmt);
    f.addEventListener('input', e => { if (e.target === f.entered) tot(); });
    f.addEventListener('change', e => { if (e.target.type === 'checkbox') tot(); });
    f.date.addEventListener('change', () => { f.due.value = addDays(f.date.value, +st.termsDays || 0); if (!i) f.no.value = nextInvNo(f.date.value); tot(); });
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const status = ev.submitter?.value || 'issued', no = f.no.value.trim(), c = calc();
      if (S.invoices.some(x => x.no === no && x.id !== i?.id)) { toast('That invoice number is already used.'); return; }
      if (!(c.base > 0)) { toast('Enter the invoice amount.'); return; }
      if (f.due.value < f.date.value) { toast('The due date is before the invoice date.'); return; }
      const anyTax = T.vatOn || T.aitOn;
      const data = { projectId: f.projectId.value, entity: entOf(prj(f.projectId.value)), payAcctId: f.payAcctId.value, milestoneId: f.milestoneId.value, desc: f.desc.value.trim(), no, date: f.date.value, due: f.due.value, status,
        mode: T.mode, vatOn: T.vatOn, aitOn: T.aitOn, vatRate: T.vatRate, aitRate: T.aitRate, taxMode: anyTax ? T.taxMode : 'added',
        entered: +f.entered.value || 0, amount: c.base, vatPct: T.vatOn ? T.vatRate : 0, ait: c.ait, net: c.net };
      const msg = status === 'draft' ? 'Draft saved' : 'Invoice issued';
      const ok = i ? await run(() => putDoc('invoices', i.id, { ...strip(i), ...data }), msg) : await run(() => addDoc('invoices', data), msg);
      if (ok) closeSheet(); });
  });
}
function invoiceSheet(i) {
  const p = prj(i.projectId), st = invStatus(i), recs = recsOf(i).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const vat = (+i.amount || 0) * (+i.vatPct || 0) / 100, bal = Math.max(0, invTotal(i) - invSettled(i));
  const lk = locked(i.date);
  const taxLine = i.mode ? `${MODE_LABEL[i.mode]} invoice${i.vatOn || i.aitOn ? ` · ${[i.vatOn && `VAT ${i.vatRate}%`, i.aitOn && `AIT ${i.aitRate}%`].filter(Boolean).join(' + ')} ${i.taxMode === 'inclusive' ? 'inclusive' : 'added on top'}` : ' · no VAT or AIT'}` : '';
  openSheet(`${sheetHead(i.no, `${esc(p ? p.client : '')} · ${esc(p ? p.name : '')}`)}
    <div style="display:flex;gap:8px;align-items:center;margin:-6px 0 14px;flex-wrap:wrap">${chip(st, ST_LABEL[st])}<span class="hint">${st === 'draft' ? 'Draft, not sent' : 'Issued'} ${fmtDate(i.date)} · due ${fmtDate(i.due)}</span>${lk ? chip('', 'FY closed') : ''}</div>
    <p style="margin:0 0 4px">${esc(i.desc)}</p>
    ${taxLine ? `<p class="hint" style="margin:0 0 12px">${esc(taxLine)}</p>` : ''}
    <dl class="kv"><dt>Fee (taxable value)</dt><dd>${tk(i.amount)}</dd>${+i.vatPct ? `<dt>VAT ${+i.vatPct}%</dt><dd>${tk(vat)}</dd>` : ''}<dt class="tot">Invoice total</dt><dd class="tot">${tk(invTotal(i))}</dd>
      ${invAit(i) ? `<dt>AIT expected from client</dt><dd>${tk(invAit(i))}</dd>` : ''}<dt>SLATE keeps</dt><dd>${tk(invNet(i))}</dd>
      ${st !== 'draft' ? `<dt>Settled so far</dt><dd>${tk(invSettled(i))}</dd><dt class="tot">Balance</dt><dd class="tot" style="color:var(${bal > 0 && st !== 'void' ? '--bad' : '--good'})">${tk(st === 'void' ? 0 : bal)}</dd>` : ''}</dl>
    ${st === 'void' ? `<p class="hint" style="margin-top:10px">Voided ${fmtDate(i.voidedOn)}${i.voidReason ? ` · ${esc(i.voidReason)}` : ''}</p>` : ''}
    ${st !== 'draft' ? `<div class="sec-t" style="margin-top:18px">Payments received</div>
    <div class="mini-list rows" style="margin-top:10px">${recs.length ? recs.map(r => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto auto;cursor:default"><div style="min-width:0"><div class="t">${fmtDate(r.date)} · ${esc(partsLabel(r) || r.method || '')}</div><div class="sub">${r.mrNo ? `<span class="mono">${esc(r.mrNo)}</span> · ` : ''}${r.ref ? `Ref ${esc(r.ref)} · ` : ''}${+r.ait ? `AIT ${tk(r.ait)} · ` : ''}${+r.vds ? `VDS ${tk(r.vds)} · ` : ''}by ${who(r.createdBy)}</div></div><div class="amt">${tk(r.received)}</div>
      <div style="display:flex;gap:4px">${r.mrNo ? `<button class="btn ghost sm" data-act="doc-receipt" data-id="${r.id}">Receipt</button>` : ''}${!locked(r.date) ? `<button class="btn ghost sm danger" data-act="del-receipt" data-id="${r.id}">Remove</button>` : ''}</div></div>`).join('') : `<div class="empty" style="padding:14px">No payments recorded yet.</div>`}</div>` : ''}
    ${waBlock(i, st)}
    <p class="hint">Raised by ${who(i.createdBy)}${i.updatedBy && i.updatedAt !== i.createdAt ? ` · last change by ${who(i.updatedBy)}, ${fmtWhen(i.updatedAt)}` : ''}</p>
    <div class="foot">
      ${st !== 'void' ? `<button class="btn" data-act="doc-invoice" data-id="${i.id}">${st === 'draft' ? 'Preview' : 'Print / PDF'}</button>` : ''}
      ${st === 'draft' && !lk ? `<button class="btn danger" data-act="del-invoice" data-id="${i.id}">Delete draft</button><button class="btn" data-act="edit-invoice" data-id="${i.id}">Edit</button><button class="btn pri" data-act="issue-invoice" data-id="${i.id}">Issue invoice</button>` : ''}
      ${['issued', 'part', 'overdue'].includes(st) && !lk ? `<button class="btn" data-act="due-invoice" data-id="${i.id}">Change due date</button>` : ''}
      ${['issued', 'overdue'].includes(st) && !recs.length && !lk ? `<button class="btn danger" data-act="void-invoice" data-id="${i.id}">Void</button>` : ''}
      ${waReady(i) ? `<button class="btn" data-act="wa-share" data-id="${i.id}">Share PDF</button><button class="btn wa" data-act="wa-send" data-id="${i.id}">Send to client</button>` : ''}
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
const recParts = r => Array.isArray(r.parts) && r.parts.length ? r.parts : (r.accountId ? [{ accountId: r.accountId, amount: +r.received || 0 }] : []);
const partsLabel = r => recParts(r).map(x => `${(acct(x.accountId) || {}).name || 'account'} ${tk(x.amount)}`).join(' + ');
function receiptForm(i, pre) {
  const accts = activeAccts().filter(a => a.kind !== 'petty');
  if (!accts.length) { closeSheet(); S.tab = 'cash'; render(); toast('Add your vault and bank accounts first, so each payment goes into one.'); return; }
  const bal = Math.max(0, invTotal(i) - invSettled(i));
  const aitLeft = Math.max(0, invAit(i) - recsOf(i).reduce((s, r) => s + (+r.ait || 0), 0));
  const want = i.mode === 'cash' ? ['cash'] : ['bank', 'mfs'];
  const defA = (accts.find(a => want.includes(a.kind)) || accts[0]).id, first = Math.round(Math.max(0, bal - aitLeft));
  openSheet(`${sheetHead('Record payment', `${esc(i.no)} · balance ${tk(bal)}`)}
  <form id="rf">
    <div class="fg">
      <label class="f" for="r_date">Date received<input id="r_date" name="date" type="date" required value="${esc(pre?.date || today())}"></label>
      <label class="f" for="r_mr">Money receipt no.<input id="r_mr" name="mrNo" required class="mono" value="${esc(nextMrNo(pre?.date || today()))}"></label>
    </div>
    <div class="sec-t">How it came in</div>
    <div style="display:flex;flex-direction:column;gap:6px">${accts.map(a => `<label class="f" style="display:grid;grid-template-columns:minmax(0,1fr) 140px;align-items:center;gap:10px"><span>${esc(a.name)} <span class="hint">${a.kind === 'cash' ? 'cash' : a.kind === 'mfs' ? 'mobile' : 'bank / cheque'}</span></span><input type="number" min="0" step="1" name="part" data-acct="${a.id}" value="${a.id === defA ? first : ''}" placeholder="0" aria-label="Amount into ${esc(a.name)}"></label>`).join('')}</div>
    <div class="fg">
      <label class="f" for="r_ref">Cheque / transaction ref<input id="r_ref" name="ref"></label>
      <label class="f" for="r_ait">AIT deducted by client<input id="r_ait" name="ait" type="number" min="0" step="1" value="${Math.round(aitLeft)}"></label>
      <label class="f" for="r_vds">VAT deducted by client (VDS)<input id="r_vds" name="vds" type="number" min="0" step="1" value="0"></label>
    </div>
    <p class="hint">Split a payment by filling more than one account: one money receipt covers it all. Fill AIT and VDS only if the client deducted tax at source and gave you a challan or certificate.</p>
    <dl class="kv" id="rTot"></dl>
    <p class="hint" id="rHint"></p>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Record payment</button></div>
  </form>`, root => {
    const f = $('#rf', root), partEls = [...f.querySelectorAll('[name=part]')];
    const parts = () => partEls.map(e => ({ accountId: e.dataset.acct, amount: Math.round(+e.value || 0) })).filter(x => x.amount > 0);
    const upd = () => { const P = parts(), rec = P.reduce((u, x) => u + x.amount, 0), s = rec + (+f.ait.value || 0) + (+f.vds.value || 0), left = bal - s;
      const late = P.map(x => acct(x.accountId)).find(a => a && f.date.value < a.openingDate);
      $('#rTot', root).innerHTML = `<dt>Received</dt><dd>${tk(rec)}${P.length > 1 ? `<br><small class="muted">${P.map(x => `${esc(acct(x.accountId).name)} ${tk(x.amount)}`).join(' + ')}</small>` : ''}</dd><dt>Tax deducted by client</dt><dd>${tk((+f.ait.value || 0) + (+f.vds.value || 0))}</dd><dt class="tot">Settles</dt><dd class="tot">${tk(s)}</dd>`;
      const h = $('#rHint', root);
      h.textContent = locked(f.date.value) ? `FY ${fyLabel(fyOf(f.date.value))} is closed.` : late ? `${late.name} starts on ${fmtDate(late.openingDate)}. Pick a later date.` : !rec && !(+f.ait.value) && !(+f.vds.value) ? 'Enter what came in.' : left > 1 ? `Leaves ${tk(left)} outstanding.` : left < -1 ? `That's ${tk(-left)} more than the balance.` : 'Settles this invoice in full.';
      h.className = 'hint' + (left < -1 || locked(f.date.value) || late ? ' err' : ''); };
    f.addEventListener('input', e => { if ((e.target === f.ait || e.target === f.vds) && parts().length <= 1) { const el = partEls.find(x => +x.value > 0) || partEls.find(x => x.dataset.acct === defA); el.value = Math.max(0, Math.round(bal - (+f.ait.value || 0) - (+f.vds.value || 0))); } upd(); });
    f.date.addEventListener('change', () => { f.mrNo.value = nextMrNo(f.date.value); upd(); });
    if (pre) { partEls.forEach(e => { e.value = e.dataset.acct === pre.accountId ? Math.round(+pre.amount || 0) : ''; }); if (pre.ref) f.ref.value = pre.ref; }
    upd();
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const P = parts(), rec = P.reduce((u, x) => u + x.amount, 0), mrNo = f.mrNo.value.trim(), h = $('#rHint', root);
      if (h.classList.contains('err')) { toast(h.textContent); return; }
      if (!rec && !(+f.ait.value) && !(+f.vds.value)) { toast('Enter what came in.'); return; }
      if (S.receipts.some(r => r.mrNo === mrNo)) { toast('That money receipt number is already used.'); return; }
      const main = P.slice().sort((x, y) => y.amount - x.amount)[0] || { accountId: defA };
      const methodOf = a => a?.kind === 'cash' ? 'Cash' : a?.kind === 'mfs' ? 'bKash / MFS' : 'Bank transfer';
      const data = { invoiceId: i.id, projectId: i.projectId, date: f.date.value, accountId: main.accountId, parts: P, method: P.map(x => methodOf(acct(x.accountId))).filter((v, k, a) => a.indexOf(v) === k).join(' + ') || methodOf(acct(main.accountId)),
        mrNo, received: rec, ait: +f.ait.value || 0, vds: +f.vds.value || 0, ref: f.ref.value.trim() };
      if (await run(async () => { const rid = await addDoc('receipts', data);
          const it = pre && pre.intakeId && S.intakes.find(k => k.id === pre.intakeId);
          if (it) await putDoc('intakes', it.id, { ...strip(it), status: 'matched', receiptId: rid, invoiceId: i.id, decidedBy: S.uid, decidedOn: today() }); },
        `Payment recorded · receipt ${mrNo}`)) invoiceSheet(S.invoices.find(x => x.id === i.id) || i); });
  });
}

/* ----- printable documents (open in a new tab: print or save as PDF) ----- */
/* SLATE letterhead pad: address block top left, black tab with the white SLATE mark top right, and the
   faint DESIGN WITH PURPOSE at the foot. Same measurements as the printed pad. Text in Didact Gothic (free, Century Gothic-like),
   headings and figures in bold in Jost (free, Futura-like); both are open-licensed Google Fonts. */
const LH_ADDR_DEFAULT = 'SLATE, Flat: B2, Level - 02, House: SW (I) 3/A\nRoad: 02, Gulshan 01, Dhaka -1212\n+88 01749 390 284\nslate-atelier.com\nteam@slate-atelier.com';
const LOGO_SVG = '<svg viewBox="0 0 106 108" aria-hidden="true"><g fill="#fff"><rect x="0" y="0" width="106" height="7"/><rect x="0" y="0" width="8" height="44"/><rect x="98" y="0" width="8" height="44"/><rect x="74" y="37" width="32" height="7"/><rect x="0" y="63" width="32" height="7"/><rect x="0" y="63" width="8" height="45"/><rect x="98" y="63" width="8" height="45"/><rect x="0" y="101" width="106" height="7"/></g></svg>';
const letterhead = () => `<div class="lh-addr">${lines(S.settings.lhAddress || LH_ADDR_DEFAULT).map(esc).join('<br>')}</div><div class="lh-tab"><div class="lh-mark">${LOGO_SVG}</div><div class="lh-name">SLATE</div></div><div class="lh-wm">DESIGN<br>WITH<br>PURPOSE</div>`;
function docShell(title, ref, body, more = []) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Didact+Gothic&family=Jost:wght@400;500;600&display=swap">
<style>
@page{size:A4;margin:0}*{box-sizing:border-box}
body{margin:0;background:#E6E8EA;color:#000;font:10pt/1.42 "Didact Gothic","Century Gothic",sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact;font-variant-numeric:tabular-nums}
.bar{position:sticky;top:0;z-index:5;display:flex;gap:8px;justify-content:center;padding:10px;background:#231f20}.bar button{font:500 13px system-ui;padding:8px 14px;border-radius:6px;border:0;cursor:pointer}.bar .p{background:#C41E29;color:#fff}
.page{width:210mm;min-height:297mm;margin:8mm auto;background:#fff;padding:43.5mm 14mm 16mm 12.6mm;position:relative;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,.12)}
.page>*{position:relative;z-index:1}
.page>.lh-addr,.page>.lh-tab,.page>.lh-wm{position:absolute;z-index:0}
@media print{body{background:#fff}.bar{display:none}.page{margin:0;box-shadow:none;zoom:1!important;height:297mm;page-break-after:always}.page:last-child{page-break-after:auto}}
.lh-addr{left:12.6mm;top:22.9mm;font-size:7.6pt;line-height:3.07mm;color:#545454;letter-spacing:.005em;white-space:nowrap}
.lh-tab{left:177.6mm;top:0;width:19.7mm;height:37.9mm;background:#231f20}
.lh-mark{position:absolute;left:4.7mm;top:20.6mm;width:10.6mm}.lh-mark svg{display:block;width:100%;height:auto}
.lh-name{position:absolute;left:0;right:0;top:32.15mm;text-align:center;color:#fff;font-size:5.6pt;line-height:1;letter-spacing:.32em;padding-left:.32em}
.lh-wm{left:12.2mm;top:239.6mm;font-weight:400;font-size:32pt;line-height:12.35mm;color:#f0f0f0;letter-spacing:.02em}
b,strong,h1,h2,th,tr.tot td,.to b,.ref span b,.sig b,.amtbox b,.lh-addr,.lh-name,.lh-wm,.dr{font-family:"Jost","Futura",sans-serif}
b,strong{font-weight:600}
h1{font-size:15pt;font-weight:600;letter-spacing:.08em;margin:0 0 1.5mm;text-transform:uppercase}.dr{color:#C41E29;font-size:9pt;border:1pt solid #C41E29;padding:1px 6px;margin-left:6px;vertical-align:middle;letter-spacing:.04em}
.ref{display:flex;justify-content:space-between;gap:6mm;font-size:9pt;color:#545454;margin-bottom:7mm;flex-wrap:wrap}.ref span b{color:#000;font-weight:600}
.to{margin-bottom:6mm}.to b{display:block;font-weight:600;font-size:11pt}.pre{white-space:pre-line}
h2{font-size:8.5pt;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#000;margin:7mm 0 2.5mm}
table{width:100%;border-collapse:collapse;font-size:9.5pt}
th{font-size:7.5pt;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#545454;text-align:left;padding:2mm 1mm 2mm 0;border-bottom:.75pt solid #000}
td{padding:2.2mm 1mm 2.2mm 0;border-bottom:.5pt solid #CFCFCF;vertical-align:top}td.n,th.n{text-align:right;padding-right:0}
tr.tot td{border-bottom:0;border-top:1pt solid #000;font-weight:600}tr.sub td{color:#545454;border-bottom:0}
.words{font-size:9pt;color:#545454;margin:3mm 0 0}
.sig{display:flex;flex-wrap:wrap;gap:12mm 20mm;margin-top:16mm}.sig div{min-width:60mm;border-top:.75pt solid #000;padding-top:2mm;font-size:9pt}.sig b{display:block;font-weight:600}
.note{font-size:8.5pt;color:#545454;margin-top:5mm}pre{font:inherit;white-space:pre-wrap;margin:0}
.amtbox{display:flex;justify-content:space-between;align-items:baseline;border:1pt solid #000;padding:4mm 5mm;margin:6mm 0 2mm}.amtbox b{font-size:16pt;font-weight:600}
.docref{position:absolute;left:12.6mm;right:14mm;bottom:7mm;font-size:7pt;letter-spacing:.14em;text-transform:uppercase;color:#9A9A9A;text-align:right}
</style></head><body><div class="bar"><button class="p" onclick="print()">Print or save as PDF</button><button onclick="close()">Close</button></div>
${[body, ...more].map(b => `<div class="page">${letterhead()}${b}<div class="docref">${esc(ref)}</div></div>`).join('')}
<script>(function(){function fit(){var px=210*96/25.4,w=document.documentElement.clientWidth,z=Math.min(1,(w-16)/px);document.querySelectorAll('.page').forEach(function(p){p.style.zoom=z;});}addEventListener('resize',fit);fit();})();<\/script>
</body></html>`;
}
const sigBlock = (st, ent) => `<div class="sig"><div><b>${esc(st.signName || '')}</b>${esc(st.signTitle || '')}<br>${esc(ent || STUDIO.name)}</div></div>`;
/* Earlier invoices on the same project, this one, and phases still to bill: what the client has been billed,
   what's been settled (payments plus tax deducted at source) and what's still due. */
function billingToDate(i, p) {
  const ms = p.milestones || [], phaseNo = x => { const k = ms.findIndex(m => m.id === x.milestoneId); return k >= 0 ? k + 1 : null; };
  const label = x => { const m = ms.find(m => m.id === x.milestoneId); return m ? m.label : x.desc; };
  const earlier = S.invoices.filter(x => x.projectId === i.projectId && x.id !== i.id && !['void', 'draft'].includes(invStatus(x)) && (x.date || '') <= (i.date || ''))
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.no || '').localeCompare(b.no || ''));
  if (!earlier.length) return null;
  const rowOf = (x, cur) => { const billed = invTotal(x), paid = Math.min(billed, invSettled(x)); return { n: phaseNo(x), label: label(x), ref: (x.no || '').split('/').pop(), date: x.date, billed, paid, due: Math.max(0, billed - paid), cur }; };
  const rows = [...earlier.map(x => rowOf(x, false)), rowOf(i, true)];
  const billedIds = new Set(S.invoices.filter(x => x.projectId === i.projectId && invStatus(x) !== 'void').map(x => x.milestoneId).concat(i.milestoneId));
  const later = ms.map((m, k) => ({ n: k + 1, label: m.label })).filter((m, k) => !billedIds.has(ms[k].id));
  const prevDue = rows.filter(r => !r.cur).reduce((t, r) => t + r.due, 0);
  const sum = k => rows.reduce((t, r) => t + r[k], 0);
  const cell = 'style="font-size:8.5pt;color:#545454"';
  const html = `<h2>Billing to date</h2>
  <table><thead><tr><th>Phase</th><th>Invoice</th><th class="n">Billed</th><th class="n">Paid</th><th class="n">Due</th></tr></thead><tbody>
  ${rows.map(r => `<tr><td>${r.cur ? '<b>' : ''}${r.n ? r.n + ' · ' : ''}${esc(r.label)}${r.cur ? '</b>' : ''}</td><td ${cell}>${esc(r.ref)} · ${r.cur ? 'this invoice' : fmtDate(r.date)}</td><td class="n">${nf.format(Math.round(r.billed))}</td><td class="n">${nf.format(Math.round(r.paid))}</td><td class="n">${r.due ? nf.format(Math.round(r.due)) : 'Paid'}</td></tr>`).join('')}
  ${later.map(m => `<tr class="sub"><td>${m.n} · ${esc(m.label)}</td><td ${cell}>not yet billed</td><td class="n">—</td><td class="n">—</td><td class="n">—</td></tr>`).join('')}
  <tr class="tot"><td colspan="2">Total</td><td class="n">${nf.format(Math.round(sum('billed')))}</td><td class="n">${nf.format(Math.round(sum('paid')))}</td><td class="n">${nf.format(Math.round(sum('due')))}</td></tr></tbody></table>`;
  return { html, prevDue, payNow: sum('due') };
}
function invoiceDoc(i) {
  const p = prj(i.projectId) || {}, vat = (+i.amount || 0) * (+i.vatPct || 0) / 100, st = S.settings, draft = invStatus(i) === 'draft';
  const ent = entOf(i.entity ? i : p), a = acct(i.payAcctId);
  const payee = a ? entOf({ entity: a.title }) : ent;
  const bankLines = a ? [`Account title: ${payee}`, a.number ? `Account no: ${a.number}` : '', a.bank ? `Bank: ${a.bank}` : '', a.routing ? `Routing no: ${a.routing}` : ''].filter(Boolean).join('\n') : st.bank;
  const btd = billingToDate(i, p);
  const body = `<style>.page td,.page th{padding-top:1.6mm;padding-bottom:1.6mm}.page h2{margin:5mm 0 1.5mm}.page .ref{margin-bottom:5mm}.page .to{margin-bottom:4mm}.page .amtbox{margin:4mm 0 1.5mm;padding:3mm 5mm}.page .sig{margin-top:${btd ? 8 : 16}mm}</style>
  <h1>Invoice${draft ? ' <span class="dr">Draft</span>' : ''}</h1>
  <div class="ref"><span>No <b>${esc(i.no)}</b></span><span>Date <b>${fmtDate(i.date)}</b></span><span>Due <b>${fmtDate(i.due)}</b></span>${st.bin && +i.vatPct ? `<span>BIN <b>${esc(st.bin)}</b></span>` : ''}</div>
  <div class="to">Bill to<b>${esc(p.client || '')}</b>${p.clientAddress ? `<span class="pre">${esc(p.clientAddress)}</span><br>` : ''}Project: ${esc(p.name || '')} (${esc(p.code || '')})${p.location ? `<br>Site: ${esc(p.location)}` : ''}</div>
  <table><thead><tr><th>Description</th><th class="n">Amount (BDT)</th></tr></thead><tbody>
  <tr><td>${esc(i.desc)}</td><td class="n">${nf.format(Math.round(+i.amount || 0))}</td></tr>
  ${+i.vatPct ? `<tr><td>VAT ${i.vatPct}%</td><td class="n">${nf.format(Math.round(vat))}</td></tr>` : ''}
  <tr class="tot"><td>${btd ? 'This invoice' : 'Total payable'}</td><td class="n">${nf.format(Math.round(invTotal(i)))}</td></tr>
  ${invAit(i) ? `<tr class="sub"><td>AIT ${i.aitRate}% deductible at source by the client</td><td class="n">${nf.format(invAit(i))}</td></tr>` : ''}</tbody></table>
  ${btd ? btd.html : ''}
  ${btd && btd.prevDue > 0 ? `<div class="amtbox"><span>Total payable now <span style="font-size:8.5pt;color:#545454">(this invoice + ${nf.format(Math.round(btd.prevDue))} due on earlier phases)</span></span><b>BDT ${nf.format(Math.round(btd.payNow))}</b></div>
  <p class="words">In words: ${esc(takaWords(btd.payNow))}.${btd ? ' Paid includes tax deducted at source (AIT/VDS) once the challan or certificate is received.' : ''}</p>`
    : `<p class="words">In words: ${esc(takaWords(invTotal(i)))}${btd ? '. Paid includes tax deducted at source (AIT/VDS) once the challan or certificate is received.' : ''}</p>`}
  ${!btd && (invAit(i) || +i.vatPct) ? `<p class="note">Where VAT or AIT is deducted at source, please share the treasury challan or certificate with ${esc(ent)}.</p>` : ''}
  <h2>Payment</h2><p style="margin:0">By bank transfer or account-payee cheque in favour of <b>${esc(payee)}</b>, or in cash at the SLATE studio against an official money receipt.</p>
  ${bankLines ? `<pre style="margin-top:2mm">${esc(bankLines)}</pre>` : ''}
  ${!btd && st.invNote ? `<p class="note">${esc(st.invNote)}</p>` : ''}
  ${sigBlock(st, ent)}`;
  return docShell(`Invoice ${i.no}`, `Invoice ${i.no}`, body);
}
function receiptDoc(r) {
  const i = S.invoices.find(x => x.id === r.invoiceId) || {}, p = prj(i.projectId) || {}, st = S.settings, a = acct(r.accountId) || {};
  const body = `<h1>Money receipt</h1>
  <div class="ref"><span>Receipt no <b>${esc(r.mrNo)}</b></span><span>Date <b>${fmtDate(r.date)}</b></span><span>Against invoice <b>${esc(i.no || '')}</b></span></div>
  <div class="to">Received with thanks from<b>${esc(p.client || '')}</b>Project: ${esc(p.name || '')} (${esc(p.code || '')})</div>
  <div class="amtbox"><span>Amount received</span><b>BDT ${nf.format(Math.round(+r.received || 0))}</b></div>
  <p class="words">In words: ${esc(takaWords(r.received))}</p>
  <table style="margin-top:6mm"><tbody>
    ${recParts(r).length > 1 ? recParts(r).map(x => { const ac = acct(x.accountId) || {}; return `<tr><td>${ac.kind === 'cash' ? 'In cash' : 'By bank' + (ac.name ? ' · ' + esc(ac.name) : '')}</td><td class="n">${nf.format(Math.round(+x.amount || 0))}</td></tr>`; }).join('') + (r.ref ? `<tr class="sub"><td>Reference</td><td class="n" style="font-family:inherit">${esc(r.ref)}</td></tr>` : '')
      : `<tr><td>Paid by</td><td class="n" style="font-family:inherit">${esc(r.method || '')}${a.kind && a.kind !== 'cash' ? ` · ${esc(a.name)}` : ''}${r.ref ? ` · Ref ${esc(r.ref)}` : ''}</td></tr>`}
    ${+r.ait ? `<tr><td>AIT deducted at source by client</td><td class="n">${nf.format(Math.round(+r.ait))}</td></tr>` : ''}
    ${+r.vds ? `<tr><td>VAT deducted at source by client (VDS)</td><td class="n">${nf.format(Math.round(+r.vds))}</td></tr>` : ''}
    <tr class="tot"><td>Settled against the invoice</td><td class="n">${nf.format(Math.round((+r.received || 0) + (+r.ait || 0) + (+r.vds || 0)))}</td></tr>
  </tbody></table>
  ${sigBlock(st, entOf(i.entity ? i : p))}`;
  return docShell(`Money receipt ${r.mrNo}`, `Receipt ${r.mrNo}`, body);
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
  if (!w) { saveFile(name, html, 'text/html'); toast('Pop-ups are blocked, so the document was downloaded instead.'); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* ----- Invoices by WhatsApp (switched on in Settings) -----
   Share PDF: the letterhead invoice as a PDF, handed to the phone's share menu, sent from the user's own WhatsApp.
   Send to client: the PDF goes to a private bucket under a random 32-character token; the client gets
   os.slate-atelier.com/i/<token> in a pre-written WhatsApp message. Each open is counted for Finance. */
const waNum = raw => { let n = String(raw || '').replace(/\D/g, ''); if (n.startsWith('00')) n = n.slice(2);
  if (/^01\d{9}$/.test(n)) n = '88' + n; if (/^1\d{9}$/.test(n)) n = '880' + n; return /^8801\d{9}$/.test(n) ? n : ''; };
const waShow = n => n ? '+' + n.slice(0, 3) + ' ' + n.slice(3, 7) + '-' + n.slice(7) : '';
const waReady = i => !!S.settings.waOn && ['issued', 'part', 'overdue'].includes(invStatus(i));
const linksOf = i => S.links.filter(l => l.invoice_id === i.id);
const linkUrl = t => `${location.origin}/i/${t}`;
function waBlock(i, st) {
  const ls = linksOf(i); if (!ls.length && !waReady(i)) return '';
  const p = prj(i.projectId) || {};
  const row = l => { const off = l.revoked_at || new Date(l.expires_at) < new Date();
    const seen = l.open_count ? `opened ${l.open_count}×, last ${fmtWhen(l.last_opened_at)}` : 'not opened yet';
    return l.kind === 'pdf' ? `<div class="row" style="grid-template-columns:minmax(0,1fr);cursor:default"><div style="min-width:0"><div class="t">PDF shared</div><div class="sub">${fmtWhen(l.created_at)} · by ${who(l.created_by)}</div></div></div>`
      : `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;cursor:default"><div style="min-width:0"><div class="t">Link to ${esc(waShow(l.phone) || 'client')} · <span style="color:var(${off ? '--muted' : l.open_count ? '--good' : '--warn'})">${l.revoked_at ? 'switched off' : off ? 'expired' : seen}</span></div><div class="sub">${fmtWhen(l.created_at)} · by ${who(l.created_by)}</div></div>
        ${!off ? `<div style="display:flex;gap:4px"><button class="btn ghost sm" data-act="wa-copy" data-v="${esc(linkUrl(l.token))}">Copy link</button><button class="btn ghost sm danger" data-act="wa-off" data-id="${l.id}">Switch off</button></div>` : '<span></span>'}</div>`; };
  return `<div class="sec-t" style="margin-top:18px">WhatsApp</div>
    ${waReady(i) && !p.clientWa ? `<p class="hint" style="margin:8px 0 0">No billing WhatsApp number on this project yet. Add it with Edit on the project to use Send to client.</p>` : ''}
    ${ls.length ? `<div class="mini-list rows" style="margin-top:10px">${ls.map(row).join('')}</div>` : `<p class="hint" style="margin:8px 0 0">Not sent by WhatsApp yet.</p>`}`;
}
/* the letterhead invoice as an A4 PDF, printed on SLATE's server by the same Chrome print engine as
   "Print or save as PDF", so it is identical from a PC or an iPhone. Only Finance sign-ins can use it. */
async function invoicePdf(i) {
  const { data } = await sb.auth.getSession(); const tok = data && data.session && data.session.access_token;
  if (!tok) throw new Error('Your sign-in has expired. Reload Finance and try again.');
  let r;
  try { r = await fetch('/api/invoice-pdf', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'text/plain;charset=utf-8' }, body: invoiceDoc(i) }); }
  catch (_) { throw new Error('Couldn’t reach the PDF printer. Check your connection and try again.'); }
  if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch (_) {} throw new Error(m || 'Couldn’t make the PDF. Try again in a moment.'); }
  return new File([await r.blob()], `${fileSafe(i.no)}.pdf`, { type: 'application/pdf' });
}
/* Phones only share when the share call comes straight from a tap, so the PDF is made first and the
   person taps once more to send it. */
async function waShare(i, btn) {
  btn.disabled = true; const t = btn.textContent; btn.textContent = 'Making PDF…';
  let file; try { file = await invoicePdf(i); } catch (e) { toast(e.message || 'Couldn’t make the PDF.'); btn.disabled = false; btn.textContent = t; return; }
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [file] }));
  openSheet(`${sheetHead('Share PDF', `${esc(i.no)} · ${esc((prj(i.projectId) || {}).client || '')}`)}
    <p style="margin:0 0 6px">${canShare ? 'The PDF is ready. Tap Share, choose WhatsApp, then pick the client.' : 'This device can’t pass files to WhatsApp directly. Download the PDF, then attach it in WhatsApp.'}</p>
    <p class="hint">${esc(file.name)} · ${Math.max(1, Math.round(file.size / 1024))} KB</p>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Close</button><button class="btn" type="button" id="waDl">Download PDF</button>${canShare ? '<button class="btn wa" type="button" id="waGo">Share</button>' : ''}</div>`, root => {
    $('#waDl', root).addEventListener('click', () => saveFile(file.name, file, 'application/pdf'));
    const go = $('#waGo', root); if (go) go.addEventListener('click', async () => {
      try { await navigator.share({ files: [file], title: `Invoice ${i.no}` }); }
      catch (e) { if (e.name !== 'AbortError') toast('Sharing didn’t work on this device. Download the PDF instead.'); return; }
      await sb.from('fin_links').insert({ kind: 'pdf', invoice_id: i.id }); await loadLinks(); toast('Shared'); invoiceSheet(i); });
  });
}
async function waSend(i, btn) {
  const p = prj(i.projectId) || {};
  if (!p.clientWa) { toast('Add the billing contact’s WhatsApp number on the project first.'); return; }
  btn.disabled = true; const t = btn.textContent; btn.textContent = 'Preparing…';
  try {
    const file = await invoicePdf(i);
    const tok = Array.from(crypto.getRandomValues(new Uint8Array(32)), x => ABC[x % ABC.length]).join('');
    const path = `${tok}/${fileSafe(i.no)}.pdf`;
    const up = await sb.storage.from('fin-invoices').upload(path, file, { contentType: 'application/pdf', upsert: false });
    if (up.error) throw up.error;
    const ins = await sb.from('fin_links').insert({ kind: 'link', token: tok, invoice_id: i.id, file_path: path, phone: p.clientWa, expires_at: new Date(Date.now() + 365 * 864e5).toISOString() });
    if (ins.error) throw ins.error;
    await loadLinks();
    const btd = billingToDate(i, p), amount = nf.format(Math.round(btd ? btd.payNow : Math.max(0, invTotal(i) - invSettled(i))));
    const fill = { client: p.client || '', no: i.no, project: p.name || '', amount, due: fmtDate(i.due), link: linkUrl(tok), company: entOf(i.entity ? i : p) };
    const msg = (S.settings.waMsg || DEFAULT_WA_MSG).replace(/\{(\w+)\}/g, (m, k) => k in fill ? fill[k] : m);
    const href = `https://wa.me/${p.clientWa}?text=${encodeURIComponent(msg)}`;
    openSheet(`${sheetHead('Send to client', `${esc(i.no)} · ${esc(waShow(p.clientWa))}`)}
      <p style="margin:0 0 8px">The private link is ready. Open WhatsApp, check the message and tap send there.</p>
      <pre class="wa-msg">${esc(msg)}</pre>
      <p class="hint">The client sees this invoice only. Its opens show on the invoice under WhatsApp, and you can switch the link off there.</p>
      <div class="foot"><button class="btn ghost" type="button" data-act="close">Close</button><button class="btn" type="button" data-act="wa-copy" data-v="${esc(msg)}">Copy message</button><a class="btn wa" href="${esc(href)}" target="_blank" rel="noopener">Open WhatsApp</a></div>`);
  } catch (e) { toast(friendly(e)); btn.disabled = false; btn.textContent = t; }
}

/* ----- Expenses (the Principal approves every one) ----- */
const EXP_ST = { pending: 'Awaiting approval', approved: 'Approved', rejected: 'Rejected' };
const expChip = x => x.status === 'rejected' ? chip('rejected', 'Rejected') : x.status === 'pending' ? chip('pending', 'Awaiting approval') : x.accountId ? chip('paid', 'Paid') : chip('unpaid', 'Approved · unpaid');
const pendingExp = () => S.expenses.filter(x => (x.status || 'pending') === 'pending');
function expensesView() {
  const f = S.f.exp, cat = S.f.expCat, q = S.f.q.toLowerCase(), fy = S.fy, mo = today().slice(0, 7);
  const live = S.expenses.filter(x => x.status !== 'rejected');
  const spentFY = live.filter(x => inFY(x.date, fy)).reduce((s, x) => s + (+x.amount || 0), 0);
  const spentMo = live.filter(x => (x.date || '').startsWith(mo)).reduce((s, x) => s + (+x.amount || 0), 0);
  const pend = pendingExp(), unpaid = S.expenses.filter(x => x.status === 'approved' && !x.accountId);
  const list = S.expenses.filter(x => {
    if (f === 'pending' && (x.status || 'pending') !== 'pending') return false;
    if (f === 'unpaid' && !(x.status === 'approved' && !x.accountId)) return false;
    if (f === 'rejected' && x.status !== 'rejected') return false;
    if (f === 'all' && !inFY(x.date, fy)) return false;
    if (cat && x.category !== cat) return false;
    if (q && ![x.desc, x.payee, x.category, x.ref].join(' ').toLowerCase().includes(q)) return false;
    return true; }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const total = list.reduce((s, x) => s + (+x.amount || 0), 0);
  return `
  <div class="head"><div><h2>Expenses</h2><p>Studio costs. ${isPrincipal() ? 'You approve every expense.' : 'Every expense goes to the Principal for approval.'} Consultants and vendors go under Work orders; salaries under Payroll.</p></div>
    <div class="actions"><button class="btn" data-act="export-exp">Export CSV</button>${isPrincipal() && pend.length ? `<button class="btn" data-act="approve-all">Approve all ${pend.length}</button>` : ''}<button class="btn pri" data-act="new-exp">New expense</button></div></div>
  <div class="kpis">
    <div class="kpi"><div class="lb">Spent this month</div><div class="v">${compact(spentMo)}</div><div class="s">${fmtDate(mo + '-01').replace(/^1 /, '')}</div></div>
    <div class="kpi"><div class="lb">Spent · FY</div><div class="v">${compact(spentFY)}</div><div class="s">FY ${fyLabel(fy)}, excl. rejected</div></div>
    <div class="kpi"><div class="lb">Awaiting approval</div><div class="v">${pend.length}</div><div class="s">${pend.length ? `<b class="${isPrincipal() ? 'bad' : ''}">${compact(pend.reduce((s, x) => s + (+x.amount || 0), 0))}</b>${isPrincipal() ? ' needs you' : ' with the Principal'}` : 'nothing waiting'}</div></div>
    <div class="kpi"><div class="lb">Approved, not paid</div><div class="v">${unpaid.length}</div><div class="s">${compact(unpaid.reduce((s, x) => s + (+x.amount || 0), 0))} to pay</div></div>
  </div>
  <div class="filters"><div class="seg">${[['all', `FY ${fyLabel(fy)}`], ['pending', 'Awaiting approval'], ['unpaid', 'Unpaid'], ['rejected', 'Rejected']].map(([k, l]) => `<button data-act="f-exp" data-v="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
    <select id="expCat" aria-label="Category"><option value="">All categories</option>${EXP_CATS.map(c => opt(c, c, cat === c)).join('')}</select>
    <input type="search" id="q" placeholder="Search description or payee" value="${esc(S.f.q)}"></div>
  <div class="panel"><div class="ph"><h3>${list.length} expense${list.length === 1 ? '' : 's'}</h3><span class="meta num">${tk(total)}</span></div>
  ${list.length ? `<div class="rows">${list.map(expRow).join('')}</div>` : `<div class="empty"><strong>No expenses here</strong>Record a cost with New expense.</div>`}</div>`;
}
function expRow(x) {
  const p = x.projectId ? prj(x.projectId) : null;
  return `<button class="row r-exp" data-act="open-exp" data-id="${x.id}"><div style="min-width:0"><div class="t">${esc(x.desc)}</div><div class="sub">${esc(x.category)}${x.payee ? ' · ' + esc(x.payee) : ''}${p ? ' · <span class="mono">' + esc(p.code) + '</span> · ' + esc(p.name) : ''}</div></div>
    <div class="c2 sub">${fmtDate(x.date)}</div>${expChip(x)}<div class="amt">${tk(x.amount)}</div></button>`;
}
function expenseForm(x) {
  const accts = activeAccts(), src = x || { date: today(), category: EXP_CATS[0] };
  const decided = x && (x.status || 'pending') !== 'pending';
  if (decided && !isPrincipal()) { toast('This expense has been decided. Only the Principal can change it.'); return; }
  const paid = !!src.accountId;
  openSheet(`${sheetHead(x ? 'Edit expense' : 'New expense', isPrincipal() ? 'Expenses you record are approved straight away.' : 'It goes to the Principal for approval. If you’ve already paid it, record that too.')}
  <form id="ef">
    <div class="fg">
      <label class="f" for="e_date">Date<input id="e_date" name="date" type="date" required value="${esc(src.date)}"></label>
      <label class="f" for="e_cat">Category<select id="e_cat" name="category">${EXP_CATS.map(c => opt(c, c, src.category === c)).join('')}</select></label>
    </div>
    <label class="f" for="e_desc">What it was for<input id="e_desc" name="desc" required value="${esc(src.desc)}" placeholder="e.g. Plotting for RAJUK submission"></label>
    <div class="fg">
      <label class="f" for="e_payee">Paid to<input id="e_payee" name="payee" value="${esc(src.payee)}" placeholder="Shop, person or company"></label>
      <label class="f" for="e_amt">Amount (BDT)<input id="e_amt" name="amount" type="number" min="1" step="1" required value="${esc(src.amount)}"></label>
    </div>
    <label class="f" for="e_prj">Project (if it's a cost of one)<select id="e_prj" name="projectId"><option value="">Studio overhead, not a project</option>${S.projects.map(p => opt(p.id, `${p.code} · ${p.name}`, p.id === src.projectId)).join('')}</select></label>
    <label class="check" for="e_paid"><input id="e_paid" type="checkbox" ${paid ? 'checked' : ''} ${accts.length ? '' : 'disabled'}> Already paid ${accts.length ? '' : '<span class="hint">(add the vault and bank under Cash & bank first)</span>'}</label>
    <div class="fg" id="ePay">
      <label class="f" for="e_acct">Paid from<select id="e_acct" name="accountId">${accts.map(a => opt(a.id, `${a.name} · ${tk(acctBal(a, today()))}`, a.id === (src.accountId || (accts.find(k => k.kind === 'cash') || accts[0] || {}).id))).join('')}</select></label>
      <label class="f" for="e_pd">Paid on<input id="e_pd" name="paidOn" type="date" value="${esc(src.paidOn || src.date)}"></label>
      <label class="f" for="e_ref">Voucher / cheque / txn no.<input id="e_ref" name="ref" value="${esc(src.ref)}"></label>
    </div>
    <label class="f" for="e_note">Note<input id="e_note" name="note" value="${esc(src.note)}"></label>
    <p class="hint err" id="eHint"></p>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">${x ? 'Save' : isPrincipal() ? 'Save expense' : 'Send for approval'}</button></div>
  </form>`, root => {
    const f = $('#ef', root), cb = $('#e_paid', root);
    const sync = () => { $('#ePay', root).hidden = !cb.checked; const a = acct(f.accountId?.value);
      $('#eHint', root).textContent = locked(f.date.value) ? `FY ${fyLabel(fyOf(f.date.value))} is closed.` : cb.checked && a && f.paidOn.value < a.openingDate ? `${a.name} starts on ${fmtDate(a.openingDate)}.` : cb.checked && a && acctBal(a, today()) - (+f.amount.value || 0) + (x && x.accountId === a.id ? +x.amount || 0 : 0) < 0 ? `${a.name} would go below zero.` : ''; };
    cb.addEventListener('change', sync); f.addEventListener('input', sync); f.addEventListener('change', sync); sync();
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const h = $('#eHint', root).textContent; if (h && !/below zero/.test(h)) { toast(h); return; }
      const data = { date: f.date.value, category: f.category.value, desc: f.desc.value.trim(), payee: f.payee.value.trim(), amount: +f.amount.value || 0, projectId: f.projectId.value, note: f.note.value.trim(),
        accountId: cb.checked ? f.accountId.value : '', paidOn: cb.checked ? f.paidOn.value : '', ref: cb.checked ? f.ref.value.trim() : '',
        status: x ? (x.status || 'pending') : isPrincipal() ? 'approved' : 'pending', ...(x ? {} : isPrincipal() ? { decidedBy: S.uid, decidedOn: today() } : {}) };
      const ok = x ? await run(() => putDoc('expenses', x.id, { ...strip(x), ...data }), 'Expense saved') : await run(() => addDoc('expenses', data), isPrincipal() ? 'Expense saved' : 'Sent to the Principal for approval');
      if (ok) closeSheet(); });
  });
}
function expenseSheet(x) {
  const p = x.projectId ? prj(x.projectId) : null, a = acct(x.accountId), st = x.status || 'pending', lk = locked(x.date) || locked(x.paidOn);
  openSheet(`${sheetHead(x.desc, `${esc(x.category)}${x.payee ? ' · ' + esc(x.payee) : ''}`)}
    <div style="display:flex;gap:8px;align-items:center;margin:-6px 0 14px;flex-wrap:wrap">${expChip(x)}${lk ? chip('', 'FY closed') : ''}</div>
    <dl class="kv"><dt>Date</dt><dd class="txt">${fmtDate(x.date)}</dd><dt class="tot">Amount</dt><dd class="tot">${tk(x.amount)}</dd>
      <dt>Project</dt><dd class="txt">${p ? `<span class="mono">${esc(p.code)}</span> · ${esc(p.name)}` : 'Studio overhead'}</dd>
      <dt>Paid</dt><dd class="txt">${a ? `${fmtDate(x.paidOn)} from ${esc(a.name)}${x.ref ? ' · ' + esc(x.ref) : ''}` : 'Not yet'}</dd>
      ${st !== 'pending' ? `<dt>${st === 'approved' ? 'Approved' : 'Rejected'}</dt><dd class="txt">${who(x.decidedBy)}${x.decidedOn ? ', ' + fmtDate(x.decidedOn) : ''}${x.rejectReason ? ' · ' + esc(x.rejectReason) : ''}</dd>` : ''}</dl>
    ${x.note ? `<p class="hint" style="margin-top:10px">${esc(x.note)}</p>` : ''}
    <p class="hint">Recorded by ${who(x.createdBy)} · ${fmtWhen(x.createdAt)}</p>
    <div class="foot">
      ${!lk && (st === 'pending' || isPrincipal()) ? `<button class="btn danger" data-act="del-exp" data-id="${x.id}">Delete</button><button class="btn" data-act="edit-exp" data-id="${x.id}">Edit</button>` : ''}
      ${!lk && st === 'approved' && !x.accountId ? `<button class="btn pri" data-act="pay-exp" data-id="${x.id}">Record payment</button>` : ''}
      ${isPrincipal() && st === 'pending' && !lk ? `<button class="btn danger" data-act="reject-exp" data-id="${x.id}">Reject</button><button class="btn pri" data-act="approve-exp" data-id="${x.id}">Approve</button>` : ''}
    </div>`);
}
function payExpForm(x) {
  const accts = activeAccts(); if (!accts.length) { toast('Add the vault and bank under Cash & bank first.'); return; }
  openSheet(`${sheetHead('Record payment', `${esc(x.desc)} · ${tk(x.amount)}`)}
  <form id="xf"><div class="fg">
    <label class="f" for="x_acct">Paid from<select id="x_acct" name="accountId">${accts.map(a => opt(a.id, `${a.name} · ${tk(acctBal(a, today()))}`, a.kind === 'cash')).join('')}</select></label>
    <label class="f" for="x_pd">Paid on<input id="x_pd" name="paidOn" type="date" required value="${today()}"></label>
    <label class="f" for="x_ref">Voucher / cheque / txn no.<input id="x_ref" name="ref"></label></div>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Record payment</button></div></form>`, root => {
    $('#xf', root).addEventListener('submit', async ev => { ev.preventDefault(); const f = ev.target, a = acct(f.accountId.value);
      if (a && f.paidOn.value < a.openingDate) { toast(`${a.name} starts on ${fmtDate(a.openingDate)}.`); return; }
      if (await run(() => putDoc('expenses', x.id, { ...strip(x), accountId: f.accountId.value, paidOn: f.paidOn.value, ref: f.ref.value.trim() }), 'Payment recorded')) expenseSheet(S.expenses.find(e => e.id === x.id) || x); });
  });
}
function rejectExpForm(x) {
  openSheet(`${sheetHead('Reject expense', `${esc(x.desc)} · ${tk(x.amount)}`)}
  <form id="jf"><label class="f" for="j_r">Reason<input id="j_r" name="r" required placeholder="So the COO knows what to do next"></label>
    ${x.accountId ? `<p class="hint err">This was already paid from ${esc((acct(x.accountId) || {}).name || 'an account')}. Rejecting removes that payment from the book; recover the money separately.</p>` : ''}
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn danger" type="submit">Reject</button></div></form>`, root => {
    $('#jf', root).addEventListener('submit', async ev => { ev.preventDefault();
      if (await run(() => putDoc('expenses', x.id, { ...strip(x), status: 'rejected', rejectReason: ev.target.r.value.trim(), decidedBy: S.uid, decidedOn: today(), accountId: '', paidOn: '' }), 'Expense rejected')) closeSheet(); });
  });
}
function exportExp() {
  const r = [['Date', 'Category', 'Description', 'Paid to', 'Project', 'Amount', 'Status', 'Paid on', 'Paid from', 'Ref']];
  S.expenses.filter(x => inFY(x.date, S.fy)).sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(x => r.push([x.date, x.category, x.desc, x.payee, (prj(x.projectId) || {}).code || '', x.amount, EXP_ST[x.status || 'pending'], x.paidOn || '', (acct(x.accountId) || {}).name || '', x.ref || '']));
  saveCsv(`SLATE-expenses-FY${fyLabel(S.fy).replace('–', '-')}.csv`, r);
}

/* ----- Work orders (consultants and vendors) ----- */
const woNet = x => (+x.gross || 0) - (+x.ait || 0) - (+x.vds || 0);
const nextMonth = (ym, n = 1) => { const d = new Date((ym || today().slice(0, 7)) + '-01T00:00:00'); d.setMonth(d.getMonth() + n); return iso(d).slice(0, 7); };
const woSchedule = w => Array.isArray(w.schedule) && w.schedule.length ? w.schedule : [{ id: 'all', label: 'Full value', pct: 100, month: (w.deliverBy || '').slice(0, 7) || nextMonth(today().slice(0, 7)) }];
/* what is still to pay on each instalment: payments made so far use up the earliest instalments first */
function woDue(w) { let paid = woSettled(w); return woSchedule(w).map(i => { const amt = Math.round((+w.amount || 0) * (+i.pct || 0) / 100), take = Math.min(amt, paid); paid -= take; return { ...i, amt, left: amt - take }; }); }
const schRow = i => `<div class="ml" style="grid-template-columns:minmax(0,1fr) 64px 132px 32px"><input type="hidden" name="sc_id" value="${esc(i.id)}"><input name="sc_label" aria-label="Instalment" placeholder="e.g. On approved drawings" value="${esc(i.label)}"><input name="sc_pct" aria-label="Percent" type="number" min="0" max="100" step="0.5" value="${esc(i.pct)}"><input name="sc_month" aria-label="Expected month" type="month" value="${esc(i.month || '')}"><button class="btn ghost sm" type="button" data-sc="del" aria-label="Remove">×</button></div>`;
const woPays = w => S.wopays.filter(x => x.woId === w.id).sort((a, b) => (a.date || '').localeCompare(b.date || ''));
const woSettled = w => woPays(w).reduce((s, x) => s + (+x.gross || 0), 0);
const woLeft = w => Math.max(0, (+w.amount || 0) - woSettled(w));
const WO_ST = { pending: 'Awaiting approval', approved: 'Approved', rejected: 'Rejected', closed: 'Closed' };
const woChip = w => { const st = w.status || 'pending'; return st === 'approved' && woLeft(w) < 1 ? chip('paid', 'Fully paid') : chip({ pending: 'pending', approved: 'issued', rejected: 'rejected', closed: 'void' }[st], WO_ST[st]); };
const taxWithheld = () => S.wopays.reduce((s, x) => s + (+x.ait || 0) + (+x.vds || 0), 0) + S.payruns.filter(r => r.status === 'paid').reduce((s, r) => s + (r.lines || []).reduce((t, l) => t + (+l.tax || 0), 0), 0);
const taxDeposited = () => S.expenses.filter(x => x.category === 'Tax deposited (AIT/VDS withheld)' && x.status !== 'rejected' && x.accountId).reduce((s, x) => s + (+x.amount || 0), 0);
function workordersView() {
  const f = S.f.wo, q = S.f.q.toLowerCase();
  const open = S.workorders.filter(w => (w.status || 'pending') === 'approved');
  const list = S.workorders.filter(w => { const st = w.status || 'pending';
    if (f === 'open' && !(st === 'approved' && woLeft(w) >= 1) && st !== 'pending') return false;
    if (f === 'pending' && st !== 'pending') return false;
    if (f === 'done' && !(st === 'closed' || (st === 'approved' && woLeft(w) < 1))) return false;
    if (f === 'fy' && !inFY(w.date, S.fy)) return false;
    if (q && ![w.no, w.vendor, w.scope, w.type].join(' ').toLowerCase().includes(q)) return false;
    return true; }).sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.no || '').localeCompare(a.no || ''));
  const paidFY = S.wopays.filter(x => inFY(x.date, S.fy)).reduce((s, x) => s + (+x.gross || 0), 0);
  const owed = taxWithheld() - taxDeposited();
  return `
  <div class="head"><div><h2>Work orders</h2><p>Consultants and vendors engaged for SLATE. ${isPrincipal() ? 'You approve each one' : 'Each one goes to the Principal for approval'} before any payment; AIT and VDS are deducted at source when paying.</p></div>
    <div class="actions"><button class="btn pri" data-act="new-wo">New work order</button></div></div>
  <div class="kpis">
    <div class="kpi"><div class="lb">Still to pay</div><div class="v">${compact(open.reduce((s, w) => s + woLeft(w), 0))}</div><div class="s">on ${open.filter(w => woLeft(w) >= 1).length} open work order${open.length === 1 ? '' : 's'}</div></div>
    <div class="kpi"><div class="lb">Settled · FY</div><div class="v">${compact(paidFY)}</div><div class="s">incl. tax withheld</div></div>
    ${(() => { const n = S.workorders.filter(w => (w.status || 'pending') === 'pending').length; return `<div class="kpi"><div class="lb">Awaiting approval</div><div class="v">${n}</div><div class="s">${!n ? 'nothing waiting' : isPrincipal() ? '<b class="bad">needs you</b>' : 'with the Principal'}</div></div>`; })()}
    <div class="kpi"><div class="lb">Tax to deposit</div><div class="v" style="${owed > 0 ? 'color:var(--bad)' : ''}">${compact(Math.max(0, owed))}</div><div class="s">AIT/VDS and salary tax withheld, not yet deposited</div></div>
  </div>
  <div class="filters"><div class="seg">${[['open', 'Open'], ['pending', 'Awaiting approval'], ['done', 'Paid / closed'], ['fy', `FY ${fyLabel(S.fy)}`]].map(([k, l]) => `<button data-act="f-wo" data-v="${k}" aria-pressed="${f === k}">${l}</button>`).join('')}</div>
    <input type="search" id="q" placeholder="Search vendor, scope or number" value="${esc(S.f.q)}"></div>
  <div class="panel"><div class="ph"><h3>${list.length} work order${list.length === 1 ? '' : 's'}</h3></div>
  ${list.length ? `<div class="rows">${list.map(w => { const p = w.projectId ? prj(w.projectId) : null, set = woSettled(w);
    return `<button class="row r-inv" data-act="open-wo" data-id="${w.id}"><div style="min-width:0"><div class="t">${esc(w.vendor)} · ${esc(w.scope ? w.scope.split('\n')[0] : w.type)}</div><div class="sub"><span class="mono">${esc(w.no)}</span> · ${esc(w.type)}${p ? ' · <span class="mono">' + esc(p.code) + '</span> · ' + esc(p.name) : ''}</div></div>
      <div class="c2 sub">${fmtDate(w.date)}</div>${woChip(w)}<div class="amt">${tk(w.amount)}${set ? `<small>${tk(woLeft(w))} left</small>` : ''}</div></button>`; }).join('')}</div>`
    : `<div class="empty"><strong>No work orders here</strong>Engage a consultant or vendor with New work order.</div>`}</div>
  ${owed > 0 ? `<p class="hint">Tax withheld from vendors and salaries belongs to the government. Deposit it by treasury challan, then record that as an expense under “Tax deposited (AIT/VDS withheld)”.</p>` : ''}`;
}
function woForm(w) {
  if (w && (w.status || 'pending') !== 'pending' && !isPrincipal()) { toast('This work order has been decided. Only the Principal can change it.'); return; }
  const src = w || { date: today(), type: WO_TYPES[0], aitPct: 10, vdsPct: 15, terms: S.settings.woTerms || DEFAULT_WO_TERMS };
  openSheet(`${sheetHead(w ? 'Edit work order' : 'New work order', isPrincipal() ? 'Work orders you create are approved straight away.' : 'It goes to the Principal for approval before anything is paid.')}
  <form id="wf">
    <div class="fg">
      <label class="f" for="w_no">Work order no.<input id="w_no" name="no" required class="mono" value="${esc(src.no || nextWoNo(src.date))}"></label>
      <label class="f" for="w_date">Date<input id="w_date" name="date" type="date" required value="${esc(src.date)}"></label>
      <label class="f" for="w_vendor">Consultant / vendor<input id="w_vendor" name="vendor" required value="${esc(src.vendor)}"></label>
      <label class="f" for="w_type">Type<select id="w_type" name="type">${WO_TYPES.map(t => opt(t, t, src.type === t)).join('')}</select></label>
    </div>
    <label class="f" for="w_vaddr">Vendor address / contact<input id="w_vaddr" name="vendorAddr" value="${esc(src.vendorAddr)}"></label>
    <label class="f" for="w_prj">Project<select id="w_prj" name="projectId"><option value="">Studio (not a project)</option>${S.projects.map(p => opt(p.id, `${p.code} · ${p.name}`, p.id === src.projectId)).join('')}</select></label>
    <label class="f" for="w_cl" id="w_clw">Against budget line<select id="w_cl" name="costLineId"></select></label>
    <p class="hint" id="w_clh" style="margin:-6px 0 0"></p>
    <label class="f" for="w_scope">Scope of work<textarea id="w_scope" name="scope" rows="4" required placeholder="One deliverable per line">${esc(src.scope)}</textarea></label>
    <div class="fg">
      <label class="f" for="w_amt">Value (BDT, before tax deduction)<input id="w_amt" name="amount" type="number" min="1" step="1" required value="${esc(src.amount)}"></label>
      <label class="f" for="w_by">Deliver by<input id="w_by" name="deliverBy" type="date" value="${esc(src.deliverBy)}"></label>
      <label class="f" for="w_ait">AIT deducted at source (%)<input id="w_ait" name="aitPct" type="number" min="0" max="50" step="0.5" value="${esc(src.aitPct)}"></label>
      <label class="f" for="w_vds">VDS deducted at source (%)<input id="w_vds" name="vdsPct" type="number" min="0" max="50" step="0.5" value="${esc(src.vdsPct)}"></label>
    </div>
    <div class="sec-t">Payment schedule</div>
    <div id="scBox" style="display:flex;flex-direction:column;gap:6px">${(src.schedule && src.schedule.length ? src.schedule : [{ id: mid(), label: 'On start', pct: 50, month: today().slice(0, 7) }, { id: mid(), label: 'On approved deliverables', pct: 50, month: nextMonth(today().slice(0, 7)) }]).map(schRow).join('')}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><button class="btn sm" type="button" data-sc="add">Add instalment</button><span class="hint" id="scSum"></span></div>
    <label class="f" for="w_pay">Payment note (optional, printed)<input id="w_pay" name="payTerms" value="${esc(src.payTerms || '')}" placeholder="e.g. Released within 7 days of approval"></label>
    <label class="f" for="w_terms">Terms printed on the work order<textarea id="w_terms" name="terms" rows="3">${esc(src.terms)}</textarea></label>
    <dl class="kv" id="wTot"></dl>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">${w ? 'Save' : isPrincipal() ? 'Create work order' : 'Send for approval'}</button></div>
  </form>`, root => {
    const f = $('#wf', root);
    /* cost budget lines come from SLATE OS › Business › Fees */
    const COST_WO = { str: 'Structural consultant', mep: 'MEP consultant', soil: 'Survey & soil test', viz: '3D visualisation' };
    const fillCl = keep => { const p = prj(f.projectId.value), cs = (p && p.costs) || [];
      f.costLineId.innerHTML = opt('', cs.length ? 'Not against a budget line' : 'No budget lines for this project', !keep) + cs.map(c => opt(c.id, `${c.label}${+c.budget ? ' · budget ' + tk(c.budget) : ''}`, c.id === keep)).join('');
      $('#w_clw', root).style.display = p ? '' : 'none'; showCl(); };
    const showCl = () => { const p = prj(f.projectId.value), c = ((p && p.costs) || []).find(x => x.id === f.costLineId.value), a = +f.amount.value || 0, h = $('#w_clh', root);
      if (!c) { h.textContent = p && !(p.costs || []).length ? 'Budget lines are set in SLATE OS › Business › Fees.' : ''; return; }
      const others = S.workorders.filter(o => o.costLineId === c.id && o.projectId === p.id && o.id !== w?.id && (o.status || 'pending') !== 'rejected').reduce((s, o) => s + (+o.amount || 0), 0), v = (+c.budget || 0) - others - a;
      h.textContent = +c.budget ? `Budget ${tk(c.budget)}${others ? ' · other work orders ' + tk(others) : ''} · ${v >= 0 ? tk(v) + ' under budget' : tk(-v) + ' over budget'}` : ''; h.className = 'hint' + (v < 0 ? ' err' : ''); };
    fillCl(src.costLineId || '');
    f.projectId.addEventListener('change', () => fillCl(''));
    f.costLineId.addEventListener('change', () => { const p = prj(f.projectId.value), c = ((p && p.costs) || []).find(x => x.id === f.costLineId.value);
      if (c && !f.vendor.value && c.vendor) f.vendor.value = c.vendor; if (c && COST_WO[c.type] && !w) f.type.value = COST_WO[c.type]; if (c && !f.amount.value && +c.deal) f.amount.value = c.deal; showCl(); });
    f.amount.addEventListener('input', showCl);
    const readSc = () => { const ids = [...f.querySelectorAll('[name=sc_id]')].map(x => x.value), L = [...f.querySelectorAll('[name=sc_label]')].map(x => x.value.trim()), P = [...f.querySelectorAll('[name=sc_pct]')].map(x => +x.value || 0), M = [...f.querySelectorAll('[name=sc_month]')].map(x => x.value);
      return ids.map((id, i) => ({ id, label: L[i], pct: P[i], month: M[i] })).filter(x => x.label || x.pct); };
    f.addEventListener('click', e => { const b = e.target.closest('[data-sc]'); if (!b) return; if (b.dataset.sc === 'add') $('#scBox', root).insertAdjacentHTML('beforeend', schRow({ id: mid(), label: '', pct: 0, month: '' })); else b.closest('.ml').remove(); upd(); });
    const upd = () => { const a = +f.amount.value || 0, ait = Math.round(a * (+f.aitPct.value || 0) / 100), vds = Math.round(a * (+f.vdsPct.value || 0) / 100);
      const sc = readSc(), sum = sc.reduce((u, x) => u + x.pct, 0); const h = $('#scSum', root); h.textContent = `${sum}% of value${sum !== 100 ? ' · should total 100%' : ''}`; h.className = 'hint' + (sum !== 100 ? ' err' : '');
      $('#wTot', root).innerHTML = `<dt>Value</dt><dd>${tk(a)}</dd><dt>AIT withheld</dt><dd>− ${tk(ait)}</dd><dt>VDS withheld</dt><dd>− ${tk(vds)}</dd><dt class="tot">Vendor receives</dt><dd class="tot">${tk(a - ait - vds)}</dd>`; };
    f.addEventListener('input', upd); upd();
    f.date.addEventListener('change', () => { if (!w) f.no.value = nextWoNo(f.date.value); });
    f.addEventListener('submit', async ev => { ev.preventDefault(); const no = f.no.value.trim();
      if (S.workorders.some(o => o.no === no && o.id !== w?.id)) { toast('That work order number is already used.'); return; }
      if (w && (+f.amount.value || 0) + 1 < woSettled(w)) { toast(`${tk(woSettled(w))} has already been paid against it.`); return; }
      const schedule = readSc(); if (Math.round(schedule.reduce((u, x) => u + x.pct, 0)) !== 100) { toast('The payment schedule needs to add up to 100%.'); return; }
      if (schedule.some(x => !x.label || !x.month)) { toast('Give each instalment a name and the month you expect to pay it.'); return; }
      const data = { no, date: f.date.value, vendor: f.vendor.value.trim(), vendorAddr: f.vendorAddr.value.trim(), type: f.type.value, projectId: f.projectId.value, costLineId: f.projectId.value ? f.costLineId.value : '', scope: f.scope.value.trim(),
        amount: +f.amount.value || 0, deliverBy: f.deliverBy.value, aitPct: +f.aitPct.value || 0, vdsPct: +f.vdsPct.value || 0, schedule, payTerms: f.payTerms.value.trim(), terms: f.terms.value.trim(),
        status: w ? (w.status || 'pending') : isPrincipal() ? 'approved' : 'pending', ...(w ? {} : isPrincipal() ? { decidedBy: S.uid, decidedOn: today() } : {}) };
      const ok = w ? await run(() => putDoc('workorders', w.id, { ...strip(w), ...data }), 'Work order saved') : await run(() => addDoc('workorders', data), isPrincipal() ? 'Work order created' : 'Sent to the Principal for approval');
      if (ok) closeSheet(); });
  });
}
function woSheet(w) {
  const st = w.status || 'pending', p = w.projectId ? prj(w.projectId) : null, pays = woPays(w), left = woLeft(w);
  const wh = pays.reduce((s, x) => s + (+x.ait || 0) + (+x.vds || 0), 0);
  openSheet(`${sheetHead(w.vendor, `<span class="mono">${esc(w.no)}</span> · ${esc(w.type)}${p ? ' · <span class="mono">' + esc(p.code) + '</span> · ' + esc(p.name) : ''}`)}
    <div style="display:flex;gap:8px;align-items:center;margin:-6px 0 14px;flex-wrap:wrap">${woChip(w)}<span class="hint">${fmtDate(w.date)}${w.deliverBy ? ' · deliver by ' + fmtDate(w.deliverBy) : ''}</span></div>
    ${w.scope ? `<p style="margin:0 0 12px;white-space:pre-line">${esc(w.scope)}</p>` : ''}
    <dl class="kv"><dt>Value</dt><dd>${tk(w.amount)}</dd><dt>Settled so far</dt><dd>${tk(woSettled(w))}</dd><dt>of which tax withheld</dt><dd>${tk(wh)}</dd><dt class="tot">Left to pay</dt><dd class="tot">${tk(left)}</dd>
      ${st !== 'pending' ? `<dt>${WO_ST[st]}</dt><dd class="txt">${who(w.decidedBy)}${w.decidedOn ? ', ' + fmtDate(w.decidedOn) : ''}${w.rejectReason ? ' · ' + esc(w.rejectReason) : ''}</dd>` : ''}</dl>
    <div class="sec-t" style="margin-top:18px">Payment schedule</div>
    <div class="mini-list rows" style="margin-top:10px">${woDue(w).map(i => `<div class="row r-mini" style="cursor:default"><div style="min-width:0"><div class="t">${esc(i.label)} · ${i.pct}%</div><div class="sub">${i.month ? 'expected ' + monthName(i.month) : 'no month set'}</div></div>${i.left < 1 ? chip('paid', 'Paid') : i.left < i.amt ? chip('part', 'Part paid') : chip('', 'Due')}<div class="amt">${tk(i.amt)}${i.left >= 1 && i.left < i.amt ? `<small>${tk(i.left)} left</small>` : ''}</div></div>`).join('')}</div>
    ${w.payTerms ? `<p class="hint" style="margin-top:10px">${esc(w.payTerms)}</p>` : ''}
    <div class="sec-t" style="margin-top:18px">Payments</div>
    <div class="mini-list rows" style="margin-top:10px">${pays.length ? pays.map(x => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto auto;cursor:default"><div style="min-width:0"><div class="t">${fmtDate(x.date)} · ${esc((acct(x.accountId) || {}).name || '')}</div><div class="sub">Settled ${tk(x.gross)}${+x.ait ? ` · AIT ${tk(x.ait)}` : ''}${+x.vds ? ` · VDS ${tk(x.vds)}` : ''}${x.ref ? ' · ' + esc(x.ref) : ''}</div></div><div class="amt">${tk(woNet(x))}</div>${!locked(x.date) ? `<button class="btn ghost sm danger" data-act="del-wopay" data-id="${x.id}">Remove</button>` : '<span></span>'}</div>`).join('') : `<div class="empty" style="padding:14px">No payments yet.</div>`}</div>
    <p class="hint">Raised by ${who(w.createdBy)} · ${fmtWhen(w.createdAt)}</p>
    <div class="foot">
      ${st !== 'rejected' ? `<button class="btn" data-act="doc-wo" data-id="${w.id}">${st === 'pending' ? 'Preview' : 'Print / PDF'}</button>` : ''}
      ${!pays.length && (st === 'pending' || isPrincipal()) ? `<button class="btn danger" data-act="del-wo" data-id="${w.id}">Delete</button>` : ''}
      ${st === 'pending' || isPrincipal() ? `<button class="btn" data-act="edit-wo" data-id="${w.id}">Edit</button>` : ''}
      ${isPrincipal() && st === 'pending' ? `<button class="btn danger" data-act="reject-wo" data-id="${w.id}">Reject</button><button class="btn pri" data-act="approve-wo" data-id="${w.id}">Approve</button>` : ''}
      ${isPrincipal() && st === 'approved' ? `<button class="btn" data-act="close-wo" data-id="${w.id}">Close</button>` : ''}
      ${isPrincipal() && st === 'closed' ? `<button class="btn" data-act="reopen-wo" data-id="${w.id}">Reopen</button>` : ''}
      ${st === 'approved' && left >= 1 ? `<button class="btn pri" data-act="pay-wo" data-id="${w.id}">Record payment</button>` : ''}
    </div>`);
}
function woPayForm(w) {
  const accts = activeAccts(); if (!accts.length) { toast('Add the vault and bank under Cash & bank first.'); return; }
  const left = woLeft(w);
  openSheet(`${sheetHead('Pay ' + w.vendor, `${esc(w.no)} · ${tk(left)} left`)}
  <form id="pf2"><div class="fg">
    <label class="f" for="y_date">Date<input id="y_date" name="date" type="date" required value="${today()}"></label>
    <label class="f" for="y_acct">Paid from<select id="y_acct" name="accountId">${accts.map(a => opt(a.id, `${a.name} · ${tk(acctBal(a, today()))}`, a.kind === 'bank')).join('')}</select></label>
    <label class="f" for="y_gross">Amount being settled (BDT)<input id="y_gross" name="gross" type="number" min="1" step="1" required value="${Math.round(left)}"></label>
    <label class="f" for="y_ref">Cheque / txn no.<input id="y_ref" name="ref"></label>
    <label class="f" for="y_ait">AIT withheld<input id="y_ait" name="ait" type="number" min="0" step="1"></label>
    <label class="f" for="y_vds">VDS withheld<input id="y_vds" name="vds" type="number" min="0" step="1"></label></div>
    <dl class="kv" id="yTot"></dl>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Record payment</button></div></form>`, root => {
    const f = $('#pf2', root);
    const fill = () => { const g = +f.gross.value || 0; f.ait.value = Math.round(g * (+w.aitPct || 0) / 100); f.vds.value = Math.round(g * (+w.vdsPct || 0) / 100); upd(); };
    const upd = () => { const g = +f.gross.value || 0, t = (+f.ait.value || 0) + (+f.vds.value || 0);
      $('#yTot', root).innerHTML = `<dt>Settled</dt><dd>${tk(g)}</dd><dt>Tax withheld (deposit to government)</dt><dd>− ${tk(t)}</dd><dt class="tot">Paid to ${esc(w.vendor)}</dt><dd class="tot">${tk(g - t)}</dd>${g > left + 1 ? `<dt class="tot" style="color:var(--bad)">More than what's left</dt><dd></dd>` : ''}`; };
    f.gross.addEventListener('input', fill); f.ait.addEventListener('input', upd); f.vds.addEventListener('input', upd); fill();
    f.addEventListener('submit', async ev => { ev.preventDefault(); const a = acct(f.accountId.value);
      if (a && f.date.value < a.openingDate) { toast(`${a.name} starts on ${fmtDate(a.openingDate)}.`); return; }
      const data = { woId: w.id, date: f.date.value, accountId: f.accountId.value, gross: +f.gross.value || 0, ait: +f.ait.value || 0, vds: +f.vds.value || 0, ref: f.ref.value.trim() };
      data.paid = data.gross - data.ait - data.vds;
      if (await run(() => addDoc('wopays', data), 'Payment recorded')) woSheet(S.workorders.find(o => o.id === w.id) || w); });
  });
}
function rejectWoForm(w) {
  openSheet(`${sheetHead('Reject work order', `${esc(w.no)} · ${esc(w.vendor)}`)}
  <form id="rjw"><label class="f" for="rw_r">Reason<input id="rw_r" name="r" required></label>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn danger" type="submit">Reject</button></div></form>`, root => {
    $('#rjw', root).addEventListener('submit', async ev => { ev.preventDefault();
      if (await run(() => putDoc('workorders', w.id, { ...strip(w), status: 'rejected', rejectReason: ev.target.r.value.trim(), decidedBy: S.uid, decidedOn: today() }), 'Work order rejected')) closeSheet(); });
  });
}
function woDoc(w) {
  const p = w.projectId ? prj(w.projectId) : null, st = S.settings, draft = (w.status || 'pending') === 'pending';
  const ait = Math.round((+w.amount || 0) * (+w.aitPct || 0) / 100), vds = Math.round((+w.amount || 0) * (+w.vdsPct || 0) / 100);
  const body = `<h1>Work order${draft ? ' <span class="dr">Draft</span>' : ''}</h1>
  <div class="ref"><span>No <b>${esc(w.no)}</b></span><span>Date <b>${fmtDate(w.date)}</b></span>${w.deliverBy ? `<span>Deliver by <b>${fmtDate(w.deliverBy)}</b></span>` : ''}</div>
  <div class="to">To<b>${esc(w.vendor)}</b>${w.vendorAddr ? `<span class="pre">${esc(w.vendorAddr)}</span><br>` : ''}${esc(w.type)}${p ? `<br>Project: ${esc(p.name)} (${esc(p.code)})` : ''}</div>
  <h2>Scope of work</h2><table><tbody>${(w.scope || '').split('\n').filter(Boolean).map((l, n) => `<tr><td style="width:8mm">${n + 1}.</td><td>${esc(l)}</td></tr>`).join('')}</tbody></table>
  <h2>Value</h2><table><tbody>
    <tr><td>Work order value</td><td class="n">${nf.format(Math.round(+w.amount || 0))}</td></tr>
    ${ait ? `<tr class="sub"><td>AIT ${w.aitPct}% deducted at source</td><td class="n">${nf.format(ait)}</td></tr>` : ''}
    ${vds ? `<tr class="sub"><td>VDS ${w.vdsPct}% deducted at source</td><td class="n">${nf.format(vds)}</td></tr>` : ''}
    <tr class="tot"><td>Net payable to you</td><td class="n">${nf.format(Math.round((+w.amount || 0) - ait - vds))}</td></tr></tbody></table>
  <p class="words">Work order value in words: ${esc(takaWords(w.amount))}</p>
  <h2>Payment schedule</h2><table><thead><tr><th>Instalment</th><th>Expected</th><th class="n">%</th><th class="n">Value</th><th class="n">Net payable</th></tr></thead><tbody>
  ${woSchedule(w).map(i => { const v = (+w.amount || 0) * (+i.pct || 0) / 100; return `<tr><td>${esc(i.label)}</td><td>${i.month ? monthName(i.month) : ''}</td><td class="n">${esc(i.pct)}</td><td class="n">${nf.format(Math.round(v))}</td><td class="n">${nf.format(Math.round(v * (1 - ((+w.aitPct || 0) + (+w.vdsPct || 0)) / 100)))}</td></tr>`; }).join('')}</tbody></table>
  ${w.payTerms ? `<p class="note">${esc(w.payTerms)}</p>` : ''}
  ${w.terms ? `<h2>Terms</h2><ol style="margin:0;padding-left:5mm;font-size:9pt">${w.terms.split('\n').filter(Boolean).map(l => `<li>${esc(l)}</li>`).join('')}</ol>` : ''}
  <div class="sig"><div><b>${esc(st.signName || '')}</b>${esc(st.signTitle || '')}<br>${esc(p ? entOf(p) : STUDIO.name)}</div><div><b>Accepted by</b>${esc(w.vendor)}<br>Signature and date</div></div>`;
  return docShell(`Work order ${w.no}`, `Work order ${w.no}`, body);
}

/* ----- Payroll (the COO prepares, the Principal approves) ----- */
const monthName = ym => ym ? new Date(ym + '-01T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '';
const SAL_PARTS = [['basic', 'Basic'], ['house', 'House rent'], ['medical', 'Medical'], ['conv', 'Conveyance'], ['other', 'Other allowance']];
const rateAt = (st, ym) => (st.rates || []).filter(r => r.from <= ym).sort((a, b) => b.from.localeCompare(a.from))[0] || null;
const curRate = st => rateAt(st, today().slice(0, 7)) || (st.rates || []).slice().sort((a, b) => a.from.localeCompare(b.from))[0] || null;
const grossOf = r => r ? SAL_PARTS.reduce((t, [k]) => t + (+r[k] || 0), 0) : 0;
const staffOf = id => S.staff.find(t => t.id === id);
const activeStaff = () => S.staff.filter(t => t.active !== false).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
const runLabel = r => r.kind === 'bonus' ? `${r.label || 'Bonus'} ${(r.month || '').slice(0, 4)}` : `${monthName(r.month)} salary`;
const RUN_ST = { draft: 'Draft', submitted: 'Awaiting approval', approved: 'Approved · unpaid', paid: 'Paid' };
const runChip = r => chip({ draft: '', submitted: 'pending', approved: 'unpaid', paid: 'paid' }[r.status || 'draft'], RUN_ST[r.status || 'draft']);
const PAY_LABEL = { cash: 'Cash', bank: 'Bank', split: 'Bank + cash' };
const lineBank = l => { const n = +l.net || 0; return l.method === 'bank' ? n : l.method === 'split' ? Math.min(n, Math.max(0, +l.bankAmt || 0)) : 0; };
function runTotals(r) {
  const t = { gross: 0, net: 0, cash: 0, bank: 0, cashN: 0, bankN: 0, tax: 0, adv: 0 };
  for (const l of r.lines || []) { const n = +l.net || 0, bk = lineBank(l); t.gross += +l.gross || 0; t.net += n; t.tax += +l.tax || 0; t.adv += +l.adv || 0;
    t.bank += bk; t.cash += n - bk; if (bk) t.bankN++; if (n - bk) t.cashN++; }
  return t;
}
const advGiven = id => S.advances.filter(a => a.staffId === id && a.status === 'approved' && a.accountId).reduce((t, a) => t + (+a.amount || 0), 0);
const advRecovered = (id, exceptRun) => S.payruns.filter(r => ['approved', 'paid'].includes(r.status) && r.id !== exceptRun).reduce((t, r) => t + (r.lines || []).filter(l => l.staffId === id).reduce((u, l) => u + (+l.adv || 0), 0), 0);
const advOut = (id, exceptRun) => Math.max(0, advGiven(id) - advRecovered(id, exceptRun));
const advInstall = id => S.advances.filter(a => a.staffId === id && a.status === 'approved' && a.accountId).reduce((t, a) => t + (+a.installment || 0), 0);
const pendingAdv = () => S.advances.filter(a => (a.status || 'pending') === 'pending');
const submittedRuns = () => S.payruns.filter(r => r.status === 'submitted');
function calcLine(l, kind) {
  if (kind === 'bonus') { l.net = Math.max(0, Math.round((+l.gross || 0) - (+l.tax || 0) - (+l.otherDed || 0))); return l; }
  l.leaveDed = Math.round((+l.gross || 0) / 30 * (+l.leaveDays || 0));
  l.net = Math.round((+l.gross || 0) + (+l.extra || 0) - l.leaveDed - (+l.adv || 0) - (+l.tax || 0) - (+l.otherDed || 0));
  return l;
}
function buildLines(kind, ym, opts = {}) {
  const end = monthEnd(ym), start = ym + '-01';
  return activeStaff().filter(t => !t.joinDate || t.joinDate <= end).map(t => {
    const r = rateAt(t, ym) || curRate(t); if (!r) return null;
    const base = { staffId: t.id, name: t.name, designation: t.designation || '', method: t.payMethod || 'cash', bankAmt: t.payMethod === 'split' ? +t.bankPart || 0 : 0, basic: +r.basic || 0 };
    if (kind === 'bonus') return calcLine({ ...base, gross: Math.round((opts.basis === 'gross' ? grossOf(r) : +r.basic || 0) * (+opts.pct || 0) / 100), tax: 0, otherDed: 0 }, 'bonus');
    const lateJoin = t.joinDate && t.joinDate > start ? daysBetween(start, t.joinDate) : 0;
    return calcLine({ ...base, gross: grossOf(r), leaveDays: lateJoin, extra: 0, adv: Math.min(advInstall(t.id), advOut(t.id)), tax: +r.tax || 0, otherDed: 0, note: lateJoin ? `Joined ${fmtShort(t.joinDate)}` : '' }, 'salary');
  }).filter(Boolean);
}
function payrollView() {
  const st = activeStaff(), cm = today().slice(0, 7);
  const monthly = st.reduce((t, x) => t + grossOf(curRate(x)), 0);
  const outAdv = S.staff.reduce((t, x) => t + advOut(x.id), 0);
  const cur = S.payruns.find(r => r.kind === 'salary' && r.month === cm);
  const runs = S.payruns.slice().sort((a, b) => (b.month || '').localeCompare(a.month || '') || (b.createdAt || '').localeCompare(a.createdAt || ''));
  const advs = S.advances.slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const advChip = a => (a.status || 'pending') === 'pending' ? chip('pending', 'Awaiting approval') : a.status === 'rejected' ? chip('rejected', 'Rejected') : !a.accountId ? chip('unpaid', 'Approved · unpaid') : advOut(a.staffId) < 1 ? chip('paid', 'Recovered') : chip('issued', 'Recovering');
  return `
  <div class="head"><div><h2>Payroll</h2><p>Salaries, Eid bonuses and staff advances. ${isPrincipal() ? 'You approve each salary sheet and advance.' : 'Sheets and advances go to the Principal for approval.'} Only the Principal and the COO can see this.</p></div>
    <div class="actions"><button class="btn" data-act="new-staff">Add staff</button><button class="btn" data-act="new-adv" ${S.staff.length ? '' : 'disabled'}>Give advance</button><button class="btn" data-act="new-run" data-v="bonus" ${S.staff.length ? '' : 'disabled'}>Eid bonus</button><button class="btn pri" data-act="new-run" data-v="salary" ${S.staff.length ? '' : 'disabled'}>Salary sheet</button></div></div>
  ${!S.staff.length ? `<div class="panel"><div class="empty"><strong>Add your staff first</strong>Pick each person from SLATE OS (or add someone who isn't in it), with their salary breakdown and whether they're paid in cash or to a bank account. Add the Principal too if they draw a salary; money taken out otherwise is an owner's drawing.
    <div class="actions" style="justify-content:center"><button class="btn pri" data-act="new-staff">Add first staff member</button></div></div></div>` : `
  <div class="kpis">
    <div class="kpi"><div class="lb">Monthly payroll</div><div class="v">${compact(monthly)}</div><div class="s">gross, ${st.length} active staff</div></div>
    <div class="kpi"><div class="lb">${monthName(cm)}</div><div class="v" style="font-size:16px;padding-top:6px">${cur ? RUN_ST[cur.status || 'draft'] : 'No sheet yet'}</div><div class="s">${cur ? tk(runTotals(cur).net) + ' net' : 'start it with Salary sheet'}</div></div>
    <div class="kpi"><div class="lb">Advances out</div><div class="v">${compact(outAdv)}</div><div class="s">still to recover from salaries</div></div>
    <div class="kpi"><div class="lb">Awaiting approval</div><div class="v">${submittedRuns().length + pendingAdv().length}</div><div class="s">${submittedRuns().length + pendingAdv().length ? (isPrincipal() ? '<b class="bad">needs you</b>' : 'with the Principal') : 'nothing waiting'}</div></div>
  </div>`}
  ${runs.length ? `<div class="panel"><div class="ph"><h3>Salary sheets and bonuses</h3><span class="meta">latest first</span></div><div class="rows">${runs.map(r => { const t = runTotals(r);
    return `<button class="row r-inv" data-act="open-run" data-id="${r.id}"><div style="min-width:0"><div class="t">${esc(runLabel(r))}</div><div class="sub">${(r.lines || []).length} staff · ${tk(t.cash)} cash · ${tk(t.bank)} bank</div></div><div class="c2 sub">${r.payDate ? 'Paid ' + fmtShort(r.payDate) : ''}</div>${runChip(r)}<div class="amt">${tk(t.net)}</div></button>`; }).join('')}</div></div>` : ''}
  ${S.staff.length ? `<div class="panel"><div class="ph"><h3>Staff</h3><span class="meta">${st.length} active</span></div><div class="rows">${S.staff.slice().sort((a, b) => (a.active === false) - (b.active === false) || (a.name || '').localeCompare(b.name || '')).map(t => { const ao = advOut(t.id);
    return `<button class="row r-inv" data-act="open-staff" data-id="${t.id}"><div style="min-width:0"><div class="t">${esc(t.name)}</div><div class="sub">${esc(t.designation || '—')} · ${PAY_LABEL[t.payMethod] || 'Cash'}${t.active === false ? ' · inactive' : ''}${ao ? ` · <span class="warnt">advance ${tk(ao)}</span>` : ''}</div></div><div class="c2 sub">${t.joinDate ? 'since ' + fmtShort(t.joinDate) : ''}</div><span></span><div class="amt">${tk(grossOf(curRate(t)))}<small>gross / month</small></div></button>`; }).join('')}</div></div>` : ''}
  ${advs.length ? `<div class="panel"><div class="ph"><h3>Advances and loans</h3></div><div class="rows">${advs.map(a => `<button class="row r-inv" data-act="open-adv" data-id="${a.id}"><div style="min-width:0"><div class="t">${esc((staffOf(a.staffId) || {}).name || 'Staff')}</div><div class="sub">${tk(a.installment)} a month${a.note ? ' · ' + esc(a.note) : ''}</div></div><div class="c2 sub">${fmtDate(a.date)}</div>${advChip(a)}<div class="amt">${tk(a.amount)}</div></button>`).join('')}</div></div>` : ''}`;
}
function staffForm(t) {
  const src = t || { payMethod: 'cash', joinDate: '' }, r = t ? curRate(t) || {} : {};
  const used = new Set(S.staff.map(x => x.userId).filter(Boolean));
  const ppl = S.profiles.filter(p => !used.has(p.id) || p.id === src.userId);
  openSheet(`${sheetHead(t ? 'Edit staff member' : 'Add staff member', t ? esc(t.name) : 'Salary details stay in Finance. The team never sees them.')}
  <form id="sf">
    <label class="f" for="t_user">SLATE OS account<select id="t_user" name="userId"><option value="">Not in SLATE OS (enter the name)</option>${ppl.map(p => opt(p.id, `${p.label || p.full_name}${p.role_label ? ' · ' + p.role_label : ''}`, p.id === src.userId)).join('')}</select></label>
    <div class="fg">
      <label class="f" for="t_name">Name<input id="t_name" name="name" required value="${esc(src.name)}"></label>
      <label class="f" for="t_des">Designation<input id="t_des" name="designation" value="${esc(src.designation)}"></label>
      <label class="f" for="t_join">Joined SLATE <span class="hint">(only for someone joining this month or later)</span><input id="t_join" name="joinDate" type="date" value="${esc(src.joinDate)}"></label>
      <label class="f" for="t_pay">Salary paid<select id="t_pay" name="payMethod">${opt('cash', 'In cash', !['bank', 'split'].includes(src.payMethod))}${opt('bank', 'To bank account', src.payMethod === 'bank')}${opt('split', 'Part to bank, rest in cash', src.payMethod === 'split')}</select></label>
    </div>
    <div class="fg" id="tBankWrap"><label class="f" for="t_bank">Their bank account (bank, last 4 digits)<input id="t_bank" name="bankInfo" value="${esc(src.bankInfo)}" placeholder="e.g. BRAC Bank · 4417"></label>
      <label class="f" for="t_bpart" id="tPartWrap">Paid to bank each month (rest in cash)<input id="t_bpart" name="bankPart" type="number" min="0" step="1" value="${esc(src.bankPart ?? '')}"></label></div>
    <div class="sec-t">Monthly salary (BDT)</div>
    <div class="fg">${SAL_PARTS.map(([k, l]) => `<label class="f" for="t_${k}">${l}<input id="t_${k}" name="${k}" type="number" min="0" step="1" value="${esc(r[k] ?? '')}"></label>`).join('')}
      <label class="f" for="t_tax">Tax deducted each month<input id="t_tax" name="tax" type="number" min="0" step="1" value="${esc(r.tax ?? 0)}"></label></div>
    <div class="fg"><label class="f" for="t_from">${t ? 'New salary applies from' : 'Salary starts from'}<input id="t_from" name="from" type="month" required value="${today().slice(0, 7)}"></label><div></div></div>
    <dl class="kv" id="tTot"></dl>
    ${t ? `<label class="check" for="t_act"><input id="t_act" name="active" type="checkbox" ${t.active !== false ? 'checked' : ''}> Active <span class="hint">(untick when someone leaves; their history stays)</span></label>` : ''}
    <label class="f" for="t_note">Notes<input id="t_note" name="note" value="${esc(src.note)}"></label>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">${t ? 'Save' : 'Add staff member'}</button></div>
  </form>`, root => {
    const f = $('#sf', root);
    const upd = () => { $('#tBankWrap', root).hidden = f.payMethod.value === 'cash'; $('#tPartWrap', root).hidden = f.payMethod.value !== 'split'; const g = SAL_PARTS.reduce((a, [k]) => a + (+f[k].value || 0), 0);
      $('#tTot', root).innerHTML = `<dt class="tot">Gross a month</dt><dd class="tot">${tk(g)}</dd><dt>Take-home before deductions</dt><dd>${tk(g - (+f.tax.value || 0))}</dd>`; };
    f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
    f.userId.addEventListener('change', () => { const p = S.profiles.find(x => x.id === f.userId.value); if (p) { f.name.value = p.full_name || p.label || ''; if (!f.designation.value) f.designation.value = p.role_label || ''; } });
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const nr = { from: f.from.value, tax: +f.tax.value || 0 }; SAL_PARTS.forEach(([k]) => nr[k] = +f[k].value || 0);
      if (!grossOf(nr)) { toast('Enter the salary.'); return; }
      if (f.payMethod.value === 'split' && !(+f.bankPart.value > 0)) { toast('Enter how much goes to the bank each month.'); return; }
      let rates = t ? (t.rates || []).slice() : [];
      const same = r && SAL_PARTS.every(([k]) => (+r[k] || 0) === nr[k]) && (+r.tax || 0) === nr.tax;
      if (!t || !same) { rates = rates.filter(x => x.from !== nr.from); rates.push(nr); rates.sort((a, b) => a.from.localeCompare(b.from)); }
      const data = { userId: f.userId.value, name: f.name.value.trim(), designation: f.designation.value.trim(), joinDate: f.joinDate.value, payMethod: f.payMethod.value,
        bankInfo: f.payMethod.value !== 'cash' ? f.bankInfo.value.trim() : '', bankPart: f.payMethod.value === 'split' ? +f.bankPart.value || 0 : 0, rates, active: t ? f.active.checked : true, note: f.note.value.trim() };
      const ok = t ? await run(() => putDoc('staff', t.id, { ...strip(t), ...data }), 'Saved') : await run(() => addDoc('staff', data), 'Staff member added');
      if (ok) closeSheet(); });
  });
}
function staffSheet(t) {
  const lines = S.payruns.filter(r => r.status === 'paid').flatMap(r => (r.lines || []).filter(l => l.staffId === t.id).map(l => ({ r, l }))).sort((a, b) => (b.r.month || '').localeCompare(a.r.month || ''));
  const advs = S.advances.filter(a => a.staffId === t.id);
  openSheet(`${sheetHead(t.name, `${esc(t.designation || '')}${t.userId ? ' · in SLATE OS' : ''}${t.active === false ? ' · inactive' : ''}`)}
    <dl class="kv"><dt>Joined</dt><dd class="txt">${fmtDate(t.joinDate)}</dd><dt>Paid</dt><dd class="txt">${t.payMethod === 'bank' ? 'To bank' + (t.bankInfo ? ' · ' + esc(t.bankInfo) : '') : t.payMethod === 'split' ? `${tk(t.bankPart)} to bank${t.bankInfo ? ' (' + esc(t.bankInfo) + ')' : ''}, rest in cash` : 'In cash'}</dd>
      ${SAL_PARTS.map(([k, l]) => { const v = +(curRate(t) || {})[k] || 0; return v ? `<dt>${l}</dt><dd>${tk(v)}</dd>` : ''; }).join('')}
      <dt class="tot">Gross a month</dt><dd class="tot">${tk(grossOf(curRate(t)))}</dd>${+(curRate(t) || {}).tax ? `<dt>Tax deducted</dt><dd>${tk(curRate(t).tax)}</dd>` : ''}
      ${advOut(t.id) ? `<dt>Advance still to recover</dt><dd style="color:var(--warn)">${tk(advOut(t.id))}</dd>` : ''}</dl>
    ${(t.rates || []).length > 1 ? `<div class="sec-t" style="margin-top:18px">Salary history</div><div class="mini-list rows" style="margin-top:10px">${t.rates.slice().reverse().map(r => `<div class="row r-mini" style="cursor:default"><div class="t">From ${monthName(r.from)}</div><span></span><div class="amt">${tk(grossOf(r))}</div></div>`).join('')}</div>` : ''}
    ${lines.length ? `<div class="sec-t" style="margin-top:18px">Paid</div><div class="mini-list rows" style="margin-top:10px">${lines.slice(0, 12).map(({ r, l }) => `<button class="row r-mini" data-act="doc-slip" data-id="${r.id}" data-staff="${t.id}"><div style="min-width:0"><div class="t">${esc(runLabel(r))}</div><div class="sub">Payslip</div></div><span></span><div class="amt">${tk(l.net)}</div></button>`).join('')}</div>` : ''}
    ${advs.length ? `<div class="sec-t" style="margin-top:18px">Advances</div><div class="mini-list rows" style="margin-top:10px">${advs.map(a => `<button class="row r-mini" data-act="open-adv" data-id="${a.id}"><div style="min-width:0"><div class="t">${fmtDate(a.date)}</div><div class="sub">${tk(a.installment)} a month</div></div><span></span><div class="amt">${tk(a.amount)}</div></button>`).join('')}</div>` : ''}
    ${t.note ? `<p class="hint">${esc(t.note)}</p>` : ''}
    <div class="foot">${!lines.length && !advs.length && !S.payruns.some(r => (r.lines || []).some(l => l.staffId === t.id)) ? `<button class="btn danger" data-act="del-staff" data-id="${t.id}">Delete</button>` : ''}<button class="btn" data-act="edit-staff" data-id="${t.id}">Edit</button><button class="btn pri" data-act="new-adv" data-staff="${t.id}">Give advance</button></div>`);
}
function advanceForm(staffId) {
  const st = activeStaff(); if (!st.length) { toast('Add staff first.'); return; }
  const accts = activeAccts();
  openSheet(`${sheetHead('Advance or loan', isPrincipal() ? 'You can pay it straight away.' : 'It goes to the Principal for approval before it is paid.')}
  <form id="af2">
    <label class="f" for="v_st">Staff member<select id="v_st" name="staffId">${st.map(t => opt(t.id, `${t.name}${advOut(t.id) ? ' · ' + tk(advOut(t.id)) + ' still out' : ''}`, t.id === staffId)).join('')}</select></label>
    <div class="fg">
      <label class="f" for="v_date">Date<input id="v_date" name="date" type="date" required value="${today()}"></label>
      <label class="f" for="v_amt">Amount (BDT)<input id="v_amt" name="amount" type="number" min="1" step="1" required></label>
      <label class="f" for="v_in">Recover each month<input id="v_in" name="installment" type="number" min="1" step="1" required></label>
      <label class="f" for="v_note">Reason<input id="v_note" name="note"></label>
    </div>
    <p class="hint" id="vHint"></p>
    ${isPrincipal() && accts.length ? `<label class="check" for="v_paid"><input id="v_paid" type="checkbox" checked> Paid now from <select name="accountId" style="margin-left:6px">${accts.map(a => opt(a.id, `${a.name} · ${tk(acctBal(a, today()))}`, a.kind === 'cash')).join('')}</select></label>` : ''}
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">${isPrincipal() ? 'Save advance' : 'Send for approval'}</button></div>
  </form>`, root => {
    const f = $('#af2', root);
    const upd = () => { const a = +f.amount.value || 0, i = +f.installment.value || 0; $('#vHint', root).textContent = a && i ? `Recovered over ${Math.ceil(a / i)} month${Math.ceil(a / i) === 1 ? '' : 's'} of salary.` : ''; };
    f.addEventListener('input', e => { if (e.target === f.amount && !f.installment.dataset.touched) f.installment.value = Math.ceil((+f.amount.value || 0) / 3) || ''; if (e.target === f.installment) f.installment.dataset.touched = '1'; upd(); });
    f.addEventListener('submit', async ev => { ev.preventDefault();
      if ((+f.installment.value || 0) > (+f.amount.value || 0)) { toast('The monthly recovery can’t be more than the advance.'); return; }
      const paid = isPrincipal() && f.querySelector('#v_paid')?.checked;
      const data = { staffId: f.staffId.value, date: f.date.value, amount: +f.amount.value || 0, installment: +f.installment.value || 0, note: f.note.value.trim(),
        status: isPrincipal() ? 'approved' : 'pending', ...(isPrincipal() ? { decidedBy: S.uid, decidedOn: today() } : {}), ...(paid ? { accountId: f.accountId.value, paidOn: f.date.value } : {}) };
      if (paid) { const a = acct(data.accountId); if (a && data.paidOn < a.openingDate) { toast(`${a.name} starts on ${fmtDate(a.openingDate)}.`); return; } }
      if (await run(() => addDoc('advances', data), isPrincipal() ? 'Advance saved' : 'Sent to the Principal for approval')) closeSheet(); });
  });
}
function advanceSheet(a) {
  const t = staffOf(a.staffId) || {}, st = a.status || 'pending', lk = locked(a.date) || locked(a.paidOn), acc = acct(a.accountId);
  openSheet(`${sheetHead('Advance · ' + (t.name || ''), fmtDate(a.date))}
    <dl class="kv"><dt class="tot">Amount</dt><dd class="tot">${tk(a.amount)}</dd><dt>Recovered each month</dt><dd>${tk(a.installment)}</dd>
      <dt>Paid</dt><dd class="txt">${acc ? `${fmtDate(a.paidOn)} from ${esc(acc.name)}` : 'Not yet'}</dd>
      <dt>${esc(t.name || 'Staff')} still owes (all advances)</dt><dd>${tk(advOut(a.staffId))}</dd>
      ${st !== 'pending' ? `<dt>${st === 'approved' ? 'Approved' : 'Rejected'}</dt><dd class="txt">${who(a.decidedBy)}${a.decidedOn ? ', ' + fmtDate(a.decidedOn) : ''}${a.rejectReason ? ' · ' + esc(a.rejectReason) : ''}</dd>` : ''}</dl>
    ${a.note ? `<p class="hint" style="margin-top:10px">${esc(a.note)}</p>` : ''}
    <p class="hint">Recorded by ${who(a.createdBy)} · ${fmtWhen(a.createdAt)}</p>
    <div class="foot">
      ${!lk && (st === 'pending' || isPrincipal()) && !advRecovered(a.staffId) ? `<button class="btn danger" data-act="del-adv" data-id="${a.id}">Delete</button>` : ''}
      ${isPrincipal() && st === 'pending' ? `<button class="btn danger" data-act="reject-adv" data-id="${a.id}">Reject</button><button class="btn pri" data-act="approve-adv" data-id="${a.id}">Approve</button>` : ''}
      ${st === 'approved' && !a.accountId && !lk ? `<button class="btn pri" data-act="pay-adv" data-id="${a.id}">Record payment</button>` : ''}
    </div>`);
}
function payAdvForm(a) {
  const accts = activeAccts(); if (!accts.length) { toast('Add the vault and bank under Cash & bank first.'); return; }
  openSheet(`${sheetHead('Pay advance', `${esc((staffOf(a.staffId) || {}).name || '')} · ${tk(a.amount)}`)}
  <form id="paf"><div class="fg"><label class="f" for="pa_acct">Paid from<select id="pa_acct" name="accountId">${accts.map(x => opt(x.id, `${x.name} · ${tk(acctBal(x, today()))}`, x.kind === 'cash')).join('')}</select></label>
    <label class="f" for="pa_d">Paid on<input id="pa_d" name="paidOn" type="date" required value="${today()}"></label></div>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Record payment</button></div></form>`, root => {
    $('#paf', root).addEventListener('submit', async ev => { ev.preventDefault(); const f = ev.target, x = acct(f.accountId.value);
      if (x && f.paidOn.value < x.openingDate) { toast(`${x.name} starts on ${fmtDate(x.openingDate)}.`); return; }
      if (await run(() => putDoc('advances', a.id, { ...strip(a), accountId: f.accountId.value, paidOn: f.paidOn.value }), 'Advance paid')) advanceSheet(S.advances.find(x => x.id === a.id) || a); });
  });
}
function rejectAdvForm(a) {
  openSheet(`${sheetHead('Reject advance', esc((staffOf(a.staffId) || {}).name || ''))}
  <form id="rja"><label class="f" for="ra_r">Reason<input id="ra_r" name="r" required></label>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn danger" type="submit">Reject</button></div></form>`, root => {
    $('#rja', root).addEventListener('submit', async ev => { ev.preventDefault();
      if (await run(() => putDoc('advances', a.id, { ...strip(a), status: 'rejected', rejectReason: ev.target.r.value.trim(), decidedBy: S.uid, decidedOn: today() }), 'Advance rejected')) closeSheet(); });
  });
}
function newRunForm(kind) {
  if (!activeStaff().length) { toast('Add staff first.'); return; }
  const cm = today().slice(0, 7), taken = new Set(S.payruns.filter(r => r.kind === 'salary').map(r => r.month));
  let ym = cm; if (kind === 'salary' && taken.has(cm)) { const d = new Date(cm + '-01T00:00:00'); d.setMonth(d.getMonth() + 1); ym = iso(d).slice(0, 7); }
  openSheet(`${sheetHead(kind === 'bonus' ? 'Eid bonus' : 'New salary sheet', kind === 'bonus' ? 'Starts from each person’s salary; you can change any amount before submitting.' : 'Fills in every active staff member from their salary for that month, with advance recovery and tax. Adjust leave and allowances on the sheet.')}
  <form id="nr">
    <div class="fg">
      ${kind === 'bonus' ? `<label class="f" for="n_lbl">Bonus<select id="n_lbl" name="label">${['Eid-ul-Fitr bonus', 'Eid-ul-Adha bonus', 'Puja bonus', 'Year-end bonus', 'Other bonus'].map(x => opt(x, x)).join('')}</select></label>` : ''}
      <label class="f" for="n_m">${kind === 'bonus' ? 'Paid with month' : 'Month'}<input id="n_m" name="month" type="month" required value="${ym}"></label>
      ${kind === 'bonus' ? `<label class="f" for="n_b">Based on<select id="n_b" name="basis">${opt('basic', 'Basic salary', true)}${opt('gross', 'Gross salary')}</select></label>
      <label class="f" for="n_p">Percent of it<input id="n_p" name="pct" type="number" min="0" max="300" step="1" value="100"></label>` : ''}
    </div>
    <p class="hint err" id="nHint"></p>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Prepare sheet</button></div>
  </form>`, root => {
    const f = $('#nr', root);
    const upd = () => { $('#nHint', root).textContent = kind === 'salary' && taken.has(f.month.value) ? `${monthName(f.month.value)} already has a salary sheet. Open it from the list.` : locked(f.month.value + '-01') ? 'That financial year is closed.' : ''; };
    f.addEventListener('input', upd); upd();
    f.addEventListener('submit', async ev => { ev.preventDefault(); if ($('#nHint', root).textContent) { toast($('#nHint', root).textContent); return; }
      const month = f.month.value, opts = kind === 'bonus' ? { basis: f.basis.value, pct: +f.pct.value || 0 } : {};
      const lines = buildLines(kind, month, opts);
      if (!lines.length) { toast('No active staff were on payroll in that month.'); return; }
      const data = { kind, month, label: kind === 'bonus' ? f.label.value : '', basis: opts.basis || '', pct: opts.pct || 0, lines, status: 'draft' };
      const id = kind === 'salary' ? 'S' + month.replace('-', '') : 'B' + newId().slice(0, 12);
      if (await run(() => setDoc('payruns', id, data, false), 'Sheet prepared')) { const r = S.payruns.find(x => x.id === id); if (r) runSheet(r); } });
  });
}
function runSheet(r) {
  const st = r.status || 'draft', bonus = r.kind === 'bonus', lk = locked(r.month + '-01') || locked(r.payDate);
  const editable = !lk && (st === 'draft' || (st === 'submitted' && isPrincipal()));
  const L = JSON.parse(JSON.stringify(r.lines || []));
  const num = (i, k, v) => `<input type="number" step="1" min="0" data-li="${i}" data-k="${k}" value="${esc(v ?? 0)}" aria-label="${k}" style="width:100%;min-width:0;background:var(--bg);border:1px solid var(--line);border-radius:4px;padding:5px 6px;font-family:var(--f-mono);font-size:13px">`;
  const lineHtml = (l, i) => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;cursor:default;align-items:start" data-line="${i}">
    <div style="min-width:0"><div class="t">${esc(l.name)} <span class="sub" style="font-weight:400">· ${esc(l.designation || '')} · ${PAY_LABEL[l.method] || 'Cash'}</span></div>
      ${editable ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(78px,1fr));gap:6px;margin-top:6px;font-size:11px;color:var(--muted)">
        ${bonus ? `<label>Bonus${num(i, 'gross', l.gross)}</label><label>Tax${num(i, 'tax', l.tax)}</label><label>Other ded.${num(i, 'otherDed', l.otherDed)}</label>`
          : `<label>Leave days${num(i, 'leaveDays', l.leaveDays)}</label><label>Allowance / OT${num(i, 'extra', l.extra)}</label><label>Advance${num(i, 'adv', l.adv)}</label><label>Tax${num(i, 'tax', l.tax)}</label><label>Other ded.${num(i, 'otherDed', l.otherDed)}</label>`}${l.method === 'split' ? `<label>To bank${num(i, 'bankAmt', l.bankAmt)}</label>` : ''}</div>`
        : `<div class="sub" style="white-space:normal">${bonus ? `Bonus ${tk(l.gross)}` : `Gross ${tk(l.gross)}${+l.leaveDays ? ` · ${l.leaveDays} leave day${+l.leaveDays === 1 ? '' : 's'} − ${tk(l.leaveDed)}` : ''}${+l.extra ? ` · + ${tk(l.extra)}` : ''}${+l.adv ? ` · advance − ${tk(l.adv)}` : ''}`}${+l.tax ? ` · tax − ${tk(l.tax)}` : ''}${+l.otherDed ? ` · other − ${tk(l.otherDed)}` : ''}</div>`}
      ${l.method === 'split' ? `<div class="sub" data-split="${i}">${tk(lineBank(l))} bank · ${tk((+l.net || 0) - lineBank(l))} cash</div>` : ''}
      ${l.note ? `<div class="sub">${esc(l.note)}</div>` : ''}</div>
    <div class="amt" data-net="${i}">${tk(l.net)}${!bonus ? `<small>of ${tk(l.gross)}</small>` : ''}</div></div>`;
  const totHtml = () => { const t = runTotals({ lines: L }); return `<dt>Staff</dt><dd>${L.length}</dd>${!bonus ? `<dt>Gross</dt><dd>${tk(t.gross)}</dd><dt>Advances recovered</dt><dd>${tk(t.adv)}</dd>` : ''}<dt>Tax withheld</dt><dd>${tk(t.tax)}</dd><dt>Cash to pay</dt><dd>${tk(t.cash)}</dd><dt>Bank to pay</dt><dd>${tk(t.bank)}</dd><dt class="tot">Net payable</dt><dd class="tot">${tk(t.net)}</dd>`; };
  const save = status => run(() => putDoc('payruns', r.id, { ...strip(r), lines: L, status, ...(status === 'approved' ? { decidedBy: S.uid, decidedOn: today() } : {}) }),
    { draft: 'Sheet saved', submitted: 'Sent to the Principal for approval', approved: 'Sheet approved' }[status]);
  openSheet(`${sheetHead(runLabel(r), `${bonus ? (r.basis === 'gross' ? 'Gross' : 'Basic') + ' × ' + r.pct + '%' : 'Leave is deducted at gross ÷ 30 a day'}${r.payDate ? ' · paid ' + fmtDate(r.payDate) : ''}`)}
    <div style="display:flex;gap:8px;align-items:center;margin:-6px 0 12px;flex-wrap:wrap">${runChip(r)}${lk ? chip('', 'FY closed') : ''}${r.decidedBy ? `<span class="hint">Approved by ${who(r.decidedBy)}${r.decidedOn ? ', ' + fmtDate(r.decidedOn) : ''}</span>` : ''}</div>
    <div class="mini-list rows" id="runLines">${L.map(lineHtml).join('')}</div>
    <dl class="kv" id="runTot" style="margin-top:14px">${totHtml()}</dl>
    <p class="hint">Prepared by ${who(r.createdBy)} · ${fmtWhen(r.createdAt)}${r.cashAccountId || r.bankAccountId ? ` · paid from ${[acct(r.cashAccountId), acct(r.bankAccountId)].filter(Boolean).map(a => esc(a.name)).join(' and ')}` : ''}</p>
    <div class="foot">
      <button class="btn" data-act="doc-run" data-id="${r.id}">${st === 'paid' ? 'Print sheet' : 'Preview sheet'}</button>
      ${st === 'paid' ? `<button class="btn" data-act="doc-slip" data-id="${r.id}">Payslips</button>` : ''}
      ${!lk && (['draft', 'submitted'].includes(st) || (isPrincipal() && st === 'approved')) ? `<button class="btn danger" data-act="del-run" data-id="${r.id}">Delete</button>` : ''}
      ${editable ? `<button class="btn" type="button" id="runSave">Save</button>` : ''}
      ${editable && st === 'draft' && !isPrincipal() ? `<button class="btn pri" type="button" id="runSubmit">Submit for approval</button>` : ''}
      ${editable && isPrincipal() ? `<button class="btn pri" type="button" id="runApprove">Approve</button>` : ''}
      ${!lk && isPrincipal() && st === 'approved' ? `<button class="btn" data-act="reopen-run" data-id="${r.id}">Reopen</button>` : ''}
      ${!lk && st === 'approved' ? `<button class="btn pri" data-act="pay-run" data-id="${r.id}">Record payment</button>` : ''}
      ${!lk && isPrincipal() && st === 'paid' ? `<button class="btn" data-act="unpay-run" data-id="${r.id}">Mark unpaid</button>` : ''}
    </div>`, root => {
    root.addEventListener('input', e => { const x = e.target.closest('[data-li]'); if (!x) return; const l = L[+x.dataset.li]; l[x.dataset.k] = +x.value || 0; calcLine(l, r.kind);
      const n = $(`[data-net="${x.dataset.li}"]`, root); n.innerHTML = `${tk(l.net)}${!bonus ? `<small>of ${tk(l.gross)}</small>` : ''}`; n.style.color = l.net < 0 ? 'var(--bad)' : ''; const sp = $(`[data-split="${x.dataset.li}"]`, root); if (sp) sp.textContent = `${tk(lineBank(l))} bank · ${tk((+l.net || 0) - lineBank(l))} cash`; $('#runTot', root).innerHTML = totHtml(); });
    const go = async status => { if (L.some(l => l.net < 0)) { toast('Someone would be paid less than zero. Reduce their deductions.'); return; }
      for (const l of L) { if (+l.adv > advOut(l.staffId, r.id) + 1) { toast(`${l.name}'s advance recovery is more than they still owe (${tk(advOut(l.staffId, r.id))}).`); return; } }
      if (await save(status)) { const nr = S.payruns.find(x => x.id === r.id); if (nr) runSheet(nr); } };
    $('#runSave', root)?.addEventListener('click', () => go(st));
    $('#runSubmit', root)?.addEventListener('click', () => go('submitted'));
    $('#runApprove', root)?.addEventListener('click', () => go('approved'));
  });
}
function payRunForm(r) {
  const accts = activeAccts(); if (!accts.length) { toast('Add the vault and bank under Cash & bank first.'); return; }
  const t = runTotals(r), cashA = accts.find(a => a.kind === 'cash') || accts[0], bankA = accts.find(a => a.kind === 'bank') || accts[0];
  openSheet(`${sheetHead('Pay ' + runLabel(r), `${tk(t.net)} to ${(r.lines || []).filter(l => +l.net).length} staff`)}
  <form id="prf"><div class="fg">
    <label class="f" for="pr_d">Paid on<input id="pr_d" name="payDate" type="date" required value="${today()}"></label>
    <label class="f" for="pr_ref">Reference<input id="pr_ref" name="payRef" placeholder="Bank batch / cheque no."></label>
    ${t.cash ? `<label class="f" for="pr_c">Cash salaries (${tk(t.cash)}) from<select id="pr_c" name="cashAccountId">${accts.map(a => opt(a.id, `${a.name} · ${tk(acctBal(a, today()))}`, a.id === cashA.id)).join('')}</select></label>` : ''}
    ${t.bank ? `<label class="f" for="pr_b">Bank salaries (${tk(t.bank)}) from<select id="pr_b" name="bankAccountId">${accts.map(a => opt(a.id, `${a.name} · ${tk(acctBal(a, today()))}`, a.id === bankA.id)).join('')}</select></label>` : ''}
  </div><p class="hint">Paying marks the sheet final. Payslips are ready to print right after.</p>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Mark as paid</button></div></form>`, root => {
    $('#prf', root).addEventListener('submit', async ev => { ev.preventDefault(); const f = ev.target;
      const ids = [f.cashAccountId?.value, f.bankAccountId?.value].filter(Boolean), late = ids.map(acct).find(a => a && f.payDate.value < a.openingDate);
      if (late) { toast(`${late.name} starts on ${fmtDate(late.openingDate)}.`); return; }
      if (await run(() => putDoc('payruns', r.id, { ...strip(r), status: 'paid', payDate: f.payDate.value, payRef: f.payRef.value.trim(), cashAccountId: f.cashAccountId?.value || '', bankAccountId: f.bankAccountId?.value || '' }), 'Salaries paid')) runSheet(S.payruns.find(x => x.id === r.id) || r); });
  });
}
function runDoc(r) {
  const bonus = r.kind === 'bonus', t = runTotals(r), n = v => nf.format(Math.round(+v || 0)), draft = r.status !== 'paid' && r.status !== 'approved';
  const body = `<h1>${bonus ? esc(r.label || 'Bonus') : 'Salary sheet'}${draft ? ' <span class="dr">Draft</span>' : ''}</h1>
  <div class="ref"><span>${bonus ? 'Paid with' : 'Month'} <b>${monthName(r.month)}</b></span>${r.payDate ? `<span>Paid <b>${fmtDate(r.payDate)}</b></span>` : ''}<span>Staff <b>${(r.lines || []).length}</b></span></div>
  <table style="font-size:8.5pt"><thead><tr><th>#</th><th>Name</th><th class="n">${bonus ? 'Bonus' : 'Gross'}</th>${bonus ? '' : '<th class="n">Leave</th><th class="n">Add.</th><th class="n">Adv.</th>'}<th class="n">Tax</th><th class="n">Other</th><th class="n">Net</th><th style="padding-left:4mm">Paid</th><th style="width:22mm">Signature</th></tr></thead><tbody>
  ${(r.lines || []).map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.name)}<br><span style="color:#5F6670;font-size:7.5pt">${esc(l.designation || '')}</span></td><td class="n">${n(l.gross)}</td>${bonus ? '' : `<td class="n">${+l.leaveDed ? n(l.leaveDed) : '–'}</td><td class="n">${+l.extra ? n(l.extra) : '–'}</td><td class="n">${+l.adv ? n(l.adv) : '–'}</td>`}<td class="n">${+l.tax ? n(l.tax) : '–'}</td><td class="n">${+l.otherDed ? n(l.otherDed) : '–'}</td><td class="n"><b>${n(l.net)}</b></td><td style="padding-left:4mm">${l.method === 'split' ? `Bank ${n(lineBank(l))}<br>Cash ${n((+l.net || 0) - lineBank(l))}` : l.method === 'bank' ? 'Bank' : 'Cash'}</td><td></td></tr>`).join('')}
  <tr class="tot"><td></td><td>Total</td><td class="n">${n(t.gross)}</td>${bonus ? '' : `<td></td><td></td><td class="n">${n(t.adv)}</td>`}<td class="n">${n(t.tax)}</td><td></td><td class="n">${n(t.net)}</td><td></td><td></td></tr></tbody></table>
  <p class="words">Net payable: ${esc(takaWords(t.net))} · cash ${n(t.cash)} · bank ${n(t.bank)}</p>
  <div class="sig"><div><b>Prepared by</b>${esc(S.people[r.createdBy] || 'COO')}</div><div><b>Approved by</b>${r.decidedBy ? esc(S.people[r.decidedBy] || 'Principal') : 'Principal'}</div></div>`;
  return docShell(runLabel(r), runLabel(r), body);
}
function slipsDoc(r, staffId) {
  const bonus = r.kind === 'bonus', n = v => nf.format(Math.round(+v || 0));
  const pages = (r.lines || []).filter(l => !staffId || l.staffId === staffId).map(l => `<h1>Payslip</h1>
  <div class="ref"><span>${esc(runLabel(r))}</span>${r.payDate ? `<span>Paid <b>${fmtDate(r.payDate)}</b></span>` : ''}</div>
  <div class="to"><b>${esc(l.name)}</b>${esc(l.designation || '')}<br>${l.method === 'bank' ? 'Paid to bank account' + ((staffOf(l.staffId) || {}).bankInfo ? ' · ' + esc(staffOf(l.staffId).bankInfo) : '') : l.method === 'split' ? `BDT ${n(lineBank(l))} to bank${(staffOf(l.staffId) || {}).bankInfo ? ' (' + esc(staffOf(l.staffId).bankInfo) + ')' : ''} · BDT ${n((+l.net || 0) - lineBank(l))} in cash` : 'Paid in cash'}</div>
  <table><tbody>
    <tr><td>${bonus ? esc(r.label || 'Bonus') : 'Gross salary'}</td><td class="n">${n(l.gross)}</td></tr>
    ${!bonus && +l.extra ? `<tr><td>Allowance / overtime</td><td class="n">${n(l.extra)}</td></tr>` : ''}
    ${!bonus && +l.leaveDed ? `<tr class="sub"><td>Unpaid leave (${l.leaveDays} day${+l.leaveDays === 1 ? '' : 's'})</td><td class="n">− ${n(l.leaveDed)}</td></tr>` : ''}
    ${!bonus && +l.adv ? `<tr class="sub"><td>Advance recovered</td><td class="n">− ${n(l.adv)}</td></tr>` : ''}
    ${+l.tax ? `<tr class="sub"><td>Tax deducted at source</td><td class="n">− ${n(l.tax)}</td></tr>` : ''}
    ${+l.otherDed ? `<tr class="sub"><td>Other deduction</td><td class="n">− ${n(l.otherDed)}</td></tr>` : ''}
    <tr class="tot"><td>Net paid</td><td class="n">${n(l.net)}</td></tr></tbody></table>
  <p class="words">In words: ${esc(takaWords(l.net))}</p>
  ${!bonus && advOut(l.staffId) ? `<p class="note">Advance still to recover after this: BDT ${n(advOut(l.staffId))}</p>` : ''}
  <div class="sig"><div><b>For ${esc(STUDIO.name)}</b>${esc(S.settings.signName || '')}</div><div><b>Received by</b>${esc(l.name)}</div></div>`);
  return docShell(`Payslips · ${runLabel(r)}`, runLabel(r), pages[0] || '', pages.slice(1));
}

/* ----- Petty cash (imprest: a fixed float, topped back up from the vault) ----- */
const PETTY_CATS = ['Transport & site visits', 'Printing & plotting', 'Office supplies', 'Client meetings & entertainment', 'Staff welfare', 'Repairs & maintenance', 'Utilities', 'Other'];
const pettyBox = () => S.accounts.filter(a => a.kind === 'petty' && a.active !== false)[0] || null;
function pettyView() {
  const box = pettyBox(), t = today(), mo = S.f.pettyMonth || t.slice(0, 7);
  if (!box) return `
  <div class="head"><div><h2>Petty cash</h2><p>Small day-to-day spending from a cash box with a fixed float.</p></div></div>
  <div class="panel"><div class="empty"><strong>Set up the petty cash box</strong>Choose the float, the fixed amount the box is kept at (for example ৳10,000), and count what's in it now. Bills are recorded against the box and go to the Principal for approval like any expense. When it runs low, top it back up to the float from the office vault.
    <div class="actions" style="justify-content:center"><button class="btn pri" data-act="new-acct" data-v="petty">Set up petty cash</button></div></div></div>`;
  const bal = acctBal(box, t), fl = +box.float || 0, low = fl && bal < fl * 0.25;
  const bills = S.expenses.filter(x => x.accountId === box.id);
  const spentMo = bills.filter(x => (x.paidOn || x.date || '').startsWith(t.slice(0, 7)) && x.status !== 'rejected').reduce((u, x) => u + (+x.amount || 0), 0);
  const pend = bills.filter(x => (x.status || 'pending') === 'pending');
  const all = acctEntries(box), start = mo + '-01', end = monthEnd(mo);
  const opening = all.filter(e => e.date < start).reduce((u, e) => u + e.amt, +box.opening || 0);
  const rows = all.filter(e => e.date >= start && e.date <= end);
  const months = [...new Set([t.slice(0, 7), ...all.map(e => (e.date || '').slice(0, 7))])].filter(Boolean).sort().reverse();
  let run = opening;
  const lines = rows.map(e => { run += e.amt; return { ...e, bal: run }; }).reverse();
  const rc = S.recons.find(r => r.accountId === box.id && r.month === mo);
  return `
  <div class="head"><div><h2>Petty cash</h2><p>${esc(box.name)}${box.note ? ' · ' + esc(box.note) : ''}. Bills go to the Principal for approval; top-ups come from the office vault.</p></div>
    <div class="actions"><button class="btn" data-act="petty-statement">Statement</button><button class="btn" data-act="recon-acct" data-id="${box.id}">Count the box</button>${isPrincipal() && pend.length ? `<button class="btn" data-act="approve-all" data-id="${box.id}">Approve all ${pend.length}</button>` : ''}<button class="btn" data-act="petty-topup">Top up</button><button class="btn pri" data-act="petty-bills">Record bills</button></div></div>
  <div class="kpis">
    <div class="kpi"><div class="lb">In the box</div><div class="v" style="${bal < 0 ? 'color:var(--bad)' : ''}">${tk(bal)}</div><div class="s">${low ? '<b class="bad">running low · top it up</b>' : fl ? `of a ${tk(fl)} float` : 'no float set'}</div></div>
    <div class="kpi"><div class="lb">Top-up needed</div><div class="v">${tk(Math.max(0, fl - bal))}</div><div class="s">to bring it back to the float</div></div>
    <div class="kpi"><div class="lb">Spent this month</div><div class="v">${compact(spentMo)}</div><div class="s">${monthName(t.slice(0, 7))}</div></div>
    <div class="kpi"><div class="lb">Awaiting approval</div><div class="v">${pend.length}</div><div class="s">${pend.length ? `${tk(pend.reduce((u, x) => u + (+x.amount || 0), 0))}${isPrincipal() ? ' · <b class="bad">needs you</b>' : ' with the Principal'}` : 'nothing waiting'}</div></div>
  </div>
  <div class="filters"><select id="pettyMonth" aria-label="Month">${months.map(m => opt(m, monthName(m), m === mo)).join('')}</select>
    <span class="hint">Opening ${tk(opening)} · in ${tk(rows.filter(e => e.amt > 0).reduce((u, e) => u + e.amt, 0))} · out ${tk(-rows.filter(e => e.amt < 0).reduce((u, e) => u + e.amt, 0))} · closing ${tk(run)}${rc ? ` · counted ${tk(rc.actual)}${Math.abs(+rc.diff || 0) < 1 ? ' ✓' : ` (${rc.diff > 0 ? 'short' : 'over'} ${tk(Math.abs(rc.diff))})`}` : ''}</span></div>
  <div class="panel"><div class="ph"><h3>Book · ${monthName(mo)}</h3><span class="meta">latest first</span></div>
    ${lines.length ? `<div class="rows">${lines.map(e => { const x = e.kind === 'expense' ? S.expenses.find(b => b.id === e.id) : null;
      return `<button class="row r-inv" data-act="${ENTRY_ACT[e.kind]}" data-id="${e.id}"><div style="min-width:0"><div class="t">${esc(e.what)}</div><div class="sub">${esc(e.sub || '')}</div></div><div class="c2 sub">${fmtDate(e.date)}</div>${x ? expChip(x) : '<span></span>'}<div class="amt" style="color:var(${e.amt < 0 ? '--bad' : '--good'})">${e.amt < 0 ? '− ' : '+ '}${tk(Math.abs(e.amt))}<small>bal ${tk(e.bal)}</small></div></button>`; }).join('')}</div>`
      : `<div class="empty">Nothing in or out of the box in ${monthName(mo)}.</div>`}</div>`;
}
function pettyBillsForm() {
  const box = pettyBox(); if (!box) return;
  const row = () => `<div class="pb-row" style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.3fr) minmax(0,1.6fr) minmax(0,.9fr) 28px;gap:6px;align-items:center">
    <input type="date" name="d" value="${today()}" aria-label="Date"><select name="c" aria-label="Category">${PETTY_CATS.map(c => opt(c, c)).join('')}</select>
    <input name="w" placeholder="What for" aria-label="What for"><input name="a" type="number" min="1" step="1" placeholder="Taka" aria-label="Amount"><button class="btn ghost sm" type="button" data-pb="del" aria-label="Remove">×</button></div>`;
  openSheet(`${sheetHead('Record petty cash bills', `${esc(box.name)} · ${tk(acctBal(box, today()))} in the box`)}
  <form id="pbf"><style>#pbf .pb-row input,#pbf .pb-row select{background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:8px;min-width:0;width:100%;font-size:13px}@media (max-width:560px){#pbf .pb-row{grid-template-columns:1fr 1fr!important}#pbf .pb-row [name=w]{grid-column:1/-1}}</style>
    <div id="pbRows" style="display:flex;flex-direction:column;gap:10px">${row()}${row()}${row()}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><button class="btn sm" type="button" data-pb="add">Add a line</button><span class="hint" id="pbTot"></span></div>
    <p class="hint">${isPrincipal() ? 'Bills you record are approved straight away.' : 'Each bill goes to the Principal for approval. Keep the paper voucher with the box.'} Empty lines are skipped.</p>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Save bills</button></div></form>`, root => {
    const f = $('#pbf', root), box2 = $('#pbRows', root);
    const read = () => [...box2.querySelectorAll('.pb-row')].map(r => ({ d: r.querySelector('[name=d]').value, c: r.querySelector('[name=c]').value, w: r.querySelector('[name=w]').value.trim(), a: +r.querySelector('[name=a]').value || 0 })).filter(x => x.a > 0 || x.w);
    const upd = () => { const L = read(), t = L.reduce((u, x) => u + x.a, 0); $('#pbTot', root).textContent = L.length ? `${L.length} bill${L.length === 1 ? '' : 's'} · ${tk(t)}${t > acctBal(box, today()) ? ' · more than is in the box' : ''}` : ''; };
    f.addEventListener('input', upd);
    f.addEventListener('click', e => { const b = e.target.closest('[data-pb]'); if (!b) return; if (b.dataset.pb === 'add') box2.insertAdjacentHTML('beforeend', row()); else b.closest('.pb-row').remove(); upd(); });
    f.addEventListener('submit', async ev => { ev.preventDefault(); const L = read();
      if (!L.length) { toast('Enter at least one bill.'); return; }
      const bad = L.find(x => !x.w || !(x.a > 0) || !x.d); if (bad) { toast('Each bill needs what it was for and an amount.'); return; }
      const early = L.find(x => x.d < box.openingDate); if (early) { toast(`The box starts on ${fmtDate(box.openingDate)}.`); return; }
      const lk = L.find(x => locked(x.d)); if (lk) { toast(`FY ${fyLabel(fyOf(lk.d))} is closed.`); return; }
      const st = isPrincipal() ? { status: 'approved', decidedBy: S.uid, decidedOn: today() } : { status: 'pending' };
      if (await run(async () => { for (const x of L) await addDoc('expenses', { date: x.d, category: x.c, desc: x.w, payee: '', amount: x.a, projectId: '', note: 'Petty cash', accountId: box.id, paidOn: x.d, ref: '', ...st }); },
        `${L.length} bill${L.length === 1 ? '' : 's'} saved${isPrincipal() ? '' : ' · sent for approval'}`)) closeSheet(); });
  });
}
function pettyTopupForm() {
  const box = pettyBox(); if (!box) return;
  const src = activeAccts().filter(a => a.id !== box.id); if (!src.length) { toast('Add the office vault under Cash & bank first.'); return; }
  const need = Math.max(0, (+box.float || 0) - acctBal(box, today()));
  moveForm('transfer', null, { from: (src.find(a => a.kind === 'cash') || src[0]).id, to: box.id, amount: need || '', note: 'Petty cash top-up' });
}
function pettyStatementDoc(mo) {
  const box = pettyBox(), all = acctEntries(box), start = mo + '-01', end = monthEnd(mo), n = v => nf.format(Math.round(+v || 0));
  const opening = all.filter(e => e.date < start).reduce((u, e) => u + e.amt, +box.opening || 0);
  const rows = all.filter(e => e.date >= start && e.date <= end);
  let run = opening; const cats = {};
  rows.forEach(e => { if (e.kind === 'expense') { const x = S.expenses.find(b => b.id === e.id); if (x && x.status !== 'rejected') cats[x.category] = (cats[x.category] || 0) + (+x.amount || 0); } });
  const rc = S.recons.find(r => r.accountId === box.id && r.month === mo);
  const body = `<h1>Petty cash statement</h1>
  <div class="ref"><span>Month <b>${monthName(mo)}</b></span><span>Float <b>BDT ${n(box.float)}</b></span><span>Opening <b>BDT ${n(opening)}</b></span></div>
  <table style="font-size:8.8pt"><thead><tr><th>Date</th><th>Particulars</th><th class="n">In</th><th class="n">Out</th><th class="n">Balance</th></tr></thead><tbody>
  <tr class="sub"><td>${fmtShort(start)}</td><td>Opening balance</td><td></td><td></td><td class="n">${n(opening)}</td></tr>
  ${rows.map(e => { run += e.amt; const x = e.kind === 'expense' ? S.expenses.find(b => b.id === e.id) : null; return `<tr><td>${fmtShort(e.date)}</td><td>${esc(e.what)}${x ? `<br><span style="color:#545454;font-size:7.5pt">${esc(x.category)}${x.status === 'pending' ? ' · awaiting approval' : x.status === 'rejected' ? ' · rejected' : ''}</span>` : ''}</td><td class="n">${e.amt > 0 ? n(e.amt) : ''}</td><td class="n">${e.amt < 0 ? n(-e.amt) : ''}</td><td class="n">${n(run)}</td></tr>`; }).join('')}
  <tr class="tot"><td></td><td>Closing balance</td><td class="n">${n(rows.filter(e => e.amt > 0).reduce((u, e) => u + e.amt, 0))}</td><td class="n">${n(-rows.filter(e => e.amt < 0).reduce((u, e) => u + e.amt, 0))}</td><td class="n">${n(run)}</td></tr></tbody></table>
  ${Object.keys(cats).length ? `<h2>Spent by category</h2><table style="font-size:8.8pt"><tbody>${Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<tr><td>${esc(c)}</td><td class="n">${n(v)}</td></tr>`).join('')}</tbody></table>` : ''}
  ${rc ? `<p class="note">Cash counted on ${fmtDate(monthEnd(mo))}: BDT ${n(rc.actual)} · ${Math.abs(+rc.diff || 0) < 1 ? 'matches the book' : `${rc.diff > 0 ? 'short' : 'over'} by BDT ${n(Math.abs(rc.diff))}`}${rc.note ? ' · ' + esc(rc.note) : ''}</p>` : ''}
  <div class="sig"><div><b>Kept by</b>${esc(box.note || 'Petty cash holder')}</div><div><b>Checked by</b>COO</div><div><b>Approved by</b>Principal</div></div>`;
  return docShell(`Petty cash · ${monthName(mo)}`, `Petty cash · ${monthName(mo)}`, body);
}

/* ----- Cash & bank ----- */
const ENTRY_ACT = { receipt: 'open-receipt-inv', move: 'edit-move', expense: 'open-exp', wopay: 'open-wopay', advance: 'open-adv', payrun: 'open-run' };
const fyStart = fy => `${fy}-07-01`, fyEnd = fy => `${fy + 1}-06-30`;
const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); return iso(new Date(y, m, 0)); };
const lastRecon = a => S.recons.filter(r => r.accountId === a.id).sort((x, y) => (y.month || '').localeCompare(x.month || ''))[0];
function cashbook() {
  const accts = activeAccts(), inactive = S.accounts.filter(a => a.active === false), t = today();
  const sumKind = k => accts.filter(a => a.kind === k).reduce((s, a) => s + acctBal(a, t), 0);
  const total = accts.reduce((s, a) => s + acctBal(a, t), 0);
  const recent = [];
  for (const a of S.accounts) for (const e of acctEntries(a)) if (inFY(e.date, S.fy)) recent.push({ ...e, a });
  recent.sort((x, y) => (y.date || '').localeCompare(x.date || '') || (y.at || '').localeCompare(x.at || ''));
  const acRow = a => { const b = acctBal(a, t), rc = lastRecon(a);
    return `<button class="row r-prj" data-act="open-acct" data-id="${a.id}"><div style="min-width:0"><div class="t">${esc(a.name)}</div><div class="sub">${ACCT_KIND[a.kind]}${a.bank ? ' · ' + esc(a.bank) : ''}${a.number ? ' · <span class="mono">' + esc(a.number) + '</span>' : ''}${a.active === false ? ' · inactive' : ''}</div></div>
      <div class="c2 sub">${rc ? `Checked to ${fmtShort(monthEnd(rc.month))} · ${Math.abs(+rc.diff || 0) < 1 ? '<span style="color:var(--good)">matched</span>' : `<span class="warnt">off by ${tk(Math.abs(rc.diff))}</span>`}` : 'Not checked yet'}</div>
      <div class="amt" style="${b < 0 ? 'color:var(--bad)' : ''}">${tk(b)}</div></button>`; };
  if (!S.accounts.length) return `
  <div class="head"><div><h2>Cash & bank</h2><p>Every taka in and out, account by account.</p></div></div>
  <div class="panel"><div class="empty"><strong>Set up the vault and the bank</strong>Add the office vault and the studio's bank account, each with what it held on the day you start counting. Client payments, transfers and drawings then post to them and keep both balances right.
    <div class="actions" style="justify-content:center"><button class="btn" data-act="new-acct" data-v="cash">Add office vault</button><button class="btn pri" data-act="new-acct" data-v="bank">Add bank account</button></div></div></div>`;
  return `
  <div class="head"><div><h2>Cash & bank</h2><p>Balances as of today. Client payments, paid expenses, work order payments, salaries, transfers and drawings all post here.</p></div>
    <div class="actions"><button class="btn" data-act="reg-ff">Fund flow</button><button class="btn" data-act="new-acct">Add account</button><button class="btn" data-act="new-move" data-v="transfer">Transfer</button><button class="btn" data-act="new-move" data-v="drawing">Owner’s drawing</button><button class="btn" data-act="new-move" data-v="capital">Capital in</button><button class="btn" data-act="new-move" data-v="income">Other income</button></div></div>
  <div class="kpis">
    <div class="kpi"><div class="lb">Total cash & bank</div><div class="v" style="${total < 0 ? 'color:var(--bad)' : ''}">${compact(total)}</div><div class="s">${accts.length} active account${accts.length === 1 ? '' : 's'}</div></div>
    <div class="kpi"><div class="lb">Cash</div><div class="v">${compact(sumKind('cash'))}</div><div class="s">vault and cash in hand · count at month end</div></div>
    <div class="kpi"><div class="lb">Bank</div><div class="v">${compact(sumKind('bank'))}</div><div class="s">check against the statement</div></div>
    ${accts.some(a => a.kind === 'mfs') ? `<div class="kpi"><div class="lb">Mobile wallets</div><div class="v">${compact(sumKind('mfs'))}</div><div class="s">bKash, Nagad</div></div>`
      : (() => { const lm = (() => { const d = new Date(); d.setDate(0); return iso(d).slice(0, 7); })(), due = accts.filter(a => a.openingDate <= monthEnd(lm) && !S.recons.some(r => r.accountId === a.id && r.month === lm));
        return `<div class="kpi"><div class="lb">Month-end check</div><div class="v">${due.length ? `${due.length} due` : 'Done'}</div><div class="s">${fmtShort(monthEnd(lm))}${due.length ? ' · ' + esc(due.map(a => a.name).join(', ')) : ' · all matched up'}</div></div>`; })()}
  </div>
  ${movesPanel()}
  <div class="panel"><div class="ph"><h3>Accounts</h3><span class="meta">tap one for its book</span></div><div class="rows">${accts.map(acRow).join('')}${inactive.map(acRow).join('')}</div></div>
  <div class="panel"><div class="ph"><h3>Money in and out · FY ${fyLabel(S.fy)}</h3><span class="meta">latest first</span></div>
    ${recent.length ? `<div class="rows">${recent.slice(0, 25).map(e => entryRow(e, e.a)).join('')}</div>` : `<div class="empty">Nothing in or out in FY ${fyLabel(S.fy)} yet.</div>`}</div>`;
}
function entryRow(e, a) {
  const act = `data-act="${ENTRY_ACT[e.kind]}" data-id="${e.id}"`;
  return `<button class="row r-inv" ${act}><div style="min-width:0"><div class="t">${esc(e.what)}</div><div class="sub">${a ? esc(a.name) + ' · ' : ''}${esc(e.sub || '')}</div></div>
    <div class="c2 sub">${fmtDate(e.date)}</div><span></span><div class="amt" style="color:var(${e.amt < 0 ? '--bad' : '--good'})">${e.amt < 0 ? '− ' : '+ '}${tk(Math.abs(e.amt))}</div></button>`;
}
function accountForm(a, kind) {
  const src = a || { kind: kind || 'bank', openingDate: kind === 'petty' ? today() : fyStart(fyOf(today())), opening: 0 };
  const used = a && acctEntries(a).length;
  openSheet(`${sheetHead(a ? 'Edit account' : 'Add account', a ? esc(a.name) : 'Enter what the account held on the date you start counting from.')}
  <form id="af">
    <div class="fg">
      <label class="f" for="a_kind">Type<select id="a_kind" name="kind">${Object.entries(ACCT_KIND).map(([k, l]) => opt(k, l, src.kind === k)).join('')}</select></label>
      <label class="f" for="a_name">Name<input id="a_name" name="name" required value="${esc(src.name || (src.kind === 'cash' ? 'Office vault' : src.kind === 'petty' ? 'Petty cash' : ''))}" placeholder="e.g. City Bank current"></label>
    </div>
    <div id="aBank" style="display:flex;flex-direction:column;gap:14px">
      <div class="fg">
        <label class="f" for="a_title">Account title (cheques payable to)<select id="a_title" name="title">${ENTITIES.map(e => opt(e, e, entOf({ entity: src.title }) === e)).join('')}</select></label>
        <label class="f" for="a_bank">Bank and branch<input id="a_bank" name="bank" value="${esc(src.bank)}" placeholder="e.g. City Bank, Gulshan branch"></label>
      </div>
      <div class="fg">
        <label class="f" for="a_no">Account number<input id="a_no" name="number" value="${esc(src.number)}" class="mono" maxlength="24"></label>
        <label class="f" for="a_rt">Routing number<input id="a_rt" name="routing" value="${esc(src.routing)}" class="mono" maxlength="12" inputmode="numeric"></label>
      </div>
      <p class="hint" style="margin:0">Bank accounts are printed on invoices exactly as entered here.</p>
    </div>
    <div class="fg">
      <label class="f" for="a_open">Opening balance (BDT)<input id="a_open" name="opening" type="number" step="1" required value="${esc(src.opening)}"></label>
      <label class="f" for="a_od">As of<input id="a_od" name="openingDate" type="date" required value="${esc(src.openingDate)}"></label>
    </div>
    <label class="f" for="a_float" id="aFloat">Petty cash float (the fixed amount the box is topped up to)<input id="a_float" name="float" type="number" min="0" step="1" value="${esc(src.float || 10000)}"></label>
    <p class="hint">Start from a date you can verify: a bank statement balance, or cash counted in the drawer. Entries can't be dated before it.</p>
    ${a ? `<label class="check" for="a_act"><input id="a_act" name="active" type="checkbox" ${a.active !== false ? 'checked' : ''}> Active <span class="hint">(inactive accounts keep their history but can't take new entries)</span></label>` : ''}
    <label class="f" for="a_note">Notes<textarea id="a_note" name="note" rows="2">${esc(src.note)}</textarea></label>
    <div class="foot">${a && !used ? `<button class="btn danger" type="button" data-act="del-acct" data-id="${a.id}">Delete</button>` : ''}<button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">${a ? 'Save' : 'Add account'}</button></div>
  </form>`, root => {
    const f = $('#af', root);
    const sync = () => { $('#aBank', root).hidden = f.kind.value === 'cash' || f.kind.value === 'petty'; $('#aFloat', root).hidden = f.kind.value !== 'petty'; }; sync();
    f.kind.addEventListener('change', () => { if (!a && (!f.name.value || ['Office vault', 'Petty cash'].includes(f.name.value))) f.name.value = f.kind.value === 'cash' ? 'Office vault' : f.kind.value === 'petty' ? 'Petty cash' : ''; sync(); });
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const first = a && acctEntries(a)[0];
      if (first && f.openingDate.value > first.date) { toast(`This account already has an entry on ${fmtDate(first.date)}. The opening date must be on or before it.`); return; }
      const cashy = ['cash', 'petty'].includes(f.kind.value);
      const data = { kind: f.kind.value, name: f.name.value.trim(), bank: cashy ? '' : f.bank.value.trim(), number: cashy ? '' : f.number.value.trim(), routing: cashy ? '' : f.routing.value.trim(), title: cashy ? '' : f.title.value, float: f.kind.value === 'petty' ? +f.float.value || 0 : 0,
        opening: +f.opening.value || 0, openingDate: f.openingDate.value, active: a ? f.active.checked : true, note: f.note.value.trim() };
      const ok = a ? await run(() => putDoc('accounts', a.id, { ...strip(a), ...data }), 'Account saved') : await run(() => addDoc('accounts', data), 'Account added');
      if (ok) closeSheet(); });
  });
}
function accountSheet(a) {
  const fy = S.fy, all = acctEntries(a), t = today();
  const bf = all.filter(e => e.date < fyStart(fy)).reduce((s, e) => s + e.amt, +a.opening || 0);
  const rows = all.filter(e => inFY(e.date, fy));
  const startsInFY = inFY(a.openingDate, fy), startsAfter = a.openingDate > fyEnd(fy);
  let run = bf;
  const lines = rows.map(e => { run += e.amt; return { ...e, bal: run }; }).reverse();
  const checks = S.recons.filter(r => r.accountId === a.id).sort((x, y) => (y.month || '').localeCompare(x.month || '')).slice(0, 6);
  openSheet(`${sheetHead(a.name, `${ACCT_KIND[a.kind]}${a.bank ? ' · ' + esc(a.bank) : ''}${a.number ? ' · <span class="mono">' + esc(a.number) + '</span>' : ''}`)}
    <dl class="kv"><dt>${startsInFY ? `Opening balance, ${fmtDate(a.openingDate)}` : `Brought forward, 1 Jul ${fy}`}</dt><dd>${startsAfter ? '—' : tk(bf)}</dd>
      <dt>In · FY ${fyLabel(fy)}</dt><dd style="color:var(--good)">${tk(rows.filter(e => e.amt > 0).reduce((s, e) => s + e.amt, 0))}</dd>
      <dt>Out · FY ${fyLabel(fy)}</dt><dd style="color:var(--bad)">${tk(-rows.filter(e => e.amt < 0).reduce((s, e) => s + e.amt, 0))}</dd>
      <dt class="tot">Balance today</dt><dd class="tot">${tk(acctBal(a, t))}</dd></dl>
    <div class="sec-t" style="margin-top:18px">Book · FY ${fyLabel(fy)}</div>
    <div class="mini-list rows" style="margin-top:10px">${lines.length ? lines.map(e => `<button class="row" style="grid-template-columns:minmax(0,1fr) auto" data-act="${ENTRY_ACT[e.kind]}" data-id="${e.id}"><div style="min-width:0"><div class="t">${esc(e.what)}</div><div class="sub">${fmtDate(e.date)}${e.sub ? ' · ' + esc(e.sub) : ''}</div></div>
      <div class="amt" style="color:var(${e.amt < 0 ? '--bad' : '--good'})">${e.amt < 0 ? '− ' : '+ '}${tk(Math.abs(e.amt))}<small>bal ${tk(e.bal)}</small></div></button>`).join('') : `<div class="empty" style="padding:14px">No entries in FY ${fyLabel(fy)}.</div>`}</div>
    <div class="sec-t" style="margin-top:18px">Month-end checks</div>
    <div class="mini-list rows" style="margin-top:10px">${checks.length ? checks.map(r => `<div class="row r-mini" style="cursor:default"><div style="min-width:0"><div class="t">${fmtDate(monthEnd(r.month))}</div><div class="sub">Book ${tk(r.book)} · ${isCashLike(a) ? 'counted' : 'statement'} ${tk(r.actual)}${r.note ? ' · ' + esc(r.note) : ''} · by ${who(r.createdBy)}</div></div>${Math.abs(+r.diff || 0) < 1 ? chip('paid', 'Matched') : chip('overdue', (r.diff > 0 ? 'Short ' : 'Over ') + tk(Math.abs(r.diff)))}<span></span></div>`).join('') : `<div class="empty" style="padding:14px">No checks yet. At each month end, compare the book with the ${isCashLike(a) ? 'cash in the box' : 'bank statement'}.</div>`}</div>
    <div class="foot"><button class="btn" data-act="reg-cb" data-id="${a.id}">Cash book</button><button class="btn" data-act="reg-vr" data-id="${a.id}">${a.kind === 'cash' ? 'Vault register' : 'Register'}</button><button class="btn" data-act="export-acct" data-id="${a.id}">Export CSV</button><button class="btn" data-act="edit-acct" data-id="${a.id}">Edit</button><button class="btn pri" data-act="reg-count" data-id="${a.id}">${isCashLike(a) ? "Count cash" : "Statement check"}</button></div>`);
}
function moveForm(type, m, preset) {
  const accts = activeAccts(), src = m || { type, date: today(), ...(preset || {}) };
  type = src.type;
  const needFrom = ['transfer', 'drawing'].includes(type), needTo = ['transfer', 'capital', 'income'].includes(type);
  if (accts.length < (type === 'transfer' ? 2 : 1)) { toast(type === 'transfer' ? 'Add at least two accounts to transfer between them.' : 'Add an account first.'); return; }
  const lk = m && locked(m.date);
  const pickList = (name, sel) => `<select id="m_${name}" name="${name}">${(m ? S.accounts.filter(a => a.active !== false || a.id === sel) : accts).map(a => opt(a.id, `${a.name} · ${tk(acctBal(a, today()))}`, a.id === sel)).join('')}</select>`;
  const titles = { transfer: 'Transfer between accounts', drawing: 'Owner’s drawing', capital: 'Capital put in', income: 'Other income' };
  const subs = { transfer: 'Vault cash deposited in the bank, or cash withdrawn from the bank into the vault.', drawing: 'Money you take out of the studio for yourself. It isn’t a studio expense.', capital: 'Money you put into the studio from your own pocket.', income: 'Money in that isn’t a client fee: bank interest, a refund, sale of old equipment.' };
  const defTo = type === 'transfer' ? (accts.find(a => a.kind !== 'cash') || accts[1] || accts[0]).id : accts[0].id;
  openSheet(`${sheetHead(m ? `Edit · ${titles[type]}` : titles[type], subs[type])}
  <form id="mf">
    <div class="fg">
      ${needFrom ? `<label class="f" for="m_from">From${pickList('from', src.from || accts[0].id)}</label>` : ''}
      ${needTo ? `<label class="f" for="m_to">Into${pickList('to', src.to || defTo)}</label>` : ''}
      <label class="f" for="m_date">Date<input id="m_date" name="date" type="date" required value="${esc(src.date)}"></label>
      <label class="f" for="m_amt">Amount (BDT)<input id="m_amt" name="amount" type="number" min="1" step="1" required value="${esc(src.amount)}"></label>
      <label class="f" for="m_ref">Reference<input id="m_ref" name="ref" value="${esc(src.ref)}" placeholder="Cheque / deposit slip / txn no."></label>
    </div>
    <label class="f" for="m_note">${type === 'income' ? 'What it was for' : 'Note'}<input id="m_note" name="note" ${type === 'income' ? 'required' : ''} value="${esc(src.note)}"></label>
    <p class="hint" id="mHint"></p>
    ${m ? `<p class="hint">Added by ${who(m.createdBy)} · ${fmtWhen(m.createdAt)}</p>` : ''}
    <div class="foot">${m && !lk ? `<button class="btn danger" type="button" data-act="del-move" data-id="${m.id}">Delete</button>` : ''}<button class="btn ghost" type="button" data-act="close">${lk ? 'Close' : 'Cancel'}</button>${lk ? '' : `<button class="btn pri" type="submit">${m ? 'Save' : 'Save entry'}</button>`}</div>
  </form>`, root => {
    const f = $('#mf', root);
    const upd = () => { const h = $('#mHint', root), ids = [f.from?.value, f.to?.value].filter(Boolean), late = ids.map(acct).find(a => a && f.date.value < a.openingDate);
      h.textContent = lk ? `FY ${fyLabel(fyOf(m.date))} is closed, so this can't change.` : locked(f.date.value) ? `FY ${fyLabel(fyOf(f.date.value))} is closed.` : late ? `${late.name} starts on ${fmtDate(late.openingDate)}.` : f.from && f.to && f.from.value === f.to.value ? 'Pick two different accounts.' : '';
      h.className = 'hint err'; };
    f.addEventListener('input', upd); f.addEventListener('change', upd); upd();
    f.addEventListener('submit', async ev => { ev.preventDefault();
      if ($('#mHint', root).textContent) { toast($('#mHint', root).textContent); return; }
      const data = { type, date: f.date.value, amount: +f.amount.value || 0, from: f.from ? f.from.value : '', to: f.to ? f.to.value : '', ref: f.ref.value.trim(), note: f.note.value.trim() };
      const ok = m ? await run(() => putDoc('moves', m.id, { ...strip(m), ...data }), 'Entry saved') : await run(() => addDoc('moves', data), `${titles[type]} saved`);
      if (ok) closeSheet(); });
  });
}
function reconForm(a) {
  const d = new Date(); d.setDate(0);                       // last month by default
  const ym0 = iso(d).slice(0, 7);
  openSheet(`${sheetHead('Month-end check', `${esc(a.name)} · compare the book with ${isCashLike(a) ? 'the cash you count' : 'the bank statement'}`)}
  <form id="cf">
    <div class="fg">
      <label class="f" for="c_m">Month<input id="c_m" name="month" type="month" required value="${ym0}" max="${today().slice(0, 7)}"></label>
      <label class="f" for="c_a">${isCashLike(a) ? 'Cash counted' : 'Statement balance'} on the last day (BDT)<input id="c_a" name="actual" type="number" step="1" required></label>
    </div>
    <dl class="kv" id="cTot"></dl>
    <label class="f" for="c_n">Note<input id="c_n" name="note" placeholder="Explain any difference"></label>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Save check</button></div>
  </form>`, root => {
    const f = $('#cf', root);
    const upd = () => { if (!f.month.value) return; const end = monthEnd(f.month.value), book = acctBal(a, end), act = f.actual.value === '' ? null : +f.actual.value, diff = act == null ? 0 : book - act;
      const prev = S.recons.find(r => r.accountId === a.id && r.month === f.month.value);
      $('#cTot', root).innerHTML = `<dt>Book balance on ${fmtDate(end)}</dt><dd>${tk(book)}</dd>${act != null ? `<dt class="tot">${Math.abs(diff) < 1 ? 'Matched' : diff > 0 ? 'Short by' : 'Over by'}</dt><dd class="tot" style="color:var(${Math.abs(diff) < 1 ? '--good' : '--bad'})">${tk(Math.abs(diff))}</dd>` : ''}${prev ? `<dt>Already checked</dt><dd class="txt">saving replaces it</dd>` : ''}`; };
    f.addEventListener('input', upd); upd();
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const month = f.month.value, end = monthEnd(month), book = Math.round(acctBal(a, end)), actual = +f.actual.value || 0;
      if (end < a.openingDate) { toast(`${a.name} starts on ${fmtDate(a.openingDate)}.`); return; }
      const id = `${a.id}_${month.replace('-', '')}`, prev = S.recons.find(r => r.id === id);
      const data = { accountId: a.id, month, date: end, book, actual, diff: book - actual, note: f.note.value.trim() };
      if (await run(() => setDoc('recons', id, prev ? { ...strip(prev), ...data } : data, !!prev), Math.abs(book - actual) < 1 ? 'Matched and saved' : 'Check saved with a difference')) accountSheet(acct(a.id) || a); });
  });
}
function exportAcct(a) {
  const r = [['Date', 'Entry', 'Detail', 'In', 'Out', 'Balance']];
  r.push([a.openingDate, 'Opening balance', '', '', '', +a.opening || 0]);
  acctEntries(a).forEach(e => r.push([e.date, e.what, e.sub || '', e.amt > 0 ? e.amt : '', e.amt < 0 ? -e.amt : '', Math.round(e.bal)]));
  saveCsv(`SLATE-${fileSafe(a.name)}-book.csv`, r);
}

/* ----- Reports ----- */
/* ----- Reports: profit & loss, budget, forecast, billing ----- */
const NOT_COST = ['Tax deposited (AIT/VDS withheld)'];
const COST_CATS = [...EXP_CATS.filter(c => !NOT_COST.includes(c)), 'Salaries & bonuses', 'Consultants & vendors'];
const lineCost = l => (+l.gross || 0) + (+l.extra || 0) - (+l.leaveDed || 0);   // cost to SLATE of one payroll line
/* income and costs per month of a financial year.
   billed: income when invoiced (fee before VAT), costs when incurred (expense date, salary month, vendor payment)
   cash:   income when paid (the fee share of what was settled), costs when the money left an account */
function plData(fy, basis) {
  const keys = Array.from({ length: 12 }, (_, i) => monthKey(fy, i));
  const R = keys.map(k => ({ k, income: 0, cats: {} }));
  const at = d => { const i = keys.indexOf((d || '').slice(0, 7)); return i < 0 ? null : R[i]; };
  const add = (d, cat, v) => { const r = at(d); if (r && v) r.cats[cat] = (r.cats[cat] || 0) + v; };
  if (basis === 'cash') {
    S.receipts.forEach(x => { const i = S.invoices.find(v => v.id === x.invoiceId); if (!i) return; const t = invTotal(i) || 1, r = at(x.date);
      if (r) r.income += ((+x.received || 0) + (+x.ait || 0) + (+x.vds || 0)) * (+i.amount || 0) / t; });
    S.expenses.filter(x => x.status !== 'rejected' && x.accountId && !NOT_COST.includes(x.category)).forEach(x => add(x.paidOn, x.category, +x.amount || 0));
    S.payruns.filter(r => r.status === 'paid').forEach(r => add(r.payDate, 'Salaries & bonuses', (r.lines || []).reduce((u, l) => u + lineCost(l), 0)));
  } else {
    S.invoices.filter(i => !['void', 'draft'].includes(invStatus(i))).forEach(i => { const r = at(i.date); if (r) r.income += +i.amount || 0; });
    S.expenses.filter(x => x.status !== 'rejected' && !NOT_COST.includes(x.category)).forEach(x => add(x.date, x.category, +x.amount || 0));
    S.payruns.filter(r => ['approved', 'paid'].includes(r.status)).forEach(r => add(r.month + '-01', 'Salaries & bonuses', (r.lines || []).reduce((u, l) => u + lineCost(l), 0)));
  }
  S.wopays.forEach(x => add(x.date, 'Consultants & vendors', +x.gross || 0));
  R.forEach(r => { r.cost = Object.values(r.cats).reduce((u, v) => u + v, 0); r.profit = r.income - r.cost; });
  const T = { income: 0, cost: 0, profit: 0, cats: {} };
  R.forEach(r => { T.income += r.income; T.cost += r.cost; T.profit += r.profit; for (const [c, v] of Object.entries(r.cats)) T.cats[c] = (T.cats[c] || 0) + v; });
  return { R, T };
}
function reports() {
  const v = S.f.rep;
  const seg = `<div class="filters"><div class="seg">${[['pl', 'Profit & loss'], ['budget', 'Budget'], ['forecast', 'Forecast'], ['billing', 'Billing']].map(([k, l]) => `<button data-act="f-rep" data-v="${k}" aria-pressed="${v === k}">${l}</button>`).join('')}</div></div>`;
  return seg + ({ pl: plView, budget: budgetView, forecast: forecastView, billing: billingReport }[v] || plView)();
}
function plView() {
  const fy = S.fy, basis = S.f.basis, { R, T } = plData(fy, basis), n = v => v ? nf.format(Math.round(v)) : '–';
  const cats = COST_CATS.filter(c => T.cats[c]);
  const cur = today().slice(0, 7), cm = R.find(r => r.k === cur);
  const margin = T.income ? Math.round(T.profit / T.income * 100) : 0;
  const max = Math.max(1, ...R.map(r => Math.max(r.income, r.cost)));
  const bars = R.map((r, i) => `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:0" title="${MONTHS[i]}: income ${tk(r.income)}, costs ${tk(r.cost)}, profit ${tk(r.profit)}">
    <div style="height:110px;display:flex;align-items:flex-end;gap:2px;width:100%;justify-content:center"><i style="display:block;width:38%;max-width:12px;height:${(r.income / max * 100).toFixed(1)}%;background:var(--inflow);opacity:.75;border-radius:2px 2px 0 0"></i><i style="display:block;width:38%;max-width:12px;height:${(r.cost / max * 100).toFixed(1)}%;background:var(--red);border-radius:2px 2px 0 0"></i></div>
    <span style="font-size:10px;color:${r.k === cur ? 'var(--ink)' : 'var(--muted)'};font-weight:${r.k === cur ? 600 : 400}">${MONTHS[i]}</span><span class="num" style="font-size:10px;color:${r.profit < 0 ? 'var(--bad)' : 'var(--good)'}">${r.income || r.cost ? axisLbl(Math.abs(r.profit)).replace(/^/, r.profit < 0 ? '−' : '') : ''}</span></div>`).join('');
  return `
  <div class="head"><div><h2>Profit & loss · FY ${fyLabel(fy)}</h2><p>${basis === 'cash' ? 'Cash basis: income when clients pay (fee share, before VAT), costs when money leaves the vault or bank.' : 'Billed basis: income when invoiced (before VAT), costs when incurred.'} VAT, tax deposits and owner’s drawings are not income or cost.</p></div>
    <div class="actions"><div class="seg">${[['billed', 'Billed'], ['cash', 'Cash']].map(([k, l]) => `<button data-act="f-basis" data-v="${k}" aria-pressed="${basis === k}">${l}</button>`).join('')}</div><button class="btn" data-act="export-plfull">Export CSV</button></div></div>
  <div class="kpis">
    <div class="kpi"><div class="lb">Income · FY</div><div class="v">${compact(T.income)}</div><div class="s">${cm ? `${compact(cm.income)} this month` : ''}</div></div>
    <div class="kpi"><div class="lb">Costs · FY</div><div class="v">${compact(T.cost)}</div><div class="s">${cm ? `${compact(cm.cost)} this month` : ''}</div></div>
    <div class="kpi"><div class="lb">Profit · FY</div><div class="v" style="color:var(${T.profit < 0 ? '--bad' : '--good'})">${compact(T.profit)}</div><div class="s">${T.income ? `${margin}% margin` : 'no income yet'}</div></div>
    <div class="kpi"><div class="lb">This month</div><div class="v" style="color:var(${cm && cm.profit < 0 ? '--bad' : '--good'})">${compact(cm ? cm.profit : 0)}</div><div class="s">${monthName(cur)}</div></div>
  </div>
  <div class="panel"><div class="ph"><h3>Income and costs by month</h3><div class="legend"><span style="--c:var(--inflow)">Income</span><span style="--c:var(--red)">Costs</span></div></div>
    <div class="pb" style="display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:2px">${bars}</div></div>
  <div class="panel"><div class="ph"><h3>Statement</h3><span class="meta">BDT</span></div><div class="tbl"><table>
    <thead><tr><th></th>${R.map((r, i) => `<th>${MONTHS[i]}</th>`).join('')}<th>FY</th></tr></thead>
    <tbody><tr><td><b>Fee income</b></td>${R.map(r => `<td>${n(r.income)}</td>`).join('')}<td><b>${n(T.income)}</b></td></tr>
    ${cats.map(c => `<tr><td style="padding-left:20px">${esc(c)}</td>${R.map(r => `<td>${n(r.cats[c])}</td>`).join('')}<td>${n(T.cats[c])}</td></tr>`).join('')}
    <tr><td><b>Total costs</b></td>${R.map(r => `<td>${n(r.cost)}</td>`).join('')}<td><b>${n(T.cost)}</b></td></tr></tbody>
    <tfoot><tr><td>Profit</td>${R.map(r => `<td class="${r.profit < 0 ? 'neg' : ''}">${n(r.profit)}</td>`).join('')}<td class="${T.profit < 0 ? 'neg' : ''}">${n(T.profit)}</td></tr></tfoot>
  </table></div></div>
  <p class="hint">Salaries count the cost to SLATE (gross plus allowances, less unpaid leave); advances aren’t a cost, their recovery isn’t income. Consultants count what was settled, including tax withheld. ${basis === 'billed' ? 'Expenses awaiting approval are included; rejected ones are not.' : ''}</p>`;
}
const budgetOf = fy => S.budgets.find(b => b.id === 'FY' + fy);
// Eid bonus estimate: every active person's basic x the budget's percent
const bonusEst = b => Math.round(activeStaff().reduce((u, t) => u + (+(curRate(t) || {}).basic || 0), 0) * (+(b && b.bonusPct != null ? b.bonusPct : 100)) / 100);
/* budget for one category in one month: the monthly amount, plus the Eid bonus in an Eid month, plus any one-off cost dated that month */
function budgetFor(b, cat, ym) {
  if (!b) return 0;
  let v = +(b.lines || {})[cat] || 0;
  if (cat === 'Salaries & bonuses' && (b.bonusMonths || []).includes(ym)) v += bonusEst(b);
  (b.oneoffs || []).forEach(o => { if (o.month === ym && (o.cat || 'Other') === cat) v += +o.amount || 0; });
  return v;
}
function budgetView() {
  const fy = S.fy, b = budgetOf(fy), lines = (b && b.lines) || {}, { R } = plData(fy, 'billed'), cur = today().slice(0, 7);
  const months = R.map(r => r.k), bm = S.f.bm && months.includes(S.f.bm) ? S.f.bm : (months.includes(cur) ? cur : months[0]);
  const upto = months.indexOf(bm) + 1, done = R.slice(0, upto);
  const rows = COST_CATS.map(c => { const mb = budgetFor(b, c, bm), ma = (R.find(r => r.k === bm).cats[c] || 0), yb = done.reduce((u, r) => u + budgetFor(b, c, r.k), 0), ya = done.reduce((u, r) => u + (r.cats[c] || 0), 0); return { c, mb, ma, yb, ya }; }).filter(r => r.mb || r.ma || r.ya);
  const T = rows.reduce((a, r) => ({ mb: a.mb + r.mb, ma: a.ma + r.ma, yb: a.yb + r.yb, ya: a.ya + r.ya }), { mb: 0, ma: 0, yb: 0, ya: 0 });
  const vr = (bud, act) => { if (!bud) return act ? `<span class="warnt">no budget</span>` : '–'; const d = act - bud, pct = Math.round(act / bud * 100); return `<span style="color:var(${d > 0 ? '--bad' : '--good'})">${pct}%</span>`; };
  return `
  <div class="head"><div><h2>Budget · FY ${fyLabel(fy)}</h2><p>Monthly budget per cost category against what was actually spent (billed basis). ${isPrincipal() ? 'Only you set the budget.' : 'The Principal sets the budget.'}</p></div>
    <div class="actions"><select id="bmSel" aria-label="Month">${months.map(m => opt(m, monthName(m), m === bm)).join('')}</select>${isPrincipal() ? `<button class="btn pri" data-act="edit-budget">${b ? 'Edit budget' : 'Set budget'}</button>` : ''}</div></div>
  ${!b ? `<div class="panel"><div class="empty"><strong>No budget for FY ${fyLabel(fy)} yet</strong>${isPrincipal() ? 'Set a monthly amount for each kind of cost (rent, salaries, consultants, printing). Actuals are tracked against it every month.' : 'The Principal hasn’t set one yet. Actual spending still shows below.'}${isPrincipal() ? `<div class="actions" style="justify-content:center"><button class="btn pri" data-act="edit-budget">Set budget</button></div>` : ''}</div></div>` : ''}
  <div class="kpis">
    <div class="kpi"><div class="lb">Budget · ${MONTHS[upto - 1]}</div><div class="v">${compact(T.mb)}</div><div class="s">a month</div></div>
    <div class="kpi"><div class="lb">Spent · ${MONTHS[upto - 1]}</div><div class="v" style="color:var(${T.mb && T.ma > T.mb ? '--bad' : '--ink'})">${compact(T.ma)}</div><div class="s">${T.mb ? `${Math.round(T.ma / T.mb * 100)}% of budget` : ''}</div></div>
    <div class="kpi"><div class="lb">Budget to date</div><div class="v">${compact(T.yb)}</div><div class="s">Jul to ${MONTHS[upto - 1]}</div></div>
    <div class="kpi"><div class="lb">Spent to date</div><div class="v" style="color:var(${T.yb && T.ya > T.yb ? '--bad' : '--ink'})">${compact(T.ya)}</div><div class="s">${T.yb ? `${T.ya > T.yb ? 'over' : 'under'} by ${compact(Math.abs(T.yb - T.ya))}` : ''}</div></div>
  </div>
  <div class="panel"><div class="ph"><h3>By category</h3><span class="meta">BDT</span></div>${rows.length ? `<div class="tbl"><table>
    <thead><tr><th>Category</th><th>Budget · ${MONTHS[upto - 1]}</th><th>${MONTHS[upto - 1]}</th><th></th><th>Budget to date</th><th>Spent to date</th><th></th></tr></thead>
    <tbody>${rows.map(r => `<tr><td>${esc(r.c)}</td><td>${nf.format(r.mb)}</td><td>${nf.format(Math.round(r.ma))}</td><td>${vr(r.mb, r.ma)}</td><td>${nf.format(r.yb)}</td><td>${nf.format(Math.round(r.ya))}</td><td>${vr(r.yb, r.ya)}</td></tr>`).join('')}</tbody>
    <tfoot><tr><td>Total</td><td>${nf.format(T.mb)}</td><td>${nf.format(Math.round(T.ma))}</td><td>${vr(T.mb, T.ma)}</td><td>${nf.format(T.yb)}</td><td>${nf.format(Math.round(T.ya))}</td><td>${vr(T.yb, T.ya)}</td></tr></tfoot></table></div>`
    : `<div class="empty">No budget or spending yet this year.</div>`}</div>
  ${b && ((b.bonusMonths || []).length || (b.oneoffs || []).length) ? `<div class="panel"><div class="ph"><h3>Dated items in this budget</h3></div><div class="rows">
    ${(b.bonusMonths || []).filter(Boolean).map((m, i) => `<div class="row r-mini" style="cursor:default"><div style="min-width:0"><div class="t">${['Eid-ul-Fitr', 'Eid-ul-Adha'][i] || 'Eid'} bonus</div><div class="sub">${monthName(m)} · ${b.bonusPct ?? 100}% of basic</div></div><span></span><div class="amt">${tk(bonusEst(b))}</div></div>`).join('')}
    ${(b.oneoffs || []).slice().sort((x, y) => (x.month || '').localeCompare(y.month || '')).map(o => `<div class="row r-mini" style="cursor:default"><div style="min-width:0"><div class="t">${esc(o.label)}</div><div class="sub">${monthName(o.month)} · ${esc(o.cat || 'Other')}</div></div><span></span><div class="amt">${tk(o.amount)}</div></div>`).join('')}
  </div></div>` : ''}`;
}
const ooRow = o => `<div class="oo" data-id="${esc(o.id)}" style="display:grid;grid-template-columns:minmax(0,1.4fr) 128px minmax(0,1fr) 96px 28px;gap:6px;align-items:center">
  <input name="oo_label" placeholder="e.g. Trade licence renewal" value="${esc(o.label)}" aria-label="One-off cost" style="background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:7px 9px;min-width:0">
  <input name="oo_month" type="month" value="${esc(o.month)}" aria-label="Month" style="background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:6px;min-width:0">
  <select name="oo_cat" aria-label="Category" style="background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:6px;min-width:0">${COST_CATS.map(c => opt(c, c, (o.cat || 'Other') === c)).join('')}</select>
  <input name="oo_amt" type="number" min="1" step="1" value="${esc(o.amount)}" placeholder="Taka" aria-label="Amount" style="background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:7px 9px;min-width:0">
  <button class="btn ghost sm" type="button" data-oo="del" aria-label="Remove">×</button></div>`;
function budgetForm() {
  const fy = S.fy, b = budgetOf(fy), lines = (b && b.lines) || {};
  // suggest from the last three months of actual spending where there is no budget yet
  const { R } = plData(fy, 'billed'), cur = today().slice(0, 7), past = R.filter(r => r.k < cur).slice(-3);
  const avg = c => past.length ? Math.round(past.reduce((u, r) => u + (r.cats[c] || 0), 0) / past.length / 100) * 100 : 0;
  const payroll = activeStaff().reduce((u, t) => u + grossOf(curRate(t)), 0);
  openSheet(`${sheetHead(`Budget · FY ${fyLabel(fy)}`, 'Monthly amounts. Leave a category empty if you don’t budget for it.')}
  <form id="bf"><div class="fg">${COST_CATS.map(c => { const v = lines[c] ?? (c === 'Salaries & bonuses' && payroll ? Math.round(payroll / 100) * 100 : avg(c) || ''); return `<label class="f">${esc(c)}<input name="${esc(c)}" type="number" min="0" step="100" value="${esc(v)}"></label>`; }).join('')}</div>
    <div class="sec-t">Eid bonuses</div>
    <div class="fg"><label class="f">Eid-ul-Fitr bonus paid in<input type="month" name="eid1" value="${esc((b && b.bonusMonths || [])[0] ?? (fy === 2026 ? '2027-03' : ''))}"></label>
      <label class="f">Eid-ul-Adha bonus paid in<input type="month" name="eid2" value="${esc((b && b.bonusMonths || [])[1] ?? (fy === 2026 ? '2027-05' : ''))}"></label>
      <label class="f">Each bonus (% of basic)<input type="number" name="bonusPct" min="0" max="300" step="5" value="${esc(b && b.bonusPct != null ? b.bonusPct : 100)}"></label><div class="hint" id="bBonus" style="align-self:end"></div></div>
    <p class="hint" style="margin-top:-6px">Eid falls on lunar dates; check the months each year. The bonus is added to salaries in those months only.</p>
    <div class="sec-t">One-off costs this year</div>
    <div id="ooBox" style="display:flex;flex-direction:column;gap:6px">${((b && b.oneoffs) || []).map(ooRow).join('')}</div>
    <div><button class="btn sm" type="button" data-oo="add">Add one-off cost</button> <span class="hint">trade licence, advance tax instalment, audit, renewals</span></div>
    <dl class="kv" id="bTot"></dl>
    <p class="hint">${b ? '' : 'Pre-filled from the last three months of spending and current payroll. Adjust freely.'}</p>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Save budget</button></div></form>`, root => {
    const f = $('#bf', root);
    const readOO = () => [...f.querySelectorAll('.oo')].map(r => ({ id: r.dataset.id, label: r.querySelector('[name=oo_label]').value.trim(), month: r.querySelector('[name=oo_month]').value, cat: r.querySelector('[name=oo_cat]').value, amount: +r.querySelector('[name=oo_amt]').value || 0 })).filter(o => o.label || o.amount);
    const upd = () => { const t = COST_CATS.reduce((u, c) => u + (+f.elements[c].value || 0), 0), be = bonusEst({ bonusPct: +f.bonusPct.value || 0 }), nb = [f.eid1.value, f.eid2.value].filter(Boolean).length, oo = readOO().reduce((u, o) => u + o.amount, 0);
      $('#bBonus', root).textContent = `≈ ${tk(be)} each, from current basic salaries`;
      $('#bTot', root).innerHTML = `<dt>Monthly budget</dt><dd>${tk(t)}</dd><dt>Eid bonuses</dt><dd>${tk(be * nb)}</dd><dt>One-off costs</dt><dd>${tk(oo)}</dd><dt class="tot">For the year</dt><dd class="tot">${tk(t * 12 + be * nb + oo)}</dd>`; };
    f.addEventListener('click', e => { const x = e.target.closest('[data-oo]'); if (!x) return; if (x.dataset.oo === 'add') $('#ooBox', root).insertAdjacentHTML('beforeend', ooRow({ id: mid(), label: '', month: '', cat: 'Other', amount: '' })); else x.closest('.oo').remove(); upd(); });
    f.addEventListener('input', upd); upd();
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const out = {}; COST_CATS.forEach(c => { const v = +f.elements[c].value || 0; if (v) out[c] = v; });
      const oneoffs = readOO(); if (oneoffs.some(o => !o.label || !o.month || !(o.amount > 0))) { toast('Each one-off cost needs a name, a month and an amount.'); return; }
      const extra = { bonusMonths: [f.eid1.value, f.eid2.value], bonusPct: +f.bonusPct.value || 0, oneoffs };
      if (await run(() => setDoc('budgets', 'FY' + fy, b ? { ...strip(b), fy, lines: out, ...extra } : { fy, lines: out, ...extra }, !!b), 'Budget saved')) closeSheet(); });
  });
}
function forecastData() {
  const t = today(), cm = t.slice(0, 7), keys = [];
  const d = new Date(cm + '-01T00:00:00'); for (let i = 0; i < 6; i++) { keys.push(iso(d).slice(0, 7)); d.setMonth(d.getMonth() + 1); }
  const R = keys.map(k => ({ k, inv: 0, ms: 0, pay: 0, exp: 0, wo: 0, items: [] }));
  const at = ym => R.find(r => r.k === (ym < cm ? cm : ym));
  // money owed by clients, on the due date (overdue lands this month); AIT the client keeps isn't cash
  S.invoices.filter(invOpen).forEach(i => { const r = at((i.due || i.date || t).slice(0, 7)); if (!r) return; const left = Math.max(0, invDue(i) - Math.max(0, invAit(i) - recsOf(i).reduce((u, x) => u + (+x.ait || 0), 0))); r.inv += left; });
  // milestones not invoiced yet, in the month you expect to bill them (paid the month after)
  S.projects.filter(p => (p.status || 'active') === 'active').forEach(p => (p.milestones || []).forEach(m => { if (!m.expect || msInvoiced(p, m)) return; const nx = new Date(m.expect + '-01T00:00:00'); nx.setMonth(nx.getMonth() + 1);
    const r = at(iso(nx).slice(0, 7)); if (r) r.ms += Math.round((+p.fee || 0) * m.pct / 100); }));
  // payroll: this month's net if a sheet exists, else every active person's salary less tax and advance recovery
  const est = activeStaff().reduce((u, s2) => { const rt = curRate(s2); return u + grossOf(rt) - (+(rt || {}).tax || 0); }, 0);
  R.forEach(r => { const run = S.payruns.find(x => x.kind === 'salary' && x.month === r.k); r.pay = run ? (run.status === 'paid' ? 0 : runTotals(run).net) : est;
    S.payruns.filter(x => x.kind === 'bonus' && x.month === r.k && x.status !== 'paid').forEach(x => r.pay += runTotals(x).net); });
  // other costs: the budget if set, else the last three months' average; approved unpaid expenses this month
  const b = budgetOf(fyOf(t)), { R: P } = plData(fyOf(t), 'billed'), past = P.filter(r => r.k < cm).slice(-3);
  const avgOf = c => past.length ? past.reduce((v, r) => v + (r.cats[c] || 0), 0) / past.length : 0;
  R.forEach(r => { const bb = budgetOf(fyOf(r.k + '-01'));
    r.exp = EXP_CATS.filter(c => !NOT_COST.includes(c)).reduce((u, c) => u + (bb ? budgetFor(bb, c, r.k) : avgOf(c)), 0);
    if (bb && (bb.bonusMonths || []).includes(r.k) && !S.payruns.some(x => x.kind === 'bonus' && x.month === r.k)) r.pay += bonusEst(bb);
    if (bb) (bb.oneoffs || []).forEach(o => { if (o.month !== r.k) return; if (o.cat === 'Salaries & bonuses') r.pay += +o.amount || 0; if (o.cat === 'Consultants & vendors') r.wo += +o.amount || 0; }); });
  R[0].exp += S.expenses.filter(x => x.status === 'approved' && !x.accountId).reduce((u, x) => u + (+x.amount || 0), 0);
  // vendors: what's left on open work orders, in the delivery month (or next month), net of tax withheld
  S.workorders.filter(w => ['approved', 'pending'].includes(w.status || 'pending') && woLeft(w) >= 1).forEach(w => { const netF = 1 - ((+w.aitPct || 0) + (+w.vdsPct || 0)) / 100;
    woDue(w).forEach(i => { if (i.left < 1) return; const r = at(i.month || keys[1]); if (r) r.wo += i.left * netF; }); });
  let bal = activeAccts().reduce((u, a) => u + acctBal(a, t), 0); const open = bal;
  R.forEach(r => { r.open = bal; r.in = r.inv + r.ms; r.out = r.pay + r.exp + r.wo; bal += r.in - r.out; r.close = bal; });
  return { R, open, budgeted: !!b };
}
function forecastView() {
  const { R, open, budgeted } = forecastData(), low = R.reduce((m, r) => r.close < m.close ? r : m, R[0]), n = v => nf.format(Math.round(v || 0));
  const unplanned = [];
  S.projects.filter(p => (p.status || 'active') === 'active').forEach(p => (p.milestones || []).forEach(m => { if (!msInvoiced(p, m)) unplanned.push({ p, m }); }));
  return `
  <div class="head"><div><h2>Cash forecast · next 6 months</h2><p>Starts from today\u2019s cash and bank. Money in: what clients owe (by due date) and the milestones you expect to bill. Money out: salaries with Eid bonuses in their months, ${budgeted ? 'the budget and its one-off costs' : 'average monthly spending (set a budget to use it instead)'}, and work orders by their payment schedules.</p></div></div>
  <div class="kpis">
    <div class="kpi"><div class="lb">Cash & bank now</div><div class="v">${compact(open)}</div><div class="s">all active accounts</div></div>
    <div class="kpi"><div class="lb">In · 6 months</div><div class="v" style="color:var(--good)">${compact(R.reduce((u, r) => u + r.in, 0))}</div><div class="s">invoices and milestones</div></div>
    <div class="kpi"><div class="lb">Out · 6 months</div><div class="v" style="color:var(--bad)">${compact(R.reduce((u, r) => u + r.out, 0))}</div><div class="s">salaries, costs, vendors</div></div>
    <div class="kpi"><div class="lb">Lowest point</div><div class="v" style="color:var(${low.close < 0 ? '--bad' : '--ink'})">${compact(low.close)}</div><div class="s">${low.close < 0 ? `<b class="bad">short in ${monthName(low.k)}</b>` : `end of ${monthName(low.k)}`}</div></div>
  </div>
  <div class="panel"><div class="ph"><h3>Month by month</h3><span class="meta">BDT</span></div><div class="tbl"><table>
    <thead><tr><th></th>${R.map(r => `<th>${MONTHS[(+r.k.slice(5, 7) + 5) % 12]} ${r.k.slice(2, 4)}</th>`).join('')}</tr></thead>
    <tbody><tr><td>Opening</td>${R.map(r => `<td>${n(r.open)}</td>`).join('')}</tr>
      <tr><td style="padding-left:20px">Clients owe</td>${R.map(r => `<td>${r.inv ? n(r.inv) : '–'}</td>`).join('')}</tr>
      <tr><td style="padding-left:20px">Milestones to bill</td>${R.map(r => `<td>${r.ms ? n(r.ms) : '–'}</td>`).join('')}</tr>
      <tr><td style="padding-left:20px">Salaries</td>${R.map(r => `<td class="neg">${r.pay ? n(r.pay) : '–'}</td>`).join('')}</tr>
      <tr><td style="padding-left:20px">Running costs</td>${R.map(r => `<td class="neg">${r.exp ? n(r.exp) : '–'}</td>`).join('')}</tr>
      <tr><td style="padding-left:20px">Vendors</td>${R.map(r => `<td class="neg">${r.wo ? n(r.wo) : '–'}</td>`).join('')}</tr></tbody>
    <tfoot><tr><td>Closing</td>${R.map(r => `<td class="${r.close < 0 ? 'neg' : ''}">${n(r.close)}</td>`).join('')}</tr></tfoot></table></div></div>
  <div class="panel"><div class="ph"><h3>When will you bill these milestones?</h3><span class="meta">${unplanned.filter(x => x.m.expect).length} of ${unplanned.length} planned</span></div>
    ${unplanned.length ? `<div class="rows">${unplanned.map(({ p, m }) => `<div class="row r-mini" style="cursor:default"><div style="min-width:0"><div class="t">${esc(m.label)}</div><div class="sub"><span class="mono">${esc(p.code)}</span> · ${esc(p.name)} · ${tk((+p.fee || 0) * m.pct / 100)}</div></div>
      <input type="month" class="msExpect" data-pid="${p.id}" data-mid="${m.id}" value="${esc(m.expect || '')}" min="${today().slice(0, 7)}" aria-label="Expected billing month" style="background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:5px 6px;font-size:13px;max-width:150px"><span></span></div>`).join('')}</div>`
      : `<div class="empty">Every active milestone has been invoiced.</div>`}</div>
  <p class="hint">A forecast is only as good as its inputs: set the expected month for each milestone above, keep salary sheets and work orders current, and set a budget for running costs.</p>`;
}
function exportPLFull() {
  const { R, T } = plData(S.fy, S.f.basis), cats = COST_CATS.filter(c => T.cats[c]);
  const r = [['', ...R.map(x => x.k), `FY ${fyLabel(S.fy)}`], ['Fee income', ...R.map(x => Math.round(x.income)), Math.round(T.income)],
    ...cats.map(c => [c, ...R.map(x => Math.round(x.cats[c] || 0)), Math.round(T.cats[c])]), ['Total costs', ...R.map(x => Math.round(x.cost)), Math.round(T.cost)], ['Profit', ...R.map(x => Math.round(x.profit)), Math.round(T.profit)]];
  saveCsv(`SLATE-profit-and-loss-${S.f.basis}-FY${fyLabel(S.fy).replace('–', '-')}.csv`, r);
}
function billingReport() {
  const fy = S.fy;
  const rows = Array.from({ length: 12 }, (_, i) => ({ k: monthKey(fy, i), m: MONTHS[i], billed: 0, vat: 0, recv: 0, wh: 0 }));
  const at = d => rows.find(r => d && d.startsWith(r.k));
  S.invoices.forEach(i => { if (['void', 'draft'].includes(invStatus(i))) return; const r = at(i.date); if (r) { r.billed += +i.amount || 0; r.vat += (+i.amount || 0) * (+i.vatPct || 0) / 100; } });
  S.receipts.forEach(x => { const r = at(x.date); if (r) { r.recv += +x.received || 0; r.wh += (+x.ait || 0) + (+x.vds || 0); } });
  const T = rows.reduce((a, r) => ({ billed: a.billed + r.billed, vat: a.vat + r.vat, recv: a.recv + r.recv, wh: a.wh + r.wh }), { billed: 0, vat: 0, recv: 0, wh: 0 });
  const byProj = S.projects.map(p => ({ p, s: projStats(p) })).filter(x => x.s.billed || x.s.fee).sort((a, b) => b.s.outstanding - a.s.outstanding);
  const n = v => v ? nf.format(Math.round(v)) : '–';
  return `
  <div class="head"><div><h2>Billing · FY ${fyLabel(fy)}</h2><p>Billed on the invoice date, excluding VAT. Received on the day the money came in.</p></div>
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
  const r = [['Invoice no', 'Date', 'Due', 'Project code', 'Client', 'Description', 'Payment', 'Taxes', 'Fee (taxable)', 'VAT %', 'Total', 'AIT expected', 'SLATE keeps', 'Received', 'AIT', 'VDS', 'Balance', 'Status']];
  S.invoices.filter(i => inFY(i.date, S.fy)).sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(i => { const p = prj(i.projectId), rc = recsOf(i);
    const sm = k => rc.reduce((s, x) => s + (+x[k] || 0), 0);
    r.push([i.no, i.date, i.due, p?.code, p?.client, i.desc, MODE_LABEL[i.mode] || '', i.vatOn || i.aitOn ? (i.taxMode === 'inclusive' ? 'Inclusive' : 'Added on top') : 'None', i.amount, i.vatPct, Math.round(invTotal(i)), invAit(i), Math.round(invNet(i)), sm('received'), sm('ait'), sm('vds'), Math.round(invDue(i)), ST_LABEL[invStatus(i)]]); });
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
const FIELD = { lines: 'Lines', rates: 'Salary', payDate: 'Paid on', installment: 'Monthly recovery', payMethod: 'Paid by', category: 'Category', payee: 'Paid to', paidOn: 'Paid on', vendor: 'Vendor', scope: 'Scope', gross: 'Settled', paid: 'Paid', rejectReason: 'Reason', opening: 'Opening balance', openingDate: 'Opening date', accountId: 'Account', mrNo: 'Receipt no', mode: 'Payment', net: 'SLATE keeps', entered: 'Entered', actual: 'Counted / statement', from: 'From', to: 'Into', active: 'Active', kind: 'Type', amount: 'Amount', vatPct: 'VAT %', no: 'Number', date: 'Date', due: 'Due date', desc: 'Description', status: 'Status', fee: 'Fee', milestones: 'Milestones', name: 'Name', code: 'Code', client: 'Client', received: 'Received', ait: 'AIT', vds: 'VDS', method: 'Method', ref: 'Reference', note: 'Note', voidReason: 'Void reason', bin: 'BIN', bank: 'Bank details', prefix: 'Number prefix', termsDays: 'Payment terms', lockedFYs: 'Closed years', clientAddress: 'Billing address', location: 'Site', rate: 'Rate', areaSft: 'Area', osId: 'SLATE OS link', type: 'Type', invNote: 'Invoice note', signName: 'Signatory', signTitle: 'Signatory title', projectId: 'Project', milestoneId: 'Milestone', invoiceId: 'Invoice' };
const SKIP = ['createdAt', 'createdBy', 'updatedAt', 'updatedBy'];
/* ----- Dashboard: where income comes from and where the money goes ----- */
// categorical slots, fixed order (validated: adjacent CVD ΔE ≥ 9.1, normal-vision ≥ 19.6); values carry direct labels/tooltips
const DPAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'];
const CGROUPS = [
  ['Salaries & bonuses', DPAL[0], ['Salaries & bonuses']],
  ['Consultants & vendors', DPAL[1], ['Consultants & vendors']],
  ['Office & running', DPAL[2], ['Office rent', 'Utilities', 'Internet & software', 'Repairs & maintenance', 'Office supplies', 'Bank charges']],
  ['Projects & site', DPAL[3], ['Printing & plotting', 'Transport & site visits', 'Authority & approval fees']],
  ['Clients & people', DPAL[4], ['Client meetings & entertainment', 'Marketing', 'Staff welfare']],
  ['Other', '#8E959C', ['Other']]];
const groupOf = c => (CGROUPS.find(g => g[2].includes(c)) || CGROUPS[CGROUPS.length - 1])[0];
const pctTxt = (a, b) => b ? Math.round(a / b * 100) + '%' : '—';
const monthIdx = d => { const m = +String(d).slice(5, 7); return (m + 5) % 12; };

/* every income and cost item of a financial year, on the same basis as Profit & loss */
function ledgerItems(fy, basis) {
  const inc = [], cost = [];
  const wo = id => S.workorders.find(o => o.id === id) || {};
  if (basis === 'cash') {
    S.receipts.forEach(r => { if (!inFY(r.date, fy)) return; const i = S.invoices.find(v => v.id === r.invoiceId); if (!i) return;
      const share = (+i.amount || 0) / (invTotal(i) || 1), settled = (+r.received || 0) + (+r.ait || 0) + (+r.vds || 0);
      const parts = recParts(r), cashPart = parts.filter(x => isCashLike(acct(x.accountId))).reduce((u, x) => u + (+x.amount || 0), 0);
      const cashShare = (+r.received || 0) ? cashPart / (+r.received || 1) : (i.mode === 'cash' ? 1 : 0);
      const fee = settled * share;
      if (fee * cashShare) inc.push({ d: r.date, pid: i.projectId, amt: fee * cashShare, mode: 'cash' });
      if (fee * (1 - cashShare)) inc.push({ d: r.date, pid: i.projectId, amt: fee * (1 - cashShare), mode: 'bank' }); });
    S.expenses.filter(x => x.status !== 'rejected' && x.accountId && inFY(x.paidOn, fy) && !NOT_COST.includes(x.category))
      .forEach(x => cost.push({ d: x.paidOn, cat: x.category, amt: +x.amount || 0, payee: x.payee || '', pid: x.projectId || '' }));
    S.payruns.filter(r => r.status === 'paid' && inFY(r.payDate, fy)).forEach(r => (r.lines || []).forEach(l =>
      cost.push({ d: r.payDate, cat: 'Salaries & bonuses', amt: lineCost(l), payee: '', pid: '', staff: l.staffId, kind: r.kind })));
  } else {
    S.invoices.filter(i => !['void', 'draft'].includes(invStatus(i)) && inFY(i.date, fy))
      .forEach(i => inc.push({ d: i.date, pid: i.projectId, amt: +i.amount || 0, mode: i.mode === 'cash' ? 'cash' : 'bank' }));
    S.expenses.filter(x => x.status !== 'rejected' && inFY(x.date, fy) && !NOT_COST.includes(x.category))
      .forEach(x => cost.push({ d: x.date, cat: x.category, amt: +x.amount || 0, payee: x.payee || '', pid: x.projectId || '' }));
    S.payruns.filter(r => ['approved', 'paid'].includes(r.status) && inFY(r.month + '-01', fy)).forEach(r => (r.lines || []).forEach(l =>
      cost.push({ d: r.month + '-01', cat: 'Salaries & bonuses', amt: lineCost(l), payee: '', pid: '', staff: l.staffId, kind: r.kind })));
  }
  S.wopays.filter(x => inFY(x.date, fy)).forEach(x => { const w = wo(x.woId); cost.push({ d: x.date, cat: 'Consultants & vendors', amt: +x.gross || 0, payee: w.vendor || '', pid: w.projectId || '', wtype: w.type || '' }); });
  return { inc: inc.filter(x => x.amt), cost: cost.filter(x => x.amt) };
}
const sumBy = (arr, key, val = x => x.amt) => { const m = new Map(); arr.forEach(x => { const k = typeof key === 'function' ? key(x) : x[key]; m.set(k, (m.get(k) || 0) + val(x)); }); return m; };
const topN = (m, n) => { const a = [...m.entries()].filter(([, v]) => v).sort((x, y) => y[1] - x[1]); if (a.length <= n) return a; const rest = a.slice(n - 1).reduce((u, [, v]) => u + v, 0); return [...a.slice(0, n - 1), ['__other', rest, a.length - n + 1]]; };

/* rounded data-end bar (top corners), anchored to the baseline */
function barPath(x, y, w, h, r = 3) { if (h <= 0) return ''; r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }
function axis(max, W, L, R, y) { const step = niceStep(max / 3); let g = '';
  for (let v = 0; v <= max + 1; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${axisLbl(v)}</text>`;
  return g; }
/* monthly bars: grouped (side by side) or stacked; one hover target per month */
function monthBars(fy, series, { stack = false, H = 230, label = '', W = 720 } = {}) {
  const tot = i => stack ? series.reduce((u, s) => u + (s.vals[i] || 0), 0) : Math.max(...series.map(s => s.vals[i] || 0));
  const raw = Math.max(0, ...MONTHS.map((_, i) => tot(i)));
  if (!raw) return '';
  const step = niceStep(raw / 3), max = step * Math.ceil(raw / step);
  const L = 56, R = 6, T = 12, B = 28, cw = (W - L - R) / 12;
  const y = v => T + (H - T - B) * (1 - v / max), cur = today().slice(0, 7);
  let out = axis(max, W, L, R, y);
  for (let i = 0; i < 12; i++) {
    const x0 = L + cw * i, isCur = monthKey(fy, i) === cur;
    if (stack) { const bw = Math.min(26, cw * 0.56), x = x0 + (cw - bw) / 2; let base = 0; const segs = series.filter(s => s.vals[i]);
      segs.forEach((s, k) => { const v = s.vals[i], top = y(base + v), h = y(base) - top - (k ? 2 : 0);
        out += k === segs.length - 1 ? `<path d="${barPath(x, top, bw, Math.max(0, h))}" fill="${s.color}"/>` : `<rect x="${x}" y="${top}" width="${bw}" height="${Math.max(0, h)}" fill="${s.color}"/>`; base += v; }); }
    else { const n = series.length, bw = Math.min(16, (cw * 0.7 - (n - 1) * 2) / n), gx = x0 + (cw - (bw * n + (n - 1) * 2)) / 2;
      series.forEach((s, k) => { const v = s.vals[i] || 0; out += `<path d="${barPath(gx + k * (bw + 2), y(v), bw, y(0) - y(v))}" fill="${s.color}"/>`; }); }
    out += `<text x="${x0 + cw / 2}" y="${H - 9}" text-anchor="middle" font-size="11" fill="${isCur ? 'var(--ink)' : 'var(--muted)'}" font-weight="${isCur ? 600 : 400}">${MONTHS[i]}</text>`;
    const tip = `${MONTHS[i]} ${monthKey(fy, i).slice(0, 4)}\n` + series.filter(s => s.vals[i] || !stack).map(s => `${s.name}: ${tk(s.vals[i] || 0)}`).join('\n') + (stack ? `\nTotal: ${tk(tot(i))}` : '') + (series[0].extra ? series[0].extra(i) : '');
    out += `<rect x="${x0}" y="${T}" width="${cw}" height="${H - T - B}" fill="transparent" data-tip="${esc(tip)}"/>`;
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${out}<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--muted)"/></svg>`;
}
/* lines over the 12 months of a financial year */
function monthLines(fy, series, { H = 220, label = '', W = 720 } = {}) {
  const raw = Math.max(0, ...series.flatMap(s => s.vals.slice(0, s.upto ?? 12)));
  const lo = Math.min(0, ...series.flatMap(s => s.vals.slice(0, s.upto ?? 12)));
  if (!raw && !lo) return '';
  const step = niceStep((raw - lo) / 3), max = step * Math.ceil(raw / step), min = lo < 0 ? -step * Math.ceil(-lo / step) : 0;
  const L = 56, R = 6, T = 12, B = 28, cw = (W - L - R) / 12;
  const y = v => T + (H - T - B) * (1 - (v - min) / (max - min || 1));
  let out = '';
  for (let v = min; v <= max + 1; v += step) out += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="${v === 0 ? 'var(--muted)' : 'var(--grid)'}"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)" font-family="IBM Plex Mono, monospace">${v < 0 ? '−' : ''}${axisLbl(Math.abs(v))}</text>`;
  series.forEach(s => { const n = s.upto ?? 12, pts = s.vals.slice(0, n).map((v, i) => `${(L + cw * i + cw / 2).toFixed(1)},${y(v).toFixed(1)}`);
    if (!pts.length) return;
    out += `<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="5 4"' : ''}/>`;
    const last = pts[pts.length - 1].split(','); out += `<circle cx="${last[0]}" cy="${last[1]}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`; });
  for (let i = 0; i < 12; i++) { const x0 = L + cw * i;
    out += `<text x="${x0 + cw / 2}" y="${H - 9}" text-anchor="middle" font-size="11" fill="var(--muted)">${MONTHS[i]}</text>`;
    const vis = series.filter(s => i < (s.upto ?? 12)); if (!vis.length) continue;
    out += `<rect x="${x0}" y="${T}" width="${cw}" height="${H - T - B}" fill="transparent" data-tip="${esc(`${MONTHS[i]}\n` + vis.map(s => `${s.name}: ${tk(s.vals[i])}`).join('\n'))}"/>`; }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${out}</svg>`;
}
/* ranked horizontal bars with the value and share written beside each bar */
function rankBars(rows, total, color = 'var(--inflow)') {
  if (!rows.length) return '<div class="empty" style="padding:14px">Nothing in this period.</div>';
  const max = Math.max(1, ...rows.map(r => r.v));
  return `<div class="rk">${rows.map(r => `<div class="rk-r" data-tip="${esc(r.tip || `${r.label}\n${tk(r.v)} · ${pctTxt(r.v, total)} of total`)}">
    <div class="rk-l"><span class="t">${esc(r.label)}</span>${r.sub ? `<span class="sub">${esc(r.sub)}</span>` : ''}</div>
    <div class="rk-b"><i style="width:${Math.max(1, r.v / max * 100).toFixed(1)}%;background:${r.color || color}"></i></div>
    <div class="rk-v"><span class="num">${compact(r.v)}</span><small>${pctTxt(r.v, total)}</small></div></div>`).join('')}</div>`;
}
function shareBar(parts) {   // 100% bar; every part labelled underneath
  const tot = parts.reduce((u, p) => u + p.v, 0); if (!tot) return '<div class="empty" style="padding:14px">Nothing in this period.</div>';
  return `<div class="sbar">${parts.filter(p => p.v).map(p => `<i style="flex:${p.v} 1 0;background:${p.color}" data-tip="${esc(`${p.label}\n${tk(p.v)} · ${pctTxt(p.v, tot)}`)}"></i>`).join('')}</div>
    <div class="slegend">${parts.filter(p => p.v).map(p => `<span><i style="background:${p.color}"></i>${esc(p.label)} <b class="num">${pctTxt(p.v, tot)}</b> <span class="muted">${compact(p.v)}</span></span>`).join('')}</div>`;
}
const legendHTML = items => `<div class="legend" style="flex-wrap:wrap">${items.map(([l, c]) => `<span style="--c:${c}">${esc(l)}</span>`).join('')}</div>`;
const delta = (now, then) => { if (!then) return now ? '<span class="muted">new this year</span>' : ''; const p = Math.round((now - then) / Math.abs(then) * 100);
  return `<b class="${p >= 0 ? 'good' : 'bad'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</b> vs last FY`; };
const deltaCost = (now, then) => { if (!then) return now ? '<span class="muted">new this year</span>' : ''; const p = Math.round((now - then) / Math.abs(then) * 100);
  return `<b class="${p <= 0 ? 'good' : 'bad'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</b> vs last FY`; };

function dashboard() {
  const fy = S.fy, basis = S.f.basis, t = today(), curFY = fyOf(t) === fy;
  const span = curFY ? monthIdx(t) + 1 : 12;                 // months of this FY so far
  const like = x => !curFY || monthIdx(x.d) < span;           // last FY, same months, for a fair comparison
  const A = ledgerItems(fy, basis), Pv = ledgerItems(fy - 1, basis);
  const P = { inc: Pv.inc.filter(like), cost: Pv.cost.filter(like) };
  const incT = A.inc.reduce((u, x) => u + x.amt, 0), costT = A.cost.reduce((u, x) => u + x.amt, 0), profit = incT - costT;
  const incP = P.inc.reduce((u, x) => u + x.amt, 0), costP = P.cost.reduce((u, x) => u + x.amt, 0);
  const segBasis = `<div class="seg">${[['billed', 'Billed'], ['cash', 'Cash']].map(([k, l]) => `<button data-act="f-basis" data-v="${k}" aria-pressed="${basis === k}">${l}</button>`).join('')}</div>`;
  const head = `<div class="head"><div><h2>Dashboard · FY ${fyLabel(fy)}</h2><p>${basis === 'cash' ? 'Cash basis: income when clients pay (fee share, before VAT), costs when money leaves an account.' : 'Billed basis: income when invoiced (before VAT), costs when incurred.'} Compared with the same ${span === 12 ? 'months' : span + ' months'} of FY ${fyLabel(fy - 1)}.</p></div><div class="actions">${segBasis}</div></div>`;
  if (!A.inc.length && !A.cost.length && !P.inc.length && !P.cost.length)
    return head + `<div class="panel"><div class="empty"><strong>Nothing to analyse yet</strong>Invoices, payments, expenses, work orders and salary sheets for FY ${fyLabel(fy)} will build this dashboard.</div></div>`;

  // monthly series
  const mInc = Array(12).fill(0), mCost = Array(12).fill(0), mIncP = Array(12).fill(0);
  A.inc.forEach(x => mInc[monthIdx(x.d)] += x.amt); A.cost.forEach(x => mCost[monthIdx(x.d)] += x.amt);
  Pv.inc.forEach(x => mIncP[monthIdx(x.d)] += x.amt);
  const cum = a => a.reduce((o, v, i) => (o.push((o[i - 1] || 0) + v), o), []);
  const mProfit = mInc.map((v, i) => v - mCost[i]);

  // cash position and runway (money actually leaving accounts; transfers between accounts don't count)
  const accts = activeAccts(), cashNow = accts.reduce((u, a) => u + acctBal(a, t), 0);
  const outByMonth = new Map(), inByMonth = new Map();
  S.accounts.forEach(a => acctEntries(a).forEach(e => { if (e.kind === 'move') { const m = S.moves.find(x => x.id === e.id); if (m && m.type === 'transfer') return; }
    const k = (e.date || '').slice(0, 7); if (e.amt < 0) outByMonth.set(k, (outByMonth.get(k) || 0) - e.amt); else inByMonth.set(k, (inByMonth.get(k) || 0) + e.amt); }));
  const last3 = [1, 2, 3].map(n => nextMonth(t.slice(0, 7), -n)), burn = last3.reduce((u, k) => u + (outByMonth.get(k) || 0), 0) / 3;
  const runway = burn ? cashNow / burn : null;

  // collections
  const recFY = S.receipts.filter(r => inFY(r.date, fy));
  let wDays = 0, wAmt = 0; recFY.forEach(r => { const i = S.invoices.find(v => v.id === r.invoiceId); if (!i || !i.date) return; const a = +r.received || 0; wDays += Math.max(0, daysBetween(i.date, r.date)) * a; wAmt += a; });
  const dso = wAmt ? Math.round(wDays / wAmt) : null;
  const invFY = S.invoices.filter(i => !['void', 'draft'].includes(invStatus(i)) && inFY(i.date, fy));
  const billedTot = invFY.reduce((u, i) => u + invTotal(i), 0), settledTot = invFY.reduce((u, i) => u + Math.min(invSettled(i), invTotal(i)), 0);
  const receivable = S.invoices.filter(invOpen).reduce((u, i) => u + invDue(i), 0);
  const unbilled = S.projects.filter(p => (p.status || 'active') === 'active').reduce((u, p) => u + projStats(p).unbilled, 0);

  // income breakdowns
  const byPid = sumBy(A.inc, 'pid'), byPidP = sumBy(P.inc, 'pid');
  const clientOf = pid => { const p = prj(pid); return p ? (p.client || p.name || 'Unknown client') : 'Unknown project'; };
  const byClient = sumBy(A.inc, x => clientOf(x.pid));
  const byType = sumBy(A.inc, x => (prj(x.pid) || {}).type || 'Not set');
  const byMode = sumBy(A.inc, 'mode');
  const clientsSorted = [...byClient.entries()].sort((a, b) => b[1] - a[1]);
  const top1 = clientsSorted[0] ? clientsSorted[0][1] : 0, top3 = clientsSorted.slice(0, 3).reduce((u, x) => u + x[1], 0);
  const clientRows = topN(byClient, 8).map(([k, v, n]) => ({ label: k === '__other' ? `${n} other clients` : k, v }));
  const typeRows = [...byType.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, v }));
  const projRows = topN(byPid, 10).map(([k, v, n]) => { if (k === '__other') return { label: `${n} other projects`, v };
    const p = prj(k) || {}, was = byPidP.get(k) || 0; return { label: p.name || 'Unknown project', sub: [p.code, p.client].filter(Boolean).join(' · '), v, tip: `${p.name || ''}\n${tk(v)} · ${pctTxt(v, incT)} of income${was ? `\nSame months last FY: ${tk(was)}` : ''}` }; });

  // cost breakdowns
  const byCat = sumBy(A.cost, 'cat'), byCatP = sumBy(P.cost, 'cat');
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => { const was = byCatP.get(k) || 0, g = CGROUPS.find(x => x[0] === groupOf(k));
    return { label: k, v, color: g[1], sub: was ? `${v >= was ? '+' : '−'}${compact(Math.abs(v - was)).replace('৳ ', '৳')} vs last FY` : 'new this year', tip: `${k}\n${tk(v)} · ${pctTxt(v, costT)} of costs\nSame months last FY: ${tk(was)}` }; });
  const grpSeries = CGROUPS.map(([name, color]) => ({ name, color, vals: Array(12).fill(0) }));
  A.cost.forEach(x => { const g = grpSeries.find(s => s.name === groupOf(x.cat)); g.vals[monthIdx(x.d)] += x.amt; });
  const grpTot = grpSeries.map(s => ({ label: s.name, v: s.vals.reduce((u, v) => u + v, 0), color: s.color }));
  const payees = sumBy(A.cost.filter(x => x.payee), x => x.payee);
  const payeeRows = topN(payees, 8).map(([k, v, n]) => ({ label: k === '__other' ? `${n} others` : k, v }));
  const woTypes = sumBy(A.cost.filter(x => x.wtype), 'wtype');
  // payroll
  const sal = Array(12).fill(0), heads = Array.from({ length: 12 }, () => new Set()), bonus = Array(12).fill(0);
  A.cost.filter(x => x.cat === 'Salaries & bonuses').forEach(x => { const i = monthIdx(x.d); if (x.kind === 'bonus') bonus[i] += x.amt; else { sal[i] += x.amt; if (x.staff) heads[i].add(x.staff); } });
  const salT = sal.reduce((u, v) => u + v, 0) + bonus.reduce((u, v) => u + v, 0);
  const salSeries = [{ name: 'Salaries', color: DPAL[0], vals: sal, extra: i => heads[i].size ? `\nStaff paid: ${heads[i].size}` : '' }, { name: 'Bonuses', color: DPAL[1], vals: bonus }];
  // taxes
  const vatBilled = invFY.reduce((u, i) => u + invTotal(i) - (+i.amount || 0), 0);
  const aitBy = recFY.reduce((u, r) => u + (+r.ait || 0), 0), vdsBy = recFY.reduce((u, r) => u + (+r.vds || 0), 0);
  const wpFY = S.wopays.filter(x => inFY(x.date, fy)), withheld = wpFY.reduce((u, x) => u + (+x.ait || 0) + (+x.vds || 0), 0);
  const deposited = S.expenses.filter(x => x.category === 'Tax deposited (AIT/VDS withheld)' && x.status !== 'rejected' && inFY(x.paidOn || x.date, fy)).reduce((u, x) => u + (+x.amount || 0), 0);
  // projects: income against direct costs (consultants and expenses tagged to the project)
  const direct = sumBy(A.cost.filter(x => x.pid), 'pid');
  const projIds = [...new Set([...byPid.keys(), ...direct.keys()])].filter(Boolean);
  const projTbl = projIds.map(id => { const p = prj(id) || {}, st = p.id ? projStats(p) : { fee: 0, unbilled: 0, outstanding: 0 }, inc = byPid.get(id) || 0, dc = direct.get(id) || 0;
    return { p, inc, dc, net: inc - dc, fee: st.fee, out: st.outstanding, unb: st.unbilled }; }).sort((a, b) => b.inc - a.inc);
  // cash flow
  const cIn = MONTHS.map((_, i) => inByMonth.get(monthKey(fy, i)) || 0), cOut = MONTHS.map((_, i) => outByMonth.get(monthKey(fy, i)) || 0);
  const openFY = S.accounts.reduce((u, a) => u + acctBal(a, (fy) + '-06-30') , 0);
  const closing = cum(cIn.map((v, i) => v - cOut[i])).map(v => v + openFY);
  const curIdx = curFY ? span : 12;

  const kpi = (lb, v, s, style = '') => `<div class="kpi"><div class="lb">${lb}</div><div class="v"${style}>${v}</div><div class="s">${s}</div></div>`;
  const margin = incT ? Math.round(profit / incT * 100) : null;
  const n = v => v ? nf.format(Math.round(v)) : '–';

  return head + `
  <div class="kpis">
    ${kpi('Income', compact(incT), delta(incT, incP))}
    ${kpi('Costs', compact(costT), deltaCost(costT, costP))}
    ${kpi('Profit', compact(profit), margin == null ? 'no income yet' : `${margin}% margin · ${delta(profit, incP - costP).replace(' vs last FY', '')}`, ` style="color:var(${profit < 0 ? '--bad' : '--good'})"`)}
    ${kpi('Average month', compact(incT / span), `income · ${compact(costT / span)} costs`)}
  </div>
  <div class="kpis">
    ${kpi('Cash & bank now', compact(cashNow), runway == null ? 'no spending in the last 3 months' : `<b class="${runway < 3 ? 'bad' : runway < 6 ? '' : 'good'}">${runway.toFixed(1)} months</b> of spending covered`)}
    ${kpi('Days to get paid', dso == null ? '—' : dso + ' days', 'invoice date to payment, weighted by amount')}
    ${kpi('Collected', billedTot ? pctTxt(settledTot, billedTot) : '—', `of ${compact(billedTot)} invoiced this FY`)}
    ${kpi('Receivable · not yet billed', compact(receivable), `${compact(unbilled)} of active fees still to bill`)}
  </div>

  <div class="panel"><div class="ph"><h3>Income and costs by month</h3>${legendHTML([['Income', 'var(--inflow)'], ['Costs', 'var(--red)']])}</div>
    <div class="pb chart">${monthBars(fy, [{ name: 'Income', color: 'var(--inflow)', vals: mInc, extra: i => `\nProfit: ${tk(mProfit[i])}` }, { name: 'Costs', color: 'var(--red)', vals: mCost }], { label: 'Income and costs by month' }) || '<div class="empty">Nothing yet.</div>'}</div></div>

  <div class="grid2">
    <div class="panel"><div class="ph"><h3>Income building up</h3>${legendHTML([['FY ' + fyLabel(fy), DPAL[0]], ['FY ' + fyLabel(fy - 1), '#8E959C']])}</div>
      <div class="pb chart">${monthLines(fy, [{ name: 'FY ' + fyLabel(fy), color: DPAL[0], vals: cum(mInc), upto: curIdx }, { name: 'FY ' + fyLabel(fy - 1), color: '#8E959C', vals: cum(mIncP), dash: true }], { label: 'Cumulative income', W: 440, H: 240 }) || '<div class="empty">Nothing yet.</div>'}</div></div>
    <div class="panel"><div class="ph"><h3>Profit building up</h3><span class="meta">income less costs, running total</span></div>
      <div class="pb chart">${monthLines(fy, [{ name: 'Profit so far', color: DPAL[2], vals: cum(mProfit), upto: curIdx }], { label: 'Cumulative profit', W: 440, H: 240 }) || '<div class="empty">Nothing yet.</div>'}</div></div>
  </div>

  <div class="sec-h"><h3>Where income comes from</h3></div>
  <div class="grid2">
    <div class="panel"><div class="ph"><h3>By client</h3><span class="meta">${byClient.size} client${byClient.size === 1 ? '' : 's'}</span></div><div class="pb">${rankBars(clientRows, incT)}
      ${incT ? `<p class="hint" style="margin:12px 0 0">Largest client: <b>${pctTxt(top1, incT)}</b> of income · top three: <b>${pctTxt(top3, incT)}</b>${top1 / incT > 0.4 ? ' · <span class="bad">heavy reliance on one client</span>' : ''}</p>` : ''}</div></div>
    <div class="panel"><div class="ph"><h3>By project</h3><span class="meta">top 10</span></div><div class="pb">${rankBars(projRows, incT)}</div></div>
  </div>
  <div class="grid2">
    <div class="panel"><div class="ph"><h3>By project type</h3></div><div class="pb">${rankBars(typeRows, incT)}</div></div>
    <div class="panel"><div class="ph"><h3>How clients pay</h3><span class="meta">${basis === 'cash' ? 'by the account the money went into' : 'by invoice type'}</span></div><div class="pb">
      ${shareBar([{ label: 'Bank', v: byMode.get('bank') || 0, color: DPAL[0] }, { label: 'Cash', v: byMode.get('cash') || 0, color: DPAL[2] }])}
      <dl class="kv" style="margin-top:14px">
        <dt>VAT on invoices</dt><dd class="num">${tk(vatBilled)}</dd>
        <dt>AIT deducted by clients</dt><dd class="num">${tk(aitBy)}</dd>
        <dt>VDS deducted by clients</dt><dd class="num">${tk(vdsBy)}</dd>
        <dt>AIT/VDS we withheld from vendors</dt><dd class="num">${tk(withheld)}</dd>
        <dt>Tax deposited</dt><dd class="num">${tk(deposited)}</dd>
      </dl></div></div>
  </div>

  <div class="sec-h"><h3>Where the money goes</h3></div>
  <div class="panel"><div class="ph"><h3>Cost mix by month</h3>${legendHTML(CGROUPS.map(g => [g[0], g[1]]))}</div>
    <div class="pb chart">${monthBars(fy, grpSeries, { stack: true, label: 'Cost mix by month' }) || '<div class="empty">No costs yet.</div>'}</div>
    <div class="pb" style="border-top:1px solid var(--line)">${shareBar(grpTot)}</div></div>
  <div class="grid2">
    <div class="panel"><div class="ph"><h3>By category</h3><span class="meta">${compact(costT)} total</span></div><div class="pb">${rankBars(catRows, costT)}</div></div>
    <div class="panel"><div class="ph"><h3>Who gets paid most</h3><span class="meta">vendors and payees, excluding salaries</span></div><div class="pb">${rankBars(payeeRows, costT, DPAL[1])}
      ${woTypes.size ? `<div class="sec-t" style="margin:16px 0 8px">Consultants by type</div>${rankBars([...woTypes.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, v })), costT, DPAL[1])}` : ''}</div></div>
  </div>
  <div class="panel"><div class="ph"><h3>Payroll</h3><span class="meta">${compact(salT)} · ${pctTxt(salT, incT)} of income · ${pctTxt(salT, costT)} of costs</span></div>
    <div class="pb chart">${monthBars(fy, salSeries, { stack: true, label: 'Payroll cost by month', H: 180 }) || '<div class="empty">No salary sheets in this period yet.</div>'}</div></div>

  <div class="sec-h"><h3>Projects and cash</h3></div>
  <div class="panel"><div class="ph"><h3>Project income against direct costs</h3><span class="meta">direct costs = consultants and expenses tagged to the project</span></div>
    ${projTbl.length ? `<div class="tbl"><table><thead><tr><th>Project</th><th>Fee</th><th>Income · FY</th><th>Direct costs · FY</th><th>After direct costs</th><th>Outstanding</th><th>Not yet billed</th></tr></thead><tbody>
      ${projTbl.map(r => `<tr><td><b>${esc(r.p.name || 'Unknown project')}</b><div class="sub">${esc([r.p.code, r.p.client].filter(Boolean).join(' · '))}</div></td><td>${n(r.fee)}</td><td>${n(r.inc)}</td><td>${n(r.dc)}</td><td class="${r.net < 0 ? 'neg' : ''}">${n(r.net)}${r.inc ? ` <small class="muted">${pctTxt(r.net, r.inc)}</small>` : ''}</td><td>${n(r.out)}</td><td>${n(r.unb)}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty">No project income or direct costs in this period.</div>'}</div>
  <div class="grid2">
    <div class="panel"><div class="ph"><h3>Money in and out of accounts</h3>${legendHTML([['In', 'var(--inflow)'], ['Out', 'var(--red)']])}</div>
      <div class="pb chart">${monthBars(fy, [{ name: 'In', color: 'var(--inflow)', vals: cIn, extra: i => `\nNet: ${tk(cIn[i] - cOut[i])}` }, { name: 'Out', color: 'var(--red)', vals: cOut }], { label: 'Cash in and out', W: 440, H: 240 }) || '<div class="empty">No account movements yet.</div>'}</div></div>
    <div class="panel"><div class="ph"><h3>Cash and bank at month end</h3><span class="meta">all accounts</span></div>
      <div class="pb chart">${monthLines(fy, [{ name: 'Balance', color: DPAL[0], vals: closing, upto: curIdx }], { label: 'Month-end balance', W: 440, H: 240 }) || '<div class="empty">No accounts yet.</div>'}</div></div>
  </div>
  <p class="hint">Transfers between your own accounts are left out of money in and out. Capital you put in counts as money in; drawings as money out. VAT, tax deposits and drawings are not income or cost.</p>`;
}

function auditLine(a) {
  const [coll] = a.path.split('/'), d = a.after || a.before || {};
  const an = id => (acct(id) || {}).name || 'an account';
  const nm = coll === 'invoices' ? `invoice ${d.no || ''}` : coll === 'receipts' ? `payment of ${tk(d.received)} on ${(S.invoices.find(x => x.id === d.invoiceId) || {}).no || 'an invoice'}${d.mrNo ? ` (${d.mrNo})` : ''}`
    : coll === 'projects' ? `project fee ${d.code || ''}` : coll === 'accounts' ? `account ${d.name || ''}`
    : coll === 'moves' ? (d.type === 'transfer' ? `transfer of ${tk(d.amount)} from ${an(d.from)} to ${an(d.to)}` : `${(MOVE_LABEL[d.type] || 'entry').toLowerCase()} of ${tk(d.amount)}`)
    : coll === 'recons' ? `month-end check of ${an(d.accountId)} for ${d.month || ''}`
    : coll === 'expenses' ? `expense “${d.desc || ''}” (${tk(d.amount)})` : coll === 'workorders' ? `work order ${d.no || ''} for ${d.vendor || ''}`
    : coll === 'budgets' ? `budget for FY ${fyLabel(+d.fy || S.fy)}` : coll === 'staff' ? `staff record for ${d.name || ''}` : coll === 'advances' ? `advance of ${tk(d.amount)} to ${(staffOf(d.staffId) || {}).name || 'staff'}`
    : coll === 'payruns' ? `${runLabel(d)} (${tk(runTotals(d).net)})`
    : coll === 'wopays' ? `payment of ${tk((+d.gross || 0) - (+d.ait || 0) - (+d.vds || 0))} on work order ${(S.workorders.find(w => w.id === d.woId) || {}).no || ''}` : 'finance settings';
  let verb = a.op === 'insert' ? 'added' : a.op === 'delete' ? 'removed' : 'changed';
  if (coll === 'invoices') {
    if (a.op === 'insert') verb = d.status === 'issued' ? 'issued' : 'drafted';
    else if (a.op === 'update' && a.before && a.after && a.before.status !== a.after.status) verb = a.after.status === 'void' ? 'voided' : a.after.status === 'issued' ? 'issued' : 'changed';
  }
  if (coll === 'receipts' && a.op === 'insert') verb = 'recorded';
  if (coll === 'payruns' && a.op === 'update' && a.before && a.after && a.before.status !== a.after.status) verb = { submitted: 'submitted', approved: 'approved', paid: 'paid', draft: 'reopened' }[a.after.status] || 'changed';
  if (coll === 'advances' && a.op === 'update' && a.before && a.after && a.before.status !== a.after.status) verb = a.after.status === 'approved' ? 'approved' : 'rejected';
  if ((coll === 'expenses' || coll === 'workorders') && a.op === 'update' && a.before && a.after && a.before.status !== a.after.status) verb = a.after.status === 'approved' ? 'approved' : a.after.status === 'rejected' ? 'rejected' : a.after.status === 'closed' ? 'closed' : 'reopened';
  if (coll === 'expenses' && a.op === 'insert') verb = d.status === 'approved' ? 'added' : 'sent for approval';
  const changes = a.op === 'update' && a.before && a.after ? Object.keys({ ...a.before, ...a.after }).filter(k => !SKIP.includes(k) && JSON.stringify(a.before[k]) !== JSON.stringify(a.after[k])) : [];
  const val = (k, v) => v == null || v === '' ? '—' : k === 'lines' ? `${(v || []).length} staff, ${tk(runTotals({ lines: v }).net)} net` : k === 'rates' ? (v || []).map(r => `${r.from}: ${tk(grossOf(r))}`).join(', ') : ['amount', 'fee', 'received', 'ait', 'vds', 'opening', 'net', 'entered', 'actual', 'book', 'diff', 'gross', 'paid'].includes(k) ? tk(v) : k === 'milestones' ? (v || []).map(m => `${m.label} ${m.pct}%`).join(', ') : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;cursor:default"><div style="min-width:0"><div class="t" style="white-space:normal"><b style="font-weight:600">${who(a.actor)}</b> ${verb} ${esc(nm)}</div>
    ${changes.length ? `<div class="sub" style="white-space:normal">${changes.slice(0, 6).map(k => `${esc(FIELD[k] || k)}: ${esc(val(k, a.before[k]))} → ${esc(val(k, a.after[k]))}`).join(' · ')}</div>` : ''}</div><div class="sub">${fmtWhen(a.at)}</div></div>`;
}
function activity() {
  if (!S.audit) { loadAudit(); return `<div class="head"><div><h2>Change log</h2><p>Loading…</p></div></div>`; }
  return `<div class="head"><div><h2>Change log</h2><p>Every change to finance, with who made it and when. Only the Principal and the COO can see this. Entries can't be edited or removed.</p></div><div class="actions"><button class="btn" data-act="reload-audit">Refresh</button></div></div>
  <div class="panel">${S.audit.length ? `<div class="rows">${S.audit.map(auditLine).join('')}</div>` : `<div class="empty">No changes yet.</div>`}</div>`;
}

/* ----- Guide: how to use Finance, for the Principal and the COO ----- */
const G_ROUTINE = {
  principal: [
    ['Overview', 'Start here', 'Cash and bank now, what clients owe, what is not yet billed, and everything waiting for your approval.'],
    ['Overview', 'Decide what is waiting', 'Expenses, work orders, advances and salary sheets the COO sent. Approve, or Reject with a reason so the COO knows what to do next. Approve all clears every pending expense at once.'],
    ['Invoices', 'Check what is overdue', 'The red count on Invoices is overdue bills. Open one to see its payments and chase the client.'],
    ['Payroll', 'Approve the salary sheet', 'Each month the COO prepares the sheet and submits it. Check it, then Approve. It is paid only after you approve.'],
    ['Reports', 'Read the month', 'Profit & loss, Budget against spending, and the 6-month cash Forecast. Set the budget once a year.'],
    ['Settings', 'Close the year', 'After 30 June, Close year. Nothing in a closed year can change until you reopen it.']],
  coo: [
    ['Projects', 'Add the project fee', 'When an agreement is signed: Add project fee. Pick the SLATE OS project, enter the fee and the payment milestones (they must add up to 100%).'],
    ['Invoices', 'Bill each milestone', 'From the project or Overview › Next milestones to bill: Invoice. Save as draft, check the Preview, then Issue invoice.'],
    ['Invoices', 'Record the payment', 'When money arrives: Record payment. Fill one or more accounts if it came part cash, part bank; one money receipt covers it. Print the Receipt for the client.'],
    ['Expenses', 'Log every cost', 'New expense, or Petty cash › Record bills for small cash spends. Each goes to the Principal; record the payment once approved.'],
    ['Work orders', 'Hire a consultant or vendor', 'New work order with scope, value and payment schedule. After the Principal approves, print it for signature and pay each instalment; AIT and VDS are withheld for you.'],
    ['Payroll', 'Run the salaries', 'Salary sheet for the month: adjust leave, advances and tax, then Submit for approval. Once approved, Record payment and print the Payslips.'],
    ['Cash & bank', 'Check the books monthly', 'Month-end check on every account: count the cash, enter the bank statement balance. Short or over shows straight away.']]
};
const G_FLOW = [['Project fee', 'Fee and milestones'], ['Invoice', 'Draft, then issued'], ['Payment', 'Cash, bank or both'], ['Money receipt', 'Printed for the client'], ['Cash & bank', 'In the account book']];
const G_RULES = [
  'Issued invoices are fixed. Only the due date can change. To correct one, Void it (only possible before any payment) and issue a new one; a voided number is never reused.',
  'Bank invoices carry VAT and AIT by default. Cash invoices leave them off unless the client needs them.',
  'Every expense, work order, advance and salary sheet the COO raises waits for the Principal. What the Principal raises is approved at once.',
  'Money the Principal takes out goes through Cash & bank › Owner’s drawing; it is not a studio expense. If the Principal draws a fixed salary, add them as staff under Payroll instead.',
  'Things with history are never deleted: mark a project closed, an account or a staff member inactive.',
  'Delete and void buttons need a second tap to confirm.',
  'The Change log keeps every change with who made it and when. Nobody can edit it.',
  'Finance figures never reach the team, their notifications or the SLATE OS log.'];
const G_WHERE = [['Overview', 'Today’s position and your approvals'], ['Dashboard', 'Income, costs, profit and runway against last year'], ['Projects', 'Fees and milestones per project'], ['Invoices', 'Bills and client payments'], ['Expenses', 'Studio and project costs'], ['Work orders', 'Consultants and vendors, paid in instalments'], ['Payroll', 'Staff, salary sheets, Eid bonuses, advances'], ['Petty cash', 'The cash box, bills and top-ups'], ['Cash & bank', 'Every account’s book, transfers, drawings'], ['Reports', 'Profit & loss, budget, forecast, billing'], ['Change log', 'Who changed what'], ['Settings', 'Tax rates, numbering, letterhead, year close']];
function guideView() {
  const who = S.f.guide || (isPrincipal() ? 'principal' : 'coo');
  const steps = G_ROUTINE[who];
  const tab = k => (TABS.find(([, l]) => l === k) || [])[0] || '';
  const card = (n, [t, h, d]) => `<li class="g-step"><span class="g-no">${String(n + 1).padStart(2, '0')}</span><b>${esc(h)}</b><p>${esc(d)}</p>${tab(t) ? `<button class="btn sm ghost" data-tab="${tab(t)}">Open ${esc(t)} ›</button>` : ''}</li>`;
  return `<div class="head"><div><h2>How to use Finance</h2><p>Fees, invoices, payments, costs and payroll for SLATE. Only the Principal and the COO can open it. Figures in BDT; the financial year runs July to June.</p></div></div>
  <div class="filters"><div class="seg">${[['principal', 'Principal'], ['coo', 'COO']].map(([k, l]) => `<button data-act="f-guide" data-v="${k}" aria-pressed="${who === k}">${l}${(isPrincipal() ? 'principal' : 'coo') === k ? ' · you' : ''}</button>`).join('')}</div></div>
  <section class="panel"><div class="ph"><h3>${who === 'principal' ? 'Your routine as Principal' : 'Your routine as COO'}</h3><span class="meta">${who === 'principal' ? 'Approve, review, close' : 'Record, bill, pay, check'}</span></div>
    <div class="pb"><ol class="g-steps">${steps.map((x, i) => card(i, x)).join('')}</ol></div></section>
  <section class="panel"><div class="ph"><h3>How a fee becomes money in the bank</h3></div>
    <div class="pb"><div class="g-flow">${G_FLOW.map(([t, d], i) => `${i ? '<span class="g-arr" aria-hidden="true">→</span>' : ''}<div class="g-node"><b>${esc(t)}</b><span>${esc(d)}</span></div>`).join('')}</div>
    <p class="hint" style="margin:12px 0 0">Invoice numbers run per financial year, e.g. SLATE/INV/2026-27/001; receipts use MR and work orders WO. Every printed document is on the SLATE letterhead: Print, or save as PDF.</p></div></section>
  <section class="panel"><div class="ph"><h3>Approvals</h3><span class="meta">The Principal decides</span></div>
    <div class="pb"><div class="g-flow"><div class="g-node"><b>COO raises it</b><span>Expense, work order, advance, salary sheet</span></div><span class="g-arr" aria-hidden="true">→</span><div class="g-node g-hi"><b>Principal decides</b><span>Approve, or reject with a reason</span></div><span class="g-arr" aria-hidden="true">→</span><div class="g-node"><b>COO pays</b><span>Record payment; it goes in the book</span></div></div></div></section>
  <section class="panel"><div class="ph"><h3>Where things are</h3></div>
    <div class="pb"><div class="g-where">${G_WHERE.map(([t, d]) => `<button class="g-tab" data-tab="${tab(t)}"><b>${esc(t)}</b><span>${esc(d)}</span></button>`).join('')}</div></div></section>
  <section class="panel"><div class="ph"><h3>Ground rules</h3></div>
    <div class="pb"><ul class="g-rules">${G_RULES.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div></section>`;
}

/* ----- Settings ----- */
function settings() {
  const s = S.settings, cur = fyOf(today());
  const fys = [...new Set([cur - 1, cur, ...S.invoices.map(i => fyOf(i.date || today())), ...(s.lockedFYs || []).map(Number)])].filter(y => y <= cur).sort((a, b) => b - a);
  return `
  <div class="head"><div><h2>Settings</h2><p>Defaults for invoices and money receipts. The Principal and the COO can change these.</p></div></div>
  <div class="panel"><div class="pb"><form id="setForm">
    <div class="fg">
      <label class="f" for="s_prefix">Invoice number prefix<input id="s_prefix" name="prefix" value="${esc(s.prefix)}" maxlength="12"></label>
      <label class="f" for="s_vat">VAT rate (%)<input id="s_vat" name="vatPct" type="number" min="0" max="100" step="0.5" value="${esc(s.vatPct)}"></label>
      <label class="f" for="s_ait">AIT rate (%)<input id="s_ait" name="aitPct" type="number" min="0" max="50" step="0.5" value="${esc(s.aitPct)}"></label>
      <label class="f" for="s_tm">Bank invoices: taxes<select id="s_tm" name="bankTaxMode">${opt('added', 'Added on top (fee stays whole)', s.bankTaxMode !== 'inclusive')}${opt('inclusive', 'Inclusive (taxes inside the figure)', s.bankTaxMode === 'inclusive')}</select></label>
      <label class="f" for="s_terms">Payment terms (days)<input id="s_terms" name="termsDays" type="number" min="0" max="180" value="${esc(s.termsDays)}"></label>
      <label class="f" for="s_bin">VAT registration (BIN)<input id="s_bin" name="bin" value="${esc(s.bin)}" placeholder="Printed on VAT invoices"></label>
    </div>
    <p class="hint">Bank invoices start with VAT and AIT at these rates; cash invoices start without them. Rates are fixed on each invoice when it's raised. Numbers run per financial year: ${esc(s.prefix || 'SLATE')}/INV/${fyLabel(cur).replace('–', '-')}/001 for invoices and ${esc(s.prefix || 'SLATE')}/MR/${fyLabel(cur).replace('–', '-')}/001 for money receipts. A voided number is never reused.</p>
    <div class="fg"><label class="f" for="s_sname">Signatory on invoices<input id="s_sname" name="signName" value="${esc(s.signName)}"></label>
      <label class="f" for="s_stitle">Signatory title<input id="s_stitle" name="signTitle" value="${esc(s.signTitle)}"></label></div>
    <label class="f" for="s_bank">Bank details printed on bank invoices<textarea id="s_bank" name="bank" rows="4" placeholder="Account name, account number, bank, branch, routing number">${esc(s.bank)}</textarea></label>
    <label class="f" for="s_note">Note under the total<textarea id="s_note" name="invNote" rows="2">${esc(s.invNote)}</textarea></label>
    <label class="f" for="s_lh">Address on the letterhead<textarea id="s_lh" name="lhAddress" rows="5">${esc(s.lhAddress || LH_ADDR_DEFAULT)}</textarea></label>
    <label class="f" for="s_wot">Standard terms on new work orders<textarea id="s_wot" name="woTerms" rows="3">${esc(s.woTerms)}</textarea></label>
    <div class="foot"><button class="btn pri" type="submit">Save settings</button></div>
  </form></div></div>
  <div class="panel"><div class="ph"><h3>Send invoices by WhatsApp</h3>${chip(s.waOn ? 'paid' : '', s.waOn ? 'On' : 'Off')}</div><div class="pb"><form id="waForm">
    <label class="check" for="w_on"><input id="w_on" name="waOn" type="checkbox" ${s.waOn ? 'checked' : ''}> Show <b>Share PDF</b> and <b>Send to client</b> on issued invoices</label>
    <p class="hint">Share PDF sends the invoice as an attachment from your own WhatsApp; you pick the contact. Send to client opens the client's chat, using the number saved on the project, with a private link to the invoice, and shows here when they open it. Switching this off hides the buttons; links already sent keep working until you switch them off on the invoice.</p>
    <label class="f" for="w_msg">Message for Send to client<textarea id="w_msg" name="waMsg" rows="7">${esc(s.waMsg || DEFAULT_WA_MSG)}</textarea></label>
    <p class="hint">Fill-ins: {client} {no} {project} {amount} (total payable now) {due} {link} {company} (SLATE or SLATE ATELIER, from the project).</p>
    <div class="foot"><button class="btn" type="button" data-act="wa-msg-reset">Reset message</button><button class="btn pri" type="submit">Save</button></div>
  </form></div></div>
  <div class="panel"><div class="ph"><h3>Close a financial year</h3><span class="meta">${isPrincipal() ? 'Principal only' : 'The Principal closes and reopens years'}</span></div>
    <div class="pb hint" style="padding-bottom:4px">Once a year is closed, its invoices, payments, expenses, transfers and month-end checks can't be added, changed or removed. Reopen it for a late correction, then close it again.</div>
    <div class="rows">${fys.map(y => { const isL = (s.lockedFYs || []).map(Number).includes(y);
      return `<div class="row r-mini" style="cursor:default"><div class="t">FY ${fyLabel(y)}</div>${chip(isL ? 'paid' : '', isL ? 'Closed' : 'Open')}${isPrincipal() ? `<button class="btn sm" data-act="${isL ? 'fy-open' : 'fy-close'}" data-v="${y}" ${!isL && y === cur ? 'disabled title="The current year closes after 30 June"' : ''}>${isL ? 'Reopen' : 'Close year'}</button>` : '<span></span>'}</div>`; }).join('')}</div></div>
  <div class="panel"><div class="ph"><h3>Who can see finance</h3></div><div class="pb hint">Only the Principal and the COO. The database itself enforces this: the team's accounts get nothing back from these records, the project list in SLATE OS never carries fees, and finance changes never appear in the team's log, notifications or messages. The accountant and office staff roles will be added only when the Principal approves them.</div></div>`;
}

/* ---------- events ---------- */
/* chart tooltips: hover on desktop, tap on touch */
const tipEl = Object.assign(document.createElement('div'), { id: 'tip', hidden: true }); tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl);
function showTip(el, x, y) { tipEl.textContent = el.getAttribute('data-tip'); tipEl.hidden = false;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight; let l = x + 14, t = y + 14;
  if (l + w > innerWidth - 8) l = x - w - 14; if (t + h > innerHeight - 8) t = y - h - 14;
  tipEl.style.left = Math.max(8, l) + 'px'; tipEl.style.top = Math.max(8, t) + 'px'; }
document.addEventListener('mousemove', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) showTip(el, e.clientX, e.clientY); else tipEl.hidden = true; });
document.addEventListener('touchstart', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el) { const p = e.touches[0]; showTip(el, p.clientX, p.clientY); } else tipEl.hidden = true; }, { passive: true });
document.addEventListener('scroll', () => { tipEl.hidden = true; }, { passive: true, capture: true });
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
    case 'wa-share': { const i = inv(); if (i) waShare(i, b); break; }
    case 'wa-send': { const i = inv(); if (i) waSend(i, b); break; }
    case 'wa-off': { const l = S.links.find(x => String(x.id) === id); if (l && armed(b)) { const { error } = await sb.from('fin_links').update({ revoked_at: new Date().toISOString() }).eq('id', l.id);
      if (error) toast(friendly(error)); else { await loadLinks(); toast('Link switched off. The client can no longer open it.'); const i = S.invoices.find(x => x.id === l.invoice_id); if (i) invoiceSheet(i); } } break; }
    case 'wa-copy': { const t = b.dataset.v; try { await navigator.clipboard.writeText(t); toast('Copied'); } catch (_) { toast('Couldn’t copy. Select the text and copy it.'); } break; }
    case 'wa-msg-reset': { const t = $('#w_msg'); if (t) t.value = DEFAULT_WA_MSG; break; }
    case 'doc-invoice': { const i = inv(); if (i) openDoc(invoiceDoc(i), `${fileSafe(i.no)}.html`); break; }
    case 'export-inv': exportInv(); break;
    case 'new-acct': accountForm(null, b.dataset.v); break;
    case 'new-staff': staffForm(); break;
    case 'f-rep': S.f.rep = b.dataset.v; schedule(); break;
    case 'f-guide': S.f.guide = b.dataset.v; schedule(); break;
    case 'f-basis': S.f.basis = b.dataset.v; schedule(); break;
    case 'edit-budget': budgetForm(); break;
    case 'export-plfull': exportPLFull(); break;
    case 'petty-bills': pettyBillsForm(); break;
    case 'petty-topup': pettyTopupForm(); break;
    case 'petty-statement': { if (pettyBox()) openDoc(pettyStatementDoc(S.f.pettyMonth || today().slice(0, 7)), 'Petty-cash-statement.html'); break; }
    case 'open-staff': { const t = staffOf(id); if (t) staffSheet(t); break; }
    case 'edit-staff': staffForm(staffOf(id)); break;
    case 'del-staff': if (armed(b) && await run(() => delDoc('staff', id), 'Staff record deleted')) closeSheet(); break;
    case 'new-adv': advanceForm(b.dataset.staff); break;
    case 'open-adv': { const x = S.advances.find(a => a.id === id); if (x) advanceSheet(x); break; }
    case 'del-adv': if (armed(b) && await run(() => delDoc('advances', id), 'Advance deleted')) closeSheet(); break;
    case 'approve-adv': { const x = S.advances.find(a => a.id === id); if (x && await run(() => putDoc('advances', id, { ...strip(x), status: 'approved', decidedBy: S.uid, decidedOn: today() }), 'Advance approved')) advanceSheet(S.advances.find(a => a.id === id)); break; }
    case 'reject-adv': { const x = S.advances.find(a => a.id === id); if (x) rejectAdvForm(x); break; }
    case 'pay-adv': { const x = S.advances.find(a => a.id === id); if (x) payAdvForm(x); break; }
    case 'new-run': newRunForm(b.dataset.v); break;
    case 'open-run': { const r = S.payruns.find(x => x.id === id); if (r) runSheet(r); break; }
    case 'del-run': if (armed(b) && await run(() => delDoc('payruns', id), 'Sheet deleted')) closeSheet(); break;
    case 'reopen-run': { const r = S.payruns.find(x => x.id === id); if (r && await run(() => putDoc('payruns', id, { ...strip(r), status: 'draft' }), 'Sheet reopened')) runSheet(S.payruns.find(x => x.id === id)); break; }
    case 'pay-run': { const r = S.payruns.find(x => x.id === id); if (r) payRunForm(r); break; }
    case 'unpay-run': { const r = S.payruns.find(x => x.id === id); if (r && armed(b) && await run(() => putDoc('payruns', id, { ...strip(r), status: 'approved', payDate: '', payRef: '', cashAccountId: '', bankAccountId: '' }), 'Marked unpaid')) runSheet(S.payruns.find(x => x.id === id)); break; }
    case 'doc-run': { const r = S.payruns.find(x => x.id === id); if (r) openDoc(runDoc(r), `${fileSafe(runLabel(r))}.html`); break; }
    case 'doc-slip': { const r = S.payruns.find(x => x.id === id); if (r) openDoc(slipsDoc(r, b.dataset.staff), `Payslips-${fileSafe(runLabel(r))}.html`); break; }
    case 'f-exp': S.f.exp = b.dataset.v; schedule(); break;
    case 'f-wo': S.f.wo = b.dataset.v; schedule(); break;
    case 'new-exp': expenseForm(); break;
    case 'open-exp': { const x = S.expenses.find(e => e.id === id); if (x) expenseSheet(x); break; }
    case 'edit-exp': expenseForm(S.expenses.find(e => e.id === id)); break;
    case 'del-exp': if (armed(b) && await run(() => delDoc('expenses', id), 'Expense deleted')) closeSheet(); break;
    case 'pay-exp': { const x = S.expenses.find(e => e.id === id); if (x) payExpForm(x); break; }
    case 'approve-exp': { const x = S.expenses.find(e => e.id === id); if (x && await run(() => putDoc('expenses', id, { ...strip(x), status: 'approved', decidedBy: S.uid, decidedOn: today() }), 'Expense approved')) expenseSheet(S.expenses.find(e => e.id === id)); break; }
    case 'reject-exp': { const x = S.expenses.find(e => e.id === id); if (x) rejectExpForm(x); break; }
    case 'approve-all': { const pe = pendingExp().filter(x => !locked(x.date) && (!id || x.accountId === id)); if (!pe.length || !armed(b)) break;
      await run(async () => { for (const x of pe) await putDoc('expenses', x.id, { ...strip(x), status: 'approved', decidedBy: S.uid, decidedOn: today() }); }, `${pe.length} expense${pe.length === 1 ? '' : 's'} approved`); break; }
    case 'export-exp': exportExp(); break;
    case 'new-wo': woForm(); break;
    case 'open-wo': { const w = S.workorders.find(o => o.id === id); if (w) woSheet(w); break; }
    case 'open-wopay': { const x = S.wopays.find(o => o.id === id), w = x && S.workorders.find(o => o.id === x.woId); if (w) woSheet(w); break; }
    case 'edit-wo': woForm(S.workorders.find(o => o.id === id)); break;
    case 'del-wo': if (armed(b) && await run(() => delDoc('workorders', id), 'Work order deleted')) closeSheet(); break;
    case 'approve-wo': case 'close-wo': case 'reopen-wo': { const w = S.workorders.find(o => o.id === id); if (!w) break;
      const st = { 'approve-wo': 'approved', 'close-wo': 'closed', 'reopen-wo': 'approved' }[a];
      if (await run(() => putDoc('workorders', id, { ...strip(w), status: st, ...(a === 'approve-wo' ? { decidedBy: S.uid, decidedOn: today() } : {}) }), { approved: a === 'reopen-wo' ? 'Work order reopened' : 'Work order approved', closed: 'Work order closed' }[st])) woSheet(S.workorders.find(o => o.id === id)); break; }
    case 'reject-wo': { const w = S.workorders.find(o => o.id === id); if (w) rejectWoForm(w); break; }
    case 'pay-wo': { const w = S.workorders.find(o => o.id === id); if (w) woPayForm(w); break; }
    case 'del-wopay': { const x = S.wopays.find(o => o.id === id); if (x && armed(b) && await run(() => delDoc('wopays', id), 'Payment removed')) { const w = S.workorders.find(o => o.id === x.woId); if (w) woSheet(w); } break; }
    case 'doc-wo': { const w = S.workorders.find(o => o.id === id); if (w) openDoc(woDoc(w), `${fileSafe(w.no)}.html`); break; }
    case 'open-acct': { const a = acct(id); if (a) accountSheet(a); break; }
    case 'edit-acct': accountForm(acct(id)); break;
    case 'del-acct': if (armed(b) && await run(() => delDoc('accounts', id), 'Account deleted')) closeSheet(); break;
    case 'recon-acct': { const a = acct(id); if (a) reconForm(a); break; }
    case 'export-acct': { const a = acct(id); if (a) exportAcct(a); break; }
    case 'new-move': moveForm(b.dataset.v); break;
    case 'edit-move': { const m = S.moves.find(x => x.id === id); if (m) moveForm(m.type, m); break; }
    case 'del-move': if (armed(b) && await run(() => delDoc('moves', id), 'Entry deleted')) closeSheet(); break;
    case 'open-receipt-inv': { const r = S.receipts.find(x => x.id === id), i = r && S.invoices.find(x => x.id === r.invoiceId); if (i) invoiceSheet(i); break; }
    case 'doc-receipt': { const r = S.receipts.find(x => x.id === id); if (r) openDoc(receiptDoc(r), `${fileSafe(r.mrNo)}.html`); break; }
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
document.addEventListener('change', ev => { if (ev.target.id === 'fySel') { S.fy = +ev.target.value; schedule(); } if (ev.target.id === 'expCat') { S.f.expCat = ev.target.value; schedule(); } if (ev.target.id === 'pettyMonth') { S.f.pettyMonth = ev.target.value; schedule(); } if (ev.target.id === 'bmSel') { S.f.bm = ev.target.value; schedule(); }
  if (ev.target.classList.contains('msExpect')) { const p = prj(ev.target.dataset.pid); if (!p) return; const ms = (p.milestones || []).map(m => m.id === ev.target.dataset.mid ? { ...m, expect: ev.target.value } : m);
    run(() => putDoc('projects', p.id, { ...strip(p), milestones: ms }), ev.target.value ? `Expected ${monthName(ev.target.value)}` : 'Cleared'); } });
document.addEventListener('submit', async ev => {
  if (ev.target.id !== 'waForm') return; ev.preventDefault();
  const f = ev.target, msg = f.waMsg.value.trim() || DEFAULT_WA_MSG;
  if (!msg.includes('{link}')) { toast('Keep {link} in the message so the client gets the invoice.'); return; }
  await run(() => saveSettings({ ...S.settings, waOn: f.waOn.checked, waMsg: msg }), f.waOn.checked ? 'WhatsApp sending is on' : 'WhatsApp sending is off');
});
document.addEventListener('submit', async ev => {
  if (ev.target.id !== 'setForm') return; ev.preventDefault();
  const f = ev.target;
  const data = { ...S.settings, prefix: f.prefix.value.trim().toUpperCase() || 'SLATE', vatPct: +f.vatPct.value || 0, aitPct: +f.aitPct.value || 0, bankTaxMode: f.bankTaxMode.value, termsDays: +f.termsDays.value || 0, bank: f.bank.value.trim(), invNote: f.invNote.value.trim(), signName: f.signName.value.trim(), signTitle: f.signTitle.value.trim(), bin: f.bin.value.trim(), woTerms: f.woTerms.value.trim(), lhAddress: f.lhAddress.value.trim() };
  await run(() => saveSettings(data), 'Settings saved');
});
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

/* ---------- Accountant: input only ----------
   The Accountant enters expenses and petty cash bills for the Principal to approve. They see only their own
   entries, and only the names of cash points and projects to pick from: never balances, fees, invoices,
   salaries or reports. The database enforces the same (fin_acc_* policies); this screen just matches it. */
const isAcc = () => S.role === 'accountant';
async function loadPick() {
  const { data, error } = await sb.rpc('fin_pick_lists');
  if (error) throw error;
  S.pick = { accounts: (data && data.accounts) || [], projects: (data && data.projects) || [] };
}
const pickAcct = id => (S.pick.accounts.find(a => a.id === id) || {}).name || '';
const pickPrj = id => S.pick.projects.find(p => p.id === id);
const pettyPick = () => S.pick.accounts.find(a => a.kind === 'petty');
const accSt = x => (x.status || 'pending');
function accView() {
  const name = id => (S.pick.accounts.find(a => a.id === id) || {}).name || '—';
  const items = [
    ...S.expenses.map(x => ({ kind: 'Expense', act: 'acc-open', id: x.id, date: x.date, at: x.createdAt, amt: x.amount, st: accSt(x), t: x.desc,
      sub: `${esc(x.category)}${x.payee ? ' · ' + esc(x.payee) : ''}${x.projectId && pickPrj(x.projectId) ? ' · <span class="mono">' + esc(pickPrj(x.projectId).code) + '</span>' : ''}${x.accountId ? ' · paid from ' + esc(pickAcct(x.accountId)) : ''}` })),
    ...S.intakes.map(x => ({ kind: 'Money received', act: 'acc-open-doc', id: 'intakes/' + x.id, date: x.date, at: x.createdAt, amt: x.amount, st: x.status || 'pending', t: `Received · ${x.client || 'client'}`,
      sub: `into ${esc(name(x.accountId))}${x.ref ? ' · ' + esc(x.ref) : ''}` })),
    ...S.moves.map(x => ({ kind: 'Transfer', act: 'acc-open-doc', id: 'moves/' + x.id, date: x.date, at: x.createdAt, amt: x.amount, st: x.status || 'pending', t: `${name(x.from)} → ${name(x.to)}`,
      sub: `Transfer${x.ref ? ' · ' + esc(x.ref) : ''}` }))
  ].sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.at || '').localeCompare(a.at || ''));
  const STC = { pending: ['pending', 'Waiting'], approved: ['paid', 'Approved'], matched: ['paid', 'Matched'], rejected: ['rejected', 'Rejected'], dismissed: ['rejected', 'Not matched'] };
  const pend = items.filter(x => x.st === 'pending');
  const row = x => `<button class="row r-exp" data-act="${x.act}" data-id="${x.id}"><div style="min-width:0"><div class="t">${esc(x.t)}</div><div class="sub">${x.kind} · ${x.sub}</div></div>
      <div class="c2 sub">${fmtDate(x.date)}</div>${chip(...(STC[x.st] || STC.pending))}<div class="amt">${tk(x.amt)}</div></button>`;
  return `
  <div class="head"><div><h2>My entries</h2><p>Everything you enter goes to the Principal or COO: expenses for approval, money received for matching to an invoice, transfers for approval. You can correct or remove an entry while it's still waiting.</p></div>
    <div class="actions">${pettyPick() ? '<button class="btn" data-act="acc-petty">Petty cash bills</button>' : ''}<button class="btn" data-act="acc-transfer">Transfer</button><button class="btn" data-act="acc-intake">Money received</button><button class="btn pri" data-act="acc-new">New expense</button></div></div>
  <div class="kpis"><div class="kpi"><div class="lb">Waiting</div><div class="v">${pend.length}</div><div class="s">for approval or matching</div></div>
    <div class="kpi"><div class="lb">Entered by you</div><div class="v">${items.length}</div><div class="s">all time</div></div></div>
  <div class="panel"><div class="ph"><h3>${items.length} entr${items.length === 1 ? 'y' : 'ies'}</h3></div>
  ${items.length ? `<div class="rows">${items.map(row).join('')}</div>` : '<div class="empty"><strong>Nothing entered yet</strong>Use New expense for a bill or payment, Money received when a client pays, Transfer to move money between cash points, or Petty cash bills for small bills paid from the box.</div>'}</div>`;
}
function accExpForm(x) {
  const src = x || { date: today(), category: EXP_CATS[0] }, paid = !!(x && x.accountId), accts = S.pick.accounts;
  openSheet(`${sheetHead(x ? 'Correct entry' : 'New expense', 'Goes to the Principal for approval')}
  <form id="acf"><div class="fg">
    <label class="f" for="a_date">Date<input id="a_date" name="date" type="date" required value="${esc(src.date)}"></label>
    <label class="f" for="a_cat">Head of account<select id="a_cat" name="category">${EXP_CATS.map(c => opt(c, c, src.category === c)).join('')}</select></label></div>
    <label class="f" for="a_desc">What for<input id="a_desc" name="desc" required value="${esc(src.desc)}" placeholder="e.g. Structural design fee, first part"></label>
    <div class="fg"><label class="f" for="a_payee">Paid to<input id="a_payee" name="payee" value="${esc(src.payee)}" placeholder="Shop, person or company"></label>
      <label class="f" for="a_amt">Amount (BDT)<input id="a_amt" name="amount" type="number" min="1" step="1" required value="${esc(src.amount)}"></label></div>
    <label class="f" for="a_prj">Cost centre<select id="a_prj" name="projectId"><option value="">Studio overhead, not a project</option>${S.pick.projects.map(p => opt(p.id, `${p.code} · ${p.name}`, p.id === src.projectId)).join('')}</select></label>
    <label class="check" for="a_paid"><input id="a_paid" type="checkbox" ${paid ? 'checked' : ''} ${accts.length ? '' : 'disabled'}> Already paid</label>
    <div class="fg" id="aPay">
      <label class="f" for="a_acct">Paid from<select id="a_acct" name="accountId">${accts.map(a => opt(a.id, a.name, a.id === src.accountId)).join('')}</select></label>
      <label class="f" for="a_pd">Paid on<input id="a_pd" name="paidOn" type="date" value="${esc(src.paidOn || src.date)}"></label>
      <label class="f" for="a_ref">Voucher / cheque / txn no.<input id="a_ref" name="ref" value="${esc(src.ref)}"></label></div>
    <label class="f" for="a_note">Note<input id="a_note" name="note" value="${esc(src.note)}"></label>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">${x ? 'Save' : 'Send for approval'}</button></div>
  </form>`, root => {
    const f = $('#acf', root), cb = $('#a_paid', root), sync = () => { $('#aPay', root).hidden = !cb.checked; };
    cb.addEventListener('change', sync); sync();
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const data = { date: f.date.value, category: f.category.value, desc: f.desc.value.trim(), payee: f.payee.value.trim(), amount: +f.amount.value || 0, projectId: f.projectId.value,
        note: f.note.value.trim(), accountId: cb.checked ? f.accountId.value : '', paidOn: cb.checked ? f.paidOn.value : '', ref: cb.checked ? f.ref.value.trim() : '', status: 'pending' };
      if (!data.desc || !(data.amount > 0)) { toast('Enter what it was for and an amount.'); return; }
      const ok = x ? await run(() => putDoc('expenses', x.id, { ...strip(x), ...data }), 'Saved') : await run(() => addDoc('expenses', data), 'Sent to the Principal for approval');
      if (ok) closeSheet(); });
  });
}
function accPettyForm() {
  const box = pettyPick(); if (!box) { toast('The petty cash box isn’t set up yet.'); return; }
  const row = () => `<div class="pb-row" style="display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1.3fr) minmax(0,1.6fr) minmax(0,.9fr) 28px;gap:6px;align-items:center">
    <input type="date" name="d" value="${today()}" aria-label="Date"><select name="c" aria-label="Head of account">${PETTY_CATS.map(c => opt(c, c)).join('')}</select>
    <input name="w" placeholder="What for" aria-label="What for"><input name="a" type="number" min="1" step="1" placeholder="Taka" aria-label="Amount"><button class="btn ghost sm" type="button" data-pb="del" aria-label="Remove">×</button></div>`;
  openSheet(`${sheetHead('Petty cash bills', esc(box.name))}
  <form id="apb"><style>#apb .pb-row input,#apb .pb-row select{background:var(--bg);border:1px solid var(--line);border-radius:var(--r);padding:8px;min-width:0;width:100%;font-size:13px}@media (max-width:560px){#apb .pb-row{grid-template-columns:1fr 1fr!important}}</style>
    <div id="apRows" style="display:flex;flex-direction:column;gap:10px">${row()}${row()}${row()}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><button class="btn sm" type="button" data-pb="add">Add a line</button><span class="hint" id="apTot"></span></div>
    <p class="hint">Each bill goes to the Principal for approval. Keep the paper bill with the box. Empty lines are skipped.</p>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Send for approval</button></div></form>`, root => {
    const f = $('#apb', root), rows = $('#apRows', root);
    const read = () => [...rows.querySelectorAll('.pb-row')].map(r => ({ d: r.querySelector('[name=d]').value, c: r.querySelector('[name=c]').value, w: r.querySelector('[name=w]').value.trim(), a: +r.querySelector('[name=a]').value || 0 })).filter(x => x.w || x.a);
    const upd = () => { const L = read(), t = L.reduce((u, x) => u + x.a, 0); $('#apTot', root).textContent = L.length ? `${L.length} bill${L.length === 1 ? '' : 's'} · ${tk(t)}` : ''; };
    f.addEventListener('input', upd);
    f.addEventListener('click', e => { const b = e.target.closest('[data-pb]'); if (!b) return; if (b.dataset.pb === 'add') rows.insertAdjacentHTML('beforeend', row()); else b.closest('.pb-row').remove(); upd(); });
    f.addEventListener('submit', async ev => { ev.preventDefault(); const L = read();
      if (!L.length) { toast('Enter at least one bill.'); return; }
      if (L.find(x => !x.w || !(x.a > 0) || !x.d)) { toast('Each bill needs a date, what it was for and an amount.'); return; }
      if (await run(async () => { for (const x of L) await addDoc('expenses', { date: x.d, category: x.c, desc: x.w, payee: '', amount: x.a, projectId: '', note: 'Petty cash', accountId: box.id, paidOn: x.d, ref: '', status: 'pending' }); },
        `${L.length} bill${L.length === 1 ? '' : 's'} sent for approval`)) closeSheet(); });
  });
}
function accOpen(x) {
  const p = x.projectId ? pickPrj(x.projectId) : null, st = accSt(x);
  openSheet(`${sheetHead(x.desc, `${esc(x.category)}${x.payee ? ' · ' + esc(x.payee) : ''}`)}
    <dl class="kv"><dt>Date</dt><dd class="txt">${fmtDate(x.date)}</dd><dt class="tot">Amount</dt><dd class="tot">${tk(x.amount)}</dd>
      <dt>Cost centre</dt><dd class="txt">${p ? `<span class="mono">${esc(p.code)}</span> · ${esc(p.name)}` : 'Studio overhead'}</dd>
      <dt>Paid</dt><dd class="txt">${x.accountId ? `${fmtDate(x.paidOn)} from ${esc(pickAcct(x.accountId))}${x.ref ? ' · ' + esc(x.ref) : ''}` : 'Not yet'}</dd>
      <dt>Status</dt><dd class="txt">${st === 'pending' ? 'Awaiting the Principal' : st === 'rejected' ? 'Rejected' + (x.rejectReason ? ' · ' + esc(x.rejectReason) : '') : 'Approved'}</dd></dl>
    ${x.note ? `<p class="hint" style="margin-top:10px">${esc(x.note)}</p>` : ''}
    <div class="foot">${st === 'pending' ? `<button class="btn danger" data-act="acc-del" data-id="${x.id}">Remove</button><button class="btn pri" data-act="acc-edit" data-id="${x.id}">Correct</button>` : '<button class="btn ghost" type="button" data-act="close">Close</button>'}</div>`);
}
document.addEventListener('click', async ev => {
  if (!isAcc()) return;
  const b = ev.target.closest('[data-act^="acc-"]'); if (!b) return;
  const x = S.expenses.find(e => e.id === b.dataset.id);
  switch (b.dataset.act) {
    case 'acc-new': accExpForm(); break;
    case 'acc-petty': accPettyForm(); break;
    case 'acc-open': if (x) accOpen(x); break;
    case 'acc-edit': if (x) accExpForm(x); break;
    case 'acc-del': if (x && confirm('Remove this entry?')) { const ok = await run(async () => { const { error } = await sb.from('fin_docs').delete().eq('path', 'expenses/' + x.id); if (error) throw error; }, 'Removed'); if (ok) closeSheet(); } break;
  }
});

/* ---------- Cash point registers (everyone with Finance access) ----------
   One shape for every viewer: { id, name, kind, opening, openingDate, entries: [{ date, amt, what, sub }], counts: [...] }.
   The Principal and COO build it from their full data; the Accountant gets it from fin_ledger(), which carries
   only what moved, when, and a plain label — no fees, invoice amounts or individual salaries. */
const NOTES = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1];
function ledgerAccounts() {
  if (isAcc()) return S.ledger || [];
  return activeAccts().map(a => ({ id: a.id, name: a.name, kind: a.kind, active: a.active !== false, opening: +a.opening || 0, openingDate: a.openingDate, float: a.float,
    entries: acctEntries(a).map(e => ({ date: e.date, amt: e.amt, what: e.what, sub: e.sub })),
    counts: S.recons.filter(r => r.accountId === a.id).map(r => ({ month: r.month, date: r.date, book: r.book, actual: r.actual, diff: r.diff, notes: r.notes, note: r.note })) }));
}
const lgFind = id => ledgerAccounts().find(L => L.id === id);
const lgBal = (L, upto) => (L.entries || []).filter(e => !upto || e.date <= upto).reduce((s, e) => s + (+e.amt || 0), +L.opening || 0);
const lgCashLike = L => L.kind === 'cash' || L.kind === 'petty';
const nn = v => nf.format(Math.round(+v || 0));
function denomTable(notes) {
  if (!notes || !Object.keys(notes).length) return '';
  const rows = NOTES.map(d => ({ d, q: +notes[d] || 0 })).filter(x => x.q);
  const tot = rows.reduce((u, x) => u + x.d * x.q, 0);
  return `<table style="font-size:8.8pt;width:auto;min-width:70mm"><thead><tr><th>Note</th><th class="n">Quantity</th><th class="n">Amount</th></tr></thead><tbody>
    ${rows.map(x => `<tr><td>${nn(x.d)}</td><td class="n">${nn(x.q)}</td><td class="n">${nn(x.d * x.q)}</td></tr>`).join('')}
    <tr class="tot"><td>Total</td><td></td><td class="n">${nn(tot)}</td></tr></tbody></table>`;
}
const regSig = `<div class="sig"><div><b>Prepared by</b>Accountant</div><div><b>Verified by</b>COO</div><div><b>Approved by</b>Principal</div></div>`;
/* Cash book: two-sided for one month — receipts left, payments right */
function cashBookDoc(L, mo) {
  const start = mo + '-01', end = monthEnd(mo);
  const opening = lgBal(L, iso(new Date(new Date(start + 'T00:00:00').getTime() - 864e5)));
  const rows = (L.entries || []).filter(e => e.date >= start && e.date <= end);
  const ins = rows.filter(e => e.amt > 0), outs = rows.filter(e => e.amt < 0);
  const inT = ins.reduce((u, e) => u + e.amt, 0), outT = -outs.reduce((u, e) => u + e.amt, 0), closing = opening + inT - outT;
  const left = [{ date: '', what: '<b>Opening balance</b>', amt: opening }, ...ins.map(e => ({ date: fmtShort(e.date), what: esc(e.what) + (e.sub ? `<br><span style="color:#545454;font-size:7.5pt">${esc(e.sub)}</span>` : ''), amt: e.amt }))];
  const right = outs.map(e => ({ date: fmtShort(e.date), what: esc(e.what) + (e.sub ? `<br><span style="color:#545454;font-size:7.5pt">${esc(e.sub)}</span>` : ''), amt: -e.amt }));
  const n = Math.max(left.length, right.length);
  const cell = x => x ? `<td>${x.date}</td><td>${x.what}</td><td class="n">${nn(x.amt)}</td>` : '<td></td><td></td><td></td>';
  const cnt = (L.counts || []).find(c => c.month === mo);
  const body = `<h1>${lgCashLike(L) ? 'Cash book' : 'Bank book'}</h1>
  <div class="ref"><span>Cash point <b>${esc(L.name)}</b></span><span>Month <b>${monthName(mo)}</b></span><span>Printed <b>${fmtDate(today())}</b></span></div>
  <table style="font-size:8.6pt;table-layout:fixed"><colgroup><col style="width:9%"><col style="width:28%"><col style="width:13%"><col style="width:9%"><col style="width:28%"><col style="width:13%"></colgroup>
  <thead><tr><th>Date</th><th>Received</th><th class="n">Taka</th><th style="border-left:.5pt solid #CFCFCF;padding-left:2mm">Date</th><th>Paid</th><th class="n">Taka</th></tr></thead><tbody>
  ${Array.from({ length: n }, (_, k) => `<tr>${cell(left[k])}${cell(right[k]).replace('<td>', '<td style="border-left:.5pt solid #CFCFCF;padding-left:2mm">')}</tr>`).join('')}
  <tr class="sub"><td></td><td></td><td></td><td style="border-left:.5pt solid #CFCFCF"></td><td><b>Total paid</b></td><td class="n">${nn(outT)}</td></tr>
  <tr class="sub"><td></td><td></td><td></td><td style="border-left:.5pt solid #CFCFCF"></td><td><b>Closing balance</b></td><td class="n">${nn(closing)}</td></tr>
  <tr class="tot"><td></td><td>Total</td><td class="n">${nn(opening + inT)}</td><td></td><td>Total</td><td class="n">${nn(outT + closing)}</td></tr></tbody></table>
  ${cnt ? `<h2>${lgCashLike(L) ? 'Cash counted' : 'Bank statement'} · ${fmtDate(cnt.date || end)}</h2>
    <p class="note" style="margin-top:0">Book ${nn(cnt.book)} · ${lgCashLike(L) ? 'counted' : 'statement'} ${nn(cnt.actual)} · ${Math.abs(+cnt.diff || 0) < 1 ? 'matches the book' : `${cnt.diff > 0 ? 'short' : 'over'} by ${nn(Math.abs(cnt.diff))}`}${cnt.note ? ' · ' + esc(cnt.note) : ''}</p>
    ${denomTable(cnt.notes)}` : `<p class="note">No ${lgCashLike(L) ? 'cash count' : 'statement check'} recorded for this month.</p>`}
  ${regSig}`;
  return docShell(`${L.name} · ${monthName(mo)}`, `${L.name} · cash book · ${monthName(mo)}`, body);
}
/* Vault register: what came in (with source), what went out, running balance, last note count */
function vaultRegisterDoc(L, from, to) {
  const opening = lgBal(L, iso(new Date(new Date(from + 'T00:00:00').getTime() - 864e5)));
  const rows = (L.entries || []).filter(e => e.date >= from && e.date <= to);
  let run = opening, cumIn = 0;
  const cnt = (L.counts || []).filter(c => (c.date || '') <= to).slice(-1)[0];
  const body = `<h1>${/vault/i.test(L.name) ? 'Vault cash register' : L.kind === 'bank' || L.kind === 'mfs' ? 'Account register' : 'Cash register'}</h1>
  <div class="ref"><span>Cash point <b>${esc(L.name)}</b></span><span>Period <b>${fmtDate(from)} – ${fmtDate(to)}</b></span><span>Printed <b>${fmtDate(today())}</b></span></div>
  <table style="font-size:8.4pt"><thead><tr><th>Date</th><th>Received from / paid to</th><th>Reference</th><th class="n">In</th><th class="n">Cumulative in</th><th class="n">Out</th><th class="n">Balance</th></tr></thead><tbody>
  <tr class="sub"><td>${fmtShort(from)}</td><td>Opening balance</td><td></td><td></td><td></td><td></td><td class="n">${nn(opening)}</td></tr>
  ${rows.map(e => { run += e.amt; if (e.amt > 0) cumIn += e.amt; return `<tr><td>${fmtShort(e.date)}</td><td>${esc(e.what)}</td><td style="color:#545454;font-size:7.6pt">${esc(e.sub || '')}</td><td class="n">${e.amt > 0 ? nn(e.amt) : ''}</td><td class="n">${e.amt > 0 ? nn(cumIn) : ''}</td><td class="n">${e.amt < 0 ? nn(-e.amt) : ''}</td><td class="n">${nn(run)}</td></tr>`; }).join('')}
  <tr class="tot"><td></td><td>Closing balance</td><td></td><td class="n">${nn(cumIn)}</td><td></td><td class="n">${nn(-rows.filter(e => e.amt < 0).reduce((u, e) => u + e.amt, 0))}</td><td class="n">${nn(run)}</td></tr></tbody></table>
  ${cnt ? `<h2>Last count · ${fmtDate(cnt.date)}</h2><p class="note" style="margin-top:0">Book ${nn(cnt.book)} · counted ${nn(cnt.actual)} · difference ${nn(cnt.diff)}${cnt.note ? ' · ' + esc(cnt.note) : ''}</p>${denomTable(cnt.notes)}` : ''}
  ${regSig}`;
  return docShell(`${L.name} register`, `${L.name} · register · ${fmtDate(from)} – ${fmtDate(to)}`, body);
}
/* Fund flow: every cash point for a period — opening, collection, payment, closing */
function fundFlowDoc(from, to) {
  const before = iso(new Date(new Date(from + 'T00:00:00').getTime() - 864e5));
  const Ls = ledgerAccounts().filter(L => L.active !== false);
  const rows = Ls.map(L => { const es = (L.entries || []).filter(e => e.date >= from && e.date <= to);
    const op = lgBal(L, before), inn = es.filter(e => e.amt > 0).reduce((u, e) => u + e.amt, 0), out = -es.filter(e => e.amt < 0).reduce((u, e) => u + e.amt, 0);
    return { L, op, inn, out, cl: op + inn - out }; });
  const sum = (k, f = () => true) => rows.filter(r => f(r.L)).reduce((u, r) => u + r[k], 0);
  const KIND = { cash: 'Cash', petty: 'Petty cash', bank: 'Bank', mfs: 'Mobile wallet' };
  const body = `<h1>Fund flow statement</h1>
  <div class="ref"><span>Period <b>${fmtDate(from)} – ${fmtDate(to)}</b></span><span>Printed <b>${fmtDate(today())}</b></span></div>
  <table style="font-size:9pt"><thead><tr><th>#</th><th>Cash point</th><th>Type</th><th class="n">Opening</th><th class="n">Collection</th><th class="n">Payment</th><th class="n">Closing</th></tr></thead><tbody>
  ${rows.map((r, k) => `<tr><td>${k + 1}</td><td>${esc(r.L.name)}</td><td>${KIND[r.L.kind] || ''}</td><td class="n">${nn(r.op)}</td><td class="n">${nn(r.inn)}</td><td class="n">${nn(r.out)}</td><td class="n">${nn(r.cl)}</td></tr>`).join('')}
  <tr class="tot"><td></td><td>This period</td><td></td><td class="n">${nn(sum('op'))}</td><td class="n">${nn(sum('inn'))}</td><td class="n">${nn(sum('out'))}</td><td class="n">${nn(sum('cl'))}</td></tr></tbody></table>
  <h2>Position at ${fmtDate(to)}</h2>
  <table style="font-size:9.5pt;width:auto;min-width:90mm"><tbody>
    <tr><td>Total bank</td><td class="n">${nn(sum('cl', L => !lgCashLike(L)))}</td></tr>
    <tr><td>Total cash</td><td class="n">${nn(sum('cl', lgCashLike))}</td></tr>
    <tr class="tot"><td>Total funds</td><td class="n">${nn(sum('cl'))}</td></tr></tbody></table>
  ${regSig}`;
  return docShell('Fund flow statement', `Fund flow · ${fmtDate(from)} – ${fmtDate(to)}`, body);
}
function registerForm(kind, id) {
  const L = id ? lgFind(id) : null, mo = today().slice(0, 7);
  const titles = { cb: 'Cash book', vr: L && L.kind === 'cash' ? 'Vault register' : 'Account register', ff: 'Fund flow statement' };
  openSheet(`${sheetHead(titles[kind], L ? esc(L.name) : 'All cash points')}
  <form id="rgf"><div class="fg">${kind === 'cb' ? `<label class="f" for="rg_m">Month<input id="rg_m" name="m" type="month" required value="${mo}" max="${mo}"></label>`
    : `<label class="f" for="rg_f">From<input id="rg_f" name="from" type="date" required value="${mo}-01"></label><label class="f" for="rg_t">To<input id="rg_t" name="to" type="date" required value="${today()}"></label>`}</div>
    <p class="hint">Opens on the SLATE letterhead: print it, or save it as a PDF.</p>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Open</button></div></form>`, root => {
    $('#rgf', root).addEventListener('submit', ev => { ev.preventDefault(); const f = ev.target;
      if (kind !== 'cb' && f.from.value > f.to.value) { toast('The start date is after the end date.'); return; }
      if (kind === 'cb') openDoc(cashBookDoc(L, f.m.value), `${fileSafe(L.name)}-cash-book-${f.m.value}.html`);
      else if (kind === 'vr') openDoc(vaultRegisterDoc(L, f.from.value, f.to.value), `${fileSafe(L.name)}-register.html`);
      else openDoc(fundFlowDoc(f.from.value, f.to.value), 'Fund-flow-statement.html');
      closeSheet(); });
  });
}
/* Cash count with note count (cash points) or statement balance (bank) — Accountant, COO, Principal */
function countForm(id) {
  const L = lgFind(id); if (!L) return;
  const d = new Date(); d.setDate(0); const ym0 = iso(d).slice(0, 7), cashy = lgCashLike(L);
  openSheet(`${sheetHead(cashy ? 'Cash count' : 'Bank statement check', esc(L.name))}
  <form id="ccf"><div class="fg">
    <label class="f" for="cc_m">Month<input id="cc_m" name="month" type="month" required value="${ym0}" max="${today().slice(0, 7)}"></label>
    ${cashy ? '' : `<label class="f" for="cc_a">Statement balance on the last day<input id="cc_a" name="actual" type="number" step="1" required></label>`}</div>
    ${cashy ? `<div class="sec-t">Notes counted</div><div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px">${NOTES.map(n => `<label class="f" for="cc_${n}">৳ ${n}<input id="cc_${n}" name="n${n}" type="number" min="0" step="1" placeholder="0"></label>`).join('')}</div>` : ''}
    <dl class="kv" id="ccTot"></dl>
    <label class="f" for="cc_note">Note<input id="cc_note" name="note" placeholder="Explain any difference"></label>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">Save</button></div></form>`, root => {
    const f = $('#ccf', root);
    const notes = () => { const o = {}; if (cashy) NOTES.forEach(n => { const q = Math.max(0, Math.round(+f['n' + n].value || 0)); if (q) o[n] = q; }); return o; };
    const actual = () => cashy ? Object.entries(notes()).reduce((u, [n, q]) => u + n * q, 0) : (+f.actual.value || 0);
    const upd = () => { if (!f.month.value) return; const book = Math.round(lgBal(L, monthEnd(f.month.value))), act = actual(), diff = book - act;
      $('#ccTot', root).innerHTML = `<dt>Book balance on ${fmtDate(monthEnd(f.month.value))}</dt><dd>${tk(book)}</dd><dt>${cashy ? 'Counted' : 'Statement'}</dt><dd>${tk(act)}</dd><dt class="tot">${Math.abs(diff) < 1 ? 'Matched' : diff > 0 ? 'Short by' : 'Over by'}</dt><dd class="tot" style="color:var(${Math.abs(diff) < 1 ? '--good' : '--bad'})">${tk(Math.abs(diff))}</dd>`; };
    f.addEventListener('input', upd); upd();
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const month = f.month.value, end = monthEnd(month), book = Math.round(lgBal(L, end)), act = actual();
      if (L.openingDate && end < L.openingDate) { toast(`${L.name} starts on ${fmtDate(L.openingDate)}.`); return; }
      const rid = `${L.id}_${month.replace('-', '')}`, prev = S.recons.find(r => r.id === rid);
      const data = { accountId: L.id, month, date: end, book, actual: act, diff: book - act, notes: notes(), note: f.note.value.trim() };
      if (await run(() => setDoc('recons', rid, prev ? { ...strip(prev), ...data } : data, !!prev), Math.abs(book - act) < 1 ? 'Matched and saved' : 'Saved with a difference')) closeSheet(); });
  });
}

/* ---------- Accountant: money received and transfers ---------- */
function accIntakeForm(x) {
  const src = x || { date: today() }, accts = S.pick.accounts.filter(a => a.kind !== 'petty');
  if (!accts.length) { toast('The cash points aren’t set up yet. Ask the COO to add them under Cash & bank.'); return; }
  openSheet(`${sheetHead(x ? 'Correct money received' : 'Money received', 'The Principal or COO matches it to the client’s invoice')}
  <form id="aif"><div class="fg">
    <label class="f" for="i_date">Date received<input id="i_date" name="date" type="date" required value="${esc(src.date)}"></label>
    <label class="f" for="i_amt">Amount received (BDT)<input id="i_amt" name="amount" type="number" min="1" step="1" required value="${esc(src.amount)}"></label></div>
    <label class="f" for="i_prj">Project<select id="i_prj" name="projectId"><option value="">Not sure / other</option>${S.pick.projects.map(p => opt(p.id, `${p.code} · ${p.name}`, p.id === src.projectId)).join('')}</select></label>
    <label class="f" for="i_cl">Received from (client)<input id="i_cl" name="client" value="${esc(src.client)}" placeholder="Client or person who paid"></label>
    <div class="fg"><label class="f" for="i_acct">Went into<select id="i_acct" name="accountId">${accts.map(a => opt(a.id, a.name, a.id === src.accountId)).join('')}</select></label>
      <label class="f" for="i_ref">Cheque / transfer / slip no.<input id="i_ref" name="ref" value="${esc(src.ref)}"></label></div>
    <label class="f" for="i_note">Note<input id="i_note" name="note" value="${esc(src.note)}" placeholder="e.g. 2nd instalment, tax deducted by client"></label>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">${x ? 'Save' : 'Send for matching'}</button></div></form>`, root => {
    const f = $('#aif', root);
    f.projectId.addEventListener('change', () => { const p = pickPrj(f.projectId.value); if (p && !f.client.value) f.client.value = p.client || ''; });
    f.addEventListener('submit', async ev => { ev.preventDefault();
      const a = S.pick.accounts.find(k => k.id === f.accountId.value) || {};
      const data = { date: f.date.value, amount: +f.amount.value || 0, projectId: f.projectId.value, client: f.client.value.trim(), accountId: f.accountId.value,
        mode: a.kind === 'cash' ? 'cash' : 'bank', ref: f.ref.value.trim(), note: f.note.value.trim(), status: 'pending' };
      if (!(data.amount > 0)) { toast('Enter the amount received.'); return; }
      const ok = x ? await run(() => putDoc('intakes', x.id, { ...strip(x), ...data }), 'Saved') : await run(() => addDoc('intakes', data), 'Sent to the Principal and COO for matching');
      if (ok) closeSheet(); });
  });
}
function accTransferForm(x) {
  const accts = S.pick.accounts; if (accts.length < 2) { toast('At least two cash points are needed. Ask the COO to add them under Cash & bank.'); return; }
  const src = x || { date: today(), from: (accts.find(a => a.kind === 'cash') || accts[0]).id, to: (accts.find(a => a.kind !== 'cash') || accts[1]).id };
  const sel = (n, v) => `<select id="t_${n}" name="${n}">${accts.map(a => opt(a.id, a.name, a.id === v)).join('')}</select>`;
  openSheet(`${sheetHead(x ? 'Correct transfer' : 'Transfer between cash points', 'Waits for the Principal or COO to approve; balances change once approved')}
  <form id="atf"><div class="fg"><label class="f" for="t_from">From${sel('from', src.from)}</label><label class="f" for="t_to">Into${sel('to', src.to)}</label>
    <label class="f" for="t_date">Date<input id="t_date" name="date" type="date" required value="${esc(src.date)}"></label>
    <label class="f" for="t_amt">Amount (BDT)<input id="t_amt" name="amount" type="number" min="1" step="1" required value="${esc(src.amount)}"></label></div>
    <label class="f" for="t_ref">Reference<input id="t_ref" name="ref" value="${esc(src.ref)}" placeholder="Deposit slip, cheque no."></label>
    <label class="f" for="t_note">Note<input id="t_note" name="note" value="${esc(src.note)}" placeholder="e.g. Vault cash for this week's payments"></label>
    <div class="foot"><button class="btn ghost" type="button" data-act="close">Cancel</button><button class="btn pri" type="submit">${x ? 'Save' : 'Send for approval'}</button></div></form>`, root => {
    $('#atf', root).addEventListener('submit', async ev => { ev.preventDefault(); const f = ev.target;
      if (f.from.value === f.to.value) { toast('Pick two different cash points.'); return; }
      const data = { type: 'transfer', from: f.from.value, to: f.to.value, date: f.date.value, amount: +f.amount.value || 0, ref: f.ref.value.trim(), note: f.note.value.trim(), status: 'pending' };
      const ok = x ? await run(() => putDoc('moves', x.id, { ...strip(x), ...data }), 'Saved') : await run(() => addDoc('moves', data), 'Sent for approval');
      if (ok) closeSheet(); });
  });
}
function accCashView() {
  const Ls = (S.ledger || []).filter(L => L.active !== false), t = today();
  const tot = Ls.reduce((u, L) => u + lgBal(L, t), 0), cashT = Ls.filter(lgCashLike).reduce((u, L) => u + lgBal(L, t), 0);
  const pend = S.moves.filter(m => m.status === 'pending');
  return `
  <div class="head"><div><h2>Cash & bank</h2><p>Balances of SLATE's cash points today. Transfers you enter change them once the Principal or COO approves.</p></div>
    <div class="actions"><button class="btn" data-act="acc-ff">Fund flow</button><button class="btn pri" data-act="acc-transfer">Transfer</button></div></div>
  <div class="kpis"><div class="kpi"><div class="lb">Total funds</div><div class="v">${compact(tot)}</div><div class="s">${Ls.length} cash point${Ls.length === 1 ? '' : 's'}</div></div>
    <div class="kpi"><div class="lb">Cash</div><div class="v">${compact(cashT)}</div><div class="s">vault, cash in hand, petty</div></div>
    <div class="kpi"><div class="lb">Bank</div><div class="v">${compact(tot - cashT)}</div><div class="s">check against statements</div></div>
    <div class="kpi"><div class="lb">Transfers waiting</div><div class="v">${pend.length}</div><div class="s">${tk(pend.reduce((u, m) => u + (+m.amount || 0), 0))}</div></div></div>
  <div class="panel"><div class="ph"><h3>Cash points</h3><span class="meta">tap one for its book</span></div>
  ${Ls.length ? `<div class="rows">${Ls.map(L => { const last = (L.counts || []).slice(-1)[0];
    return `<button class="row r-prj" data-act="acc-acct" data-id="${L.id}"><div style="min-width:0"><div class="t">${esc(L.name)}</div><div class="sub">${ACCT_KIND[L.kind] || ''}</div></div>
      <div class="c2 sub">${last ? `Counted ${fmtShort(last.date)} · ${Math.abs(+last.diff || 0) < 1 ? '<span style="color:var(--good)">matched</span>' : `<span class="warnt">off by ${tk(Math.abs(last.diff))}</span>`}` : 'Not counted yet'}</div>
      <div class="amt">${tk(lgBal(L, t))}</div></button>`; }).join('')}</div>` : '<div class="empty"><strong>No cash points yet</strong>The COO adds the vault, cash in hand, petty cash and bank accounts under Cash & bank.</div>'}</div>`;
}
function accAcctSheet(id) {
  const L = lgFind(id); if (!L) return;
  let run = +L.opening || 0; const rows = (L.entries || []).map(e => { run += +e.amt || 0; return { ...e, bal: run }; }).reverse().slice(0, 80);
  openSheet(`${sheetHead(L.name, ACCT_KIND[L.kind] || '')}
    <dl class="kv"><dt>Opening balance${L.openingDate ? ', ' + fmtDate(L.openingDate) : ''}</dt><dd>${tk(L.opening)}</dd><dt class="tot">Balance today</dt><dd class="tot">${tk(lgBal(L, today()))}</dd></dl>
    <div class="sec-t" style="margin-top:18px">Latest entries</div>
    <div class="mini-list rows" style="margin-top:10px">${rows.length ? rows.map(e => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto;cursor:default"><div style="min-width:0"><div class="t">${esc(e.what)}</div><div class="sub">${fmtDate(e.date)}${e.sub ? ' · ' + esc(e.sub) : ''}</div></div>
      <div class="amt" style="color:var(${e.amt < 0 ? '--bad' : '--good'})">${e.amt < 0 ? '− ' : '+ '}${tk(Math.abs(e.amt))}<small>bal ${tk(e.bal)}</small></div></div>`).join('') : '<div class="empty" style="padding:14px">No entries yet.</div>'}</div>
    <div class="foot"><button class="btn" data-act="reg-cb" data-id="${L.id}">Cash book</button><button class="btn" data-act="reg-vr" data-id="${L.id}">${L.kind === 'cash' ? 'Vault register' : 'Register'}</button><button class="btn pri" data-act="reg-count" data-id="${L.id}">${lgCashLike(L) ? 'Count cash' : 'Statement check'}</button></div>`);
}

/* ---------- Principal and COO: match money received; approve transfers ---------- */
const pendingIntakes = () => S.intakes.filter(x => (x.status || 'pending') === 'pending');
const pendingMoves = () => S.moves.filter(m => m.status === 'pending');
function intakesPanel() {
  const L = pendingIntakes(); if (!L.length) return '';
  return `<div class="panel"><div class="ph"><h3>Money received · to match</h3><span class="meta">entered by the Accountant</span></div><div class="rows">${L.map(x => { const p = prj(x.projectId);
    return `<button class="row r-exp" data-act="open-intake" data-id="${x.id}"><div style="min-width:0"><div class="t">${esc(x.client || (p ? p.client || p.name : 'Unknown payer'))}</div><div class="sub">${p ? `<span class="mono">${esc(p.code)}</span> · ` : ''}into ${esc((acct(x.accountId) || {}).name || '—')}${x.ref ? ' · ' + esc(x.ref) : ''}</div></div>
      <div class="c2 sub">${fmtDate(x.date)}</div>${chip('pending', 'To match')}<div class="amt">${tk(x.amount)}</div></button>`; }).join('')}</div></div>`;
}
function intakeSheet(x) {
  const p = prj(x.projectId), open = S.invoices.filter(i => invOpen(i)).sort((a, b) => (a.projectId === x.projectId ? 0 : 1) - (b.projectId === x.projectId ? 0 : 1) || (a.date || '').localeCompare(b.date || ''));
  openSheet(`${sheetHead('Money received', `${esc(x.client || 'Unknown payer')} · ${tk(x.amount)}`)}
    <dl class="kv"><dt>Date</dt><dd class="txt">${fmtDate(x.date)}</dd><dt>Project</dt><dd class="txt">${p ? `<span class="mono">${esc(p.code)}</span> · ${esc(p.name)}` : 'Not given'}</dd>
      <dt>Went into</dt><dd class="txt">${esc((acct(x.accountId) || {}).name || '—')}${x.ref ? ' · ' + esc(x.ref) : ''}</dd><dt>Entered by</dt><dd class="txt">${who(x.createdBy)} · ${fmtWhen(x.createdAt)}</dd></dl>
    ${x.note ? `<p class="hint" style="margin-top:10px">${esc(x.note)}</p>` : ''}
    <label class="f" for="ix_inv" style="margin-top:14px">Invoice it pays<select id="ix_inv">${open.length ? open.map(i => { const q = prj(i.projectId); return opt(i.id, `${i.no} · ${q ? q.code : ''} · due ${tk(invDue(i))}`, false); }).join('') : '<option value="">No open invoices</option>'}</select></label>
    <p class="hint">Match opens the money receipt filled in with this payment; check it, add any tax the client deducted, and save.</p>
    <div class="foot"><button class="btn danger" data-act="dismiss-intake" data-id="${x.id}">Not an invoice payment</button>${open.length ? `<button class="btn pri" data-act="match-intake" data-id="${x.id}">Match</button>` : ''}</div>`);
}
function movesPanel() {
  const L = pendingMoves(); if (!L.length) return '';
  return `<div class="panel"><div class="ph"><h3>Transfers awaiting approval</h3><span class="meta">entered by the Accountant</span></div><div class="rows">${L.map(m => `<div class="row" style="grid-template-columns:minmax(0,1fr) auto auto;cursor:default"><div style="min-width:0"><div class="t">${esc((acct(m.from) || {}).name || '?')} → ${esc((acct(m.to) || {}).name || '?')}</div><div class="sub">${fmtDate(m.date)}${m.ref ? ' · ' + esc(m.ref) : ''}${m.note ? ' · ' + esc(m.note) : ''} · ${who(m.createdBy)}</div></div>
    <div class="amt">${tk(m.amount)}</div><div style="display:flex;gap:4px"><button class="btn ghost sm danger" data-act="reject-move" data-id="${m.id}">Reject</button><button class="btn sm pri" data-act="approve-move" data-id="${m.id}">Approve</button></div></div>`).join('')}</div></div>`;
}
document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act]'); if (!b || !S.role) return;
  const id = b.dataset.id, a = b.dataset.act;
  if (a === 'reg-cb') registerForm('cb', id);
  else if (a === 'reg-vr') registerForm('vr', id);
  else if (a === 'reg-count') countForm(id);
  else if (a === 'reg-ff' || a === 'acc-ff') registerForm('ff');
  else if (isAcc()) {
    if (a === 'acc-intake') accIntakeForm();
    else if (a === 'acc-transfer') accTransferForm();
    else if (a === 'acc-acct') accAcctSheet(id);
    else if (a === 'acc-edit-intake') { const x = S.intakes.find(k => k.id === id); if (x) accIntakeForm(x); }
    else if (a === 'acc-edit-move') { const x = S.moves.find(k => k.id === id); if (x) accTransferForm(x); }
    else if (a === 'acc-del-doc') { const [coll, did] = (id || '').split('/'); if (coll && did && confirm('Remove this entry?')) { if (await run(async () => { const { error } = await sb.from('fin_docs').delete().eq('path', coll + '/' + did); if (error) throw error; }, 'Removed')) closeSheet(); } }
    else if (a === 'acc-open-doc') { const [coll, did] = (id || '').split('/'); const x = (coll === 'intakes' ? S.intakes : S.moves).find(k => k.id === did); if (x) accDocSheet(coll, x); }
  } else {
    if (a === 'open-intake') { const x = S.intakes.find(k => k.id === id); if (x) intakeSheet(x); }
    else if (a === 'match-intake') { const x = S.intakes.find(k => k.id === id), i = S.invoices.find(v => v.id === ($('#ix_inv') || {}).value); if (x && i) receiptForm(i, { date: x.date, accountId: x.accountId, amount: x.amount, ref: x.ref, intakeId: x.id }); }
    else if (a === 'dismiss-intake') { const x = S.intakes.find(k => k.id === id); const why = x && prompt('Why isn’t this an invoice payment? (e.g. advance, refund, other income — record it separately)'); if (x && why) { if (await run(() => putDoc('intakes', x.id, { ...strip(x), status: 'dismissed', dismissNote: why, decidedBy: S.uid, decidedOn: today() }), 'Marked as not an invoice payment')) closeSheet(); } }
    else if (a === 'approve-move') { const m = S.moves.find(k => k.id === id); if (m) await run(() => putDoc('moves', m.id, { ...strip(m), status: 'approved', approvedBy: S.uid, approvedOn: today() }), 'Transfer approved'); }
    else if (a === 'reject-move') { const m = S.moves.find(k => k.id === id); if (m && confirm('Reject this transfer? It won’t change any balance.')) await run(() => putDoc('moves', m.id, { ...strip(m), status: 'rejected', approvedBy: S.uid, approvedOn: today() }), 'Transfer rejected'); }
  }
});
function accDocSheet(coll, x) {
  const st = x.status || 'pending', isI = coll === 'intakes';
  const name = id => (S.pick.accounts.find(a => a.id === id) || {}).name || '—';
  openSheet(`${sheetHead(isI ? 'Money received' : 'Transfer', tk(x.amount))}
    <dl class="kv"><dt>Date</dt><dd class="txt">${fmtDate(x.date)}</dd>
      ${isI ? `<dt>From</dt><dd class="txt">${esc(x.client || '—')}${pickPrj(x.projectId) ? ' · <span class="mono">' + esc(pickPrj(x.projectId).code) + '</span>' : ''}</dd><dt>Went into</dt><dd class="txt">${esc(name(x.accountId))}</dd>`
        : `<dt>From</dt><dd class="txt">${esc(name(x.from))}</dd><dt>Into</dt><dd class="txt">${esc(name(x.to))}</dd>`}
      ${x.ref ? `<dt>Reference</dt><dd class="txt">${esc(x.ref)}</dd>` : ''}
      <dt>Status</dt><dd class="txt">${st === 'pending' ? (isI ? 'Waiting to be matched' : 'Awaiting approval') : st === 'matched' ? 'Matched to an invoice' : st === 'approved' ? 'Approved' : st === 'dismissed' ? 'Not an invoice payment' + (x.dismissNote ? ' · ' + esc(x.dismissNote) : '') : 'Rejected'}</dd></dl>
    ${x.note ? `<p class="hint" style="margin-top:10px">${esc(x.note)}</p>` : ''}
    <div class="foot">${st === 'pending' ? `<button class="btn danger" data-act="acc-del-doc" data-id="${coll}/${x.id}">Remove</button><button class="btn pri" data-act="${isI ? 'acc-edit-intake' : 'acc-edit-move'}" data-id="${x.id}">Correct</button>` : '<button class="btn ghost" type="button" data-act="close">Close</button>'}</div>`);
}

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
  if (!['principal', 'coo', 'accountant'].includes(role)) { notice('Finance is limited to the Principal and the COO', 'Your account doesn’t have access to studio finances.', true); return; }
  S.role = role;
  if (role === 'accountant') { S.tab = 'mine'; const bk = $('#backOS'); if (bk) bk.hidden = true; }
  try { await Promise.all([load(), loadAux()]); }
  catch (e) { notice('Couldn’t open finance', esc(friendly(e)), true); return; }
  clearTimeout(watchdog);
  render();
  const refresh = () => { if (document.visibilityState === 'visible' && $('#sheet').hidden) load().then(render).catch(() => {}); };
  setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', refresh);
})().catch(e => { clearTimeout(watchdog); notice('Couldn’t open finance', esc(friendly(e)), true); });
window.slateFinanceTest = { S, render, invStatus, takaWords, nextInvNo };

/* ----- Back -----
   A phone's back (any gesture setting), the mouse's back button and Alt+← close an open sheet first;
   with nothing open they return to SLATE OS. The ‹ SLATE OS button takes the same step back, so SLATE OS
   reopens where it was left (More, usually) instead of starting again at Home. */
const FIN_NAV = { pending: false, wantPush: false };
function finNavPush() {
  if (FIN_NAV.pending) { FIN_NAV.wantPush = true; return; }
  if (history.state && history.state.fin === 'sheet') return;
  try { history.pushState({ fin: 'sheet' }, ''); } catch (_) {}
}
function finNavPop() {
  FIN_NAV.wantPush = false;
  if (FIN_NAV.pending || !(history.state && history.state.fin === 'sheet')) return;
  FIN_NAV.pending = true; history.back();
}
window.addEventListener('popstate', () => {
  if (FIN_NAV.pending) {
    FIN_NAV.pending = false;
    if (FIN_NAV.wantPush && !$('#sheet').hidden) { FIN_NAV.wantPush = false; try { history.pushState({ fin: 'sheet' }, ''); } catch (_) {} }
    return;
  }
  if (!$('#sheet').hidden) closeSheet(true);
});
(() => {
  const b = document.getElementById('backOS'); if (!b) return;
  b.addEventListener('click', e => {
    let fromOS = false;
    try { const r = new URL(document.referrer); fromOS = r.origin === location.origin && !/^\/(finance|i\/)/.test(r.pathname); } catch (_) {}
    if (!fromOS || history.length < 2) return;
    e.preventDefault();
    if (history.state && history.state.fin === 'sheet') history.go(-2); else history.back();
  });
})();
})();
