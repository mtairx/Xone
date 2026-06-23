// routes/webhook.js
// Stripe calls this endpoint directly (not the browser), so it's the only
// trustworthy signal that money actually moved. We verify the signature,
// then on checkout.session.completed: mark the purchase active, and if
// the product is api_metered, generate the buyer's API key right here.
//
// IMPORTANT: this route needs the raw request body for signature
// verification, so it's mounted with express.raw() in server.js BEFORE
// the global express.json() middleware touches it.

const express = require('express');
const Stripe = require('stripe');
const bcrypt = require('bcryptjs');
const { db, randomUUID } = require('../db');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

const router = express.Router();

router.post('/', async (req, res) => {
  let event;

  try {
    event = WEBHOOK_SECRET
      ? stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], WEBHOOK_SECRET)
      : JSON.parse(req.body); // local/dev fallback when no signing secret is configured
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { product_id, user_id } = session.metadata || {};

    if (!product_id || !user_id) {
      console.warn('Webhook missing metadata, skipping.');
      return res.json({ received: true });
    }

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(product_id);

    db.prepare(`
      UPDATE purchases SET status = 'active', stripe_subscription_id = ?
      WHERE stripe_checkout_session_id = ?
    `).run(session.subscription || null, session.id);

    // For metered API products, issue the API key now that payment is confirmed.
    if (product && product.type === 'api_metered') {
      const rawKey = `sk_live_${randomUUID().replace(/-/g, '')}`;
      const keyPrefix = rawKey.slice(0, 12);
      const keyHash = bcrypt.hashSync(rawKey, 10);

      // Fetch the subscription item id so usage.js knows what to report against.
      let subscriptionItemId = null;
      if (session.subscription) {
        const sub = await stripe.subscriptions.retrieve(session.subscription);
        subscriptionItemId = sub.items.data[0]?.id || null;
      }

      db.prepare(`
        INSERT INTO api_keys (id, user_id, product_id, key_prefix, key_hash, stripe_subscription_item_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(randomUUID(), user_id, product_id, keyPrefix, keyHash, subscriptionItemId);

      // NOTE: in production, deliver `rawKey` to the buyer via a one-time
      // "reveal" screen or email — it cannot be retrieved again since only
      // the hash is stored. Logging here only for local/dev visibility.
      console.log(`Issued API key for user ${user_id}, product ${product.slug}: ${rawKey}`);
    }
  }

  res.json({ received: true });
});

module.exports = router;
