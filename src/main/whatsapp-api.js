'use strict';

/**
 * Fast Tech WA Manager — WhatsApp Business Cloud API Service
 * Wraps Meta's official REST API (v19.0)
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api
 */

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');
const FormData = require('form-data');

const BASE = 'https://graph.facebook.com/v21.0';

class WaApi {
  constructor(db) {
    this._db = db;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  _client(token) {
    return axios.create({
      baseURL: BASE,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
  }

  _acct(id) {
    const a = this._db.accountGet(id);
    if (!a) throw new Error(`Account not found: ${id}`);
    if (!a.active) throw new Error(`Account is disabled: ${a.name}`);
    return a;
  }

  // normalize phone: strip non-digits, ensure no leading +
  _phone(raw) { return String(raw).replace(/\D/g, ''); }

  // ─── Account verification ─────────────────────────────────────────────────
  async testAccount(accountId) {
    const a = this._acct(accountId);
    const cli = this._client(a.token);
    try {
      const res = await cli.get(`/${a.phone_id}/`);
      return { ok: true, data: res.data };
    } catch (err) {
      return { ok: false, error: this._extractError(err) };
    }
  }

  async getAccountInfo(accountId) {
    const a = this._acct(accountId);
    const cli = this._client(a.token);
    const res = await cli.get(`/${a.biz_acct_id}?fields=name,timezone_id,message_template_namespace`);
    return res.data;
  }

  // ─── Send text message ────────────────────────────────────────────────────
  async sendText(accountId, to, text, previewUrl = false) {
    const a   = this._acct(accountId);
    const cli = this._client(a.token);
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: this._phone(to),
      type: 'text',
      text: { body: text, preview_url: previewUrl },
    };
    const res = await cli.post(`/${a.phone_id}/messages`, payload);
    this._db.accountBumpUsage(accountId);
    return res.data;                           // { messages: [{ id }] }
  }

  // ─── Send template message ────────────────────────────────────────────────
  async sendTemplate(accountId, to, templateName, langCode, components = []) {
    const a   = this._acct(accountId);
    const cli = this._client(a.token);
    const payload = {
      messaging_product: 'whatsapp',
      to: this._phone(to),
      type: 'template',
      template: { name: templateName, language: { code: langCode }, components },
    };
    const res = await cli.post(`/${a.phone_id}/messages`, payload);
    this._db.accountBumpUsage(accountId);
    return res.data;
  }

  // ─── Send media message ───────────────────────────────────────────────────
  async sendMedia(accountId, to, mediaId, mediaType, caption = '') {
    const a   = this._acct(accountId);
    const cli = this._client(a.token);
    const typeKey = mediaType;   // image | video | document | audio
    const mediaObj = { id: mediaId };
    if (caption && ['image','video','document'].includes(mediaType)) mediaObj.caption = caption;
    const payload = {
      messaging_product: 'whatsapp',
      to: this._phone(to),
      type: typeKey,
      [typeKey]: mediaObj,
    };
    const res = await cli.post(`/${a.phone_id}/messages`, payload);
    this._db.accountBumpUsage(accountId);
    return res.data;
  }

  // ─── Upload media file ────────────────────────────────────────────────────
  async uploadMedia(accountId, filePath) {
    const a = this._acct(accountId);
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const ext  = path.extname(filePath).toLowerCase().slice(1);
    const mime = this._mime(ext);
    const fd   = new FormData();
    fd.append('messaging_product', 'whatsapp');
    fd.append('type', mime);
    fd.append('file', fs.createReadStream(filePath), {
      filename: path.basename(filePath),
      contentType: mime,
    });

    const res = await axios.post(`${BASE}/${a.phone_id}/media`, fd, {
      headers: { ...fd.getHeaders(), Authorization: `Bearer ${a.token}` },
      timeout: 60000,
    });
    return res.data;   // { id }
  }

  // ─── Get approved templates ───────────────────────────────────────────────
  async getTemplates(accountId) {
    const a   = this._acct(accountId);
    const cli = this._client(a.token);
    const res = await cli.get(`/${a.biz_acct_id}/message_templates?fields=name,status,language,category,components&limit=100`);
    return res.data.data || [];
  }

  // ─── Mark message as read ─────────────────────────────────────────────────
  async markRead(accountId, msgId) {
    const a   = this._acct(accountId);
    const cli = this._client(a.token);
    await cli.post(`/${a.phone_id}/messages`, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: msgId,
    });
  }

  // ─── Bulk send with delay & round-robin ──────────────────────────────────
  /**
   * @param {Object} opts
   * @param {string[]} opts.accountIds   - ordered list; 'auto' uses all active
   * @param {string[]} opts.recipients   - phone numbers
   * @param {string}   opts.messageBody  - text body (supports {{name}} placeholder)
   * @param {string}   [opts.mediaPath]  - local file to attach
   * @param {string}   [opts.mediaType]  - image|video|document
   * @param {number}   [opts.delaySec]   - seconds between messages (default: 5)
   * @param {string}   [opts.campaignId]
   * @param {Function} [opts.onProgress] - (sent, total, lastStatus) callback
   */
  async sendBulk(opts) {
    const { v4: uuidv4 } = require('uuid');
    const {
      accountIds = [],
      recipients = [],
      messageBody = '',
      mediaPath,
      mediaType,
      delaySec = 5,
      campaignId,
      onProgress,
    } = opts;

    // Resolve accounts
    let accounts = accountIds.length
      ? accountIds.map(id => this._db.accountGet(id)).filter(Boolean)
      : this._db.accountList().filter(a => a.active);

    if (!accounts.length) throw new Error('No active accounts available');

    let rrIndex = 0;
    let sent = 0, failed = 0;
    const total = recipients.length;
    let uploadedMediaId = null;

    // Pre-upload media once if provided
    if (mediaPath && mediaType) {
      try {
        const firstAcct = accounts[0];
        const upRes = await this.uploadMedia(firstAcct.id, mediaPath);
        uploadedMediaId = upRes.id;
      } catch (e) {
        console.warn('[WA] Media upload failed, sending text only:', e.message);
      }
    }

    for (let i = 0; i < recipients.length; i++) {
      const phone  = this._phone(recipients[i]);
      const acct   = accounts[rrIndex % accounts.length];
      rrIndex++;

      const msgId  = uuidv4();
      const body   = messageBody; // could interpolate contact name here if passed
      let waId     = null;
      let status   = 'sent';
      let errMsg   = null;

      try {
        let res;
        if (uploadedMediaId) {
          res = await this.sendMedia(acct.id, phone, uploadedMediaId, mediaType, body);
        } else {
          res = await this.sendText(acct.id, phone, body);
        }
        waId = res?.messages?.[0]?.id || null;
        sent++;
      } catch (err) {
        status = 'failed';
        errMsg = this._extractError(err);
        failed++;
        console.error(`[WA] Failed to send to ${phone}:`, errMsg);
      }

      // Log to DB
      if (campaignId) {
        this._db.messageCreate({
          id: msgId, campaign_id: campaignId, account_id: acct.id,
          recipient: phone, direction: 'out', body,
          media_url: uploadedMediaId ? `media:${uploadedMediaId}` : null,
          wa_msg_id: waId, status,
        });
        if (status === 'failed' || status === 'sent') {
          this._db.campaignUpdateStatus(campaignId, 'running', { sent, failed });
        }
      }

      onProgress?.(sent + failed, total, status);

      // Delay (skip after last)
      if (i < recipients.length - 1 && delaySec > 0) {
        await this._sleep(delaySec * 1000);
      }
    }

    if (campaignId) {
      this._db.campaignUpdateStatus(campaignId, 'done', { sent, failed });
    }

    return { sent, failed, total };
  }

  // ─── Webhook payload parser ───────────────────────────────────────────────
  /**
   * Parse incoming webhook notification from Meta and return normalized events.
   * @param {Object} body  — raw webhook body
   * @returns {Array}      — array of { type, from, msgId, text, timestamp }
   */
  static parseWebhook(body) {
    const events = [];
    try {
      const entries = body.entry || [];
      for (const entry of entries) {
        for (const change of entry.changes || []) {
          const val = change.value || {};
          for (const msg of val.messages || []) {
            events.push({
              type:      msg.type,
              from:      msg.from,
              msgId:     msg.id,
              text:      msg.text?.body || '',
              timestamp: msg.timestamp,
            });
          }
          for (const status of val.statuses || []) {
            events.push({
              type:      'status_update',
              msgId:     status.id,
              recipient: status.recipient_id,
              status:    status.status,   // sent | delivered | read | failed
              timestamp: status.timestamp,
            });
          }
        }
      }
    } catch (_) { /* ignore parse errors */ }
    return events;
  }

  // ─── Utilities ────────────────────────────────────────────────────────────
  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  _extractError(err) {
    if (err.response?.data?.error?.message) return err.response.data.error.message;
    if (err.response?.data?.error)          return JSON.stringify(err.response.data.error);
    return err.message || String(err);
  }

  _mime(ext) {
    const map = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
      webp: 'image/webp', gif: 'image/gif',
      mp4: 'video/mp4', '3gp': 'video/3gpp',
      pdf: 'application/pdf', doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xls: 'application/vnd.ms-excel',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      mp3: 'audio/mpeg', ogg: 'audio/ogg', aac: 'audio/aac', amr: 'audio/amr',
    };
    return map[ext] || 'application/octet-stream';
  }
}

module.exports = WaApi;
