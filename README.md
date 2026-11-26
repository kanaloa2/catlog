# CatLog

A calendar of your kitties' events: who pooed, who barfed, when. Cat pages with photos and counts, search and
filters, one-tap quick add, an easy "Who did it?" button for events logged as Somebody, iPhone Shortcuts, logging
from email text, and import from Dataverse. Works offline as an installable web app and syncs to your account.

## How it's built

- Vite + React + TypeScript PWA. Data lives in IndexedDB (Dexie) on the device and syncs to Supabase.
- Supabase project `hpyjxwmfxjopbvojagqe` (shared with Packlist and Pickup, so the same email and password sign in).
  Tables `catlog_cats`, `catlog_events`, `catlog_shortcut_keys`, `catlog_import_reports`; photos in the private
  `catlog-photos` bucket. Row level security keeps each account's rows private. Schema in `supabase/migrations/`.
- "Somebody" is a built-in cat whose id is the account's user id, so every device and the shortcut endpoints agree on it.
- Shortcuts and email: `catlog_quick_add(p_key, p_cats, p_type, …)` and `catlog_log_text(p_key, p_text)` are
  database functions that check a shortcut key (stored hashed). Make a key in Settings, Shortcuts.
- `worker/index.ts` is the Cloudflare Worker (`wrangler.jsonc`, name `catlog`). It serves the app and adds
  `GET /api/add?k=KEY&cat=Stormy&type=poo`, `POST /api/log?k=KEY` (text body) and an `email()` handler for
  Cloudflare Email Routing (set the `CATLOG_EMAIL_KEY` secret, or send to `name+KEY@your-domain`, and optionally
  `CATLOG_EMAIL_FROM` to limit who can log).
- Import from Dataverse (Settings): signs in with Microsoft, finds your cat and event tables, matches columns
  (cat lookups, a many-to-many link or names in text; type; date; event number; notes; pictures), previews, then
  imports. Re-importing updates the same records.

## Develop

```sh
npm install
npm run dev      # http://localhost:5173
npm test
npm run build
```

## Deploy

Pushing to `main` deploys through Cloudflare Workers Builds (if the `catlog` worker is connected to this repo) and
GitHub Pages (`.github/workflows/deploy.yml`, served at `/catlog/`, without the `/api` routes).
Add the site's address to Supabase Auth's redirect URLs, and `<site>/auth-redirect.html` to the Entra app's
single-page application redirect URIs, for sign-in emails and the Dataverse import.
