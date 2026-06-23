# Deploying: Railway (backend) + Cloudflare Pages (frontend)

This splits the project across two hosts because Cloudflare Pages can't run
a stateful Express server with a local SQLite file — it's an edge/static
platform. Railway runs the backend exactly as-is, with a real persistent
disk for the database. Pages serves the two static HTML files.

## 1. Push both folders to GitHub

You should have two folders:
- `registry-backend/` — the Express API + admin/storefront source (symlinked into `public/`)
- `registry-frontend/` — the same two HTML files, meant to be deployed standalone

Easiest setup: **two separate GitHub repos** (or two folders in one repo,
deploying each as its own Railway/Pages project pointed at a subdirectory).

```bash
cd registry-backend
git init && git add . && git commit -m "Initial commit"
gh repo create registry-backend --private --source=. --push

cd ../registry-frontend
git init && git add . && git commit -m "Initial commit"
gh repo create registry-frontend --private --source=. --push
```

## 2. Deploy the backend to Railway

1. Go to railway.com → **New Project** → **Deploy from GitHub repo** → select `registry-backend`.
2. Railway auto-detects Node.js and runs `npm install` + `npm start`.
3. **Add a persistent volume** (Settings → Volumes → New Volume). Mount it at `/data`.
   Without this, your SQLite database resets every time you redeploy.
4. **Set environment variables** (Settings → Variables):
   ```
   DB_PATH=/data/registry.sqlite
   JWT_SECRET=<a long random string>
   STRIPE_SECRET_KEY=sk_live_... (or sk_test_... while testing)
   STRIPE_WEBHOOK_SECRET=whsec_...
   FRONTEND_URL=https://your-project.pages.dev   (set this after step 3)
   ADMIN_EMAIL=you@yourdomain.com
   ADMIN_PASSWORD=<something only you know>
   ```
5. Settings → Networking → **Generate Domain**. You'll get a URL like
   `https://registry-backend.up.railway.app` — this is your API base.
6. Confirm it's alive: visit `https://your-app.up.railway.app/api/health` —
   should return `{"status":"ok"}`.

## 3. Deploy the frontend to Cloudflare Pages

1. In `registry-frontend/index.html` and `registry-frontend/iamopbhaiadmin.html`,
   find this line near the top of the `<script>` block:
   ```js
   const PRODUCTION_API_BASE = 'https://YOUR-BACKEND.up.railway.app';
   ```
   Replace it with your actual Railway URL from step 2.5, commit, and push.
2. Go to the Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → select `registry-frontend`.
3. Build settings: leave **Framework preset** as "None" — this is a plain
   static site, no build command needed. Build output directory: `/`.
4. Deploy. You'll get a URL like `https://registry-frontend.pages.dev`.
5. The admin panel is automatically reachable at
   `https://registry-frontend.pages.dev/iamopbhaiadmin` — Cloudflare Pages
   serves `iamopbhaiadmin.html` at both that path and the `.html` path, and
   redirects the `.html` version to the clean one automatically.

## 4. Close the loop

Go back to Railway and set `FRONTEND_URL` to your real Pages URL
(`https://registry-frontend.pages.dev`), then redeploy the backend. This is
what locks CORS down to just your front-end's origin instead of `*`.

## 5. Stripe webhook

In the Stripe dashboard, add a webhook endpoint pointing at:
```
https://your-app.up.railway.app/api/webhook
```
listening for `checkout.session.completed`. Copy the signing secret into
Railway's `STRIPE_WEBHOOK_SECRET` variable.

## Custom domains (optional)

Both Railway and Pages support custom domains under their respective
Settings → Domains. If you want `api.yourdomain.com` for the backend and
`yourdomain.com` for the storefront, set those up, then update
`PRODUCTION_API_BASE` in the front-end and `FRONTEND_URL` in Railway to
match the new domains.

## What's still local-only

This guide gets the same app you tested locally running in production. It
does not add: a password-reset flow, email delivery (for the "show the API
key once" pattern mentioned in the main README), or rate limiting on the
public API. Add those before pointing real customers at this in volume.
