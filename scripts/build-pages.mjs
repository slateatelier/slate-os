// SLATE OS · Cloudflare Pages build
// Copies the app's public files into dist/, leaving out server code, database migrations,
// tooling and docs, so only what the browser needs is published.
import { cpSync, rmSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'dist';
const SKIP = new Set([
  OUT, '.git', '.github', 'node_modules',
  'api', 'functions', 'pdf-worker', 'scripts', 'supabase', 'content',
  'package.json', 'package-lock.json', 'vercel.json', '.vercelignore', 'wrangler.toml', 'README.md', '.gitignore'
]);

rmSync(OUT, { recursive: true, force: true });
for (const name of readdirSync('.')) {
  if (SKIP.has(name)) continue;
  cpSync(name, `${OUT}/${name}`, { recursive: true });
}
// the release number (from the service worker's cache name) and the build time go into the app, shown under More
const ver = (readFileSync('sw.js', 'utf8').match(/slate-os-v(\d+)/) || [])[1] || '';
const page = `${OUT}/index.html`;
writeFileSync(page, readFileSync(page, 'utf8').replace("'__APP_VER__'", `'${ver}'`).replace("'__APP_AT__'", `'${new Date().toISOString()}'`));
console.log('SLATE OS: published', readdirSync(OUT).join(', '), '· release v' + ver + ' (shown as 2.' + String(+ver - 409).padStart(3, '0') + ')');
