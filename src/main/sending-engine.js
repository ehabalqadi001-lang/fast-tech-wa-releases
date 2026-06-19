'use strict';

const { v4: uuidv4 }   = require('uuid');
const EventEmitter     = require('events');

const DELAY_MIN_DEFAULT  = 15_000;
const DELAY_MAX_DEFAULT  = 45_000;
const POLL_MS            =  2_500;
const CB_THRESHOLD       = 5;          // auth failures before circuit opens
const CB_COOLDOWN_MS     = 15 * 60_000; // 15-minute cooldown per session

// ── Basic phone number validation ────────────────────────────────────────────
function _isValidPhone(raw) {
  if (!raw) return false;
  if (String(raw).includes('@')) return true; // JID — pass through
  const digits = String(raw).replace(/\D/g, '');
  return digits.length >= 6 && digits.length <= 15;
}

class SendingEngine extends EventEmitter {
  constructor(db, waSvc, antiBanSvc = null) {
    super();
    this._db            = db;
    this._wa            = waSvc;
    this._ab            = antiBanSvc;
    this._active        = false;
    this._paused        = false;
    this._timer         = null;
    this._processing    = false;
    this._cbFailCount   = new Map(); // sessionId → consecutive auth_failure count
    this._cbCooldown    = new Map(); // sessionId → timestamp when cooldown expires
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
    let queued = 0;
    const rejected = [];

    for (const item of items) {
      if (!_isValidPhone(item.recipient)) {
        rejected.push(String(item.recipient));
        continue;
      }
      this._db.queueEnqueue({
        id:           uuidv4(),
        session_id:   item.sessionId   ?? null,
        campaign_id:  item.campaignId  ?? null,
        recipient:    String(item.recipient).includes('@')
                        ? String(item.recipient)
                        : String(item.recipient).replace(/\D/g, ''),
        body:         item.body        ?? null,
        scripts:      item.scripts?.length ? JSON.stringify(item.scripts) : null,
        media_path:   item.mediaPath   ?? null,
        delay_min_ms: item.delayMin    ?? DELAY_MIN_DEFAULT,
        delay_max_ms: item.delayMax    ?? DELAY_MAX_DEFAULT,
        priority:     item.priority    ?? 5,
        max_attempts: item.maxAttempts ?? 3,
        scheduled_at: item.scheduledAt ?? new Date().toISOString(),
      });
      queued++;
    }

    if (rejected.length) {
      console.warn(`[Engine] Rejected ${rejected.length} invalid phone(s):`, rejected.slice(0, 5).join(', '));
    }
    return { queued, rejected: rejected.length, invalidPhones: rejected };
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
    if (!item) {
      // Queue transitioned from busy → empty
      if (this._wasBusy) { this._wasBusy = false; this.emit('queue:drained'); }
      return;
    }
    this._wasBusy = true;

    this._processing = true;

    // Pick session (pinned or health-aware rotation)
    const sessionId = item.session_id ?? this._rotateSession();
    if (!sessionId) {
      // No session ready yet — put back and wait
      this._db.queueSetStatus(item.id, 'pending');
      this._processing = false;
      return;
    }

    // ── AntiBanService gate ────────────────────────────────────────────────
    if (this._ab) {
      const gate = this._ab.canSend(sessionId);
      if (!gate.ok) {
        this._db.queueSetStatus(item.id, 'pending');
        this._processing = false;
        this.emit('antiban:blocked', { sessionId, reason: gate.reason, retryAfterMs: gate.retryAfterMs });
        console.warn(`[Engine] Anti-ban blocked session ${sessionId}: ${gate.reason}`);
        // If all sessions are blocked, wait before next poll
        if (gate.retryAfterMs) await this._sleep(Math.min(gate.retryAfterMs, 60_000));
        return;
      }
    }

    const { body, mediaPath, scriptIndex } = this._pickVariant(item);
    const chatId = this._wa._toChatId(item.recipient);

    // Store chosen variant index for A/B analytics (best-effort, non-blocking)
    if (scriptIndex >= 0) {
      try { this._db.queueSetScriptIndex(item.id, scriptIndex, body); } catch (_) {}
    }

    // ── Typing simulation (best-effort, never blocks send) ─────────────────
    if (this._ab) {
      const client = this._wa._clients?.get(sessionId);
      if (client) await this._ab.simulateTyping(client, chatId);
    }

    try {
      let waId;
      if (mediaPath) {
        const res = await this._wa.sendMedia(sessionId, item.recipient, mediaPath, body);
        waId = res.waId;
      } else {
        const res = await this._wa.sendText(sessionId, item.recipient, body);
        waId = res.waId;
      }

      this._db.queueSetDone(item.id, waId);
      if (item.campaign_id) {
        this._db.campaignIncrSent(item.campaign_id);
        if (scriptIndex >= 0) {
          try { this._db.campaignScriptIncrSent(item.campaign_id, scriptIndex); } catch (_) {}
        }
      }
      if (this._ab) {
        this._ab.recordSend(sessionId);
        if (typeof this._ab.recordSendResult === 'function') this._ab.recordSendResult(sessionId, true);
      }

      this.emit('sent', { itemId: item.id, recipient: item.recipient, sessionId, waId, scriptIndex });
      console.log(`[Engine] Sent → ${item.recipient} via ${sessionId} [script ${scriptIndex}]`);

    } catch (err) {
      const attempts = (item.attempts || 0) + 1;
      const lm = err.message?.toLowerCase() || '';

      // ── Circuit Breaker: track auth failures per session ──────────────────
      const isAuthErr = lm.includes('auth') || lm.includes('unauthorized') || lm.includes('session');
      if (isAuthErr) {
        const fails = (this._cbFailCount.get(sessionId) || 0) + 1;
        this._cbFailCount.set(sessionId, fails);
        if (fails >= CB_THRESHOLD) {
          const cooldownUntil = Date.now() + CB_COOLDOWN_MS;
          this._cbCooldown.set(sessionId, cooldownUntil);
          this._cbFailCount.set(sessionId, 0);
          console.warn(`[Engine] Circuit OPEN for ${sessionId} — ${CB_THRESHOLD} auth failures. Cooldown 15 min.`);
          this.emit('circuit:open', { sessionId, cooldownUntil });
        }
      } else {
        // Non-auth error: reset consecutive counter
        this._cbFailCount.set(sessionId, 0);
      }

      // Tell AntiBanService about the error
      if (this._ab) {
        if (lm.includes('ban') || lm.includes('blocked') || lm.includes('unauthorized')) {
          this._ab.recordBan(sessionId);
        } else if (isAuthErr) {
          this._ab.recordError(sessionId, 'auth_failure');
        } else {
          this._ab.recordError(sessionId, 'send_error');
        }
        if (typeof this._ab.recordSendResult === 'function') this._ab.recordSendResult(sessionId, false);
      }

      if (attempts >= (item.max_attempts || 3)) {
        this._db.queueSetFailed(item.id, err.message);
        if (item.campaign_id) {
          this._db.campaignIncrFailed(item.campaign_id);
          if (scriptIndex >= 0) {
            try { this._db.campaignScriptIncrFailed(item.campaign_id, scriptIndex); } catch (_) {}
          }
        }
        this.emit('failed', { itemId: item.id, recipient: item.recipient, error: err.message });
        console.error(`[Engine] Permanently failed → ${item.recipient}: ${err.message}`);
        this._processing = false;
        return;  // skip delay after permanent failure
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
    // AntiBanService provides profile-aware delay; fall back to item/default values
    let min, max;
    if (this._ab) {
      const profile = this._ab.getDelay(sessionId);
      min = profile.min;
      max = profile.max;
    } else {
      min = item.delay_min_ms || DELAY_MIN_DEFAULT;
      max = item.delay_max_ms || DELAY_MAX_DEFAULT;
    }
    const wait = Math.floor(Math.random() * (max - min + 1)) + min;
    console.log(`[Engine] Anti-ban delay: ${(wait / 1000).toFixed(1)}s`);
    this._processing = false;
    await this._sleep(wait);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROTATION & VARIATION
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Health-score-aware session rotation.
   * Excludes suspended (health < 30) or ban-detected sessions.
   * Among healthy sessions picks the least-used one.
   */
  _rotateSession() {
    const now   = Date.now();
    const ready = this._wa
      .getActiveSessions()
      .filter(s => this._wa.isReady(s.id));
    if (!ready.length) return null;

    const eligible = ready.filter(s => {
      // Circuit Breaker cooldown
      const cooldown = this._cbCooldown.get(s.id);
      if (cooldown && now < cooldown) return false;
      else if (cooldown) this._cbCooldown.delete(s.id); // expired — reopen

      // AntiBanService gates
      if (this._ab) {
        const abData = this._db.sessionGetAntiBan(s.id);
        if (!abData) return true;
        if (abData.ban_detected_at)           return false;
        if ((abData.health_score ?? 80) < 30) return false;
      }
      return true;
    });

    const pool = eligible.length ? eligible : ready;
    pool.sort((a, b) => (a.msg_count || 0) - (b.msg_count || 0));
    return pool[0].id;
  }

  /**
   * Pick one script variant at random.
   * Supports both legacy string[] and new {text, mediaPath}[] formats.
   * Returns { body, mediaPath, scriptIndex }.
   */
  _pickVariant(item) {
    if (item.scripts) {
      try {
        const variants = JSON.parse(item.scripts);
        if (Array.isArray(variants) && variants.length) {
          const idx = Math.floor(Math.random() * variants.length);
          const v   = variants[idx];
          if (typeof v === 'string') {
            return { body: v, mediaPath: item.media_path || null, scriptIndex: idx };
          }
          return {
            body:        v.text      || '',
            mediaPath:   v.mediaPath || item.media_path || null,
            scriptIndex: idx,
          };
        }
      } catch (_) {}
    }
    return { body: item.body || '', mediaPath: item.media_path || null, scriptIndex: -1 };
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  stats() { return this._db.queueStats(); }
}

module.exports = SendingEngine;
