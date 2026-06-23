// middleware/admin.js
// Stacks on top of requireAuth — checks the authenticated user actually
// has is_admin set before allowing access to admin-only routes.

const { db } = require('../db');

function requireAdmin(req, res, next) {
  const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.userId);
  if (!user || !user.is_admin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

module.exports = { requireAdmin };
