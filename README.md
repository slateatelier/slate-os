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

Not included: files in Supabase Storage. Invoice PDFs can be made again from the data; bill photos are archived to Google Drive (below).

Each run also copies the two encrypted files to Google Drive (**SLATE OS Archive › Backups**, kept one year) when the `GOOGLE_*` secrets are set.

## Google Drive archive

Google account `slateos.archive@gmail.com` (in the Principal's Google One family, so it uses the shared storage), OAuth client in Google Cloud project `slate-os-513515`, scope `drive.file` only: SLATE OS sees and changes only the files it created. The secrets `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `GOOGLE_REFRESH_TOKEN` are in GitHub Actions secrets and Supabase Edge Function secrets, never in the code.

- **Bills:** the Edge Function `drive-archive` (`supabase/functions/drive-archive`, called nightly at 03:17 Dhaka by the pg_cron job `slate-drive-archive`) copies every file in the private `books` bucket once its upload month has ended, to **SLATE OS Archive › Bills › YYYY-MM**, named `date · ref · party · Tk amount`, and refreshes that month's **Bills index YYYY-MM** sheet. Anything missed is caught up the next night. The Principal is notified when a month is done or if a run fails. Set-up: `supabase/migrations/m_drive_archive.sql`.
- **Backups:** the weekly workflow above.
- If Google sign-in starts failing, the refresh token was revoked: make a new one in the OAuth Playground with SLATE OS's own client and replace `GOOGLE_REFRESH_TOKEN` in both places.

GitHub pauses scheduled workflows in a repository with no commits for 60 days; if that happens, re-enable it from the Actions tab.

### Restoring

Only the Principal (or a developer they authorise) restores, and only after deciding what to roll back.

1. Download the backup from the Actions run and unzip it.
2. Decrypt: `gpg --decrypt slate-os-data-<date>.dump.gpg > data.dump` and enter the passphrase.
3. Restore into a **new** Supabase project first and check it, never straight over the live one:
   `pg_restore --no-owner --no-privileges --dbname "<new project's connection string>" data.dump`
4. Point the app at the restored project only once it checks out.
