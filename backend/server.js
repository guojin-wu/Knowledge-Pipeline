require('dotenv').config();

const path = require('path');
const requireDep = require('./require-dep');
const express = requireDep('express');
const cors = requireDep('cors');

const authRoutes = require('./routes/auth');
const kbRoutes = require('./routes/kb');

const app = express();
const PORT = process.env.PORT || 3001;
const frontendDir = path.join(__dirname, '../frontend');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(frontendDir));

app.use('/auth', authRoutes);
app.use('/kb', kbRoutes);

[
  '/ai-assistant.html',
  '/knowledge-base.html',
  '/retrieval-config.html',
  '/qa-builder.html',
  '/internal-reminder.html',
  '/accuracy-test.html'
].forEach((legacyPath) => {
  app.get(legacyPath, (req, res) => {
    res.redirect(302, '/');
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'));
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', project: 'knowledge-base', timestamp: new Date().toISOString() });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, () => {
  console.log(`Knowledge Base running on http://localhost:${PORT}`);
});

module.exports = app;
