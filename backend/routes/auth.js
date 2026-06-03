/**
 * auth.js — Authentication & User Management Routes
 */
const express = require('express');
const router = express.Router();
const userStore = require('../userStore');

// POST /auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const user = userStore.authenticate(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }
  // Create HMAC-signed token (stateless, survives server restarts)
  const token = userStore.createToken(user.username);

  res.json({
    token,
    user: {
      username: user.username,
      role: user.role,
      pages: user.pages
    }
  });
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token) userStore.removeToken(token);
  res.json({ ok: true });
});

// GET /auth/me — get current user info
router.get('/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const username = userStore.getTokenUser(token);
  if (!username) return res.status(401).json({ error: 'Not authenticated' });

  const user = userStore.getUser(username);
  if (!user) return res.status(401).json({ error: 'User not found' });

  res.json({
    username: user.username,
    role: user.role,
    pages: user.pages
  });
});

// ─── Admin-only: User Management ───

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const username = userStore.getTokenUser(token);
  if (!username) return res.status(401).json({ error: 'Not authenticated' });
  const user = userStore.getUser(username);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// GET /auth/users — list all users (admin only)
router.get('/users', requireAdmin, (req, res) => {
  const users = userStore.listUsers();
  res.json(users.map(u => ({
    username: u.username,
    role: u.role,
    pages: u.pages,
    createdAt: u.createdAt
  })));
});

// POST /auth/users — create user (admin only)
router.post('/users', requireAdmin, (req, res) => {
  const { username, password, role, pages } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  try {
    const user = userStore.createUser(username, password, role || 'user', pages || []);
    res.json({ username: user.username, role: user.role, pages: user.pages });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// PUT /auth/users/:username — update user (admin only)
router.put('/users/:username', requireAdmin, (req, res) => {
  const { password, role, pages } = req.body;
  try {
    const user = userStore.updateUser(req.params.username, { password, role, pages });
    res.json({ username: user.username, role: user.role, pages: user.pages });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// DELETE /auth/users/:username — delete user (admin only)
router.delete('/users/:username', requireAdmin, (req, res) => {
  try {
    userStore.deleteUser(req.params.username);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
