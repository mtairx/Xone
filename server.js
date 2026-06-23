// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const checkoutRoutes = require('./routes/checkout');
const webhookRoutes = require('./routes/webhook');
const accountRoutes = require('./routes/account');
const adminRoutes = require('./routes/admin');
const apiDemoRoutes = require('./routes/apiDemo');
const { startUsageReporter } = require('./jobs/stripeUsageReporter');

const app = express();
const PORT = process.env.PORT || 4242;

// In production, restrict CORS to the deployed front-end's origin (set via
// FRONTEND_URL). Locally, allow any origin so testing isn't blocked by it.
const allowedOrigin = process.env.FRONTEND_URL || '*';
app.use(cors({ origin: allowedOrigin }));

// Serve the connected front-end from the same server.
app.use(express.static(require('path').join(__dirname, 'public')));

// Stripe webhook needs the raw body for signature verification, so it's
// mounted BEFORE express.json() touches the request stream.
app.use('/api/webhook', express.raw({ type: 'application/json' }), webhookRoutes);

app.use(express.json());

// Admin panel served at a deliberately unguessable path. The page itself
// still requires a valid admin login to see any data — this path is not
// a substitute for auth, just obscurity on top of it.
app.get('/iamopbhaiadmin', (req, res) => {
  res.sendFile(require('path').join(__dirname, 'public', 'iamopbhaiadmin.html'));
});

app.use('/api/auth', authRoutes);
app.use('/api/products', productRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/admin', adminRoutes);
app.use('/v1', apiDemoRoutes); // simulated metered API surface, e.g. POST /v1/geocode

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

app.listen(PORT, () => {
  console.log(`registry backend listening on http://localhost:${PORT}`);
  if (process.env.STRIPE_SECRET_KEY) {
    startUsageReporter();
    console.log('Stripe usage reporter started (60s interval).');
  } else {
    console.log('STRIPE_SECRET_KEY not set — running in stub mode. Set it in .env to enable real Stripe calls.');
  }
});

module.exports = app;
