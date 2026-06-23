// routes/auth.js
const express = require('express');
const bcrypt = require('bcryptjs');
const { db, randomUUID } = require('../db');
const { signToken } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/signup
router.post('/signup', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'Email and an 8+ character password are required.' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) {
    return res.status(409).json({ error: 'An account with that email already exists.' });
  }

  const id = randomUUID();
  const passwordHash = bcrypt.hashSync(password, 10);

  db.prepare('INSERT INTO users (id, email, password_hash) VALUES (?, ?, ?)').run(
    id,
    email,
    passwordHash
  );

  const token = signToken(id);
  res.status(201).json({ token, user: { id, email, is_admin: false } });
});

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  const token = signToken(user.id);
  res.json({ token, user: { id: user.id, email: user.email, is_admin: !!user.is_admin } });
});

module.exports = router;
