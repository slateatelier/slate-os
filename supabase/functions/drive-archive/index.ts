// SLATE OS · Google Drive bills archive
// Copies bill photos and documents from the private storage bucket 'books' to
//   SLATE OS Archive / Bills / YYYY-MM /     (file name: date · ref · party · Tk amount)
// and keeps a "Bills index YYYY-MM" Google Sheet in each month's folder.
// A file is copied once its upload month has ended; the nightly cron (pg_cron 'slate-drive-archive') catches up
// on anything missed. Runs from the cron (x-slate-cron token) or by hand by the Principal or the COO.
// POST { "check": true } only tests the Google connection and makes the folders.
// Google access: slateos.archive@gmail.com, scope drive.file (sees only what SLATE OS creates).
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (Supabase Edge Function secrets).
const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const G_ID = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const G_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
const G_REFRESH = Deno.env.get('GOOGLE_REFRESH_TOKEN') || '';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-slate-cron', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const FOLDER = 'application/vnd.google-apps.folder';
const SHEET = 'application/vnd.google-apps.spreadsheet';
const BUDGET_MS = 110_000;   // stop taking new files after this; the next run carries on

async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${t.slice(0, 300)}`);
  return (t ? JSON.parse(t) : null) as T;
}

/* ---------- Google ---------- */
let token = '';
async function google(): Promise<string> {
  if (token) return token;
  if (!G_ID || !G_SECRET || !G_REFRESH) throw new Error('Google secrets are missing in Supabase (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN).');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: G_ID, client_secret: G_SECRET, refresh_token: G_REFRESH, grant_type: 'refresh_token' }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const why = j.error === 'invalid_grant' ? 'the refresh token was revoked or has expired: get a new one from the OAuth Playground' : (j.error_description || j.error || r.status);
    throw new Error(`Google sign-in failed (${why}).`);
  }
  return (token = j.access_token);
}
async function drive(path: string, init: RequestInit = {}, base = 'https://www.googleapis.com/drive/v3/'): Promise<Response> {
  const r = await fetch(base + path, { ...init, headers: { Authorization: `Bearer ${await google()}`, ...(init.headers || {}) } });
  if (!r.ok) {
    const t = await r.text();
    if (/storageQuotaExceeded/.test(t)) throw new Error('Google Drive is full: check the Google One family storage.');
    throw new Error(`Drive ${init.method || 'GET'} ${path.split('?')[0]}: ${r.status} ${t.slice(0, 200)}`);
  }
  return r;
}
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

// a folder SLATE OS made (drive.file only ever sees its own), found or created, remembered in the database
async function folder(key: string, name: string, parent: string | null): Promise<string> {
  const known = await rpc<string | null>('drive_folder', { p_key: key });
  if (known) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${known}?fields=id,trashed`, { headers: { Authorization: `Bearer ${await google()}` } });
    if (r.ok && !(await r.json()).trashed) return known;
  }
  const query = `name='${q(name)}' and mimeType='${FOLDER}' and trashed=false` + (parent ? ` and '${parent}' in parents` : '');
  const found = await (await drive(`files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`)).json();
  let id = found.files?.[0]?.id;
  if (!id) {
    const made = await (await drive('files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }) })).json();
    id = made.id;
  }
  await rpc('drive_folder_set', { p_key: key, p_id: id });
  return id;
}
async function billsFolder(month: string): Promise<string> {
  const root = await folder('root', 'SLATE OS Archive', null);
  const bills = await folder('bills', 'Bills', root);
  return folder(`bills/${month}`, month, bills);
}

// resumable upload: works for big photos and PDFs alike
async function upload(meta: Record<string, unknown>, body: Blob, mime: string, existing?: string): Promise<string> {
  const init = await drive(existing ? `files/${existing}?uploadType=resumable&fields=id` : 'files?uploadType=resumable&fields=id', {
    method: existing ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime || 'application/octet-stream' },
    body: JSON.stringify(meta),
  }, 'https://www.googleapis.com/upload/drive/v3/');
  const at = init.headers.get('Location');
  if (!at) throw new Error('Drive did not open an upload session.');
  const r = await fetch(at, { method: 'PUT', headers: { 'Content-Type': mime || 'application/octet-stream' }, body });
  if (!r.ok) throw new Error(`Drive upload: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).id;
}

/* ---------- what each file is ---------- */
type Doc = { coll: string; path: string; data: Record<string, any> };
type Label = { kind: string; date: string; ref: string; party: string; amount: number | null };
const num = (x: unknown) => { const n = Number(x); return Number.isFinite(n) && n ? n : 0; };
function label(docs: Doc[], led: Record<string, string>, uploaded: string): Label {
  const L = (id: unknown) => (typeof id === 'string' && led[id]) || '';
  const pick = (c: string) => docs.find(d => d.coll === c || d.coll.startsWith(c + '/'));
  const v = pick('vouchers'), inv = pick('invoices'), req = pick('requests'), lib = pick('files'), shop = pick('shoplists');
  const day = uploaded.slice(0, 10);
  if (v) {
    const d = v.data, lines: any[] = Array.isArray(d.lines) ? d.lines : [];
    const total = lines.reduce((s, x) => s + num(x.dr), 0);
    const main = lines.filter(x => !/cash|bank|petty/i.test(L(x.l))).sort((a, b) => Math.abs(num(b.dr) - num(b.cr)) - Math.abs(num(a.dr) - num(a.cr)))[0];
    return { kind: 'Voucher', date: d.date || day, ref: d.no || d.ref || '', party: d.party || L(main?.l) || d.type || '', amount: total || null };
  }
  if (inv) {
    const d = inv.data, items: any[] = Array.isArray(d.items) ? d.items : [];
    return { kind: 'Invoice', date: d.date || day, ref: d.no || '', party: L(d.client) || d.clientName || '', amount: num(d.total) || items.reduce((s, x) => s + num(x.amount), 0) || null };
  }
  if (req) {
    const d = req.data;
    return { kind: d.type === 'petty' ? 'Petty cash bill' : 'Payment request', date: d.date || day, ref: '', party: d.payTo || d.title || d.byName || '', amount: num(d.amount) || null };
  }
  if (shop) return { kind: 'Office shopping', date: day, ref: shop.path.replace(/^.*\//, ''), party: '', amount: null };
  if (lib) {
    const d = lib.data;
    return { kind: d.kind || 'Document', date: d.date || day, ref: d.note || '', party: d.party || '', amount: num(d.amount) || null };
  }
  return { kind: 'Not linked', date: day, ref: '', party: '', amount: null };
}
const tk = (n: number | null) => n == null ? '' : 'Tk ' + Math.round(n).toLocaleString('en-IN');
const clean = (s: string) => String(s || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
function fileName(l: Label, objectName: string): string {
  const ext = (objectName.match(/\.(\w{1,5})$/) || [, 'bin'])[1].toLowerCase();
  const tail = objectName.replace(/^.*\//, '').replace(/\.\w+$/, '').slice(-6);   // keeps names unique
  return [l.date, clean(l.ref), clean(l.party), tk(l.amount), tail].filter(Boolean).join(' · ') + '.' + ext;
}

/* ---------- index sheet for a month ---------- */
const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
async function writeIndex(month: string, parent: string) {
  const rows = await rpc<any[]>('drive_month_files', { p_month: month });
  const head = ['Date', 'Type', 'Ref / voucher no', 'Party', 'Amount (Tk)', 'File', 'Uploaded to SLATE OS', 'Size (KB)', 'Open'];
  const body = rows.map(f => [f.doc_date, f.kind, f.ref, f.party, f.amount ?? '', f.drive_name,
    f.uploaded_at ? new Date(f.uploaded_at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' }) : '',
    f.size_bytes ? Math.round(f.size_bytes / 1024) : '', `https://drive.google.com/file/d/${f.drive_id}/view`]);
  const csv = [head, ...body].map(r => r.map(csvCell).join(',')).join('\r\n');
  const key = `index/${month}`, existing = await rpc<string | null>('drive_folder', { p_key: key });
  const blob = new Blob([csv], { type: 'text/csv' });
  let id: string;
  try {
    id = existing ? await upload({}, blob, 'text/csv', existing)
      : await upload({ name: `Bills index ${month}`, mimeType: SHEET, parents: [parent] }, blob, 'text/csv');
  } catch (e) {
    if (!existing) throw e;
    id = await upload({ name: `Bills index ${month}`, mimeType: SHEET, parents: [parent] }, blob, 'text/csv');   // the old index was deleted
  }
  await rpc('drive_folder_set', { p_key: key, p_id: id });
}

/* ---------- the run ---------- */
async function run(trigger: string, check: boolean) {
  const t0 = Date.now();
  if (check) {
    const root = await folder('root', 'SLATE OS Archive', null);
    await folder('bills', 'Bills', root);
    await folder('backups', 'Backups', root);
    return { ok: true, check: true, pending: await rpc<number>('drive_pending_count') };
  }
  const id = await rpc<number>('drive_run_start', { p_trigger: trigger });
  let copied = 0;
  const months = new Set<string>();
  try {
    const pending = await rpc<any[]>('drive_pending', { p_limit: 300 });
    if (pending.length) {
      const led = await rpc<Record<string, string>>('drive_ledger_names');
      for (const p of pending) {
        if (Date.now() - t0 > BUDGET_MS) break;
        const obj = await fetch(`${URL_}/storage/v1/object/books/${p.object_name.split('/').map(encodeURIComponent).join('/')}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
        if (obj.status === 404 || obj.status === 400) continue;   // removed since; nothing to keep
        if (!obj.ok) throw new Error(`Couldn't read ${p.object_name} from storage (${obj.status}).`);
        const l = label(p.docs || [], led, new Date(p.uploaded_at).toLocaleString('sv-SE', { timeZone: 'Asia/Dhaka' }));
        const name = fileName(l, p.object_name);
        const parent = await billsFolder(p.month);
        const driveId = await upload({ name, parents: [parent], description: `SLATE OS bill archive · ${l.kind}` }, await obj.blob(), p.mime);
        await rpc('drive_file_done', { p: { object_name: p.object_name, month: p.month, drive_id: driveId, drive_name: name, kind: l.kind,
          doc_date: l.date, ref: l.ref, party: l.party, amount: l.amount ?? '', size_bytes: p.size_bytes ?? '', uploaded_at: p.uploaded_at } });
        months.add(p.month); copied++;
      }
      for (const m of months) await writeIndex(m, await billsFolder(m));
    }
    const left = await rpc<number>('drive_pending_count');
    await rpc('drive_run_end', { p_id: id, p_ok: true, p_copied: copied, p_pending: left, p_note: [...months].join(', ') });
    return { ok: true, copied, pending: left, months: [...months] };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await rpc('drive_run_end', { p_id: id, p_ok: false, p_copied: copied, p_pending: -1, p_note: msg }).catch(() => {});
    throw e;
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const body = await req.json().catch(() => ({}));
  let trigger = 'cron';
  const cron = req.headers.get('x-slate-cron');
  if (cron) {
    if (!(await rpc<boolean>('drive_cron_ok', { p_token: cron }))) return json({ error: 'Not allowed.' }, 403);
  } else {
    // by hand: the Principal or the COO, signed in
    const auth = req.headers.get('Authorization') || '';
    const ok = await fetch(`${URL_}/rest/v1/rpc/drive_can_run`, { method: 'POST', headers: { apikey: KEY, Authorization: auth, 'Content-Type': 'application/json' }, body: '{}' })
      .then(r => r.ok ? r.json() : false).catch(() => false);
    if (ok !== true) return json({ error: 'Only the Principal and the COO can run the Drive archive.' }, 403);
    trigger = 'manual';
  }
  try {
    return json(await run(trigger, !!body.check));
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
