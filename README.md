# registry — sell apps & API access

A full marketplace: a dark, developer-focused storefront (front-end) backed
by a real Node.js/Express API (back-end) with Stripe wired in for three
pricing models — one-time app purchases, app subscriptions, and metered
(pay-per-call) API access.

This was tested end-to-end during development: signup, login, browsing the
live product catalog, the account dashboard, and the API-key-gated demo
endpoint all work against this exact code. Stripe checkout itself needs your
own API keys (see below) since no payment provider will process charges
without real credentials.

## What's included

```
server.js              Express app entry point
db/index.js             SQLite schema + auto-seeded sample products
middleware/auth.js       JWT session verification (for signed-in buyers)
middleware/apiKey.js     API key verification + usage logging (for API callers)
routes/auth.js           POST /api/auth/signup, /api/auth/login
routes/products.js       GET  /api/products, /api/products/:slug
routes/checkout.js       POST /api/checkout/:slug — creates a Stripe Checkout Session
routes/webhook.js        POST /api/webhook — Stripe calls this after real payment
routes/account.js        GET  /api/account/purchases, /api/account/api-keys
routes/admin.js           Admin-only: product CRUD, users, all purchases, all API keys, stats
routes/apiDemo.js         POST /v1/geocode — a sample metered endpoint, gated by API key
jobs/stripeUsageReporter.js  Background job batching usage to Stripe every 60s
public/index.html        The storefront front-end (single file, no build step)
public/admin.html        The admin panel front-end (single file, no build step)
middleware/admin.js       Checks is_admin after requireAuth — stacks on every /api/admin/* route
```

## Admin panel

A dashboard for managing the catalog lives at **`/iamopbhaiadmin`**. On first
run, an admin account is auto-seeded:

```
email:    admin@registry.dev
password: admin12345
```

**Change this password immediately** — either sign in and there's no
self-service password change yet (add one before going live), or set
`ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` before the first run so a
different admin account gets seeded instead.

From the panel you can:
- See live stats: total users, active products, active purchases, total API calls, estimated revenue
- Create, edit, and deactivate products (deactivating is a soft delete — purchase history stays intact)
- View every signed-up user and their purchase/key counts
- View every purchase platform-wide, not just your own
- View and revoke any API key platform-wide

**On the custom URL path:** `/iamopbhaiadmin` is obscurity, not security —
it just means random crawlers won't stumble onto a login form named
`/admin`. The actual security boundary is the `is_admin` flag, checked
independently on every single `/api/admin/*` route on the server, so even
someone who finds the URL and has *a* valid login still gets a 403 unless
their account is flagged as admin. If you want defense in depth beyond
this, consider putting the admin path behind your hosting provider's IP
allowlist or a VPN.

## Run it locally

```bash
npm install
cp .env.example .env     # then fill in your Stripe keys (see below)
npm start
```

Open **http://localhost:4242** — the front-end and API are served from the
same server.

Without a Stripe key, everything works *except* checkout: you can sign up,
log in, browse the live catalog, and view your (empty) account dashboard.
Clicking "Buy" or "Get key" will show a clear error rather than crash,
since Stripe can't create a session without real credentials.

## Going live with real payments

1. **Get Stripe keys.** Sign up at stripe.com, grab your secret key from
   the dashboard, and put it in `.env` as `STRIPE_SECRET_KEY`.
2. **Set up the webhook.** In the Stripe dashboard, add a webhook endpoint
   pointing at `https://yourdomain.com/api/webhook`, listening for
   `checkout.session.completed`. Copy the signing secret into `.env` as
   `STRIPE_WEBHOOK_SECRET`. Locally, use the Stripe CLI
   (`stripe listen --forward-to localhost:4242/api/webhook`) to test this
   before deploying.
3. **Set `FRONTEND_URL`** to wherever you're hosting the site, so Stripe
   redirects buyers back correctly after payment.
4. **Change `JWT_SECRET`** to a long random string — the placeholder in
   `.env.example` is not safe to use in production.
5. **Swap the database** if you expect real traffic. The included SQLite
   setup (Node's built-in `node:sqlite`) is genuinely fine for low/medium
   traffic and has zero setup cost, but a single file won't survive most
   serverless hosts restarting, and concurrent writes have low headroom.
   Postgres (e.g. via Supabase, Neon, or Railway) is the natural upgrade —
   only `db/index.js` needs to change; every route calls the same exported
   helpers.
6. **Deploy.** Any Node host works (Railway, Render, Fly.io, a VPS). Point
   it at your repo, set the environment variables above, and run `npm start`.

## How the three pricing models work

- **One-time app purchase** (`app_onetime`): a single Stripe Checkout
  Session in `payment` mode. Buyer pays once, done.
- **App subscription** (`app_subscription`): a Checkout Session in
  `subscription` mode with a flat recurring price.
- **Metered API access** (`api_metered`): also a `subscription`-mode
  Checkout Session, but using a Stripe *metered* price (`usage_type:
  'metered'`) with no fixed quantity. Every authenticated call to a gated
  endpoint (see `routes/apiDemo.js` for the pattern) logs one row in
  `usage_events`. A background job batches those rows and reports them to
  Stripe every 60 seconds via `subscriptionItems.createUsageRecord`, so
  Stripe bills the buyer for what they actually used at the end of the
  billing period.

## Adding your own products

Right now products are seeded once in `db/index.js`. For a real catalog,
build a small admin route (or just insert rows directly) following the
same shape:

```js
INSERT INTO products (id, slug, name, description, type, price_cents, price_per_call_cents, active)
VALUES (?, ?, ?, ?, 'app_onetime' | 'app_subscription' | 'api_metered', ?, ?, 1)
```

`price_cents` is used for apps, `price_per_call_cents` for metered APIs
(can be fractional, e.g. `0.08` = $0.0008).

## Gating your own API behind this

`middleware/apiKey.js` is the reusable part. Point any route you want
metered at it:

```js
const { requireApiKey } = require('./middleware/apiKey');
app.post('/v1/my-real-endpoint', requireApiKey, (req, res) => {
  // req.apiKeyRow and req.apiProduct are available here
  // ... your actual logic ...
});
```

Every call through that middleware is logged and counted automatically.

## Security notes

- Passwords are hashed with bcrypt, never stored in plaintext.
- API keys are hashed at rest (bcrypt) — the raw key is shown to the buyer
  exactly once, at issuance, then never retrievable again. Build a "reveal
  once" UI step for this in production rather than relying on the console
  log in `webhook.js`, which is there for local testing only.
- The webhook route verifies Stripe's signature before trusting any
  payload — this is what makes it safe to grant access based on it.
