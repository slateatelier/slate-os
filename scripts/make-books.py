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
body .chrome{background:rgba(231,241,234,.88);border-bottom:2px solid #3F7F5A}
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
    const pick = own && id !== ownerId() ? (() => { const s = h('select', { 'aria-label': 'Role for ' + nameOf(id), style: 'width:auto', onchange: e => setRole(id, e.target.value) }, [['COO', 'COO'], ['Accountant', 'Accountant'], ['Office staff', 'Office staff'], ['Viewer', 'Viewer (sees all, changes nothing)'], ['None', 'No access']].map(([v, t]) => h('option', { value: v, text: t }))); s.value = r; return s; })() : h('span', { class: 'tag', text: r === 'None' ? 'No access' : r });""")
rep("""function setRole(id, role) {
  const team = Object.assign({}, S.settings.team || {}); team[id] = Object.assign({}, team[id] || {}, { role });""",
"""function setRole(id, role) {
  if (role === 'Viewer' && !confirm('A Viewer sees everything in Books, including every salary. Give ' + nameOf(id) + ' this role?')) { render(); return; }
  const team = Object.assign({}, S.settings.team || {}); team[id] = Object.assign({}, team[id] || {});
  if (role === 'None') delete team[id].role; else team[id].role = role;
  if (!Object.keys(team[id]).length) delete team[id];""")
rep("""Viewer: 'Can look, can’t change anything.' };""", """Viewer: 'Sees everything in Books, including salaries, but changes nothing.', None: 'No access to Books. Sees nothing there.' };""")

rep("""h('li', {}, h('b', { text: k + ': ' }), v)""", """h('li', {}, h('b', { text: (k === 'None' ? 'No access' : k) + ': ' }), v)""")

open(out, 'w', encoding='utf-8').write(s)
print('ok', len(s))
