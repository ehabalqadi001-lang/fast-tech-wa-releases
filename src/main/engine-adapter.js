'use strict';

/**
 * Fast Tech WA Manager — Engine Adapter
 *
 * Unified interface that routes all sending operations to either:
 *   - WhatsApp Business Cloud API  (waApi)  — official Meta REST API
 *   - whatsapp-web.js + SendingEngine       — browser-automation sessions
 *
 * Setting key:  active_engine = 'cloud' | 'web' | 'auto'
 * 'auto' resolves at call time: cloud if active accounts exist, else web.
 */

const path   = require('path');
const { v4: uuidv4 } = require('uuid');

const MEDIA_TYPES = {
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image',
  mp4: 'video', '3gp': 'video',
  mp3: 'audio', ogg: 'audio', aac: 'audio', amr: 'audio',
};

class EngineAdapter {
  /**
   * @param {import('./database')}               db
   * @param {import('./whatsapp-api')}            waApi
   * @param {import('./whatsapp-web-service')}    waSvc
   * @param {import('./sending-engine')}          engine
   */
  constructor(db, waApi, waSvc, engine) {
    this._db     = db;
    this._waApi  = waApi;
    this._waSvc  = waSvc;
    this._engine = engine;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ENGINE STATE
  // ═══════════════════════════════════════════════════════════════════════════

  /** Return current resolved engine mode. */
  getMode() {
    const setting = this._db.settingGet('active_engine') || 'auto';
    if (setting === 'cloud') return 'cloud';
    if (setting === 'web')   return 'web';

    // auto: prefer web (no Meta dependency) → cloud → none
    if (this.isWebAvailable())   return 'web';
    if (this.isCloudAvailable()) return 'cloud';
    return 'none';
  }

  isCloudAvailable() {
    return this._db.accountList().filter(a => a.active).length > 0;
  }

  isWebAvailable() {
    const sessions = this._waSvc?.getActiveSessions?.() || [];
    return sessions.some(s => this._waSvc?.isReady(s.id));
  }

  /** Full status snapshot used by UI. */
  status() {
    const sessions = this._waSvc?.getActiveSessions?.() || [];
    return {
      mode:           this.getMode(),
      setting:        this._db.settingGet('active_engine') || 'auto',
      cloudAvailable: this.isCloudAvailable(),
      webAvailable:   this.isWebAvailable(),
      cloudAccounts:  this._db.accountList().filter(a => a.active).length,
      webSessions:    sessions.filter(s => s.state === 'ready' || s.active).length,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEND — SINGLE TEXT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @param {string} to          — recipient phone (digits only)
   * @param {string} body        — message text
   * @param {Object} [opts]
   * @param {string} [opts.engine]    — override engine: 'cloud'|'web'
   * @param {string} [opts.accountId] — pin to specific Cloud account
   * @param {string} [opts.sessionId] — pin to specific Web session
   */
  async sendText(to, body, opts = {}) {
    const mode = opts.engine || this.getMode();

    if (mode === 'cloud') {
      const accountId = opts.accountId || this._defaultCloudAccount();
      return this._waApi.sendText(accountId, to, body);
    }

    if (mode === 'web') {
      const sessionId = opts.sessionId || this._defaultWebSession();
      if (!sessionId) throw new Error('لا توجد جلسة Web نشطة. يرجى بدء جلسة أولاً.');
      return this._waSvc.sendText(sessionId, to, body);
    }

    throw new Error('لا يوجد محرك إرسال متاح. أضف حساب Cloud API أو ابدأ جلسة Web.');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEND — SINGLE MEDIA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @param {string} to
   * @param {string} filePath — absolute path on disk
   * @param {string} [caption]
   * @param {Object} [opts]
   */
  async sendMedia(to, filePath, caption = '', opts = {}) {
    const mode = opts.engine || this.getMode();

    if (mode === 'cloud') {
      const accountId = opts.accountId || this._defaultCloudAccount();
      const uploaded  = await this._waApi.uploadMedia(accountId, filePath);
      const ext       = path.extname(filePath).slice(1).toLowerCase();
      const mediaType = MEDIA_TYPES[ext] || 'document';
      return this._waApi.sendMedia(accountId, to, uploaded.id, mediaType, caption);
    }

    if (mode === 'web') {
      const sessionId = opts.sessionId || this._defaultWebSession();
      if (!sessionId) throw new Error('لا توجد جلسة Web نشطة.');
      return this._waSvc.sendMedia(sessionId, to, filePath, caption);
    }

    throw new Error('لا يوجد محرك إرسال متاح.');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEND — BULK CAMPAIGN
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * @param {Object} opts
   * @param {string[]} opts.recipients
   * @param {string}   opts.messageBody
   * @param {string}   [opts.mediaPath]
   * @param {string}   [opts.mediaType]
   * @param {number}   [opts.delaySec]       — seconds (Cloud API direct)
   * @param {number}   [opts.delayMin]       — ms min (Web queue)
   * @param {number}   [opts.delayMax]       — ms max (Web queue)
   * @param {string}   [opts.campaignId]
   * @param {string}   [opts.campaignName]
   * @param {string[]} [opts.accountIds]     — Cloud account IDs
   * @param {string}   [opts.sessionId]      — Web session ID
   * @param {string[]} [opts.scripts]        — message variants (Web A/B)
   * @param {string}   [opts.engine]         — override
   * @param {Function} [opts.onProgress]     — (sent, total, status) callback (Cloud)
   */
  async sendBulk(opts) {
    const mode = opts.engine || this.getMode();

    if (mode === 'cloud') {
      return this._waApi.sendBulk(opts);
    }

    if (mode === 'web') {
      if (!this._engine) throw new Error('محرك الإرسال Web غير متاح.');
      const campaignId = opts.campaignId || uuidv4();

      if (!this._db.campaignGet(campaignId)) {
        this._db.campaignCreate({
          id:           campaignId,
          name:         opts.campaignName || `حملة ${new Date().toLocaleDateString('ar')}`,
          type:         'individual',
          account_id:   opts.sessionId || null,
          message_body: opts.messageBody || (opts.scripts?.[0] || ''),
          media_path:   opts.mediaPath || null,
          media_type:   opts.mediaType || null,
          delay_sec:    Math.round((opts.delayMin || 15000) / 1000),
          total:        opts.recipients?.length || 0,
        });
        this._db.campaignUpdateStatus(campaignId, 'running', { sent: 0, failed: 0 });
      }

      const items = (opts.recipients || []).map(r => ({
        recipient:   r,
        body:        opts.messageBody || null,
        scripts:     opts.scripts     || [],
        sessionId:   opts.sessionId   || null,
        campaignId,
        mediaPath:   opts.mediaPath   || null,
        delayMin:    opts.delayMin    ?? 15000,
        delayMax:    opts.delayMax    ?? 45000,
      }));

      this._engine.enqueue(items);
      return { sent: 0, failed: 0, total: items.length, queued: items.length, campaignId };
    }

    throw new Error('لا يوجد محرك إرسال متاح. أضف حساب Cloud API أو ابدأ جلسة Web.');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  _defaultCloudAccount() {
    const accounts = this._db.accountList().filter(a => a.active);
    if (!accounts.length) throw new Error('لا يوجد حساب Cloud API نشط. أضف حساباً من صفحة الحسابات.');
    accounts.sort((a, b) => (a.msg_count || 0) - (b.msg_count || 0));
    return accounts[0].id;
  }

  _defaultWebSession() {
    const sessions = this._waSvc?.getActiveSessions?.() || [];
    const ready = sessions.filter(s => this._waSvc?.isReady(s.id));
    if (!ready.length) return null;
    ready.sort((a, b) => (a.msg_count || 0) - (b.msg_count || 0));
    return ready[0].id;
  }
}

module.exports = EngineAdapter;
