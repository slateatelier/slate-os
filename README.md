# SLATE OS

SLATE Architecture & Design's internal project, phase and task system. *Design with purpose.*

- **App:** os.slate-atelier.com
- **Data, logins and access rules:** Supabase project `slate-os` (Mumbai), with row-level security on every table
- **Access model:** the approved Roles & Permission Matrix (23 Oct 2026) — Principal, COO, POD leader, Junior Architect, support roles

Never commit secret keys. The app uses only Supabase's public key, which is safe in the browser because every table is protected by row-level security.

## Hosting (free plans)

| Part | Where | Notes |
| --- | --- | --- |
| App | Cloudflare Pages project `slate-os` | Builds from `main` with `node scripts/build-pages.mjs`, publishes `dist/` |
| Invoice PDF printer | Cloudflare Worker `slate-os-pdf` (`pdf-worker/`) | Cloudflare's headless browser; no public address, reached only through the app's `/api/invoice-pdf` |
| Database and logins | Supabase `slate-os` | Free plan; stays awake with daily use |
| Backups | GitHub Actions, `.github/workflows/weekly-backup.yml` | Encrypted, weekly, kept 90 days |

`vercel.json` and `api/` are the previous Vercel setup, kept until the move to Cloudflare is confirmed, then removed.

## Weekly backup

Every Thursday night the workflow copies the database, encrypts it with `BACKUP_PASSPHRASE`, and keeps it for 90 days under **Actions › Weekly database backup**. Each run holds two files:

- `slate-os-data-<date>.dump.gpg` — all SLATE OS data (projects, tasks, meetings, Finance, logs, settings)
- `slate-os-logins-<date>.dump.gpg` — sign-in accounts

Not included: files in Supabase Storage (shared invoice PDFs). These can be made again from the data.

GitHub pauses scheduled workflows in a repository with no commits for 60 days; if that happens, re-enable it from the Actions tab.

### Restoring

Only the Principal (or a developer they authorise) restores, and only after deciding what to roll back.

1. Download the backup from the Actions run and unzip it.
2. Decrypt: `gpg --decrypt slate-os-data-<date>.dump.gpg > data.dump` and enter the passphrase.
3. Restore into a **new** Supabase project first and check it, never straight over the live one:
   `pg_restore --no-owner --no-privileges --dbname "<new project's connection string>" data.dump`
4. Point the app at the restored project only once it checks out.
