'use strict';

const { safeStorage } = require('electron');

const ENC_PREFIX = 'ENC:';

const SENSITIVE_KEYS = new Set<string>([
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
  private _db: any;

  constructor(db: any) {
    this._db = db;
  }

  private _canEncrypt(): boolean {
    try { return safeStorage.isEncryptionAvailable(); }
    catch { return false; }
  }

  set(key: string, value: string): void {
    if (!value) { this._db.settingSet(key, ''); return; }
    if (this._canEncrypt()) {
      const buf = safeStorage.encryptString(String(value));
      this._db.settingSet(key, ENC_PREFIX + buf.toString('base64'));
    } else {
      this._db.settingSet(key, String(value));
    }
  }

  get(key: string): string {
    const raw: string = this._db.settingGet(key);
    if (!raw) return '';
    if (raw.startsWith(ENC_PREFIX)) {
      try {
        const buf = Buffer.from(raw.slice(ENC_PREFIX.length), 'base64');
        return safeStorage.decryptString(buf);
      } catch {
        return '';
      }
    }
    return raw;
  }

  migrateExisting(): void {
    if (!this._canEncrypt()) return;
    for (const key of SENSITIVE_KEYS) {
      const raw = this._db.settingGet(key);
      if (raw && !raw.startsWith(ENC_PREFIX)) {
        this.set(key, raw);
      }
    }
  }

  isSensitive(key: string): boolean {
    return SENSITIVE_KEYS.has(key);
  }

  mask(key: string): string {
    const val = this.get(key);
    if (!val) return '';
    if (val.length <= 4) return '****';
    return '****' + val.slice(-4);
  }
}

export default SecureStore;
module.exports = SecureStore;
