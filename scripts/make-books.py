#!/usr/bin/env python3
"""Build books.html (SLATE Books inside SLATE OS) from the SLATE Books artifact.
The Books code is kept as it is; the changes below connect it to SLATE OS (books-host.js),
add the Studio · Business · Books switch and the Bangladesh financial year, and swap the Claude-only messages.
Usage: python3 scripts/make-books.py <artifact.html> books.html"""
import sys, os, re
src, out = sys.argv[1], sys.argv[2]
s = open(src, encoding='utf-8').read()
def rep(a, b, n=1):
    global s
    c = s.count(a)
    assert c == n, (c, a[:90])
    s = s.replace(a, b)

# ---------- head: icons, and the host before the Books scripts ----------
rep('<title>SLATE Books</title>', '<title>SLATE Books</title>\n<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png">\n<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">\n<meta name="theme-color" content="#ffffff">')
first = s.index('<script>')
s = s[:first] + '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js"></script>\n<script src="/config.js"></script>\n<script src="/books-host.js"></script>\n' + s[first:]

# ---------- engine: the financial year follows a rule (Bangladesh: July–June to June 2027, a 9-month FY 2027-28, then April–March) ----------
rep("""  function fyRange(startYear, fyStart) {""", """  /* the financial year a date falls in. rule 'bd': Bangladesh, July–June up to 30 Jun 2027, then FY 2027-28 runs
     1 Jul 2027 to 31 Mar 2028 (nine months), then April–March. Any other rule: a fixed start month (rule or fyStart). */
  function fyOfRule(d, rule, fyStart) {
    if (rule === 'bd' || rule == null || rule === '') {
      if (d < '2027-07-01') return fyRange(fyStartYear(d, 7), 7);
      if (d <= '2028-03-31') return { from: '2027-07-01', to: '2028-03-31', label: 'FY 2027-28', short: '27-28', months: 9 };
      return fyRange(fyStartYear(d, 4), 4);
    }
    var m = +rule || +fyStart || 7;
    return fyRange(fyStartYear(d, m), m);
  }
  function fyRange(startYear, fyStart) {""")
rep("""    var fy = fyRange(fyStartYear(date, +P.settings.fyStart || 7), +P.settings.fyStart || 7).short;""",
    """    var fy = fyOfRule(date, P.settings.fyRule, P.settings.fyStart).short;""")
rep("""dayBefore: dayBefore, fyStartYear: fyStartYear, fyRange: fyRange,""", """dayBefore: dayBefore, fyStartYear: fyStartYear, fyRange: fyRange, fyOfRule: fyOfRule,""")

# ---------- app: financial year ----------
rep("""function fyOf(d) { return SB.fyRange(SB.fyStartYear(d, fyStart()), fyStart()); }""",
    """function fyOf(d) { return SB.fyOfRule(d, S.settings.fyRule, fyStart()); }
const FY_RULES = [['bd', 'Bangladesh: July–June until June 2027, FY 2027-28 runs July–March, then April–March'], ['7', 'July–June'], ['4', 'April–March'], ['1', 'January–December']];
const fyRuleName = st => (FY_RULES.find(x => x[0] === String(st.fyRule || 'bd')) || FY_RULES[0])[1];""")
rep("""  if (p === 'lastfy') { const f = SB.fyRange(SB.fyStartYear(today(), fyStart()) - 1, fyStart()); return { from: f.from, to: f.to, label: f.label, short: f.label }; }""",
    """  if (p === 'lastfy') { const f = fyOf(SB.dayBefore(curFY().from)); return { from: f.from, to: f.to, label: f.label, short: f.label }; }""")
rep("""fact('Financial year starts', MONL[(+st.fyStart || 7) - 1]),""", """fact('Financial year', fyRuleName(st), curFY().label + ': ' + fmtD(curFY().from, true) + ' to ' + fmtD(curFY().to, true)),""")
rep("""fyStart: String(st.fyStart || 7), lockDate:""", """fyStart: String(st.fyStart || 7), fyRule: String(st.fyRule || 'bd'), lockDate:""")
rep("""field('Financial year starts in', sel('fyStart', MONL.map((m, i) => [String(i + 1), m])))""", """field('Financial year', sel('fyRule', FY_RULES), 'Voucher and invoice numbers restart each financial year.')""")
rep("""fyStart: +d.fyStart, lockDate: d.lockDate || '',""", """fyStart: d.fyRule === 'bd' ? 7 : +d.fyRule, fyRule: d.fyRule, lockDate: d.lockDate || '',""")

# ---------- app: the COO is the COO without being given the role ----------
rep("""return (t && ROLES.includes(t.role)) ? t.role : (id === S.uid && S.isOwner ? 'Principal' : 'Viewer');""",
    """return (t && ROLES.includes(t.role)) ? t.role : (id === S.uid && S.isOwner ? 'Principal' : (window.BooksHost && BooksHost.isCOO(id) ? 'COO' : 'Viewer'));""")

# ---------- app: files open through signed links ----------
rep("""const fileUrl = f => f ? (f.id && location.protocol !== 'file:' ? '/_blob/' + f.id : f.url || '') : '';""",
    """const fileUrl = f => f ? (f.id ? BooksHost.fileUrl(f.id) : f.url || '') : '';""")

# ---------- app: messages that pointed at Claude ----------
rep("""h('strong', { text: 'Open SLATE Books in Claude' }), h('span', { text: 'The accounts are kept in Claude. Open the shared link at claude.ai while signed in.' })""",
    """h('strong', { text: 'Sign in to SLATE OS first' }), h('span', {}, 'SLATE Books uses your SLATE OS account. ', h('a', { href: '/?next=books', text: 'Sign in' }), ', then come back here.')""")
rep("""h('span', { text: 'Ask the Principal to share SLATE Books with you as an Editor.' })""", """h('span', { text: 'Ask the Principal to give you a role in SLATE Books.' })""")
rep("""h('span', { text: 'You can view SLATE Books but not change it. Ask the Principal to share it with you as an Editor.' })""", """h('span', { text: 'You can view SLATE Books but not change it. Your role is Viewer.' })""")
rep("""h('div', { class: 'banner warn' }, h('span', { text: 'File uploads aren’t available in this view. Open SLATE Books in Claude t""", """h('div', { class: 'banner warn' }, h('span', { text: 'File uploads aren’t available right now. Reload the page t""")

# ---------- app: header — the space switch, and signing out ----------
rep("""  me.replaceChildren(h('span', { class: 'who-t', text: myRole() }), ava(S.uid));""",
    """  const sw = window.BooksHost && BooksHost.spaceSwitch();
  me.replaceChildren(...(sw ? [sw] : [h('span', { class: 'who-t', text: myRole() }), h('button', { class: 'ava-btn', type: 'button', title: 'Sign out', onclick: () => { if (confirm('Sign out of SLATE OS?')) BooksHost.signOut(); } }, ava(S.uid))]));
  { const left = document.getElementById('bk-left'); if (left) left.replaceChildren(...(sw ? BooksHost.headLeft(() => ava(S.uid)) : [])); }""")
rep('''<div class="me" id="me-slot"></div>''', '''<span id="bk-left"></span><div class="me" id="me-slot"></div>''')
rep("""  out.push(h('div', { class: 'sec' }, secH('Data and help'), h('div', { class: 'list' },""",
    """  out.push(h('div', { class: 'sec' }, secH('Data and help'), h('div', { class: 'list' },
    moreItem('Sign out', 'Signed in as ' + nameOf(S.uid) + ' · ' + role, () => { if (confirm('Sign out of SLATE OS?')) BooksHost.signOut(); }),""")
rep("""    out.push(h('div', { class: 'card' }, h('div', { class: 'list', style: 'background:transparent' }, moreItem('How SLATE Books works', 'What to do with a petty cash bill or a payment request', () => go('more', 'help')))));""",
    """    out.push(h('div', { class: 'card' }, h('div', { class: 'list', style: 'background:transparent' }, moreItem('How SLATE Books works', 'What to do with a petty cash bill or a payment request', () => go('more', 'help')), moreItem('Sign out', 'Signed in as ' + nameOf(S.uid), () => { if (confirm('Sign out of SLATE OS?')) BooksHost.signOut(); }))));""")
rep("""boot();

})();""", """if (window.BooksHost) BooksHost.onChange(() => { render(); renderSheet(true); });
boot();

})();""")

# ---------- styles: the switch, and Books' own tint (green, the colour of money in) ----------
rep("""</style>
<div class="chrome">""", """.space-sw{display:flex;flex:0 0 auto;background:var(--group);border-radius:999px;padding:3px;gap:2px}
.space-b{appearance:none;border:0;background:none;font:inherit;font-size:13px;font-weight:600;color:var(--muted);padding:5px 12px;border-radius:999px;cursor:pointer;white-space:nowrap;text-decoration:none;display:flex;align-items:center}
.space-b.on{background:#3F7F5A;color:#fff}
body .chrome{background:rgba(231,241,234,.82);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);border-bottom:2px solid #3F7F5A}
.tab[aria-current="page"]{color:#2F6446;border-bottom-color:#3F7F5A}
.ava-btn{appearance:none;border:0;background:none;padding:0;cursor:pointer;border-radius:50%}
.me{transform:translateY(-50%)!important;top:calc(50% + 4px)!important}
@media (max-width:640px){.space-b{font-size:12px;padding:5px 8px}.space-sw{padding:2px}}
@media (max-width:440px){.space-b{font-size:11.5px;padding:5px 8px}}
html.embed .top-in{display:none}html.embed .chrome{top:0}
@media (max-width:560px){body.has-spaces .top-in .logo{visibility:hidden}body.has-spaces .top-in .divider,body.has-spaces .top-in .product{display:none}}
/* Studio's header: profile icon and bell on the left */
.top-in{--hic:38px}
.mebtn{position:absolute;left:max(16px,env(safe-area-inset-left,0px));top:calc(50% + 4px);transform:translateY(-50%);appearance:none;border:0;background:none;padding:0;cursor:pointer;display:block;line-height:0;width:var(--hic);height:var(--hic)}
.mebtn .ava{width:var(--hic);height:var(--hic);border-radius:50%;display:grid;place-items:center;font-size:13px;font-weight:600;background:#1c1c1e;color:#fff;overflow:hidden}
.mebtn .ava.ic{background:var(--c);color:#fff}.mebtn .ava svg{width:62%;height:62%}
.mebtn .ava.on{box-shadow:0 0 0 2px #34C759}
.bell{position:absolute;left:calc(max(16px,env(safe-area-inset-left,0px)) + var(--hic) + 10px);top:calc(50% + 4px);transform:translateY(-50%);appearance:none;border:0;background:none;height:var(--hic);padding:0;border-radius:999px;cursor:pointer;display:flex;align-items:center;color:var(--ink,#1c1c1e);font:inherit}
.bell .bi{width:var(--hic);height:var(--hic);border-radius:50%;background:var(--group,#efeff4);display:grid;place-items:center;flex:none}
.bell svg{width:calc(var(--hic)*.47);height:calc(var(--hic)*.47)}
.bell.has{background:#FCE4E4;padding-right:13px}.bell.has .bi{background:#fff;box-shadow:0 0 0 2px #d7262b;color:#d7262b}
.bell .bn{margin-left:9px;font-size:14px;font-weight:700;color:#d7262b;font-variant-numeric:tabular-nums}
@media (max-width:640px){.top-in{--hic:34px}.bell.has{padding-right:9px}.bell .bn{margin-left:6px;font-size:12.5px}.logo{height:34px}}
</style>
<div class="chrome">""")

# ---------- the profile icons, the same list Studio uses ----------
_ix = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'index.html'), encoding='utf-8').read()
_ic = _ix[_ix.index('const ICONS=') + len('const ICONS='):_ix.index('\nconst ICON=')].rstrip().rstrip(';')
rep('<script src="/books-host.js"></script>', '<script>window.SLATE_ICONS=' + _ic + ';</script>\n<script src="/pin.js"></script>\n<script src="/books-host.js"></script>')
# ---------- staff and projects come from SLATE OS (Business › HR & salaries, Studio and Business › Fees) ----------
_a = s.index('function sheetProject() {'); _b = s.index('\n}\n', _a)
_f = s[_a:_b]
_f = _f.replace("const id = S.sheet.id, ro = !can.setup();", "const id = S.sheet.id, ro = !can.setup(), os = !!(id && S.projects[id] && S.projects[id].src === 'os');")
for _k in ("inp('code', { placeholder: 'e.g. JOL-NAVA039-5K-2629', disabled: ro })", "sel('status', [['Active', 'Active'], ['On hold', 'On hold'], ['Closed', 'Closed']], { disabled: ro })", "inp('name', { required: true, disabled: ro })", "inp('contract', { inputmode: 'decimal', disabled: ro })"):
    assert _f.count(_k) == 1, _k
    _f = _f.replace(_k, _k.replace('disabled: ro', 'disabled: ro || os'))
_f = _f.replace("field('Client', inp('client', { disabled: ro }))", "field('Client', inp('client', { disabled: ro }), os ? 'The client’s name as it goes on invoices.' : '')")
_f = _f.replace("return [head(id ? 'Project' : 'New project', id ? projLabel(id) : 'New project'),",
  "return [head(id ? 'Project' : 'New project', id ? projLabel(id) : 'New project'), os ? h('div', { class: 'callout ok' }, 'From SLATE OS: the code, name, fee and open or closed are set in Studio and Business › Fees. Here you add the client’s name for invoices, a joint venture, overheads and notes.') : null,")
_f = _f.replace("    const nid = id || nextId('p', S.projects);\n",
  "    if (os) return run(() => Store.patch('projects', id, { client: d.client.trim(), overhead: !!d.overhead, notes: (d.notes || '').trim(), jvPartner: d.jvPartner || '', jvShare: d.jvPartner ? r2(parseAmt(d.jvShare) || 0) : 0, earned: d.status !== 'Active' ? r2(parseAmt(d.earned) || 0) : 0 }), 'Saved').then(ok => { if (ok) closeSheet(); });\n    const nid = id || nextId('p', S.projects);\n")
s = s[:_a] + _f + s[_b:]
rep("""const out = [pageH('Projects', 'Tag fees and costs to a project to see what each one earns. Codes match SLATE OS.', can.setup() ? [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openSheet({ type: 'project', d: projDraft() }), text: '+ New project' })] : null)];""",
    """const out = [pageH('Projects', 'Projects come from SLATE OS: open one in Studio and set its fee in Business › Fees, and it appears here. Tag fees and costs to a project to see what each one earns.')];""")
# staff
rep("""const out = [pageH('Staff', 'Everyone on the salary sheet, with their monthly gross salary.', can.enter() ? [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => openSheet({ type: 'staffm', d: { active: true, joined: today() } }), text: '+ New staff' })] : null)];""",
    """const out = [pageH('Staff', 'Everyone on the salary sheet. Salaries, tax and bank or cash are set in SLATE OS › Business › HR & salaries; changes there show here at once.')];""")
rep("""function sheetStaff() {
  const id = S.sheet.id, ro = !can.enter();""", """function sheetStaff() {
  const id = S.sheet.id, ro = !can.enter() || !!(id && S.staff[id] && S.staff[id].src === 'os');""")
rep("""  return [head('Staff', id ? S.staff[id].name : 'New staff'), ro ?""", """  return [head('Staff', id ? S.staff[id].name : 'New staff'), id && S.staff[id].src === 'os' ? h('div', { class: 'callout ok' }, 'From SLATE OS › Business › HR & salaries' + (S.staff[id].account ? ' (the ' + S.staff[id].account + ' account)' : '') + '. Change the salary there; the salary sheet picks it up.') : null, ro ?""")
rep("""emptyBox('No salary sheets yet', 'Add staff in More › Staff, then prepare the first month.')""", """emptyBox('No salary sheets yet', 'Staff come from SLATE OS › Business › HR & salaries. Prepare the first month when they show in More › Staff.')""")
rep("""  if (!rows.length) return toast('Add staff in More › Staff first.');""", """  if (!rows.length) return toast('No staff yet: they come from SLATE OS › Business › HR & salaries.');""")
# the salary for the month being prepared, from the SLATE OS salary history
rep("""function preparePayroll(month) {""", """/* staff from SLATE OS carry their salary history: use the rate in force for the month being prepared */
function osRate(x, month) { const rs = (x.rates || []).slice().sort((a, b) => a.from.localeCompare(b.from)); let r = null; rs.forEach(z => { if (z.from <= month) r = z; }); r = r || rs[0] || {};
  const g = ['basic', 'house', 'medical', 'conv', 'other'].reduce((t, k) => t + (+r[k] || 0), 0); return { gross: g, tax: +r.tax || 0, bank: x.payMethod === 'bank' ? g : x.payMethod === 'split' ? (+x.bankPart || 0) : 0 }; }
function preparePayroll(month) {""")
rep("""gross: +x.gross || 0, payDays: Math.min(joinedIn, leftIn), arrear: 0, other: 0, otherDed: 0, tax: pr ? pr.tax : (+x.tax || 0), bank: pr ? pr.bank : (+x.bank || 0),""",
    """gross: x.src === 'os' ? osRate(x, month).gross : (+x.gross || 0), payDays: Math.min(joinedIn, leftIn), arrear: 0, other: 0, otherDed: 0, tax: x.src === 'os' ? osRate(x, month).tax : (pr ? pr.tax : (+x.tax || 0)), bank: x.src === 'os' ? osRate(x, month).bank : (pr ? pr.bank : (+x.bank || 0)),""")
# people and roles: everyone with a SLATE OS account
rep("""  const ids = new Set(Object.keys(S.members)); Object.keys(S.settings.team || {}).forEach(k => ids.add(k)); if (S.uid) ids.add(S.uid);""",
    """  const ids = new Set(Object.keys(S.members)); Object.keys(S.settings.team || {}).forEach(k => ids.add(k)); if (S.uid) ids.add(S.uid);
  if (window.BooksHost && BooksHost.peopleIds) BooksHost.peopleIds().forEach(k => ids.add(k));""")

rep("""'Give each person a role. Share SLATE Books first: the COO and the accountant as Editors, office staff as Contributors. They appear here after they open it once.'""",
    """'Everyone with a SLATE OS account is listed. Give each person a role; without one they see nothing in Books.'""")

# ---------- People and roles: say what each choice really does; "No access" removes the role ----------
rep("""    const r = roleOf(id), seen = (S.members[id] || {}).seen;
    const pick = own && id !== ownerId() ? (() => { const s = h('select', { 'aria-label': 'Role for ' + nameOf(id), style: 'width:auto', onchange: e => setRole(id, e.target.value) }, ROLES.filter(x => x !== 'Principal').map(x => h('option', { value: x, text: x === 'Viewer' ? 'No role (view only)' : x }))); s.value = r === 'Principal' ? 'Viewer' : r; return s; })() : h('span', { class: 'tag', text: r });""",
"""    const tr = (team[id] || {}).role, r = id === ownerId() ? 'Principal' : (tr && ROLES.includes(tr)) ? tr : (window.BooksHost && BooksHost.isCOO(id) ? 'COO' : 'None'), seen = (S.members[id] || {}).seen;
    const pick = own && id !== ownerId() ? (() => { const s = h('select', { 'aria-label': 'Role for ' + nameOf(id), style: 'width:auto;max-width:150px', onchange: e => setRole(id, e.target.value) }, [['COO', 'COO'], ['Accountant', 'Accountant'], ['Office staff', 'Office staff'], ['Viewer', 'Viewer'], ['None', 'No access']].map(([v, t]) => h('option', { value: v, text: t }))); s.value = r; return s; })() : h('span', { class: 'tag', text: r === 'None' ? 'No access' : r });""")
rep("""function setRole(id, role) {
  const team = Object.assign({}, S.settings.team || {}); team[id] = Object.assign({}, team[id] || {}, { role });""",
"""function setRole(id, role) {
  if (role === 'Viewer' && !confirm('A Viewer sees everything in Books, including every salary. Give ' + nameOf(id) + ' this role?')) { render(); return; }
  const team = Object.assign({}, S.settings.team || {}); team[id] = Object.assign({}, team[id] || {});
  if (role === 'None') delete team[id].role; else team[id].role = role;
  if (!Object.keys(team[id]).length) delete team[id];""")
rep("""Viewer: 'Can look, can’t change anything.' };""", """Viewer: 'Sees everything in Books, including salaries, but changes nothing.', None: 'No access to Books. Sees nothing there.' };""")

rep("""h('li', {}, h('b', { text: k + ': ' }), v)""", """h('li', {}, h('b', { text: (k === 'None' ? 'No access' : k) + ': ' }), v)""")

# ---------- account holder: when Books has none recorded, use the one set in Business › HR & salaries ----------
rep("""function holdersOf(id) { const t = (S.settings.team || {})[id]; return (t && Array.isArray(t.holders)) ? t.holders.slice().sort((a, b) => (a.from || '').localeCompare(b.from || '')) : []; }""",
    """function holdersOf(id) { const t = (S.settings.team || {})[id]; if (t && Array.isArray(t.holders) && t.holders.length) return t.holders.slice().sort((a, b) => (a.from || '').localeCompare(b.from || ''));
  const hr = Object.values(S.staff || {}).find(x => x && x.src === 'os' && x.userId === id && x.account && x.active !== false);
  return hr ? [{ name: hr.name, from: hr.joined || '', to: null, fromHR: true }] : []; }""")

# ---------- one place for access: roles are set on each person's card in SLATE OS › Business › HR & salaries ----------
rep("""    const pick = own && id !== ownerId() ? (() => { const s = h('select', { 'aria-label': 'Role for ' + nameOf(id), style: 'width:auto;max-width:150px',""",
    """    const pick = false ? (() => { const s = h('select', { 'aria-label': 'Role for ' + nameOf(id), style: 'width:auto;max-width:150px',""")
rep("""'Everyone with a SLATE OS account is listed. Give each person a role; without one they see nothing in Books.'""",
    """'Everyone with a SLATE OS account is listed. Roles are set on each person’s card in SLATE OS › Business › HR & salaries; without one they see nothing in Books.'""")
rep("""without one they see nothing in Books.' : 'Only the Principal can change roles.')];""", """without one they see nothing in Books.' : 'Roles are set by the Principal and the COO in SLATE OS › Business › HR & salaries.')];""")

# ---------- Conveyance: team members' approved transport claims, paid once a month by Accounts ----------
rep("""staff: moreStaff, accounts: moreAccounts,""", """staff: moreStaff, conv: moreConv, accounts: moreAccounts,""")
rep("""  if (canPayroll()) out.push(h('div', { class: 'sec' }, secH('Salaries'), h('div', { class: 'list' },""",
    """  if (can.enter()) out.push(h('div', { class: 'sec' }, secH('Team'), h('div', { class: 'list' },
    moreItem('Expense claims', 'Transport, meals and client costs approved in SLATE OS, paid once a month', () => go('more', 'conv')))));
  if (canPayroll()) out.push(h('div', { class: 'sec' }, secH('Salaries'), h('div', { class: 'list' },""")
rep("""function moreItem(t, d, onclick, right) {""", """/* Conveyance (claims are made in SLATE OS; the COO approves them there). Here Accounts pays each person once a month:
   the payment is entered as Money out, then those claims are marked paid in SLATE OS. */
const CONV_PUR = { site: 'Site visit', client: 'Client meeting', authority: 'Authority', consultant: 'Consultant meeting', market: 'Market visit', errand: 'Office errand', other: 'Other' };
function convLoad(force) { const C = S.conv || (S.conv = { state: 'idle', rows: [] }); if (!force && C.state !== 'idle') return C;
  C.state = 'loading';
  Promise.all([BooksHost.sb.from('conv_claims').select('*').in('status', ['approved', 'paid']).order('trip_date').limit(3000), BooksHost.sb.from('conv_types').select('id,label')]).then(([a, b]) => {
    const e = a.error || b.error; if (e) { C.state = 'err'; C.err = /conv_|schema cache|does not exist/i.test(e.message || '') ? 'Expense claims need the latest SLATE OS database update.' : e.message; }
    else { C.rows = a.data || []; C.types = Object.fromEntries((b.data || []).map(t => [t.id, t.label])); C.state = 'ok'; } render(true); });
  return C; }
const convProjOf = os => os ? (Object.keys(S.projects).find(k => S.projects[k] && S.projects[k].osId === os) || '') : '';
function convLedger() { return Object.keys(S.ledgers).find(k => activeL(k) && !isCashL(k) && /convey|transport|travel|staff expense|expense claim/i.test(L(k))) || ''; }
function convPay(uid, xs) {
  const ids = xs.map(r => r.id), amt = xs.reduce((a, r) => a + (+r.amount || 0), 0), months = [...new Set(xs.map(r => monthName(r.trip_date.slice(0, 7))))].join(', ');
  const projs = [...new Set(xs.map(r => convProjOf(r.project_id)))], proj = projs.length === 1 ? projs[0] : '';
  openMoney('out', { amount: String(amt), cat: convLedger(), proj, party: nameOf(uid), narr: `Expense claims ${months} for ${nameOf(uid)}: ${ids.join(', ')}`,
    after: async (vid, vdoc) => { const { error } = await BooksHost.sb.rpc('conv_mark_paid', { p_ids: ids, p_voucher: vid, p_voucher_no: vdoc.no || '' });
      if (error) throw new Error('The payment is entered, but the claims could not be marked paid: ' + error.message + '. Tell the Principal before paying again.');
      S.conv.state = 'idle'; } });
}
function moreConv() {
  const C = convLoad(), out = [pageH('Expense claims', 'Transport, meals and client costs approved in SLATE OS (the Principal’s own need no approval). Pay each person once a month: Pay enters the money out here and marks their claims paid. Claims with a paper bill should come with the bill, the claim ID written on it.')];
  if (C.state !== 'ok') { out.push(C.state === 'err' ? emptyBox('Couldn’t load expense claims', C.err) : h('p', { class: 'muted', text: 'Loading…' })); return out; }
  const due = C.rows.filter(r => r.status === 'approved'), by = {};
  due.forEach(r => (by[r.user_id] = by[r.user_id] || []).push(r));
  const total = due.reduce((a, r) => a + (+r.amount || 0), 0);
  if (!due.length) out.push(emptyBox('Nothing to pay', 'Approved expense claims appear here.'));
  else out.push(h('div', { class: 'sec' }, secH('To pay', tk(total)), h('div', { class: 'list' }, Object.entries(by).sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0]))).map(([uid, xs]) => {
    const sum = xs.reduce((a, r) => a + (+r.amount || 0), 0), bills = xs.filter(r => r.paper_bill).length;
    return h('div', { class: 'card', style: 'display:grid;gap:8px' },
      h('div', { style: 'display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap' }, h('div', {}, h('b', { text: nameOf(uid) }), h('div', { class: 'f-hint', style: 'margin:0', text: `${xs.length} claim${xs.length === 1 ? '' : 's'}${bills ? ' · ' + bills + ' with a paper bill' : ''}` })),
        h('div', { style: 'display:flex;gap:10px;align-items:center' }, h('b', { class: 'mono', text: tk(sum) }), can.enter() ? h('button', { class: 'btn btn-primary btn-sm', type: 'button', onclick: () => convPay(uid, xs), text: 'Pay' }) : null)),
      h('div', { class: 'tbl-wrap' }, h('table', {}, h('tbody', {}, xs.map(r => h('tr', {}, h('td', { class: 'mono', text: r.id }), h('td', { text: fmtD(r.trip_date) }),
        h('td', { text: `${r.from_place ? r.from_place + ' → ' + r.to_place + (r.round_trip ? ' and back' : '') + ' · ' + ((C.types || {})[r.mode] || r.mode) : ((C.types || {})[r.mode] || r.mode) + ' at ' + r.to_place}${(r.people || []).length ? ' · with ' + r.people.map(x => nameOf(x)).join(', ') : ''}${convProjOf(r.project_id) ? ' · ' + projLabel(convProjOf(r.project_id)) : ' · ' + (CONV_PUR[r.purpose] || '')}${r.paper_bill ? ' · paper bill' : ''}` }),
        h('td', { class: 'n', text: fmt(r.amount) })))))));
  }))));
  const paid = C.rows.filter(r => r.status === 'paid').sort((a, b) => (b.paid_at || '').localeCompare(a.paid_at || '')), pv = {};
  paid.forEach(r => { const k = r.voucher_id || r.id; (pv[k] = pv[k] || []).push(r); });
  const pays = Object.values(pv).slice(0, 40);
  if (pays.length) out.push(h('div', { class: 'sec' }, secH('Paid', pays.length + ''), h('div', { class: 'list' }, pays.map(xs => { const r = xs[0], v = S.vouchers[r.voucher_id];
    return h('button', { class: 'row', type: 'button', onclick: () => v ? openSheet({ type: 'voucher', id: r.voucher_id }) : null }, h('div', { class: 'row-main' }, h('div', { class: 'row-title', text: nameOf(r.user_id) + ' · ' + xs.length + ' claim' + (xs.length === 1 ? '' : 's') }),
      h('div', { class: 'row-meta', text: [r.voucher_no, r.paid_at ? fmtD(r.paid_at.slice(0, 10)) : '', xs.map(x => x.id).join(', ')].filter(Boolean).join(' · ') })), h('div', { class: 'row-amt', text: tk(xs.reduce((a, x) => a + (+x.amount || 0), 0)) })); }))));
  return out;
}
function moreItem(t, d, onclick, right) {""")

# ---------- tab icons (same line style as SLATE OS Studio and Business) ----------
rep("""function tabsFor() {""", """const BK_TAB_ICO = {"home": "M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5", "money": "M4 6h13a1 1 0 0 1 1 1v2M4 6a1 1 0 0 0-1 1v11a2 2 0 0 0 2 2h14a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2M16 14h.01", "requests": "M4 5h16l1 8v6H3v-6zM3 13h5l1.5 3h5l1.5-3h5", "invoices": "M5 3h14v18l-2.3-1.5L14.3 21 12 19.5 9.7 21l-2.4-1.5L5 21zM9 8h6M9 12h6M9 16h3.5", "docs": "M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z", "reports": "M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5v10zM14 3a7.5 7.5 0 0 1 7 7h-7z", "more": "M5 12h.01M12 12h.01M19 12h.01", "petty": "M3 6h18v12H3zM12 9.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5M6.5 12h.01M17.5 12h.01"};
function tabIco(k) { const d = BK_TAB_ICO[k]; if (!d) return null; const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
  [['viewBox', '0 0 24 24'], ['class', 'tab-ic'], ['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round'], ['aria-hidden', 'true']].forEach(([a, v]) => s.setAttribute(a, v));
  const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.append(p); return s; }
function tabsFor() {""")
rep("""onclick: () => go(k) }, l, n ? h('span', { class: 'badge',""", """onclick: () => go(k) }, tabIco(k), l, n ? h('span', { class: 'badge',""")
rep(""".tab{appearance:none;border:0;background:none;font-size:14px;""", """.tab .tab-ic{width:15px;height:15px;flex:none;opacity:.85}.tab[aria-current="page"] .tab-ic{opacity:1}
.tab{appearance:none;border:0;background:none;font-size:14px;""")

# ---------- Fees still to come in: project name in bold, code beside it; colour by status ----------
rep("""h('span', { class: 't', text: x.code || x.name }), h('span', { class: 'm', text: `${x.code ? x.name + ' · ' : ''}${stopped(x) ? x.status.toLowerCase() + ' · due for work done · ' : ''}received ${tkShort(x.revenueToDate)} of ${tkShort(x.contract)}` }),""",
    """h('span', { class: 't' }, h('i', { class: 'pst-dot ' + pstCls(x.status), title: x.status || 'Active' }), x.name || x.code), h('span', { class: 'm' }, x.code && x.name ? h('span', { class: 'mono', text: x.code + ' · ' }) : null, stopped(x) ? h('b', { class: 'pst-t ' + pstCls(x.status), text: x.status + ' · due for work done · ' }) : null, `received ${tkShort(x.revenueToDate)} of ${tkShort(x.contract)}`),""")
rep("""  if (held.length) body.push(h('div', { class: 'f-hint', text: `Paused or closed, not counted until the amount due for work done is set in More › Projects: ${held.map(x => x.code || x.name).join(', ')}.` }));""",
    """  if (held.length) body.push(h('div', { class: 'f-hint' }, 'Paused or closed, not counted until the amount due for work done is set in More › Projects:', h('div', { class: 'pst-chips' }, held.map(x => h('span', { class: 'pst-chip ' + pstCls(x.status), title: (x.code ? x.code + ' · ' : '') + (x.status || '') }, h('i', { class: 'pst-dot ' + pstCls(x.status) }), x.name || x.code)))),
    h('div', { class: 'pst-key' }, [['Active', 'Running'], ['On hold', 'On hold'], ['Closed', 'Closed'], ['Cancelled', 'Cancelled']].map(([k, l]) => h('span', {}, h('i', { class: 'pst-dot ' + pstCls(k) }), l))));""")
rep("""function comingInBox() {""", """/* project status colours: running green, on hold amber, closed grey, cancelled red */
const pstCls = st => /cancel/i.test(st || '') ? 'pst-x' : /hold|paus/i.test(st || '') ? 'pst-h' : /clos|complet/i.test(st || '') ? 'pst-c' : 'pst-a';
function comingInBox() {""")
rep(""".wl .t{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}""", """.wl .t{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wl .m .mono{font-size:11.5px}
.pst-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px;flex:none}
.pst-a.pst-dot{background:#34A853}.pst-h.pst-dot{background:#F2A007}.pst-c.pst-dot{background:#AEAEB2}.pst-x.pst-dot{background:#D7262B}
.pst-t{font-weight:600}.pst-t.pst-h{color:#B26A00}.pst-t.pst-c{color:#6E6E73}.pst-t.pst-x{color:#B71C21}
.pst-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.pst-chip{display:inline-flex;align-items:center;font-size:12px;font-weight:500;padding:3px 9px;border-radius:999px;background:#F2F2F7;color:var(--ink)}
.pst-chip.pst-h{background:#FFF4DE}.pst-chip.pst-x{background:#FDECEC}.pst-chip.pst-c{background:#F2F2F7;color:#6E6E73}
.pst-key{display:flex;flex-wrap:wrap;gap:12px;font-size:11.5px;color:var(--muted);margin-top:2px}""")

# ---------- More › Projects: rows had no first column, so names were squeezed into the icon slot; status dot fills it ----------
rep("""const by = { Active: [], 'On hold': [], Closed: [] }; ids.forEach(k => (by[S.projects[k].status] || by.Active).push(k));""",
    """const by = { Active: [], 'On hold': [], Completed: [], Closed: [], Cancelled: [] }; ids.forEach(k => (by[S.projects[k].status] || by.Active).push(k));""")
rep("""return h('button', { class: 'row', type: 'button', onclick: () => openSheet({ type: 'project', id: k, d: projDraft(k) }) },
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, h('span', { text: p.name }),""",
    """return h('button', { class: 'row', type: 'button', onclick: () => openSheet({ type: 'project', id: k, d: projDraft(k) }) },
    h('span', { class: 'pst-dot ' + pstCls(p.status), style: 'justify-self:center;margin:0', title: p.status || 'Active', 'aria-hidden': 'true' }),
    h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, h('span', { text: p.name }),""")

# any row with no icon: its text takes the icon's column too (Accounts, Fixed assets and the like)
rep(""".row-main{min-width:0}""", """.row-main{min-width:0}.row>.row-main:first-child{grid-column:1/3}""")

# ---------- full project status from SLATE OS: Completed and Construction support still owe the whole fee ----------
rep("""function comingInBox() {""", """/* a project that owes only the work done: paused, closed after a phase, or cancelled */
const STOPPED = st => !!st && !['Active', 'Completed', 'Construction support'].includes(st);
function comingInBox() {""")
rep("""  const stopped = x => x.status && x.status !== 'Active', earned = x => +((S.projects[x.id] || {}).earned) || 0;""",
    """  const stopped = x => STOPPED(x.status), earned = x => +((S.projects[x.id] || {}).earned) || 0, flag = x => S.projects[x.id] || {};""")
rep("""  const act = list.filter(x => x.id && !x.overhead && (x.status === 'Active' || (stopped(x) && x.toCollect > 0.5)));""",
    """  const act = list.filter(x => x.id && !x.overhead && !flag(x).feeTba && !flag(x).free && (!stopped(x) || x.toCollect > 0.5));
  const tba = list.filter(x => x.id && !x.overhead && flag(x).feeTba && !stopped(x));""")
rep("""noFee = act.filter(x => x.status === 'Active' && !x.contract).length;""", """noFee = act.filter(x => !stopped(x) && !x.contract).length;""")
rep("""  if (noFee) body.push(""", """  if (tba.length) body.push(h('div', { class: 'f-hint' }, 'Fee to be agreed, not counted until it is set in SLATE OS › Business › Fees:', h('div', { class: 'pst-chips' }, tba.map(x => h('span', { class: 'pst-chip pst-a', title: x.code || '' }, h('i', { class: 'pst-dot pst-a' }), (x.name || x.code) + (x.revenueToDate > 0.5 ? ' · received ' + tkShort(x.revenueToDate) : '') + (+flag(x).estFee ? ' · est. ' + tkShort(+flag(x).estFee) : ''))))));
  if (noFee) body.push(""")
rep("""[['Active', 'Running'], ['On hold', 'On hold'], ['Closed', 'Closed'], ['Cancelled', 'Cancelled']]""", """[['Active', 'Running'], ['Construction support', 'Construction support'], ['On hold', 'On hold'], ['Completed', 'Completed'], ['Cancelled', 'Cancelled']]""")
rep("""const pstCls = st => /cancel/i.test(st || '') ? 'pst-x' : /hold|paus/i.test(st || '') ? 'pst-h' : /clos|complet/i.test(st || '') ? 'pst-c' : 'pst-a';""",
    """const pstCls = st => /cancel/i.test(st || '') ? 'pst-x' : /hold|paus/i.test(st || '') ? 'pst-h' : /complet/i.test(st || '') ? 'pst-d' : /clos/i.test(st || '') ? 'pst-c' : 'pst-a';""")
rep(""".pst-a.pst-dot{background:#34A853}""", """.pst-a.pst-dot{background:#34A853}.pst-d.pst-dot{background:#2F6FD6}""")
rep("""const by = { Active: [], 'On hold': [], Completed: [], Closed: [], Cancelled: [] };""", """const by = { Active: [], 'Construction support': [], 'On hold': [], Completed: [], Closed: [], Cancelled: [] };""")
rep("""    D().status !== 'Active' ? field('Fee SLATE has earned for work done (Tk)',""", """    STOPPED(D().status) ? field('Fee SLATE has earned for work done (Tk)',""")
rep("""      (pr.status && pr.status !== 'Active') ? (+pr.earned ?""", """      STOPPED(pr.status) ? (+pr.earned ?""")

rep("""[['Active', 'Active'], ['On hold', 'On hold'], ['Closed', 'Closed']], { disabled: ro || os })""", """[['Active', 'Active'], ['Construction support', 'Construction support'], ['On hold', 'On hold'], ['Completed', 'Completed'], ['Closed', 'Closed'], ['Cancelled', 'Cancelled']], { disabled: ro || os })""")

# projects list: say when the fee is still to be agreed, or the project is pro bono
rep("""h('div', { class: 'row-amt' }, h('span', { class: 'a', text: +p.contract ? fmt(p.contract) : '' }), +p.contract ? h('span', { class: 'b', text: 'fee agreed' }) : null)); })))); });""",
    """h('div', { class: 'row-amt' }, h('span', { class: 'a', text: +p.contract ? fmt(p.contract) : '' }), +p.contract ? h('span', { class: 'b', text: 'fee agreed' }) : p.feeTba ? h('span', { class: 'b', text: 'fee to be agreed' }) : p.free ? h('span', { class: 'b', text: 'pro bono' }) : null)); })))); });""")

open(out, 'w', encoding='utf-8').write(s)
print('ok', len(s))
