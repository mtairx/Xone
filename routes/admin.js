// routes/admin.js
const express = require('express');
const { db, randomUUID } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/admin');

const router = express.Router();

// Every route here requires a signed-in admin.
router.use(requireAuth, requireAdmin);

// ---------- Dashboard stats ----------
router.get('/stats', (req, res) => {
  const totalUsers = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
  const totalProducts = db.prepare('SELECT COUNT(*) as c FROM products WHERE active = 1').get().c;
  const activePurchases = db.prepare("SELECT COUNT(*) as c FROM purchases WHERE status = 'active'").get().c;
  const totalApiCalls = db.prepare('SELECT COUNT(*) as c FROM usage_events').get().c;
  const activeKeys = db.prepare('SELECT COUNT(*) as c FROM api_keys WHERE revoked = 0').get().c;

  // Rough revenue estimate from completed purchases — one-time/sub price
  // at time of purchase isn't stored historically in this simple schema,
  // so this joins against current product price as an approximation.
  const revenueRow = db.prepare(`
    SELECT COALESCE(SUM(p.price_cents), 0) as cents
    FROM purchases pur
    JOIN products p ON p.id = pur.product_id
    WHERE pur.status = 'active' AND p.price_cents IS NOT NULL
  `).get();

  res.json({
    total_users: totalUsers,
    total_products: totalProducts,
    active_purchases: activePurchases,
    total_api_calls: totalApiCalls,
    active_api_keys: activeKeys,
    estimated_revenue_cents: revenueRow.cents,
  });
});

// ---------- Products CRUD ----------
router.get('/products', (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY created_at DESC').all();
  res.json({ products });
});

router.post('/products', (req, res) => {
  const { slug, name, description, type, price_cents, price_per_call_cents } = req.body;

  if (!slug || !name || !type) {
    return res.status(400).json({ error: 'slug, name, and type are required.' });
  }
  if (!['app_onetime', 'app_subscription', 'api_metered'].includes(type)) {
    return res.status(400).json({ error: 'type must be app_onetime, app_subscription, or api_metered.' });
  }

  const existing = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
  if (existing) {
    return res.status(409).json({ error: 'A product with that slug already exists.' });
  }

  const id = randomUUID();
  db.prepare(`
    INSERT INTO products (id, slug, name, description, type, price_cents, price_per_call_cents, active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `).run(id, slug, name, description || '', type, price_cents ?? null, price_per_call_cents ?? null);

  res.status(201).json({ product: db.prepare('SELECT * FROM products WHERE id = ?').get(id) });
});

router.put('/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  const { name, description, price_cents, price_per_call_cents, active } = req.body;

  db.prepare(`
    UPDATE products
    SET name = ?, description = ?, price_cents = ?, price_per_call_cents = ?, active = ?
    WHERE id = ?
  `).run(
    name ?? product.name,
    description ?? product.description,
    price_cents !== undefined ? price_cents : product.price_cents,
    price_per_call_cents !== undefined ? price_per_call_cents : product.price_per_call_cents,
    active !== undefined ? (active ? 1 : 0) : product.active,
    req.params.id
  );

  res.json({ product: db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id) });
});

router.delete('/products/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });

  // Soft delete — keeps purchase/usage history intact and valid.
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  res.json({ deactivated: true });
});

// ---------- Users ----------
router.get('/users', (req, res) => {
  const users = db.prepare(`
    SELECT u.id, u.email, u.is_admin, u.created_at,
      (SELECT COUNT(*) FROM purchases WHERE user_id = u.id AND status = 'active') as active_purchases,
      (SELECT COUNT(*) FROM api_keys WHERE user_id = u.id AND revoked = 0) as active_keys
    FROM users u
    ORDER BY u.created_at DESC
  `).all();
  res.json({ users });
});

// ---------- All purchases (platform-wide) ----------
router.get('/purchases', (req, res) => {
  const purchases = db.prepare(`
    SELECT pur.id, pur.status, pur.created_at, p.name as product_name, p.type, u.email as user_email
    FROM purchases pur
    JOIN products p ON p.id = pur.product_id
    JOIN users u ON u.id = pur.user_id
    ORDER BY pur.created_at DESC
    LIMIT 200
  `).all();
  res.json({ purchases });
});

// ---------- All API keys + usage (platform-wide) ----------
router.get('/api-keys', (req, res) => {
  const keys = db.prepare(`
    SELECT k.id, k.key_prefix, k.revoked, k.created_at, p.name as product_name, u.email as user_email,
      (SELECT COUNT(*) FROM usage_events WHERE api_key_id = k.id) as total_calls
    FROM api_keys k
    JOIN products p ON p.id = k.product_id
    JOIN users u ON u.id = k.user_id
    ORDER BY k.created_at DESC
  `).all();
  res.json({ api_keys: keys });
});

router.post('/api-keys/:id/revoke', (req, res) => {
  const key = db.prepare('SELECT * FROM api_keys WHERE id = ?').get(req.params.id);
  if (!key) return res.status(404).json({ error: 'API key not found.' });

  db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ?').run(key.id);
  res.json({ revoked: true });
});

module.exports = router;
