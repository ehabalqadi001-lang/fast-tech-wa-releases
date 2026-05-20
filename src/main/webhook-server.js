'use strict';

/**
 * Fast Tech WA Manager — Webhook Server
 *
 * Embedded HTTP server that listens for WhatsApp Business Cloud API
 * webhook notifications (incoming messages + delivery status updates).
 *
 * Meta requires two endpoints on the same path:
 *   GET  /webhook  — challenge verification (one-time setup)
 *   POST /webhook  — live notifications
 *
 * Configure in Meta Developer Console:
 *   Callback URL:  http://<your-ip>:<port>/webhook
 *   Verify Token:  (same value as stored in settings: webhook_verify_token)
 */

const http   = require('http');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const WaApi  = require('./whatsapp-api');

const MAX_BODY_BYTES = 1_000_000;  // 1 MB hard limit

class WebhookServer {
  /**
   * @param {import('./database')} db
   */
  constructor(db) {
    this._db     = db;
    this._server = null;
    this._win    = null;
    this._port   = 3001;
  }

  /** Attach main BrowserWindow so we can push events to renderer. */
  setWindow(win) { this._win = win; }

  /** Start listening. Resolves when server is bound. */
  start(port) {
    return new Promise((resolve, reject) => {
      if (this._server) { resolve(this._port); return; }

      this._port = port || parseInt(this._db.settingGet('webhook_port') || '3001', 10);

      this._server = http.createServer((req, res) => this._handle(req, res));

      this._server.on('error', (err) => {
        console.error('[Webhook] Server error:', err.message);
        reject(err);
      });

      this._server.listen(this._port, '0.0.0.0', () => {
        console.log(`[Webhook] Listening on port ${this._port}`);
        resolve(this._port);
      });
    });
  }

  stop() {
    if (this._server) {
      this._server.closeAllConnections?.();  // Node 18+: drain in-flight requests
      this._server.close(() => console.log('[Webhook] Server stopped.'));
      this._server = null;
    }
  }

  isRunning() { return !!this._server; }
  getPort()   { return this._port; }

  // ─── Request router ───────────────────────────────────────────────────────

  _handle(req, res) {
    const url = req.url?.split('?')[0] || '/';
    if (url === '/webhook') {
      if (req.method === 'GET')  return this._verify(req, res);
      if (req.method === 'POST') return this._receive(req, res);
    }
    // Health check
    if (url === '/health' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, service: 'ftwa-webhook' }));
    }
    res.writeHead(404);
    res.end('Not found');
  }

  // ─── GET /webhook — Meta challenge verification ───────────────────────────

  _verify(req, res) {
    const qs      = new URLSearchParams(req.url.split('?')[1] || '');
    const mode    = qs.get('hub.mode');
    const token   = qs.get('hub.verify_token');
    const challenge = qs.get('hub.challenge');

    const expected = this._db.settingGet('webhook_verify_token') || 'ftwa-verify';

    if (mode === 'subscribe' && token === expected) {
      console.log('[Webhook] Verification successful.');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(challenge);
    }

    console.warn('[Webhook] Verification failed. Token mismatch.');
    res.writeHead(403);
    res.end('Forbidden');
  }

  // ─── POST /webhook — Live notifications ──────────────────────────────────

  _receive(req, res) {
    let raw = '';
    let size = 0;

    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413, { 'Content-Type': 'text/plain' });
        res.end('Payload too large');
        req.destroy();
        return;
      }
      raw += chunk;
    });

    req.on('end', () => {
      if (res.writableEnded) return;

      // HMAC-SHA256 signature verification (Meta signs with X-Hub-Signature-256)
      const appSecret = this._db.settingGet('webhook_app_secret') || '';
      const sigHeader = req.headers['x-hub-signature-256'] || '';
      if (appSecret && sigHeader) {
        const expected = 'sha256=' + crypto
          .createHmac('sha256', appSecret)
          .update(raw)
          .digest('hex');
        const valid = sigHeader.length === expected.length &&
          crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected));
        if (!valid) {
          console.warn('[Webhook] HMAC signature mismatch — request rejected.');
          res.writeHead(403);
          res.end('Forbidden');
          return;
        }
      }

      // Respond immediately — Meta times out if we take > 20 s
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');

      try {
        const body   = JSON.parse(raw);
        const events = WaApi.parseWebhook(body);

        for (const ev of events) {
          if (ev.type === 'status_update') {
            this._handleStatusUpdate(ev);
          } else if (ev.from) {
            this._handleIncomingMessage(ev);
          }
        }
      } catch (e) {
        console.error('[Webhook] Parse error:', e.message);
      }
    });
  }

  // ─── Incoming message ─────────────────────────────────────────────────────

  _handleIncomingMessage(ev) {
    try {
      const id = uuidv4();
      this._db.messageCreate({
        id,
        campaign_id: null,
        account_id:  null,
        recipient:   ev.from,
        direction:   'in',
        body:        ev.text || '',
        media_url:   null,
        wa_msg_id:   ev.msgId || null,
        status:      'read',
      });

      // Also persist in incoming_messages so Inbox page shows it
      this._db._db.prepare(`
        INSERT OR IGNORE INTO incoming_messages
          (id, session_id, from_number, body, msg_type, timestamp)
        VALUES (?, 'cloud-api', ?, ?, 'chat', ?)
      `).run(id, ev.from, ev.text || '', ev.timestamp || new Date().toISOString());

      console.log(`[Webhook] Incoming message from ${ev.from}`);

      // Push to renderer
      this._win?.webContents?.send('wa:inbox:new', {
        id,
        from:      ev.from,
        body:      ev.text || '',
        msgId:     ev.msgId,
        timestamp: ev.timestamp,
        source:    'cloud',
      });
    } catch (e) {
      console.error('[Webhook] Failed to store message:', e.message);
    }
  }

  // ─── Delivery status update ───────────────────────────────────────────────

  _handleStatusUpdate(ev) {
    try {
      if (!ev.msgId || !ev.status) return;
      // Update messages table
      this._db._db.prepare(
        "UPDATE messages SET status=? WHERE wa_msg_id=?"
      ).run(ev.status, ev.msgId);
      // Update send queue
      this._db.queueUpdateByWaId(ev.msgId, ev.status);

      // Push delivery event to renderer
      this._win?.webContents?.send('wa:status:update', {
        msgId:     ev.msgId,
        recipient: ev.recipient,
        status:    ev.status,
      });
    } catch (e) {
      console.error('[Webhook] Failed to update status:', e.message);
    }
  }
}

module.exports = WebhookServer;
