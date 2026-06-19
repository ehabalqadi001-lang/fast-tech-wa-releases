'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { safeStorage } = require('electron');
const ENC_PREFIX = 'ENC:';
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
        this._db = db;
    }
    _canEncrypt() {
        try {
            return safeStorage.isEncryptionAvailable();
        }
        catch {
            return false;
        }
    }
    set(key, value) {
        if (!value) {
            this._db.settingSet(key, '');
            return;
        }
        if (this._canEncrypt()) {
            const buf = safeStorage.encryptString(String(value));
            this._db.settingSet(key, ENC_PREFIX + buf.toString('base64'));
        }
        else {
            this._db.settingSet(key, String(value));
        }
    }
    get(key) {
        const raw = this._db.settingGet(key);
        if (!raw)
            return '';
        if (raw.startsWith(ENC_PREFIX)) {
            try {
                const buf = Buffer.from(raw.slice(ENC_PREFIX.length), 'base64');
                return safeStorage.decryptString(buf);
            }
            catch {
                return '';
            }
        }
        return raw;
    }
    migrateExisting() {
        if (!this._canEncrypt())
            return;
        for (const key of SENSITIVE_KEYS) {
            const raw = this._db.settingGet(key);
            if (raw && !raw.startsWith(ENC_PREFIX)) {
                this.set(key, raw);
            }
        }
    }
    isSensitive(key) {
        return SENSITIVE_KEYS.has(key);
    }
    mask(key) {
        const val = this.get(key);
        if (!val)
            return '';
        if (val.length <= 4)
            return '****';
        return '****' + val.slice(-4);
    }
}
exports.default = SecureStore;
module.exports = SecureStore;
