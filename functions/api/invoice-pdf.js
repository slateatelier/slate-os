/* SLATE OS · Finance · invoice PDF (Cloudflare Pages)
   Same address the app already calls. The print job is passed unchanged to the slate-os-pdf Worker,
   which checks the caller's Finance access and prints with Cloudflare's headless browser. */
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Use POST' }, { status: 405 });
  }
  if (!env.PDF) {
    return Response.json({ error: 'The PDF printer isn’t connected yet.' }, { status: 503 });
  }
  return env.PDF.fetch(request);
}
