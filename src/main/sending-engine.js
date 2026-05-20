'use strict';

/**
 * FAST TECH WhatsApp Cyber Nexus — Anti-Ban Sending Engine
 *
 * Processes the send_queue table one item at a time with:
 *   • Randomized delays between messages (15–45 s by default)
 *   • Account/session rotation (least-recently-used)
 *   • Script/message variation (random pick from variants array — A/B testing)
 *   • Automatic retry on transient errors (up to max_attempts, default 3)
 *   • Full attachment support via MessageMedia.fromFilePath
 */

const { v4: uuidv4 }   = require('uuid');
const EventEmitter     = require('events');

const DELAY_MIN_DEFAULT = 15_000;  // 15 seconds
const DELAY_MAX_DEFAULT = 45_000;  // 45 seconds
const POLL_MS           =  2_500;  // queue polling interval

class SendingEngine extends EventEmitter {
  /**
   * @param {import('./database')} db
   * @param {import('./whatsapp-web-service')} waSvc
   */
  constructor(db, waSvc) {
    super();
    this._db          = db;
    this._wa          = waSvc;
    this._active      = false;
    this._paused      = false;
    this._timer       = null;
    this._processing  = false;  // re-entrancy guard
  }

  start() {
    if (this._active) return;
    this._active = true;
    console.log('[Engine] Send queue worker started');
    this._tick();
  }

  stop() {
    this._active = false;
    clearTimeout(this._timer);
    this._timer = null;
    console.log('[Engine] Worker stopped');
  }

  pause()  { this._paused = true;  console.log('[Engine] Paused'); }
  resume() { this._paused = false; console.log('[Engine] Resumed'); }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC: ENQUEUE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Add messages to the persistent send queue.
   *
   * @param {Array<{
   *   recipient:    string,       // E.164 digits, no +
   *   body?:        string,       // plain text (used when scripts is empty)
   *   scripts?:     string[],     // array of variants — one is picked randomly per send
   *   sessionId?:   string,       // pin to a specific session; null = auto-rotate
   *   campaignId?:  string,
   *   mediaPath?:   string,       // absolute path to file on disk
   *   delayMin?:    number,       // ms (default 15000)
   *   delayMax?:    number,       // ms (default 45000)
   *   priority?:    number,       // 1 (high) … 10 (low), default 5
   *   maxAttempts?: number,       // default 3
   *   scheduledAt?: string,       // ISO datetime — don't process before this
   * }>} items
   */
  enqueue(items) {
    for (const item of items) {
      this._db.queueEnqueue({
        id:           uuidv4(),
        session_id:   item.sessionId   ?? null,
        campaign_id:  item.campaignId  ?? null,
        recipient:    String(item.recipient).replace(/\D/g, ''),
        body:         item.body        ?? null,
        scripts:      item.scripts?.length ? JSON.stringify(item.scripts) : null,
        media_path:   item.mediaPath   ?? null,
        delay_min_ms: item.delayMin    ?? DELAY_MIN_DEFAULT,
        delay_max_ms: item.delayMax    ?? DELAY_MAX_DEFAULT,
        priority:     item.priority    ?? 5,
        max_attempts: item.maxAttempts ?? 3,
        scheduled_at: item.scheduledAt ?? new Date().toISOString(),
      });
    }
    return { queued: items.length };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WORKER LOOP
  // ══════════════════════════════════════════════════════════════════════════

  async _tick() {
    if (!this._active) return;

    if (!this._paused && !this._processing) {
      try { await this._processNext(); }
      catch (err) { console.error('[Engine] Tick error:', err.message); }
    }

    this._timer = setTimeout(() => this._tick(), POLL_MS);
  }

  async _processNext() {
    // Atomic peek+lock in a single transaction to prevent double-processing
    const item = this._db._db.transaction(() => {
      const row = this._db.queuePeek();
      if (!row) return null;
      this._db.queueSetStatus(row.id, 'processing');
      return row;
    })();
    if (!item) return;

    this._processing = true;

    // Pick session (pinned or auto-rotate)
    const sessionId = item.session_id ?? this._rotateSession();
    if (!sessionId) {
      // No session ready yet — put back and wait
      this._db.queueSetStatus(item.id, 'pending');
      return;
    }

    const body = this._pickBody(item);

    try {
      let waId;
      if (item.media_path) {
        const res = await this._wa.sendMedia(sessionId, item.recipient, item.media_path, body);
        waId = res.waId;
      } else {
        const res = await this._wa.sendText(sessionId, item.recipient, body);
        waId = res.waId;
      }

      this._db.queueSetDone(item.id, waId);
      if (item.campaign_id) this._db.campaignIncrSent(item.campaign_id);

      this.emit('sent', { itemId: item.id, recipient: item.recipient, sessionId, waId });
      console.log(`[Engine] Sent → ${item.recipient} via ${sessionId}`);

    } catch (err) {
      const attempts = (item.attempts || 0) + 1;

      if (attempts >= (item.max_attempts || 3)) {
        this._db.queueSetFailed(item.id, err.message);
        if (item.campaign_id) this._db.campaignIncrFailed(item.campaign_id);
        this.emit('failed', { itemId: item.id, recipient: item.recipient, error: err.message });
        console.error(`[Engine] Permanently failed → ${item.recipient}: ${err.message}`);
        this._processing = false;
        return;  // skip anti-ban delay after permanent failure
      } else {
        this._db.queueSetRetry(item.id, attempts);
        this.emit('retry', { itemId: item.id, attempts });
        console.warn(`[Engine] Retry ${attempts} → ${item.recipient}`);
        this._processing = false;
        await this._sleep(5_000);
        return;
      }
    }

    // ── Anti-ban randomized delay before next message ─────────────────────
    const min  = item.delay_min_ms || DELAY_MIN_DEFAULT;
    const max  = item.delay_max_ms || DELAY_MAX_DEFAULT;
    const wait = Math.floor(Math.random() * (max - min + 1)) + min;
    console.log(`[Engine] Anti-ban delay: ${(wait / 1000).toFixed(1)}s`);
    this._processing = false;
    await this._sleep(wait);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROTATION & VARIATION
  // ══════════════════════════════════════════════════════════════════════════

  /** Least-used session rotation across all ready sessions */
  _rotateSession() {
    const ready = this._wa
      .getActiveSessions()
      .filter(s => this._wa.isReady(s.id));
    if (!ready.length) return null;
    ready.sort((a, b) => (a.msg_count || 0) - (b.msg_count || 0));
    return ready[0].id;
  }

  /** Pick one script variant at random; fall back to item.body */
  _pickBody(item) {
    if (item.scripts) {
      try {
        const variants = JSON.parse(item.scripts);
        if (Array.isArray(variants) && variants.length) {
          return variants[Math.floor(Math.random() * variants.length)];
        }
      } catch (_) {}
    }
    return item.body || '';
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  stats() { return this._db.queueStats(); }
}

module.exports = SendingEngine;
