// SLATE OS · deliverable uploads to Google Drive (7 Nov 2026)
// A deliverable on a phase checklist is ticked only once its document is uploaded. The browser asks this function to open a
// Google resumable upload session in
//   SLATE OS / Projects / <CODE · name> / Phase <no> <name> /
// and then sends the file straight to Google (big files, resumes on a bad connection); the file never passes through here.
// POST {act:'start', pid, k, item, name, size, mime}  -> {url}            (the caller must be able to see the project)
// POST {act:'get', pid, id}                            -> the file itself  (only a file recorded on that project's checklist)
// Google access: slateos.archive@gmail.com, scope drive.file (sees only what SLATE OS creates).
// Secrets: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN (same as drive-archive).
const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const G_ID = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const G_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
const G_REFRESH = Deno.env.get('GOOGLE_REFRESH_TOKEN') || '';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Expose-Headers': 'content-disposition' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const FOLDER = 'application/vnd.google-apps.folder';
const MAX = 500 * 1024 * 1024;
const PH: Record<string, string> = { '0': '0 Brief and feasibility', '1': '1 Concept design', '2': '2 Design development', '3': '3 Design freeze', '3r': '3R Design freeze (resume)',
  '4': '4 Authority drawings', '5': '5 Marketing materials', '6': '6 WD-1 Substructure', '7': '7 WD-2 Superstructure', '8': '8 WD-3 Finishing', '9': '9 As-built drawings' };

async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await fetch(`${URL_}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${fn}: ${t.slice(0, 300)}`);
  return (t ? JSON.parse(t) : null) as T;
}
let token = '';
async function google(): Promise<string> {
  if (token) return token;
  if (!G_ID || !G_SECRET || !G_REFRESH) throw new Error('Google secrets are missing in Supabase.');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: G_ID, client_secret: G_SECRET, refresh_token: G_REFRESH, grant_type: 'refresh_token' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Google sign-in failed (${j.error === 'invalid_grant' ? 'the refresh token was revoked or has expired' : (j.error_description || j.error || r.status)}).`);
  return (token = j.access_token);
}
async function drive(path: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch('https://www.googleapis.com/drive/v3/' + path, { ...init, headers: { Authorization: `Bearer ${await google()}`, ...(init.headers || {}) } });
  if (!r.ok) { const t = await r.text(); if (/storageQuotaExceeded/.test(t)) throw new Error('Google Drive is full: check the Google One family storage.'); throw new Error(`Drive ${r.status} ${t.slice(0, 200)}`); }
  return r;
}
const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const clean = (s: string, n = 80) => String(s || '').replace(/[\\/:*?"<>|\n\r\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
async function folder(key: string, name: string, parent: string | null): Promise<string> {
  const known = await rpc<string | null>('drive_folder', { p_key: key });
  if (known) {
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${known}?fields=id,trashed`, { headers: { Authorization: `Bearer ${await google()}` } });
    if (r.ok && !(await r.json()).trashed) return known;
  }
  const query = `name='${q(name)}' and mimeType='${FOLDER}' and trashed=false` + (parent ? ` and '${parent}' in parents` : '');
  const found = await (await drive(`files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`)).json();
  let id = found.files?.[0]?.id;
  if (!id) id = (await (await drive('files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) }) })).json()).id;
  await rpc('drive_folder_set', { p_key: key, p_id: id });
  return id;
}
// the project as the caller sees it (row-level security decides): null when they can't see it
async function projectAs(auth: string, pid: string): Promise<Record<string, any> | null> {
  if (!/^[A-Za-z0-9_-]{4,40}$/.test(pid)) return null;
  const r = await fetch(`${URL_}/rest/v1/docs?path=eq.${encodeURIComponent('projects/' + pid)}&select=data`, { headers: { apikey: ANON, Authorization: auth } });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return rows?.[0]?.data || null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const auth = req.headers.get('Authorization') || '';
    const b = await req.json().catch(() => ({}));
    const p = await projectAs(auth, String(b.pid || ''));
    if (!p) return json({ error: 'You can’t open this project.' }, 403);

    if (b.act === 'start') {
      const k = String(b.k || ''), size = Number(b.size) || 0, mime = String(b.mime || 'application/octet-stream').slice(0, 120);
      if (!PH[k]) return json({ error: 'Unknown phase.' }, 400);
      if (size <= 0) return json({ error: 'The file is empty.' }, 400);
      if (size > MAX) return json({ error: 'The file is over 500 MB. Upload a PDF of the set, not the working files.' }, 400);
      const root = await folder('os-root', 'SLATE OS', null);
      const projs = await folder('os-projects', 'Projects', root);
      const pf = await folder(`os-p/${b.pid}`, clean([p.code, p.name].filter(Boolean).join(' · ')) || String(b.pid), projs);
      const ph = await folder(`os-p/${b.pid}/${k}`, 'Phase ' + PH[k], pf);
      const day = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
      const name = [day, clean(String(b.label || ''), 50), clean(String(b.name || 'file'), 90)].filter(Boolean).join(' · ');
      const origin = req.headers.get('Origin') || 'https://os.slate-atelier.com';
      const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType', {
        method: 'POST',
        headers: { Authorization: `Bearer ${await google()}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(size), Origin: origin },
        body: JSON.stringify({ name, parents: [ph], description: `SLATE OS · ${p.code || ''} · phase ${k} · ${String(b.item || '')}` }),
      });
      const url = r.headers.get('Location');
      if (!r.ok || !url) return json({ error: `Google didn’t open the upload (${r.status}).` }, 502);
      return json({ url, folder: ph });
    }

    if (b.act === 'get') {
      const id = String(b.id || '');
      const known = JSON.stringify(p.cl || {}).includes(`"id":"${id}"`) || JSON.stringify(p.site || {}).includes(`"id":"${id}"`);
      if (!/^[A-Za-z0-9_-]{10,80}$/.test(id) || !known) return json({ error: 'That file isn’t on this project.' }, 404);
      const meta = await (await drive(`files/${id}?fields=name,mimeType,size`)).json();
      const r = await drive(`files/${id}?alt=media`);
      return new Response(r.body, { headers: { ...CORS, 'Content-Type': meta.mimeType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(meta.name || 'file')}`, ...(meta.size ? { 'Content-Length': String(meta.size) } : {}) } });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message || String(e) }, 500);
  }
});
