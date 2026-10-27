/* SLATE OS · Finance · invoice PDF printer (Cloudflare Worker)
   Prints the letterhead invoice exactly as "Print or save as PDF" does, with Cloudflare's headless
   Chrome, so the PDF a client receives is the same whether it was sent from a PC or an iPhone.
   Only the Principal and the COO can use it: the caller's own sign-in is checked against Finance access.
   The page is printed with scripts off and only the Google Fonts hosts reachable.
   Reached only through the SLATE OS Pages app (service binding); it has no public address. */
import puppeteer from '@cloudflare/puppeteer';

const ALLOWED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);
const MAX_HTML = 600 * 1024;

const fail = (status, error) => Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });

async function financeRole(env, token) {
  const r = await fetch(`${env.SB_URL}/rest/v1/rpc/fin_role`, {
    method: 'POST',
    headers: { apikey: env.SB_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (!r.ok) return null;
  return r.json();
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return fail(405, 'Use POST');
    const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return fail(401, 'Sign in to Finance first.');
    let role; try { role = await financeRole(env, token); } catch (_) { role = null; }
    if (role !== 'principal' && role !== 'coo') return fail(403, 'Finance is limited to the Principal and the COO.');

    const declared = Number(request.headers.get('content-length') || 0);
    if (declared > MAX_HTML) return fail(413, 'The invoice was too large to print.');
    const html = await request.text();
    if (html.length > MAX_HTML) return fail(413, 'The invoice was too large to print.');
    if (!/^<!doctype html>/i.test(html) || !html.includes('class="page"')) return fail(400, 'That isn’t an invoice page.');

    let browser;
    try {
      browser = await puppeteer.launch(env.BROWSER);
      const page = await browser.newPage();
      await page.setViewport({ width: 900, height: 1300 });
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
      return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } });
    } catch (e) {
      const why = String((e && e.message) || e || 'unknown error').slice(0, 300);
      console.error('invoice-pdf', why);
      // Only the Principal and the COO reach this point, so the reason is shown to help fix it
      return fail(500, `Couldn’t print the invoice (${why}). Try again in a moment.`);
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }
};
