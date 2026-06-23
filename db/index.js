// db/index.js
// SQLite database layer using Node's built-in node:sqlite module.
// File-based DB at db/registry.sqlite — swap for Postgres later by
// replacing this file; route code only calls the exported helpers below.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const { randomUUID } = require('crypto');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'registry.sqlite');
const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  stripe_customer_id TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('app_onetime', 'app_subscription', 'api_metered')),
  price_cents INTEGER,                 -- for app_onetime / app_subscription (per period)
  price_per_call_cents REAL,           -- for api_metered (fractional cents allowed)
  stripe_product_id TEXT,
  stripe_price_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  stripe_checkout_session_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | active | canceled
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  key_prefix TEXT NOT NULL,            -- visible part, e.g. sk_live_ab12
  key_hash TEXT NOT NULL,              -- bcrypt hash of full key
  stripe_subscription_item_id TEXT,    -- for metered usage reporting
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage_events (
  id TEXT PRIMARY KEY,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  reported_to_stripe INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- Migration: add is_admin to pre-existing DBs ----------
const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
if (!userCols.includes('is_admin')) {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
}

// ---------- Seed a default admin account (idempotent) ----------
function seedAdmin() {
  const bcrypt = require('bcryptjs');
  const email = process.env.ADMIN_EMAIL || 'admin@registry.dev';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(existing.id);
    return;
  }
  const password = process.env.ADMIN_PASSWORD || 'admin12345';
  const passwordHash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, email, password_hash, is_admin) VALUES (?, ?, ?, 1)').run(
    randomUUID(),
    email,
    passwordHash
  );
  console.log(`Seeded admin account: ${email} / ${password} (change this password immediately)`);
}
seedAdmin();

// ---------- Seed sample products (idempotent) ----------
function seed() {
  const count = db.prepare('SELECT COUNT(*) as c FROM products').get().c;
  if (count > 0) return;

  const insert = db.prepare(`
    INSERT INTO products (id, slug, name, description, type, price_cents, price_per_call_cents, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);

  const products = [
    ['pixelflow', 'PixelFlow', 'Batch image compression desktop app, lifetime license.', 'app_onetime', 4900, null],
    ['ledgerly', 'Ledgerly', 'Invoicing and expense tracking for freelancers.', 'app_subscription', 1200, null],
    ['scopecam', 'ScopeCam', 'Async screen recording and video review.', 'app_subscription', 800, null],
    ['geocode-io', 'geocode.io', 'Address-to-coordinate resolution API.', 'api_metered', null, 0.08],
    ['renderqueue', 'RenderQueue', 'Server-side HTML-to-PDF/image rendering API.', 'api_metered', null, 0.4],
    ['signalcheck', 'SignalCheck', 'Real-time fraud scoring API for transactions.', 'api_metered', null, 1.0],
  ];

  for (const [slug, name, desc, type, priceCents, pricePerCall] of products) {
    insert.run(randomUUID(), slug, name, desc, type, priceCents, pricePerCall);
  }
  console.log(`Seeded ${products.length} products.`);
}
seed();

module.exports = { db, randomUUID };
