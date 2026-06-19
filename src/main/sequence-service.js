'use strict';

const cron = require('node-cron');

/**
 * Phase 7 — Sequence Service
 * Drip campaign engine: processes due enrollments every 2 minutes,
 * sends the next step via the active WA engine, then advances the enrollment.
 */
class SequenceService {
  constructor(db, engine, waSvc) {
    this._db      = db;
    this._engine  = engine;   // SendingEngine
    this._waSvc   = waSvc;    // WaWebService
    this._job     = null;
    this._running = false;
  }

  start() {
    // Run every 2 minutes
    this._job = cron.schedule('*/2 * * * *', () => this._processDue());
    console.log('[SEQ] Sequence engine started');
  }

  stop() {
    this._job?.stop();
    this._job = null;
  }

  async _processDue() {
    if (this._running) return;
    this._running = true;
    try {
      const due = this._db.sequenceDueEnrollments();
      for (const enr of due) {
        await this._sendStep(enr);
      }
    } catch (e) {
      console.error('[SEQ] Error processing due enrollments:', e.message);
    } finally {
      this._running = false;
    }
  }

  async _sendStep(enr) {
    try {
      const sessionId = enr.session_id || enr.default_session;
      if (!sessionId) {
        console.warn(`[SEQ] No session for enrollment ${enr.id}`);
        return;
      }

      const phone = enr.phone.replace(/\D/g, '');
      const body  = enr.message_body || '';

      // Try sending via WA Web session
      if (this._waSvc) {
        await this._waSvc.sendMessage(sessionId, phone + '@c.us', body);
      }

      // Advance to next step
      const nextStep    = enr.current_step + 1;
      const totalSteps  = enr.total_steps;
      const seq         = this._db.sequenceGet(enr.sequence_id);
      const nextStepObj = seq?.steps[nextStep];
      const delayHours  = nextStepObj?.delay_hours || 24;

      this._db.sequenceAdvanceEnrollment({
        id: enr.id, nextStep, totalSteps, delayHours,
      });

      console.log(`[SEQ] Step ${enr.current_step} sent to ${phone} — seq: ${enr.seq_name}`);
    } catch (e) {
      console.error(`[SEQ] Failed step for ${enr.phone}:`, e.message);
    }
  }

  // Enroll a phone number in a sequence (called from IPC or trigger)
  enroll({ sequenceId, phone, sessionId }) {
    return this._db.sequenceEnroll({ sequenceId, phone, sessionId });
  }

  unenroll({ sequenceId, phone }) {
    return this._db.sequenceUnenroll({ sequenceId, phone });
  }

  // Check if a message matches any keyword trigger and auto-enroll sender
  async checkKeywordTrigger(body, phone, sessionId) {
    if (!body) return;
    const seqs = this._db.sequenceList().filter(
      s => s.active && s.trigger_type === 'keyword' && s.trigger_value
    );
    for (const seq of seqs) {
      const keywords = seq.trigger_value.split(',').map(k => k.trim().toLowerCase());
      if (keywords.some(k => k && body.toLowerCase().includes(k))) {
        this.enroll({ sequenceId: seq.id, phone, sessionId });
        console.log(`[SEQ] Auto-enrolled ${phone} in sequence "${seq.name}" via keyword`);
      }
    }
  }
}

module.exports = SequenceService;
