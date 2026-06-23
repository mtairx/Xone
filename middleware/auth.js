// middleware/auth.js
// Verifies the session JWT sent by the browser (Authorization: Bearer <token>)
// and attaches the user id to req.userId. Separate from API-key auth,
// which is used by external callers hitting the metered API endpoints.

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-production';

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Sign in to continue.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Your session expired. Sign in again.' });
  }
}

function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '7d' });
}

module.exports = { requireAuth, signToken, JWT_SECRET };
