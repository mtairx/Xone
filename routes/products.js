// routes/products.js
const express = require('express');
const { db } = require('../db');

const router = express.Router();

// GET /api/products — public catalog listing
router.get('/', (req, res) => {
  const products = db
    .prepare('SELECT id, slug, name, description, type, price_cents, price_per_call_cents FROM products WHERE active = 1')
    .all();
  res.json({ products });
});

// GET /api/products/:slug
router.get('/:slug', (req, res) => {
  const product = db
    .prepare('SELECT id, slug, name, description, type, price_cents, price_per_call_cents FROM products WHERE slug = ? AND active = 1')
    .get(req.params.slug);

  if (!product) {
    return res.status(404).json({ error: 'No product found with that slug.' });
  }
  res.json({ product });
});

module.exports = router;
