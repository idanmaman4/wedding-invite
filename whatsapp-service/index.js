require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const SITE_URL = process.env.SITE_URL || 'https://your-domain.vercel.app';

// Per-sender state
const sessions = {
  idan: { client: null, status: 'disconnected', qrDataUrl: null },
  vered: { client: null, status: 'disconnected', qrDataUrl: null },
};

function buildInviteMessage(guestName, siteUrl) {
  return (
    `🌿 *Idan & Vered's Wedding* 🌿\n\n` +
    `Dear ${guestName},\n\n` +
    `We joyfully invite you to celebrate our wedding!\n\n` +
    `📅 June 14, 2027\n` +
    `⏰ 18:30\n` +
    `📍 The Garden Palace, Tel Aviv\n\n` +
    `Please RSVP at: ${siteUrl}\n\n` +
    `With love,\nIdan & Vered 💍`
  );
}

function initClient(sender) {
  const session = sessions[sender];
  session.status = 'initializing';
  session.qrDataUrl = null;

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: sender }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  });

  client.on('qr', async (qr) => {
    session.status = 'awaiting_scan';
    session.qrDataUrl = await qrcode.toDataURL(qr);
    console.log(`[${sender}] QR code ready — scan it in the admin panel`);
  });

  client.on('ready', () => {
    session.status = 'connected';
    session.qrDataUrl = null;
    console.log(`[${sender}] WhatsApp connected ✓`);
  });

  client.on('auth_failure', () => {
    session.status = 'auth_failed';
    console.error(`[${sender}] Auth failed`);
  });

  client.on('disconnected', (reason) => {
    session.status = 'disconnected';
    session.client = null;
    console.log(`[${sender}] Disconnected: ${reason}`);
  });

  client.initialize().catch((err) => {
    session.status = 'error';
    console.error(`[${sender}] Init error:`, err.message);
  });

  session.client = client;
}

// ─── Routes ─────────────────────────────────────────────────────────────────

// Status of both sessions
app.get('/status', (_req, res) => {
  res.json({
    idan: sessions.idan.status,
    vered: sessions.vered.status,
  });
});

// Get QR code for a sender (returns data URL or null if already connected)
app.get('/qr/:sender', (req, res) => {
  const { sender } = req.params;
  if (!sessions[sender]) return res.status(400).json({ error: 'Unknown sender' });

  res.json({
    status: sessions[sender].status,
    qr: sessions[sender].qrDataUrl,
  });
});

// (Re)initialize a sender's WhatsApp session
app.post('/connect/:sender', (req, res) => {
  const { sender } = req.params;
  if (!sessions[sender]) return res.status(400).json({ error: 'Unknown sender' });

  const s = sessions[sender];
  if (s.status === 'connected') return res.json({ message: 'Already connected' });

  // Destroy previous client if any
  if (s.client) {
    s.client.destroy().catch(() => {});
    s.client = null;
  }

  initClient(sender);
  res.json({ message: `Initializing ${sender} session…` });
});

// Disconnect a sender
app.post('/disconnect/:sender', async (req, res) => {
  const { sender } = req.params;
  if (!sessions[sender]) return res.status(400).json({ error: 'Unknown sender' });

  const s = sessions[sender];
  if (s.client) {
    await s.client.destroy().catch(() => {});
    s.client = null;
  }
  s.status = 'disconnected';
  s.qrDataUrl = null;
  res.json({ success: true });
});

// Send a raw message
app.post('/send', async (req, res) => {
  const { sender, to, message } = req.body;
  if (!sessions[sender]) return res.status(400).json({ error: 'Unknown sender' });

  const s = sessions[sender];
  if (s.status !== 'connected') {
    return res.status(400).json({ error: `${sender} is not connected (status: ${s.status})` });
  }

  const chatId = to.replace(/^\+/, '') + '@c.us';
  try {
    await s.client.sendMessage(chatId, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send wedding invitation to a guest
app.post('/send-invitation', async (req, res) => {
  const { sender, guestName, phone, websiteUrl } = req.body;
  if (!sessions[sender]) return res.status(400).json({ error: 'Unknown sender' });

  const s = sessions[sender];
  if (s.status !== 'connected') {
    return res.status(400).json({ error: `${sender} is not connected (status: ${s.status})` });
  }

  const message = buildInviteMessage(guestName, websiteUrl || SITE_URL);
  const chatId = phone.replace(/^\+/, '') + '@c.us';

  try {
    await s.client.sendMessage(chatId, message);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`WhatsApp service listening on http://localhost:${PORT}`);
  console.log('Sessions start disconnected — connect them from the admin panel.');
});
