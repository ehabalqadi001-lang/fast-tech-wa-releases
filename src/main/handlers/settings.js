'use strict';

const path = require('path');
const fs   = require('fs');

/** @param {import('../types').HandlerContext} ctx */
function register(ctx) {
  const { handle, db, webhookSrv, secStore, V } = ctx;

  // ── Settings ────────────────────────────────────────────────────────────────
  handle('settings:get', () => {
    const s = db.settingsGetAll();
    const masked = { ...s };
    ['ai_gemini_key','ai_claude_key','crm_hubspot_key'].forEach(k => {
      if (masked[k]) masked[k] = '****' + masked[k].slice(-4);
    });
    return masked;
  });

  handle('settings:save',   (data) => { db.settingsBulkSet(data); return { ok: true }; });

  handle('settings:backup', async () => {
    const { app } = require('electron');
    const dataDir = path.join(app.getPath('userData'), 'fasttech-data');
    const dst = path.join(app.getPath('downloads'), `ftwa-backup-${Date.now()}.db`);
    fs.copyFileSync(path.join(dataDir, 'ftwa.db'), dst);
    return { path: dst };
  });

  handle('settings:backupEncrypted', async () => {
    const { app } = require('electron');
    const crypto = require('crypto');
    const dataDir = path.join(app.getPath('userData'), 'fasttech-data');
    const src = path.join(dataDir, 'ftwa.db');
    const dst = path.join(app.getPath('downloads'), `ftwa-backup-enc-${Date.now()}.db.enc`);
    const key    = crypto.scryptSync('ftwa-backup-key', 'fasttech-salt', 32);
    const iv     = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const enc    = Buffer.concat([iv, cipher.update(fs.readFileSync(src)), cipher.final()]);
    fs.writeFileSync(dst, enc);
    return { path: dst };
  });

  handle('settings:restore', (backupPath) => {
    const { app } = require('electron');
    const dataDir = path.join(app.getPath('userData'), 'fasttech-data');
    const dst     = path.join(dataDir, 'ftwa.db');
    const resolved = path.resolve(backupPath);
    if (!resolved.endsWith('.db'))       throw new Error('الملف يجب أن يكون .db');
    if (!fs.existsSync(resolved))        throw new Error('الملف غير موجود');
    try {
      const Db = require('better-sqlite3');
      const testDb = new Db(resolved, { readonly: true });
      testDb.pragma('integrity_check');
      testDb.close();
    } catch (e) { throw new Error('قاعدة بيانات غير صالحة: ' + e.message); }
    db.close();
    fs.copyFileSync(resolved, dst);
    return { ok: true, message: 'تم الاستعادة. أعد التشغيل.' };
  });

  // ── Developer API key ──────────────────────────────────────────────────────
  handle('api:getKey',    ()        => ({ ok: true, data: secStore.mask('dev_api_key') }));
  handle('api:setKey',    ({ key }) => {
    const v = V.optStr(key, 500, 'مفتاح API');
    if (!v.ok) return v;
    secStore.set('dev_api_key', key || '');
    return { ok: true };
  });
  handle('api:getStatus', ()        => ({ ok: true, data: { enabled: !!secStore.get('dev_api_key') } }));

  // ── Webhook server ─────────────────────────────────────────────────────────
  handle('webhook:status',  () => ({ running: webhookSrv?.isRunning() || false, port: webhookSrv?.getPort() || null }));
  handle('webhook:start',   async (port) => {
    if (!webhookSrv) throw new Error('Webhook server N/A');
    const p = await webhookSrv.start(port);
    db.settingSet('webhook_port', String(p));
    return { running: true, port: p };
  });
  handle('webhook:stop', () => { webhookSrv?.stop(); return { running: false }; });
  handle('webhook:getConfig', () => ({
    port:        db.settingGet('webhook_port')         || '3001',
    verifyToken: db.settingGet('webhook_verify_token') || 'ftwa-verify',
    running:     webhookSrv?.isRunning() || false,
  }));
  handle('webhook:saveConfig', async ({ port, verifyToken }) => {
    if (port)        { const v = V.port(port, 'منفذ Webhook'); if (!v.ok) return v; }
    if (verifyToken) { const v = V.str(verifyToken, 200, 'رمز التحقق'); if (!v.ok) return v; }
    const oldPort = db.settingGet('webhook_port') || '3001';
    if (port)        db.settingSet('webhook_port', String(port));
    if (verifyToken) secStore.set('webhook_verify_token', verifyToken);
    if (port && String(port) !== String(oldPort) && webhookSrv?.isRunning()) {
      webhookSrv.stop();
      await new Promise(r => setTimeout(r, 500));
      const newPort = await webhookSrv.start(parseInt(port, 10));
      return { ok: true, restarted: true, port: newPort };
    }
    return { ok: true, restarted: false };
  });
}

module.exports = { register };
