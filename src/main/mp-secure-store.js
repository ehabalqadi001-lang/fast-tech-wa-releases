'use strict';
const crypto = require('crypto');
const os = require('os');

const ALGO = 'aes-256-gcm';
let _masterKey = null;

function _getMachineId() {
  return os.hostname() + '-' + os.userInfo().username;
}

function _ensureKey() {
  if (!_masterKey) {
    _masterKey = crypto.createHash('sha256').update('MP_' + _getMachineId() + '_2025').digest();
  }
}

function encrypt(text) {
  if (!text) return null;
  _ensureKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGO, _masterKey, iv);
  let enc = cipher.update(String(text), 'utf8', 'hex');
  enc += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + enc;
}

function decrypt(ciphertext) {
  if (!ciphertext) return null;
  _ensureKey();
  try {
    const [ivHex, tagHex, enc] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, _masterKey, iv);
    decipher.setAuthTag(tag);
    let dec = decipher.update(enc, 'hex', 'utf8');
    dec += decipher.final('utf8');
    return dec;
  } catch {
    return null;
  }
}

module.exports = { encrypt, decrypt };
