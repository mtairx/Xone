// jobs/stripeUsageReporter.js
// Stripe's metered billing wants usage records pushed periodically, not
// per-request — pushing on every API call would mean one Stripe API call
// per customer API call, which is slow and easy to rate-limit into a corner.
// Instead requireApiKey() just logs a local row per call, and this job
// runs on an interval, grouping unreported rows by subscription item and
// sending one usage record per group per tick.

const Stripe = require('stripe');
const { db } = require('../db');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder');

async function reportPendingUsage() {
  const pending = db.prepare(`
    SELECT k.stripe_subscription_item_id as sub_item_id, COUNT(*) as qty, GROUP_CONCAT(u.id) as ids
    FROM usage_events u
    JOIN api_keys k ON k.id = u.api_key_id
    WHERE u.reported_to_stripe = 0 AND k.stripe_subscription_item_id IS NOT NULL
    GROUP BY k.stripe_subscription_item_id
  `).all();

  for (const group of pending) {
    try {
      await stripe.subscriptionItems.createUsageRecord(group.sub_item_id, {
        quantity: group.qty,
        timestamp: Math.floor(Date.now() / 1000),
        action: 'increment',
      });

      const ids = group.ids.split(',');
      const placeholders = ids.map(() => '?').join(',');
      db.prepare(`UPDATE usage_events SET reported_to_stripe = 1 WHERE id IN (${placeholders})`).run(...ids);

      console.log(`Reported ${group.qty} usage units to Stripe for ${group.sub_item_id}`);
    } catch (err) {
      console.error(`Failed to report usage for ${group.sub_item_id}:`, err.message);
      // Left unreported — picked up again on the next tick.
    }
  }
}

function startUsageReporter(intervalMs = 60_000) {
  const handle = setInterval(reportPendingUsage, intervalMs);
  return handle;
}

module.exports = { startUsageReporter, reportPendingUsage };
