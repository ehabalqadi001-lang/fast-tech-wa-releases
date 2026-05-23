'use strict';

/**
 * FAST TECH — Anti-Ban Service
 *
 * Central guardian consulted by SendingEngine before every send.
 * Fully optional: if not injected, SendingEngine works exactly as before.
 *
 * Capabilities:
 *   • Daily + hourly rate limits per session
 *   • Session warmup schedule (gradual ramp-up for new numbers)
 *   • Health score (0–100) per session — auto-suspend unhealthy sessions
 *   • Ban detection via auth_failure / error patterns
 *   • Typing + online presence simulation
 *   • Time-window enforcement (e.g. send only 09:00–21:00)
 *   • Delay profiles: STEALTH / SLOW / NORMAL / FAST
 *   • Midnight daily-counter reset via node-cron
 */

const EventEmitter = require('events');
const cron         = require('node-cron');

// ── Delay profiles (ms) ────────────────────────────────────────────────────
const DELAY_PROFILES = {
  stealth: { min: 120_000, max: 300_000 },   // 2–5 min
  slow:    { min:  60_000, max: 120_000 },   // 1–2 min
  normal:  { min:  15_000, max:  45_000 },   // 15–45 s  (original)
  fast:    { min:   5_000, max:  15_000 },   // 5–15 s   (risky)
};

// ── Warmup schedule: day-range → daily limit ──────────────────────────────
const WARMUP_SCHEDULE = [
  { from: 1,  to: 3,   limit: 10  },
  { from: 4,  to: 7,   limit: 25  },
  { from: 8,  to: 14,  limit: 50  },
  { from: 15, to: 21,  limit: 100 },
  { from: 22, to: 30,  limit: 200 },
];
const WARMUP_GRADUATED = 31; // after this day warmup is complete

// ── Health-score adjustments ──────────────────────────────────────────────
const HEALTH = {
  SEND_SUCCESS:  +1,
  SEND_ERROR:    -5,
  AUTH_FAILURE:  -30,
  DISCONNECTED:  -10,
  BAN_DETECTED:  -100,
  MAX:           100,
  SUSPEND_BELOW: 30,  // auto-suspend session
  SLOW_BELOW:    50,  // cut throughput in half
};

class AntiBanService extends EventEmitter {
  /**
   * @param {import('./database')} db
   */
  constructor(db) {
    super();
    this._db       = db;
    this._settings = {};     // cached settings from DB
    this._cronJob  = null;
    this._cronHour = null;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════════

  start() {
    this._loadSettings();

    // Reset daily counters at midnight
    this._cronJob = cron.schedule('0 0 * * *', () => {
      const changed = this._db.sessionResetDailyCounters();
      if (changed) {
        this._db.antiBanEventLog({ event_type: 'daily_reset', detail: `${changed} sessions reset` });
        this.emit('daily:reset', { sessions: changed });
        console.log(`[AntiBan] Daily counters reset for ${changed} session(s)`);
      }
    });

    // Reset hourly counters at the top of each hour
    this._cronHour = cron.schedule('0 * * * *', () => {
      this._db.sessionResetHourlyCounters();
    });

    console.log('[AntiBan] Service started');
  }

  stop() {
    this._cronJob?.stop();
    this._cronHour?.stop();
    console.log('[AntiBan] Service stopped');
  }

  /** Re-read settings from DB (call after user changes settings) */
  reloadSettings() {
    this._loadSettings();
  }

  _loadSettings() {
    const s = this._db.settingsGetAll();
    this._settings = {
      enabled:          s.antiban_enabled           !== '0',
      delayProfile:     s.antiban_delay_profile      || 'normal',
      dailyLimit:       parseInt(s.antiban_daily_limit    || '500', 10),
      hourlyLimit:      parseInt(s.antiban_hourly_limit   || '60',  10),
      timeWindowStart:  parseInt(s.antiban_window_start   || '0',   10),  // hour 0–23
      timeWindowEnd:    parseInt(s.antiban_window_end     || '23',  10),
      timeWindowEnabled: s.antiban_window_enabled       === '1',
      typingSimEnabled: s.antiban_typing_sim           !== '0',
      typingMinMs:      parseInt(s.antiban_typing_min_ms  || '1000', 10),
      typingMaxMs:      parseInt(s.antiban_typing_max_ms  || '3000', 10),
    };
  }

  getSettings() {
    return { ...this._settings };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CORE GATE: canSend()
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Check whether the given session may send a message right now.
   * Returns { ok: true } or { ok: false, reason: string, retryAfterMs?: number }
   */
  canSend(sessionId) {
    if (!this._settings.enabled) return { ok: true };

    // 1. Time window
    if (this._settings.timeWindowEnabled) {
      const hour = new Date().getHours();
      if (hour < this._settings.timeWindowStart || hour > this._settings.timeWindowEnd) {
        const msUntilWindow = this._msUntilHour(this._settings.timeWindowStart);
        return { ok: false, reason: 'outside_time_window', retryAfterMs: msUntilWindow };
      }
    }

    const session = this._db.sessionGetAntiBan(sessionId);
    if (!session) return { ok: true }; // session not tracked yet → allow

    // 2. Ban detected
    if (session.ban_detected_at) {
      return { ok: false, reason: 'ban_detected' };
    }

    // 3. Health score
    if ((session.health_score ?? 80) < HEALTH.SUSPEND_BELOW) {
      return { ok: false, reason: 'health_too_low', health: session.health_score };
    }

    // 4. Warmup daily limit
    if (session.warmup_mode) {
      const warmupLimit = session.warmup_daily_limit || this._getWarmupLimit(session.warmup_day || 1);
      const dailyCount  = this._getTodayCount(session);
      if (dailyCount >= warmupLimit) {
        return { ok: false, reason: 'warmup_daily_limit', limit: warmupLimit, count: dailyCount, retryAfterMs: this._msUntilMidnight() };
      }
    }

    // 5. Global daily limit
    const dailyCount = this._getTodayCount(session);
    if (dailyCount >= this._settings.dailyLimit) {
      return { ok: false, reason: 'daily_limit', limit: this._settings.dailyLimit, count: dailyCount, retryAfterMs: this._msUntilMidnight() };
    }

    // 6. Hourly limit
    const hourlyCount = this._getHourCount(session);
    if (hourlyCount >= this._settings.hourlyLimit) {
      return { ok: false, reason: 'hourly_limit', limit: this._settings.hourlyLimit, count: hourlyCount, retryAfterMs: this._msUntilNextHour() };
    }

    return { ok: true };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // RECORD EVENTS
  // ══════════════════════════════════════════════════════════════════════════

  recordSend(sessionId) {
    this._db.sessionBumpAntiBanCounters(sessionId);

    const session = this._db.sessionGetAntiBan(sessionId);
    if (!session) return;

    // Advance warmup day if needed
    if (session.warmup_mode) {
      this._advanceWarmupDay(session);
    }

    // Nudge health up (capped at MAX)
    const newHealth = Math.min(HEALTH.MAX, (session.health_score ?? 80) + HEALTH.SEND_SUCCESS);
    if (newHealth !== session.health_score) {
      this._db.sessionUpdateHealthScore(sessionId, newHealth);
    }
  }

  recordError(sessionId, errType = 'send_error') {
    const session = this._db.sessionGetAntiBan(sessionId);
    if (!session) return;

    let delta = HEALTH.SEND_ERROR;
    if (errType === 'auth_failure') delta = HEALTH.AUTH_FAILURE;
    if (errType === 'disconnected') delta = HEALTH.DISCONNECTED;

    const newHealth = Math.max(0, (session.health_score ?? 80) + delta);
    this._db.sessionUpdateHealthScore(sessionId, newHealth);
    this._db.antiBanEventLog({ session_id: sessionId, event_type: errType, detail: `health: ${newHealth}` });

    if (newHealth < HEALTH.SUSPEND_BELOW) {
      this.emit('session:suspended', { sessionId, health: newHealth });
      console.warn(`[AntiBan] Session ${sessionId} suspended — health: ${newHealth}`);
    }
  }

  recordBan(sessionId) {
    this._db.sessionSetBanDetected(sessionId);
    this._db.antiBanEventLog({ session_id: sessionId, event_type: 'ban_detected', detail: 'Account banned' });
    this.emit('session:banned', { sessionId });
    console.error(`[AntiBan] BAN DETECTED on session ${sessionId}`);
  }

  recordAuthFailure(sessionId) {
    const session = this._db.sessionGetAntiBan(sessionId);
    if (!session) return;

    const newHealth = Math.max(0, (session.health_score ?? 80) + HEALTH.AUTH_FAILURE);
    this._db.sessionUpdateHealthScore(sessionId, newHealth);
    this._db.antiBanEventLog({ session_id: sessionId, event_type: 'auth_failure', detail: `health: ${newHealth}` });

    if (newHealth <= 0) this.recordBan(sessionId);
    else                this.emit('session:authFailed', { sessionId, health: newHealth });
  }

  resetSession(sessionId) {
    this._db._db.prepare(`
      UPDATE wa_sessions SET
        health_score    = 80,
        ban_detected_at = NULL,
        daily_count     = 0,
        daily_reset_at  = datetime('now'),
        hourly_count    = 0,
        hourly_reset_at = datetime('now')
      WHERE id = ?
    `).run(sessionId);
    this._db.antiBanEventLog({ session_id: sessionId, event_type: 'manual_reset', detail: 'Reset by user' });
    console.log(`[AntiBan] Session ${sessionId} manually reset`);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // WARMUP
  // ══════════════════════════════════════════════════════════════════════════

  enableWarmup(sessionId) {
    this._db.sessionSetWarmup(sessionId, true, 1, this._getWarmupLimit(1));
    this._db.antiBanEventLog({ session_id: sessionId, event_type: 'warmup_start', detail: 'Warmup enabled' });
    console.log(`[AntiBan] Warmup enabled for ${sessionId}`);
  }

  disableWarmup(sessionId) {
    this._db.sessionSetWarmup(sessionId, false, 0, 0);
    this._db.antiBanEventLog({ session_id: sessionId, event_type: 'warmup_stop', detail: 'Warmup disabled' });
  }

  _getWarmupLimit(day) {
    for (const s of WARMUP_SCHEDULE) {
      if (day >= s.from && day <= s.to) return s.limit;
    }
    return 500; // graduated
  }

  _advanceWarmupDay(session) {
    const today = new Date().toISOString().slice(0, 10);
    const resetDay = session.daily_reset_at ? session.daily_reset_at.slice(0, 10) : null;
    if (resetDay && resetDay !== today) {
      // New day — advance warmup_day counter
      const newDay = (session.warmup_day || 1) + 1;
      if (newDay >= WARMUP_GRADUATED) {
        this._db.sessionSetWarmup(session.id, false, newDay, 0);
        this._db.antiBanEventLog({ session_id: session.id, event_type: 'warmup_complete', detail: `Day ${newDay}` });
        this.emit('warmup:complete', { sessionId: session.id });
      } else {
        const newLimit = this._getWarmupLimit(newDay);
        this._db.sessionSetWarmup(session.id, true, newDay, newLimit);
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TYPING + PRESENCE SIMULATION
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Simulate typing before sending. Safe to call — if anything fails it's silently ignored.
   * @param {import('whatsapp-web.js').Client} waClient
   * @param {string} chatId
   */
  async simulateTyping(waClient, chatId) {
    if (!this._settings.typingSimEnabled) return;
    const { min, max } = { min: this._settings.typingMinMs, max: this._settings.typingMaxMs };
    const duration = Math.floor(Math.random() * (max - min + 1)) + min;
    try {
      const chat = await waClient.getChatById(chatId);
      await chat.sendStateTyping();
      await this._sleep(duration);
      await chat.clearState();
    } catch (_) {
      // Typing simulation is best-effort — never block the send
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // DELAY PROFILE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Returns { min, max } delay ms for the active profile.
   * Halves the range if a session's health is low (SLOW_BELOW).
   */
  getDelay(sessionId) {
    const profile = DELAY_PROFILES[this._settings.delayProfile] || DELAY_PROFILES.normal;
    if (sessionId) {
      const session = this._db.sessionGetAntiBan(sessionId);
      const health  = session?.health_score ?? 80;
      if (health < HEALTH.SLOW_BELOW) {
        // Low-health session: force at least SLOW profile
        const slow = DELAY_PROFILES.slow;
        return { min: Math.max(profile.min, slow.min), max: Math.max(profile.max, slow.max) };
      }
    }
    return profile;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // STATS
  // ══════════════════════════════════════════════════════════════════════════

  getAllSessionStats() {
    return this._db.sessionListAntiBan().map(s => ({
      id:              s.id,
      name:            s.name,
      phone:           s.phone,
      status:          s.status,
      healthScore:     s.health_score ?? 80,
      dailyCount:      this._getTodayCount(s),
      dailyLimit:      s.warmup_mode ? (s.warmup_daily_limit || this._getWarmupLimit(s.warmup_day || 1))
                                     : this._settings.dailyLimit,
      hourlyCount:     this._getHourCount(s),
      hourlyLimit:     this._settings.hourlyLimit,
      warmupMode:      !!s.warmup_mode,
      warmupDay:       s.warmup_day || 0,
      banDetected:     !!s.ban_detected_at,
      banDetectedAt:   s.ban_detected_at || null,
      suspended:       (s.health_score ?? 80) < HEALTH.SUSPEND_BELOW,
    }));
  }

  getRecentEvents(limit = 100) {
    return this._db.antiBanEventList(limit);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  _getTodayCount(session) {
    if (!session.daily_reset_at) return 0;
    const today    = new Date().toISOString().slice(0, 10);
    const resetDay = session.daily_reset_at.slice(0, 10);
    return resetDay === today ? (session.daily_count || 0) : 0;
  }

  _getHourCount(session) {
    if (!session.hourly_reset_at) return 0;
    const thisHour  = new Date().toISOString().slice(0, 13);
    const resetHour = session.hourly_reset_at.slice(0, 13);
    return resetHour === thisHour ? (session.hourly_count || 0) : 0;
  }

  _msUntilMidnight() {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(24, 0, 0, 0);
    return next - now;
  }

  _msUntilNextHour() {
    const now  = new Date();
    const next = new Date(now);
    next.setMinutes(60, 0, 0);
    return next - now;
  }

  _msUntilHour(h) {
    const now  = new Date();
    const next = new Date(now);
    next.setHours(h, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next - now;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = { AntiBanService, DELAY_PROFILES, WARMUP_SCHEDULE };
