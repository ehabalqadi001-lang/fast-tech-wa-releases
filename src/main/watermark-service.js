'use strict';

/**
 * FAST TECH — Watermark Service (Leak Detection)
 *
 * Embeds customer data (license ID + email) into the installed app.asar
 * after license activation. If a leaked copy is found, run:
 *   node scripts/extract-watermark.js <path/to/app.asar>
 *
 * Mechanism:
 *   1. scripts/inject-wm-slot-hook.js (afterPack) appends a 512-byte
 *      placeholder block to app.asar during build.
 *   2. This service overwrites the payload section of that block at
 *      activation time using a direct file write (no full-file load).
 *   3. AES-256-CBC with fixed key — NOT machine-tied — so any copy
 *      can be decrypted with the extraction script.
 *
 * Block layout (512 bytes, appended at end of asar):
 *   [0..7]    MAGIC  0x46 54 57 41 57 4D 56 31 ('FTWAWMV1')
 *   [8..247]  payload: base64 AES-encrypted JSON, null-padded to 240 bytes
 *   [248..511] zero padding
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

// ── Block constants ────────────────────────────────────────────────────────
const WM_MAGIC   = Buffer.from([0x46, 0x54, 0x57, 0x41, 0x57, 0x4D, 0x56, 0x31]);
const WM_TOTAL   = 512;   // total appended block size (bytes)
const WM_PAYLOAD = 240;   // bytes reserved for base64 payload

// ── AES key/IV — deterministic, NOT machine-tied ───────────────────────────
// Same on every machine so we can decrypt any leaked copy.
const _KEY = crypto.createHash('sha256')
  .update('FTWA-NEXUS-WM-MASTERKEY-2025-LEAK-DETECT')
  .digest();                               // 32 bytes
const _IV  = crypto.createHash('md5')
  .update('FTWA-NEXUS-WM-IV-2025-STATIC')
  .digest();                               // 16 bytes

// ── Encrypt / decrypt ──────────────────────────────────────────────────────
function _encrypt(obj) {
  const c = crypto.createCipheriv('aes-256-cbc', _KEY, _IV);
  return Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]).toString('base64');
}

function _decrypt(b64) {
  const d = crypto.createDecipheriv('aes-256-cbc', _KEY, _IV);
  return JSON.parse(Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString('utf8'));
}

// ── Service class ──────────────────────────────────────────────────────────
class WatermarkService {
  constructor() {
    this._asarPath = this._resolveAsar();
  }

  _resolveAsar() {
    const rp = process.resourcesPath;
    if (!rp) return null;
    const p = path.join(rp, 'app.asar');
    return fs.existsSync(p) ? p : null;
  }

  /**
   * Embed customer data into the watermark block at end of app.asar.
   * Called immediately after successful license activation.
   *
   * @param {{ id: string, email: string }} data
   * @returns {boolean}  true = embedded, false = skipped/failed
   */
  embed({ id = '', email = '' }) {
    if (!this._asarPath) {
      console.log('[WM] Dev mode — watermark embed skipped (no app.asar)');
      return false;
    }
    try {
      const payload = _encrypt({ id, email, ts: new Date().toISOString() });

      if (payload.length > WM_PAYLOAD) {
        console.error(`[WM] Payload too large: ${payload.length} > ${WM_PAYLOAD}`);
        return false;
      }

      const fileSize = fs.statSync(this._asarPath).size;
      if (fileSize < WM_TOTAL) {
        console.error('[WM] asar too small — inject-wm-slot-hook was not run');
        return false;
      }

      const wmOffset = fileSize - WM_TOTAL;
      const fd = fs.openSync(this._asarPath, 'r+');

      // Verify magic header
      const hdr = Buffer.alloc(WM_MAGIC.length);
      fs.readSync(fd, hdr, 0, WM_MAGIC.length, wmOffset);
      if (!hdr.equals(WM_MAGIC)) {
        fs.closeSync(fd);
        console.error('[WM] Magic header not found — inject-wm-slot-hook did not run on this build');
        return false;
      }

      // Write payload (zero-padded to WM_PAYLOAD bytes)
      const payBuf = Buffer.alloc(WM_PAYLOAD, 0x00);
      payBuf.write(payload, 'utf8');
      fs.writeSync(fd, payBuf, 0, WM_PAYLOAD, wmOffset + WM_MAGIC.length);
      fs.closeSync(fd);

      console.log(`[WM] Watermark embedded — id=${id} email=${email}`);
      return true;
    } catch (err) {
      console.error('[WM] Embed error:', err.message);
      return false;
    }
  }

  /** Read watermark from the current running binary. null = not embedded. */
  read() {
    return this._asarPath ? WatermarkService.readFrom(this._asarPath) : null;
  }

  /**
   * Static: read watermark from any asar file.
   * Used by scripts/extract-watermark.js.
   *
   * @param {string} asarPath
   * @returns {{ id, email, ts } | null}
   */
  static readFrom(asarPath) {
    try {
      const size = fs.statSync(asarPath).size;
      if (size < WM_TOTAL) return null;

      const wmOffset = size - WM_TOTAL;
      const fd = fs.openSync(asarPath, 'r');

      const hdr = Buffer.alloc(WM_MAGIC.length);
      fs.readSync(fd, hdr, 0, WM_MAGIC.length, wmOffset);
      if (!hdr.equals(WM_MAGIC)) { fs.closeSync(fd); return null; }

      const payBuf = Buffer.alloc(WM_PAYLOAD);
      fs.readSync(fd, payBuf, 0, WM_PAYLOAD, wmOffset + WM_MAGIC.length);
      fs.closeSync(fd);

      // Strip null padding
      const b64 = payBuf.toString('utf8').replace(/\0+$/, '');
      if (!b64) return null; // block exists but payload not yet written

      return _decrypt(b64);
    } catch (_) {
      return null;
    }
  }
}

module.exports = WatermarkService;
