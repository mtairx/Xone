// routes/apiDemo.js
// A stand-in for "the actual product" behind a metered API. In a real
// marketplace, each api_metered product would proxy to its own backend;
// here we simulate geocode.io's response shape so the full purchase ->
// key issuance -> authenticated call -> usage logging loop is provable
// end to end without a third-party dependency.

const express = require('express');
const { requireApiKey } = require('../middleware/apiKey');

const router = express.Router();

router.post('/geocode', requireApiKey, (req, res) => {
  const { address } = req.body;
  if (!address) return res.status(400).json({ error: 'address is required' });

  // Deterministic fake geocode so responses are stable for testing.
  const hash = [...address].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  res.json({
    address,
    lat: 40 + (hash % 1000) / 1000,
    lng: -74 - (hash % 1000) / 1000,
    status: 'ok',
    product: req.apiProduct.slug,
  });
});

module.exports = router;
