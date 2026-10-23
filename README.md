# SLATE OS

SLATE Architecture & Design's internal project, phase and task system. *Design with purpose.*

- **App:** os.slate-atelier.com (Vercel)
- **Data, logins and access rules:** Supabase project `slate-os` (Mumbai), with row-level security on every table
- **Access model:** the approved Roles & Permission Matrix (23 Oct 2026) — Principal, COO, Pod Leader, Junior Architect, support roles

This commit is a placeholder so the repository can be linked to Vercel. The app itself arrives in Phase 5 of the deployment guide.

Never commit secret keys. The app uses only Supabase's public key, set as a Vercel environment variable.
