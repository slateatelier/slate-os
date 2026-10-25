// SLATE OS account admin: the Principal and the COO reset a password, create an account, or deactivate one.
// Holds the admin key so it never reaches a phone. Every action is logged by admin_mark_temp_pw.
const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
const fail = (error: string, status = 400) => json({ error }, status);
const rest = (path: string, init: RequestInit = {}) => fetch(`${URL_}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const admin = (path: string, init: RequestInit = {}) => fetch(`${URL_}/auth/v1/admin/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Easy to read aloud or type: no 0/O, 1/l/I.
function tempPassword() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789', r = crypto.getRandomValues(new Uint8Array(12));
  const s = Array.from(r, x => A[x % A.length]).join('');
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`;
}
async function profile(filter: string) {
  const r = await rest(`profiles?${filter}&select=id,email,designation,active,full_name`);
  const rows = await r.json(); return Array.isArray(rows) ? rows[0] : null;
}
async function mark(user: string, by: string, action: string) {
  const r = await rest('rpc/admin_mark_temp_pw', { method: 'POST', body: JSON.stringify({ p_user: user, p_by: by, p_action: action }) });
  if (!r.ok) throw new Error('Could not record the change: ' + (await r.text()));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return fail('POST only', 405);
  try {
    const who = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: KEY, Authorization: req.headers.get('Authorization') || '' } });
    if (!who.ok) return fail('Sign in again.', 401);
    const caller = await who.json();
    const me = await profile(`id=eq.${caller.id}`);
    if (!me || !me.active || !['principal', 'coo'].includes(me.designation)) return fail('Only the Principal and the COO can manage accounts.', 403);
    const boss = me.designation === 'principal';
    const body = await req.json().catch(() => ({}));
    const pw = tempPassword();

    if (body.action === 'reset') {
      const id = String(body.user_id || '');
      if (!UUID.test(id)) return fail('Choose a person.');
      if (id === me.id) return fail('Change your own password from Account.');
      const t = await profile(`id=eq.${id}`);
      if (!t) return fail('That person was not found.', 404);
      if ((t.designation === 'principal' || t.designation === 'coo') && !boss) return fail('Only the Principal can reset this password.', 403);
      const r = await admin(`users/${id}`, { method: 'PUT', body: JSON.stringify({ password: pw }) });
      if (!r.ok) return fail('Could not set the password: ' + ((await r.json().catch(() => ({}))).msg || r.status), 500);
      await mark(id, me.id, 'password_reset');
      return json({ ok: true, email: t.email, password: pw });
    }

    if (body.action === 'create') {
      const email = String(body.email || '').trim().toLowerCase();
      const name = String(body.full_name || '').trim().slice(0, 80);
      const role = String(body.role_label || '').trim().slice(0, 60);
      const team = String(body.team || '').trim().slice(0, 60);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Enter a valid email address.');
      if (!name) return fail('Enter their name.');
      if (/^\s*principal/i.test(role)) return fail('The Principal account cannot be created here.', 403);
      if (/\bcoo\b|chief operat/i.test(role) && !boss) return fail('Only the Principal can create a COO account.', 403);
      if (await profile(`email=ilike.${encodeURIComponent(email)}`)) return fail('That email already has an account. Use Reset password instead.', 409);
      const pre = await rest('rpc/admin_preassign', { method: 'POST', body: JSON.stringify({ p_email: email, p_name: name, p_role: role, p_team: team }) });
      if (!pre.ok) return fail('Could not save their details.', 500);
      const r = await admin('users', { method: 'POST', body: JSON.stringify({ email, password: pw, email_confirm: true, user_metadata: { full_name: name } }) });
      const u = await r.json().catch(() => ({}));
      if (!r.ok) return fail(/already/i.test(u.msg || '') ? 'That email already has an account. Use Reset password instead.' : 'Could not create the account: ' + (u.msg || r.status), r.status === 422 ? 409 : 500);
      await mark(u.id, me.id, 'account_create');
      return json({ ok: true, email, password: pw, id: u.id });
    }
    if (body.action === 'deactivate' || body.action === 'reactivate') {
      // someone leaves SLATE: block their sign-in and make the account read-only; their records stay
      const on = body.action === 'reactivate';
      const id = String(body.user_id || '');
      if (!UUID.test(id)) return fail('Choose a person.');
      if (id === me.id) return fail('You can’t deactivate your own account.');
      const t = await profile(`id=eq.${id}`);
      if (!t) return fail('That person was not found.', 404);
      if (t.designation === 'principal') return fail('The Principal’s account can’t be deactivated.', 403);
      if (t.designation === 'coo' && !boss) return fail('Only the Principal can deactivate or reactivate the COO.', 403);
      const r = await admin(`users/${id}`, { method: 'PUT', body: JSON.stringify({ ban_duration: on ? 'none' : '876000h' }) });
      if (!r.ok) return fail('Could not change their sign-in: ' + ((await r.json().catch(() => ({}))).msg || r.status), 500);
      const s = await rest('rpc/admin_set_active', { method: 'POST', body: JSON.stringify({ p_user: id, p_by: me.id, p_active: on }) });
      if (!s.ok) {
        await admin(`users/${id}`, { method: 'PUT', body: JSON.stringify({ ban_duration: on ? '876000h' : 'none' }) });
        return fail('Could not record the change: ' + (await s.text()), 500);
      }
      return json({ ok: true, active: on, email: t.email });
    }
    return fail('Unknown action.');
  } catch (e) {
    return fail(String((e as Error).message || e), 500);
  }
});
