'use strict';
// secure-store.js — encrypt sensitive settings using Electron safeStorage
// Encrypted values stored in the settings table as base64 with prefix "ENC:"
// Falls back to plaintext if safeStorage is unavailable (CI / headless Linux)

const { safeStorage } = require('electron');

const ENC_PREFIX = 'ENC:';

// Keys that should always be stored encrypted
const SENSITIVE_KEYS = new Set([
  'ai_gemini_key',
  'ai_claude_key',
  'dev_api_key',
  'webhook_verify_token',
  'crm_hubspot_key',
  'crm_pipedrive_key',
  'crm_airtable_key',
  'crm_webhook_secret',
]);

class SecureStore {
  constructor(db) {
    this._db = db; // Database instance (has settingGet / settingSet)
  }

  _canEncrypt() {
    try { return safeStorage.isEncryptionAvailable(); }
    catch { return false; }
  }

  set(key, value) {
    if (!value) { this._db.settingSet(key, ''); return; }
    if (this._canEncrypt()) {
      const buf = safeStorage.encryptString(String(value));
      this._db.settingSet(key, ENC_PREFIX + buf.toString('base64'));
    } else {
      this._db.settingSet(key, String(value));
    }
  }

  get(key) {
    const raw = this._db.settingGet(key);
    if (!raw) return '';
    if (raw.startsWith(ENC_PREFIX)) {
      try {
        const buf = Buffer.from(raw.slice(ENC_PREFIX.length), 'base64');
        return safeStorage.decryptString(buf);
      } catch {
        return ''; // corrupted / different machine key
      }
    }
    return raw; // plaintext fallback
  }

  // Migrate all known plaintext sensitive values to encrypted form
  migrateExisting() {
    if (!this._canEncrypt()) return;
    for (const key of SENSITIVE_KEYS) {
      const raw = this._db.settingGet(key);
      if (raw && !raw.startsWith(ENC_PREFIX)) {
        this.set(key, raw); // re-save encrypted
      }
    }
  }

  isSensitive(key) {
    return SENSITIVE_KEYS.has(key);
  }

  // Return masked display value (last 4 chars visible)
  mask(key) {
    const val = this.get(key);
    if (!val) return '';
    if (val.length <= 4) return '****';
    return '****' + val.slice(-4);
  }
}

module.exports = SecureStore;
