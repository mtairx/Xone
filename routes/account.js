// routes/account.js
// Lets a signed-in buyer see their purchases, active API keys (prefix only —
// the full key is never retrievable after issuance), and recent usage.

const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/purchases', requireAuth, (req, res) => {
  const purchases = db.prepare(`
    SELECT p.id, p.status, p.created_at, pr.name, pr.slug, pr.type
    FROM purchases p
    JOIN products pr ON pr.id = p.product_id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(req.userId);
  res.json({ purchases });
});

router.get('/api-keys', requireAuth, (req, res) => {
  const keys = db.prepare(`
    SELECT k.id, k.key_prefix, k.revoked, k.created_at, pr.name, pr.slug
    FROM api_keys k
    JOIN products pr ON pr.id = k.product_id
    WHERE k.user_id = ?
    ORDER BY k.created_at DESC
  `).all(req.userId);
  res.json({ api_keys: keys.map((k) => ({ ...k, key_display: `${k.key_prefix}••••••••` })) });
});

router.get('/usage/:productSlug', requireAuth, (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE slug = ?').get(req.params.productSlug);
  if (!product) return res.status(404).json({ error: 'No product found with that slug.' });

  const key = db.prepare('SELECT * FROM api_keys WHERE user_id = ? AND product_id = ? AND revoked = 0')
    .get(req.userId, product.id);
  if (!key) return res.status(404).json({ error: 'No active API key for this product.' });

  const usage = db.prepare(`
    SELECT COUNT(*) as total_calls,
           MIN(created_at) as first_call,
           MAX(created_at) as last_call
    FROM usage_events WHERE api_key_id = ?
  `).get(key.id);

  res.json({ product: product.slug, usage });
});

router.post('/api-keys/:id/revoke', requireAuth, (req, res) => {
  const key = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!key) return res.status(404).json({ error: 'API key not found.' });

  db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').run(key.id);
  res.json({ revoked: true });
});

module.exports = router;
