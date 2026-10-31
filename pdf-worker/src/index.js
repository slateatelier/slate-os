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

    // Reuse a browser that is already open and idle, so several PDFs in a row don't hit the free plan's
    // limit on starting new browsers; start a new one (kept open for a minute) only when none is free.
    let browser, page;
    try {
      try {
        const idle = (await puppeteer.sessions(env.BROWSER)).filter(s => !s.connectionId).map(s => s.sessionId);
        if (idle.length) browser = await puppeteer.connect(env.BROWSER, idle[Math.floor(Math.random() * idle.length)]);
      } catch (_) { browser = null; }
      if (!browser) browser = await puppeteer.launch(env.BROWSER, { keep_alive: 60000 });
      page = await browser.newPage();
      await page.setViewport({ width: 900, height: 1300 });
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', r => {
        let host = ''; try { host = new URL(r.url()).hostname; } catch (_) {}
        if (r.url().startsWith('data:') || ALLOWED_HOSTS.has(host)) r.continue(); else r.abort();
      });
      // Wait for the page and its fonts, but never fail just because Google Fonts is slow: after the wait,
      // print with whatever has loaded (the fallback fonts look almost the same).
      try { await page.setContent(html, { waitUntil: 'load', timeout: 25000 }); }
      catch (e) { if (!/timeout/i.test(String((e && e.message) || e))) throw e; }
      await Promise.race([page.evaluate('document.fonts.ready.then(() => 1)').catch(() => 0), new Promise(r => setTimeout(r, 8000))]);
      await page.emulateMediaType('print');
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
      return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' } });
    } catch (e) {
      const why = String((e && e.message) || e || 'unknown error').slice(0, 300);
      console.error('invoice-pdf', why);
      // Only the Principal and the COO reach this point, so the reason is shown to help fix it
      const busy = /429|rate limit/i.test(why);
      return fail(busy ? 429 : 500, busy ? 'The PDF printer is busy. Try again in a minute.' : `Couldn’t make the PDF (${why}). Try again in a moment.`);
    } finally {
      if (page) await page.close().catch(() => {});
      if (browser) { try { browser.disconnect(); } catch (_) {} }
    }
  }
};
