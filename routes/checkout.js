// routes/checkout.js
// Creates Stripe Checkout Sessions for all three product types this
// marketplace supports:
//   - app_onetime:      single Checkout Session, mode "payment"
//   - app_subscription: Checkout Session, mode "subscription", flat recurring price
//   - api_metered:       Checkout Session, mode "subscription", a $0 "metered" price
//                        that Stripe bills based on usage we report via
//                        stripe.subscriptionItems.createUsageRecord (see usage.js)
//
// On success, Stripe redirects to /success and sends a webhook (webhook.js)
// that actually marks the purchase active / issues the API key. The
// front-end should not trust the redirect alone — only the webhook confirms payment.

const express = require('express');
const Stripe = require('stripe');
const { db, randomUUID } = require('../db');
const { requireAuth } = require('../middleware/auth');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:8911';

const router = express.Router();

router.post('/:slug', requireAuth, async (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE slug = ? AND active = 1').get(req.params.slug);
  if (!product) {
    return res.status(404).json({ error: 'No product found with that slug.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);

  try {
    // Ensure the user has a Stripe customer record so repeat purchases
    // and subscription management stay attached to one identity.
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email });
      customerId = customer.id;
      db.prepare('UPDATE users SET stripe_customer_id = ? WHERE id = ?').run(customerId, user.id);
    }

    let sessionParams;

    if (product.type === 'app_onetime') {
      sessionParams = {
        mode: 'payment',
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: product.price_cents,
              product_data: { name: product.name, description: product.description },
            },
            quantity: 1,
          },
        ],
        success_url: `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${FRONTEND_URL}/cancel`,
        metadata: { product_id: product.id, user_id: user.id },
      };
    } else if (product.type === 'app_subscription') {
      sessionParams = {
        mode: 'subscription',
        customer: customerId,
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: product.price_cents,
              recurring: { interval: 'month' },
              product_data: { name: product.name, description: product.description },
            },
            quantity: 1,
          },
        ],
        success_url: `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${FRONTEND_URL}/cancel`,
        metadata: { product_id: product.id, user_id: user.id },
      };
    } else if (product.type === 'api_metered') {
      // Metered (usage-based) Stripe prices must exist on the Price object
      // ahead of time with billing_scheme: 'per_unit' and usage_type: 'metered'.
      // We lazily create + cache the Stripe product/price the first time
      // this product is purchased, then reuse the IDs.
      let stripePriceId = product.stripe_price_id;

      if (!stripePriceId) {
        const stripeProduct = await stripe.products.create({
          name: product.name,
          description: product.description,
        });
        const price = await stripe.prices.create({
          currency: 'usd',
          unit_amount_decimal: String(product.price_per_call_cents), // fractional cents OK
          recurring: { interval: 'month', usage_type: 'metered' },
          product: stripeProduct.id,
        });
        stripePriceId = price.id;
        db.prepare('UPDATE products SET stripe_product_id = ?, stripe_price_id = ? WHERE id = ?').run(
          stripeProduct.id,
          stripePriceId,
          product.id
        );
      }

      sessionParams = {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: stripePriceId }], // no quantity for metered prices
        success_url: `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${FRONTEND_URL}/cancel`,
        metadata: { product_id: product.id, user_id: user.id },
      };
    } else {
      return res.status(400).json({ error: 'Unknown product type.' });
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    db.prepare(`
      INSERT INTO purchases (id, user_id, product_id, stripe_checkout_session_id, status)
      VALUES (?, ?, ?, ?, 'pending')
    `).run(randomUUID(), user.id, product.id, session.id);

    res.json({ checkout_url: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'Could not start checkout. Please try again.' });
  }
});

module.exports = router;
