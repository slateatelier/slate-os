// SLATE OS · Cloudflare Pages build
// Copies the app's public files into dist/, leaving out server code, database migrations,
// tooling and docs, so only what the browser needs is published.
import { cpSync, rmSync, readdirSync } from 'node:fs';

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
console.log('SLATE OS: published', readdirSync(OUT).join(', '));
