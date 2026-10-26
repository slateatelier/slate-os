/* SLATE OS · Finance · invoice PDF
   Prints the letterhead invoice exactly as "Print or save as PDF" does, with a headless Chrome,
   so the PDF a client receives is the same whether it was sent from a PC or an iPhone.
   Only the Principal and the COO can use it: the caller's own sign-in is checked against Finance access.
   The page is printed with scripts off and only the Google Fonts hosts reachable. */
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');

const SB_URL = 'https://fbktoepdfegtkazbytel.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZia3RvZXBkZmVndGthemJ5dGVsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NTk0ODksImV4cCI6MjEwODMzNTQ4OX0.BZkYZLfjEQFylUmm1vQ3Wb0zsKHqp2Nk1Qt5GQvRPe0';
const ALLOWED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const MAX_HTML = 600 * 1024;

let browserP = null;
async function browser() {
  if (browserP) { const b = await browserP.catch(() => null); if (b && b.connected) return b; }
  browserP = (async () => puppeteer.launch({
    args: chromium.args, defaultViewport: { width: 900, height: 1300 },
    executablePath: await chromium.executablePath(), headless: chromium.headless
  }))();
  return browserP;
}

async function financeRole(token) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/fin_role`, {
    method: 'POST', headers: { apikey: SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: '{}'
  });
  if (!r.ok) return null;
  return r.json();
}

function readBody(req) {
  return new Promise((ok, no) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_HTML) { no(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => ok(Buffer.concat(chunks).toString('utf8')));
    req.on('error', no);
  });
}

module.exports = async (req, res) => {
  const fail = (code, msg) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: msg })); };
  if (req.method === 'GET' && /[?&]check=1\b/.test(req.url || '')) {   // TEMP deploy check: prints a fixed test page, returns only its size
    let pg; try { const b = await browser(); pg = await b.newPage(); await pg.setContent('<!doctype html><p style="font:20px sans-serif">SLATE print check</p>');
      const pdf = await pg.pdf({ format: 'A4' }); res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ ok: true, bytes: pdf.length })); }
    catch (e) { return fail(500, String(e && e.message)); } finally { if (pg) pg.close().catch(() => {}); }
  }
  if (req.method !== 'POST') return fail(405, 'Use POST');
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return fail(401, 'Sign in to Finance first.');
  let role; try { role = await financeRole(token); } catch (_) { role = null; }
  if (role !== 'principal' && role !== 'coo') return fail(403, 'Finance is limited to the Principal and the COO.');

  let html; try { const raw = req.body; html = typeof raw === 'string' ? raw : Buffer.isBuffer(raw) ? raw.toString('utf8') : await readBody(req); } catch (e) { return fail(e.code || 400, 'The invoice was too large to print.'); }
  if (!/^<!doctype html>/i.test(html) || !html.includes('class="page"')) return fail(400, 'That isn’t an invoice page.');

  let page;
  try {
    const b = await browser();
    page = await b.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', r => {
      let host = ''; try { host = new URL(r.url()).hostname; } catch (_) {}
      if (r.url().startsWith('data:') || ALLOWED_HOSTS.has(host)) r.continue(); else r.abort();
    });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 20000 });
    await page.evaluateHandle('document.fonts.ready');
    await page.emulateMediaType('print');
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.end(Buffer.from(pdf));
  } catch (e) {
    console.error('invoice-pdf', e && e.message);
    fail(500, 'Couldn’t print the invoice. Try again in a moment.');
  } finally { if (page) page.close().catch(() => {}); }
};
