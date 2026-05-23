'use strict';

/**
 * Fast Tech WA Manager — Message Scheduler
 * Uses node-cron to fire campaigns at configured times.
 */

const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');

class Scheduler {
  /**
   * @param {import('./database')}        db
   * @param {import('./engine-adapter')}  adapter  — unified send adapter
   */
  constructor(db, adapter) {
    this._db      = db;
    this._adapter = adapter;
    this._jobs    = new Map();   // taskId → cron job
    this._running = new Set();   // taskIds currently executing
  }

  // ─── Boot: load active tasks from DB ─────────────────────────────────────
  async loadAndStart() {
    const tasks = this._db.taskList().filter(t => t.active);
    for (const task of tasks) {
      this._schedule(task);
    }
    console.log(`[Scheduler] Loaded ${tasks.length} task(s).`);
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────
  create(data) {
    if (!cron.validate(data.cron_expr)) {
      throw new Error(`Invalid cron expression: ${data.cron_expr}`);
    }
    const task = {
      id:               uuidv4(),
      name:             data.name,
      campaign_id:      data.campaign_id      || null,
      cron_expr:        data.cron_expr,
      next_run:         this._nextRun(data.cron_expr),
      active:           1,
      message_body:     data.message_body     || null,
      media_path:       data.media_path       || null,
      media_type:       data.media_type       || null,
      recipients_type:  data.recipients_type  || 'all',
      recipients_json:  data.recipients_json  || null,
      session_id:       data.session_id       || null,
      timezone:         data.timezone         || 'Asia/Riyadh',
      template_id:      data.template_id      || null,
    };
    this._db.taskCreate(task);
    this._schedule(task);
    return task;
  }

  update(data) {
    const existing = this._db.taskGet(data.id);
    if (!existing) throw new Error('Task not found');
    if (data.cron_expr && !cron.validate(data.cron_expr)) {
      throw new Error(`Invalid cron expression: ${data.cron_expr}`);
    }
    const updated = {
      ...existing,
      ...data,
      next_run: this._nextRun(data.cron_expr || existing.cron_expr),
    };
    this._db.taskUpdate(updated);
    this._unschedule(data.id);
    if (updated.active) this._schedule(updated);
    return updated;
  }

  remove(id) {
    this._unschedule(id);
    this._db.taskDelete(id);
    return { ok: true };
  }

  pause(id) {
    return this.update({ id, active: 0 });
  }

  resume(id) {
    return this.update({ id, active: 1 });
  }

  list() {
    return this._db.taskList().map(t => ({
      ...t,
      running: this._running.has(t.id),
    }));
  }

  /** Trigger a task immediately regardless of schedule */
  async runNow(id) {
    const task = this._db.taskGet(id);
    if (!task) throw new Error('Task not found');
    if (this._running.has(id)) throw new Error('Task is already running');

    console.log(`[Scheduler] Manual trigger: ${task.name} (${id})`);
    this._running.add(id);
    try {
      await this._fireTask(task);
    } finally {
      this._running.delete(id);
    }
    return { ok: true };
  }

  // ─── Internal scheduling ──────────────────────────────────────────────────
  _schedule(task) {
    if (!task.active) return;
    if (!cron.validate(task.cron_expr)) {
      console.warn(`[Scheduler] Skipping invalid cron for task ${task.id}: ${task.cron_expr}`);
      return;
    }

    const timezone = task.timezone || this._db.settingGet('scheduler_timezone') || 'Asia/Riyadh';
    const job = cron.schedule(task.cron_expr, async () => {
      if (this._running.has(task.id)) {
        console.warn(`[Scheduler] Task ${task.name} still running — skipping overlapping fire.`);
        return;
      }
      console.log(`[Scheduler] Firing task: ${task.name} (${task.id})`);
      this._running.add(task.id);
      try {
        await this._fireTask(task);
      } finally {
        this._running.delete(task.id);
      }
    }, { timezone });

    this._jobs.set(task.id, job);
    console.log(`[Scheduler] Scheduled: ${task.name} @ ${task.cron_expr}`);
  }

  _unschedule(id) {
    const job = this._jobs.get(id);
    if (job) {
      job.stop();
      this._jobs.delete(id);
    }
  }

  // ─── Fire a task ──────────────────────────────────────────────────────────
  async _fireTask(task) {
    try {
      // ── Path A: task has its own message_body (new style) ─────────────────
      if (task.message_body) {
        const recipients = await this._resolveRecipients(task);

        if (recipients.length === 0) {
          console.warn(`[Scheduler] No recipients for task: ${task.name}`);
          this._db.taskBumpRun(task.id, this._nextRun(task.cron_expr));
          return;
        }

        console.log(`[Scheduler] Sending to ${recipients.length} recipients — task: ${task.name}`);
        await this._adapter.sendBulk({
          accountIds:   task.session_id ? [] : [],
          sessionIds:   task.session_id ? [task.session_id] : [],
          recipients,
          messageBody:  task.message_body,
          mediaPath:    task.media_path  || undefined,
          mediaType:    task.media_type  || undefined,
          delaySec:     15,
          campaignId:   null,
          campaignName: task.name,
        });

      // ── Path B: task is linked to a campaign (legacy style) ───────────────
      } else if (task.campaign_id) {
        const campaign = this._db.campaignGet(task.campaign_id);
        if (!campaign) {
          console.warn(`[Scheduler] Campaign ${task.campaign_id} not found, skipping.`);
          this._db.taskBumpRun(task.id, this._nextRun(task.cron_expr));
          return;
        }

        const contacts = this._db.contactList({ label: campaign.name })
          .filter(c => c.opt_in)
          .map(c => c.phone);

        if (contacts.length === 0) {
          console.warn(`[Scheduler] No recipients for campaign ${campaign.name}`);
          this._db.taskBumpRun(task.id, this._nextRun(task.cron_expr));
          return;
        }

        this._db.campaignUpdateStatus(campaign.id, 'running', { sent: 0, failed: 0 });
        await this._adapter.sendBulk({
          accountIds:   campaign.account_id ? [campaign.account_id] : [],
          recipients:   contacts,
          messageBody:  campaign.message_body,
          mediaPath:    campaign.media_path  || undefined,
          mediaType:    campaign.media_type  || undefined,
          delaySec:     campaign.delay_sec   || 5,
          campaignId:   campaign.id,
          campaignName: campaign.name,
        });

      } else {
        console.warn(`[Scheduler] Task ${task.name} has no message_body or campaign_id — skipping.`);
      }

      this._db.taskBumpRun(task.id, this._nextRun(task.cron_expr));
      console.log(`[Scheduler] Task complete: ${task.name}`);
    } catch (err) {
      console.error(`[Scheduler] Task error (${task.name}):`, err.message);
    }
  }

  // ─── Resolve recipients from task config ──────────────────────────────────
  async _resolveRecipients(task) {
    const type = task.recipients_type || 'all';

    if (type === 'manual') {
      // recipients_json is a JSON array of phone numbers
      try {
        const phones = JSON.parse(task.recipients_json || '[]');
        return Array.isArray(phones) ? phones.filter(Boolean) : [];
      } catch (_) { return []; }
    }

    if (type === 'label') {
      // recipients_json holds the label name
      const label = task.recipients_json || '';
      return this._db.contactList({ label })
        .filter(c => c.opt_in)
        .map(c => c.phone);
    }

    // 'all' — all opted-in contacts
    return this._db.contactList({})
      .filter(c => c.opt_in)
      .map(c => c.phone);
  }

  // ─── Next run — computed from cron expression ─────────────────────────────
  _nextRun(expr) {
    try {
      const parts = expr.trim().split(/\s+/);
      if (parts.length < 5) return null;
      const [minExpr, hourExpr, domExpr, monExpr, dowExpr] = parts;

      const matches = (val, ex) => {
        if (ex === '*') return true;
        return ex.split(',').some(part => {
          if (part.includes('/')) {
            const [, step] = part.split('/');
            return val % parseInt(step, 10) === 0;
          }
          if (part.includes('-')) {
            const [lo, hi] = part.split('-').map(Number);
            return val >= lo && val <= hi;
          }
          return parseInt(part, 10) === val;
        });
      };

      const d = new Date();
      d.setSeconds(0, 0);
      d.setMinutes(d.getMinutes() + 1);

      for (let i = 0; i < 525960; i++) {
        if (
          matches(d.getMonth() + 1, monExpr) &&
          matches(d.getDate(),      domExpr) &&
          matches(d.getDay(),       dowExpr) &&
          matches(d.getHours(),     hourExpr) &&
          matches(d.getMinutes(),   minExpr)
        ) {
          return d.toISOString();
        }
        d.setMinutes(d.getMinutes() + 1);
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  // ─── Cron expression helpers ──────────────────────────────────────────────
  static validate(expr)   { return cron.validate(expr); }

  static presets() {
    return [
      { label: 'كل يوم الساعة 9 صباحاً',      value: '0 9 * * *'    },
      { label: 'كل يوم الساعة 12 ظهراً',      value: '0 12 * * *'   },
      { label: 'كل يوم الساعة 6 مساءً',       value: '0 18 * * *'   },
      { label: 'الأحد–الخميس الساعة 9 صباحاً', value: '0 9 * * 0-4'  },
      { label: 'كل أحد الساعة 10 صباحاً',     value: '0 10 * * 0'   },
      { label: 'أول كل شهر الساعة 9 صباحاً',  value: '0 9 1 * *'    },
      { label: 'كل ساعة',                     value: '0 * * * *'    },
      { label: 'كل 30 دقيقة',                 value: '*/30 * * * *' },
    ];
  }
}

module.exports = Scheduler;
