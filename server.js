require('dotenv').config();

const express = require('express');
const fs      = require('fs');
const path    = require('path');

const app           = express();
const PORT          = process.env.PORT || 3000;
const MESSAGES_FILE = path.join(__dirname, 'messages.json');
const WAQI_TOKEN    = process.env.WAQI_TOKEN || '';

app.use(express.json());
app.use(express.static(__dirname));

function loadMessages() {
  if (!fs.existsSync(MESSAGES_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(MESSAGES_FILE, 'utf8')); }
  catch { return []; }
}

function saveMessages(msgs) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify(msgs, null, 2));
}

app.get('/api/messages', (_req, res) => {
  res.json(loadMessages());
});

app.post('/api/message', (req, res) => {
  const { text, city, aqi } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'empty' });

  const msgs  = loadMessages();
  const entry = {
    id:        Date.now(),
    text:      text.trim(),
    city:      city || 'unknown',
    aqi:       Number(aqi) || 0,
    timestamp: new Date().toISOString(),
  };
  msgs.push(entry);
  saveMessages(msgs);
  res.json(entry);
});

// AQI proxy — keeps the token server-side
app.get('/api/aqi', async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  if (!WAQI_TOKEN)  return res.status(500).json({ error: 'WAQI_TOKEN not set in .env' });
  try {
    const r    = await fetch(`https://api.waqi.info/feed/geo:${lat};${lng}/?token=${WAQI_TOKEN}`);
    const data = await r.json();
    res.json(data);
  } catch (_) {
    res.status(502).json({ error: 'upstream fetch failed' });
  }
});

app.get('/output', (_req, res) => {
  res.sendFile(path.join(__dirname, 'output.html'));
});

app.listen(PORT, () => console.log(`http://localhost:${PORT}`));
