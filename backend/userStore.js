/**
 * userStore.js — Simple file-based user store with token management
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? '/tmp/knowledge-pipeline-data' : path.join(__dirname, '../data'));
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SECRET_FILE = path.join(DATA_DIR, '.token_secret');

// ── HMAC Token Secret (persisted to disk, survives restarts) ──
function getSecret() {
  ensureDataDir();
  if (fs.existsSync(SECRET_FILE)) {
    return fs.readFileSync(SECRET_FILE, 'utf8').trim();
  }
  const secret = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(SECRET_FILE, secret);
  return secret;
}
let _secret = null;
function secret() { if (!_secret) _secret = getSecret(); return _secret; }

// All available pages in the system
const ALL_PAGES = [
  { id: 'ai-assistant',     label: 'AI Assistant' },
  { id: 'ai-workflow',      label: 'AI Workflow' },
  { id: 'knowledge-base',   label: 'Knowledge Base' },
  { id: 'retrieval-config', label: 'Retrieval Config' },
  { id: 'qa-builder',       label: 'Support QA' },
  { id: 'internal-reminder',label: 'Internal AI' },
  { id: 'accuracy-test',    label: 'Accuracy Lab' },
  { id: 'scraper',          label: 'Scraper Dashboard' },
  { id: 'cron-monitor',     label: 'Cron Monitor' },
  { id: 'llm-evaluation',   label: 'LLM Evaluation' },
  { id: 'triage-debug',     label: 'Triage Debug' },
  { id: 'settings',         label: 'AI Settings' },
];

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadUsers() {
  ensureDataDir();
  if (!fs.existsSync(USERS_FILE)) {
    // Create default admin user: secureview / 1234
    const defaults = [
      {
        username: 'secureview',
        passwordHash: hashPassword('1234'),
        role: 'admin',
        pages: ALL_PAGES.map(p => p.id),  // admin gets all pages
        createdAt: new Date().toISOString()
      }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaults, null, 2));
    return defaults;
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
}

function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function authenticate(username, password) {
  const users = loadUsers();
  const hash = hashPassword(password);
  const user = users.find(u => u.username === username && u.passwordHash === hash);
  return user || null;
}

function getUser(username) {
  const users = loadUsers();
  return users.find(u => u.username === username) || null;
}

function listUsers() {
  return loadUsers();
}

function createUser(username, password, role, pages) {
  const users = loadUsers();
  if (users.find(u => u.username === username)) {
    throw new Error('Username already exists');
  }
  const user = {
    username,
    passwordHash: hashPassword(password),
    role: role || 'user',
    pages: pages || [],
    createdAt: new Date().toISOString()
  };
  users.push(user);
  saveUsers(users);
  return user;
}

function updateUser(username, updates) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) throw new Error('User not found');

  if (updates.password) {
    users[idx].passwordHash = hashPassword(updates.password);
  }
  if (updates.role !== undefined) {
    users[idx].role = updates.role;
  }
  if (updates.pages !== undefined) {
    users[idx].pages = updates.pages;
  }
  saveUsers(users);
  return users[idx];
}

function deleteUser(username) {
  const users = loadUsers();
  if (username === 'secureview') throw new Error('Cannot delete default admin');
  const idx = users.findIndex(u => u.username === username);
  if (idx === -1) throw new Error('User not found');
  users.splice(idx, 1);
  saveUsers(users);
}

// ── HMAC-signed tokens (stateless, survive server restarts) ──
function createToken(username) {
  const payload = Buffer.from(JSON.stringify({ username, ts: Date.now() })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.username || null;
  } catch { return null; }
}

// Legacy aliases for compatibility
function setToken() {}  // no-op, tokens are self-contained
function getTokenUser(token) { return verifyToken(token); }
function removeToken() {}  // no-op, client just deletes from localStorage

module.exports = {
  ALL_PAGES,
  authenticate,
  getUser,
  listUsers,
  createUser,
  updateUser,
  deleteUser,
  createToken,
  verifyToken,
  setToken,
  getTokenUser,
  removeToken,
  hashPassword
};
