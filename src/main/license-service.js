'use strict';

const WatermarkService = require('./watermark-service');

/**
 * FAST TECH — License Service
 *
 * Backend: Keygen.sh — hosted license management API.
 *
 * Key rules (Keygen API):
 *  - validate-key  → NO Authorization header (unauthenticated)
 *  - machines POST → Authorization: License {key}
 *  - machines DEL  → Authorization: License {key}
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const os     = require('os');

const { getMachineId, getMachineIdShort } = require('./machine-id');
const cfg = require('./license-config');

const ENC_SALT = 'FT-WA-NEXUS-2024-SECURE';

class LicenseService {
  constructor(dataDir) {
    this._dataDir   = dataDir;
    this._licFile   = path.join(dataDir, 'license.dat');
    this._machineId = getMachineId();
    this._encKey    = crypto.createHash('sha256')
      .update(this._machineId + ENC_SALT)
      .digest();
    this._cached = null;
    this._wm     = new WatermarkService();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ENCRYPTION
  // ══════════════════════════════════════════════════════════════════════════

  _encrypt(obj) {
    const iv     = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._encKey, iv);
    const plain  = Buffer.from(JSON.stringify(obj), 'utf8');
    const enc    = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag    = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  _decrypt(str) {
    const buf    = Buffer.from(str, 'base64');
    const iv     = buf.slice(0, 16);
    const tag    = buf.slice(16, 32);
    const enc    = buf.slice(32);
    const dc     = crypto.createDecipheriv('aes-256-gcm', this._encKey, iv);
    dc.setAuthTag(tag);
    return JSON.parse(Buffer.concat([dc.update(enc), dc.final()]).toString('utf8'));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LOCAL STORAGE
  // ══════════════════════════════════════════════════════════════════════════

  _save(data) {
    this._cached = data;
    fs.writeFileSync(this._licFile, this._encrypt(data), 'utf8');
  }

  _load() {
    if (this._cached) return this._cached;
    if (!fs.existsSync(this._licFile)) return null;
    try {
      this._cached = this._decrypt(fs.readFileSync(this._licFile, 'utf8'));
      return this._cached;
    } catch (_) { return null; }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HTTP HELPER
  // ══════════════════════════════════════════════════════════════════════════

  _request(method, endpoint, body, licenseKey) {
    return new Promise((resolve, reject) => {
      const postData = body ? JSON.stringify(body) : null;
      const headers  = {
        'Content-Type':   'application/vnd.api+json',
        'Accept':         'application/vnd.api+json',
        'Keygen-Version': '1.3',
      };
      // Only add Authorization header when a license key is explicitly provided
      if (licenseKey) headers['Authorization'] = `License ${licenseKey}`;
      if (postData)   headers['Content-Length'] = Buffer.byteLength(postData);

      const opts = {
        hostname: 'api.keygen.sh',
        port:     443,
        path:     `/v1/accounts/${cfg.KEYGEN_ACCOUNT_ID}${endpoint}`,
        method,
        headers,
        timeout:  15000,
      };

      const req = https.request(opts, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch (_) { resolve({ status: res.statusCode, body: {} }); }
        });
      });
      req.on('error',   err => reject(err));
      req.on('timeout', ()  => { req.destroy(); reject(new Error('timeout')); });
      if (postData) req.write(postData);
      req.end();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // KEYGEN API CALLS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Validate a license key.
   * IMPORTANT: Must be called WITHOUT Authorization header (unauthenticated).
   * Optionally scope to this machine's fingerprint.
   */
  _apiValidate(key, scopeMachine = false) {
    const body = { meta: { key } };
    if (scopeMachine) body.meta.scope = { fingerprint: this._machineId };
    // Pass null as licenseKey so no Authorization header is sent
    return this._request('POST', '/licenses/actions/validate-key', body, null);
  }

  /**
   * Register this machine against a license.
   * Requires: Authorization: License {key}
   */
  _apiActivateMachine(licenseId, key) {
    return this._request('POST', '/machines', {
      data: {
        type: 'machines',
        attributes: {
          fingerprint: this._machineId,
          name:        os.hostname().slice(0, 64),
          platform:    'windows',
          hostname:    os.hostname().slice(0, 64),
        },
        relationships: {
          license: { data: { type: 'licenses', id: licenseId } },
        },
      },
    }, key);  // license key as auth
  }

  /**
   * Remove all machines from a license (reset for re-activation elsewhere).
   */
  _apiResetMachines(licenseId, key) {
    return this._request('DELETE', `/licenses/${licenseId}/actions/reset-machines`, null, key);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC — ACTIVATE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Activate a license key on this machine.
   *
   * Flow:
   *  1. Validate WITH fingerprint scope (Keygen may require it via policy)
   *  2. If NO_MACHINES  → register this machine → re-validate
   *  3. If VALID        → already registered (re-activation) → just save
   *  4. Save encrypted license data locally
   */
  async activate(key) {
    if (!key || typeof key !== 'string' || key.trim().length < 4) {
      return { success: false, message: 'الرجاء إدخال مفتاح الترخيص' };
    }
    const cleanKey = key.trim().toUpperCase();

    // ── Step 1: Validate WITH machine fingerprint scope ───────────────────
    let res;
    try {
      res = await this._apiValidate(cleanKey, true);   // always include fingerprint
    } catch (err) {
      return { success: false, message: 'فشل الاتصال بالسيرفر — تحقق من الإنترنت وأعد المحاولة' };
    }

    if (res.status !== 200) {
      return { success: false, message: `خطأ في الاتصال بالسيرفر (${res.status})` };
    }

    let meta    = res.body?.meta;
    let licData = res.body?.data;
    let code    = meta?.code || '';

    console.log(`[License] validate step1: status=${res.status} code=${code} valid=${meta?.valid}`);

    // ── Handle result from Step 1 ─────────────────────────────────────────

    // Already valid — this machine was already registered (re-activation scenario)
    if (meta?.valid) {
      return this._saveAndReturn(cleanKey, licData);
    }

    // Machine not registered yet → register then re-validate
    if (code === 'NO_MACHINES') {
      if (!licData?.id) {
        return { success: false, message: 'فشل الحصول على بيانات الترخيص — تواصل مع الدعم' };
      }

      // Register this machine
      const regResult = await this._registerMachine(licData.id, cleanKey);
      if (!regResult.ok) return { success: false, message: regResult.message };

      // Re-validate to confirm registration
      try {
        const res2 = await this._apiValidate(cleanKey, true);
        meta    = res2.body?.meta;
        licData = res2.body?.data;
        code    = meta?.code || '';
        console.log(`[License] validate step2: status=${res2.status} code=${code} valid=${meta?.valid}`);
      } catch (_) { /* use previous data — registration succeeded */ }

      if (meta?.valid) {
        return this._saveAndReturn(cleanKey, licData);
      }
      // After registration, still not valid?
      return { success: false, message: `فشل التفعيل بعد تسجيل الجهاز (${code}) — تواصل مع الدعم` };
    }

    // Machine registered but this fingerprint doesn't match (used on another device)
    if (code === 'FINGERPRINT_SCOPE_MISMATCH') {
      return { success: false, message: 'هذا المفتاح مفعّل على جهاز آخر — تواصل مع الدعم لنقل الترخيص' };
    }

    // Other key-level errors
    const errorMsgs = {
      NOT_FOUND:                'مفتاح الترخيص غير موجود — تأكد من النسخ بشكل صحيح',
      EXPIRED:                  'انتهت صلاحية مفتاح الترخيص — تواصل مع الدعم للتجديد',
      SUSPENDED:                'تم تعليق هذا الترخيص — تواصل مع الدعم',
      REVOKED:                  'تم إلغاء هذا الترخيص',
      TOO_MANY_MACHINES:        'تم تجاوز الحد الأقصى للأجهزة — تواصل مع الدعم',
      OVERDUE:                  'الترخيص متأخر في التجديد — تواصل مع الدعم',
      FINGERPRINT_SCOPE_REQUIRED: 'خطأ في إعداد السيرفر — تواصل مع الدعم (FINGERPRINT_SCOPE_REQUIRED)',
    };
    return { success: false, message: errorMsgs[code] || `مفتاح غير صالح (${code})` };
  }

  // ── Internal helpers for activate() ──────────────────────────────────────

  async _registerMachine(licenseId, key) {
    try {
      const machRes  = await this._apiActivateMachine(licenseId, key);
      const machCode = machRes.body?.errors?.[0]?.code || '';
      console.log(`[License] register-machine status=${machRes.status} code=${machCode}`);

      if (machRes.status === 201 || machRes.status === 200) return { ok: true };
      if (machCode === 'MACHINE_FINGERPRINT_TAKEN')        return { ok: true }; // already registered

      const msgs = {
        TOO_MANY_MACHINES: 'تم تجاوز الحد الأقصى للأجهزة — تواصل مع الدعم لإلغاء جهاز آخر',
        LICENSE_NOT_FOUND: 'مفتاح الترخيص غير موجود',
        LICENSE_SUSPENDED: 'الترخيص موقوف — تواصل مع الدعم',
      };
      return { ok: false, message: msgs[machCode] || `فشل تسجيل الجهاز (${machCode || machRes.status})` };
    } catch (err) {
      return { ok: false, message: 'فشل الاتصال أثناء تسجيل الجهاز — تحقق من الإنترنت' };
    }
  }

  _saveAndReturn(key, licData) {
    const attrs  = licData?.attributes || {};
    const meta   = attrs.metadata || {};
    const stored = {
      licenseKey:      key,
      licenseId:       licData?.id || '',
      machineId:       this._machineId,
      expiry:          attrs.expiry || null,
      activatedAt:     new Date().toISOString(),
      lastOnline:      new Date().toISOString(),
      nextOnlineCheck: Date.now() + cfg.ONLINE_CHECK_INTERVAL_MS,
    };
    this._save(stored);
    console.log('[License] Saved locally — licenseId:', stored.licenseId);

    // Embed watermark — silent on failure (runs in background, non-blocking)
    const email = meta.email || meta.userEmail || meta.customer_email || '';
    setImmediate(() => {
      try { this._wm.embed({ id: stored.licenseId, email }); } catch (_) {}
    });

    return { success: true, message: 'تم تفعيل الترخيص بنجاح! 🎉', data: stored };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC — CHECK (startup validation)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Check license on every startup.
   * Returns: { valid, grace?, graceLeft?, expiry?, ... }
   */
  async check() {
    const stored = this._load();
    const now    = Date.now();

    if (!stored) return { valid: false, reason: 'not_activated' };

    if (stored.machineId !== this._machineId) {
      return { valid: false, reason: 'machine_mismatch' };
    }

    if (stored.expiry && new Date(stored.expiry).getTime() < now) {
      return { valid: false, reason: 'expired', expiry: stored.expiry };
    }

    // Skip online check if not yet due
    if (stored.nextOnlineCheck && now < stored.nextOnlineCheck) {
      return this._buildValidResult(stored);
    }

    // Online re-validation (with machine scope)
    try {
      const res  = await this._apiValidate(stored.licenseKey, true);
      const meta = res.body?.meta;
      const data = res.body?.data;

      console.log(`[License] check status=${res.status} code=${meta?.code} valid=${meta?.valid}`);

      if (res.status === 200 && meta?.valid) {
        const updated = {
          ...stored,
          expiry:          data?.attributes?.expiry || meta.expiry || stored.expiry,
          nextOnlineCheck: now + cfg.ONLINE_CHECK_INTERVAL_MS,
          lastOnline:      new Date().toISOString(),
        };
        this._save(updated);
        return this._buildValidResult(updated);
      }

      const code = meta?.code || '';
      if (code === 'FINGERPRINT_SCOPE_MISMATCH') return { valid: false, reason: 'machine_mismatch' };
      if (code === 'EXPIRED')                    return { valid: false, reason: 'expired', expiry: data?.attributes?.expiry };
      if (code === 'SUSPENDED')                  return { valid: false, reason: 'suspended' };
      if (code === 'REVOKED')                    return { valid: false, reason: 'revoked' };
      if (code === 'NO_MACHINES') {
        // Machine was deregistered externally — re-register
        if (stored.licenseId) {
          try { await this._apiActivateMachine(stored.licenseId, stored.licenseKey); } catch (_) {}
          const updated = { ...stored, nextOnlineCheck: now + cfg.ONLINE_CHECK_INTERVAL_MS, lastOnline: new Date().toISOString() };
          this._save(updated);
          return this._buildValidResult(updated);
        }
      }

      return this._graceFallback(stored, now);
    } catch (_) {
      // Offline — apply grace period
      return this._graceFallback(stored, now);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PUBLIC — DEACTIVATE
  // ══════════════════════════════════════════════════════════════════════════

  async deactivate() {
    const stored = this._load();
    if (!stored) return { success: false, message: 'لا يوجد ترخيص مفعّل على هذا الجهاز' };
    try { await this._apiResetMachines(stored.licenseId, stored.licenseKey); } catch (_) {}
    try { fs.unlinkSync(this._licFile); } catch (_) {}
    this._cached = null;
    return { success: true, message: 'تم إلغاء تفعيل الترخيص. يمكنك الآن تفعيله على جهاز آخر.' };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INFO HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  getLocalInfo() {
    const s = this._load();
    if (!s) return null;
    return {
      licenseKey:    s.licenseKey ? `${s.licenseKey.slice(0,4)}-****-****-${s.licenseKey.slice(-4)}` : '',
      licenseId:     s.licenseId,
      expiry:        s.expiry,
      activatedAt:   s.activatedAt,
      lastOnline:    s.lastOnline,
      machineIdShort: getMachineIdShort(),
    };
  }

  getMachineId()      { return this._machineId; }
  getMachineIdShort() { return getMachineIdShort(); }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNAL
  // ══════════════════════════════════════════════════════════════════════════

  _buildValidResult(stored) {
    const now    = Date.now();
    const result = {
      valid:       true,
      grace:       false,
      expiry:      stored.expiry,
      activatedAt: stored.activatedAt,
      lastOnline:  stored.lastOnline,
      licenseKey:  stored.licenseKey ? `${stored.licenseKey.slice(0,4)}-****-${stored.licenseKey.slice(-4)}` : '',
    };
    if (stored.expiry) {
      const daysLeft = Math.ceil((new Date(stored.expiry).getTime() - now) / 86400000);
      if (daysLeft <= cfg.EXPIRY_WARN_DAYS) {
        result.expiryWarning = true;
        result.daysLeft      = daysLeft;
      }
    }
    return result;
  }

  _graceFallback(stored, now) {
    if (!stored.lastOnline) return { valid: false, reason: 'validation_failed' };
    const graceEnd = new Date(stored.lastOnline).getTime() + cfg.GRACE_PERIOD_DAYS * 86400000;
    if (now < graceEnd) {
      return {
        valid:      true,
        grace:      true,
        graceLeft:  Math.ceil((graceEnd - now) / 86400000),
        expiry:     stored.expiry,
        lastOnline: stored.lastOnline,
      };
    }
    return { valid: false, reason: 'offline_grace_expired' };
  }
}

module.exports = LicenseService;
