// middleware/apiKey.js
// Validates the API key callers send when hitting metered endpoints
// (Authorization: Bearer sk_live_xxxxx). Looks up the key by its visible
// prefix, then verifies the full key against the stored hash so the raw
// key is never kept in plaintext at rest. Logs one usage_event per call.

const bcrypt = require('bcryptjs');
const { db, randomUUID } = require('../db');

function requireApiKey(req, res, next) {
  const header = req.headers.authorization || '';
  const rawKey = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!rawKey || !rawKey.startsWith('sk_')) {
    return res.status(401).json({ error: 'Missing or malformed API key.' });
  }

  const prefix = rawKey.slice(0, 12); // e.g. "sk_live_ab12"
  const candidates = db
    .prepare('SELECT * FROM api_keys WHERE key_prefix = ? AND revoked = 0')
    .all(prefix);

  const match = candidates.find((row) => bcrypt.compareSync(rawKey, row.key_hash));

  if (!match) {
    return res.status(401).json({ error: 'Invalid or revoked API key.' });
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(match.product_id);
  if (!product || !product.active) {
    return res.status(403).json({ error: 'This API product is no longer active.' });
  }

  // Log usage — one row per call. A background job (see stripeUsageReporter.js)
  // batches unreported rows to Stripe on an interval.
  db.prepare(`
    INSERT INTO usage_events (id, api_key_id, product_id, quantity, reported_to_stripe)
    VALUES (?, ?, ?, 1, 0)
  `).run(randomUUID(), match.id, product.id);

  req.apiKeyRow = match;
  req.apiProduct = product;
  next();
}

module.exports = { requireApiKey };
