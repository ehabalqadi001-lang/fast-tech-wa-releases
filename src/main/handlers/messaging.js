'use strict';

const path = require('path');

/** @param {import('../types').HandlerContext} ctx */
function register(ctx) {
  const { handle, db, adapter, engine, waSvc, excel, scheduler, V, uuidv4, enableWakeLock } = ctx;

  // ── Single message ─────────────────────────────────────────────────────────
  handle('messages:sendSingle', async ({ accountId, to, body, mediaPath, sessionId, engine: engineOpt }) => {
    const vPhone = V.phone(to);
    if (!vPhone.ok) return { ok: false, error: vPhone.error };
    const vBody  = mediaPath ? V.optStr(body, 4096, 'النص') : V.str(body, 4096, 'نص الرسالة');
    if (!vBody.ok) return { ok: false, error: vBody.error };

    const msgId = uuidv4();
    let res, status = 'sent', errMsg = null, waId = null;
    try {
      if (mediaPath) {
        res = await adapter.sendMedia(to, mediaPath, body, { accountId, sessionId, engine: engineOpt });
      } else {
        res = await adapter.sendText(to, body, { accountId, sessionId, engine: engineOpt });
      }
      waId = res?.messages?.[0]?.id || res?.waId || null;
    } catch (e) { status = 'failed'; errMsg = e.message; }

    db.messageCreate({ id: msgId, campaign_id: null, account_id: accountId || null,
      recipient: to, direction: 'out', body, media_url: null, wa_msg_id: waId, status });
    if (status === 'failed') db.messageUpdateStatus(msgId, 'failed', errMsg);
    return { msgId, waId, status, engine: adapter.getMode(), error: errMsg };
  });

  handle('messages:sendBulk', async (opts) => {
    const campaignId = opts.campaignId || uuidv4();
    if (!db.campaignGet(campaignId)) {
      db.campaignCreate({
        id: campaignId, name: opts.campaignName || opts.name || 'حملة جماعية',
        type: 'individual', account_id: opts.accountIds?.[0] || opts.sessionId || null,
        message_body: opts.messageBody || '', media_path: opts.mediaPath || null,
        media_type: opts.mediaType || null, delay_sec: opts.delaySec || 5,
        total: opts.recipients?.length || 0,
      });
    }
    adapter.sendBulk({ ...opts, campaignId }).catch(e => console.error('[IPC:messages:sendBulk]', e.message));
    return { campaignId, started: true, engine: adapter.getMode() };
  });

  handle('messages:getHistory',  (phone)           => db.messageHistory(phone));
  handle('messages:getStats',    ()                => ({ ok: true, data: db.messageStats() }));
  handle('messages:search',      ({ query, limit }) => db.messagesFtsSearch(query, limit || 50));
  handle('messages:inboxSearch', ({ query, limit }) => db.incomingMessagesFtsSearch(query, limit || 50));
  handle('campaigns:list',       ()                => db.campaignList());

  // ── Scheduler ──────────────────────────────────────────────────────────────
  handle('scheduler:list',    ()     => scheduler.list());
  handle('scheduler:create',  (data) => scheduler.create(data));
  handle('scheduler:update',  (data) => scheduler.update(data));
  handle('scheduler:remove',  (id)   => scheduler.remove(id));
  handle('scheduler:pause',   (id)   => scheduler.pause(id));
  handle('scheduler:resume',  (id)   => scheduler.resume(id));
  handle('scheduler:runNow',  (id)   => scheduler.runNow(id));
  handle('scheduler:presets', ()     => require('../scheduler').presets());

  // ── Templates ──────────────────────────────────────────────────────────────
  handle('templates:list',   ()     => ({ ok: true, data: db.templateList() }));
  handle('templates:save',   (t)    => { if (!t.id) t.id = uuidv4(); db.templateUpsert(t); return { ok: true, data: t }; });
  handle('templates:remove', (id)   => { db.templateDelete(id); return { ok: true }; });
  handle('templates:getWa',  async (accountId) => accountId ? waSvc?.getTemplates?.(accountId) || [] : []);
  handle('templates:send',   async ({ templateId, recipients, sessionId, accountId, delaySec }) => {
    const tpl = db.templateList().find(t => t.id === templateId);
    if (!tpl)             throw new Error('القالب غير موجود');
    if (!recipients?.length) throw new Error('لا يوجد مستقبلون');
    return adapter.sendBulk({ sessionIds: sessionId ? [sessionId] : [], accountIds: accountId ? [accountId] : [],
      recipients, messageBody: tpl.body, delaySec: delaySec || 10, campaignName: `قالب: ${tpl.name}` });
  });

  // ── Import helpers ─────────────────────────────────────────────────────────
  handle('send:importFromFile', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const phones = [];
    if (ext === '.csv') {
      const fs = require('fs');
      for (const row of fs.readFileSync(filePath, 'utf8').split('\n')) {
        for (const cell of row.split(',')) {
          const s = cell.trim().replace(/["\s\-\+\(\)]/g, '');
          if (/^\d{7,15}$/.test(s)) { phones.push(s); break; }
        }
      }
    } else {
      const XLSX = require('xlsx');
      const wb = XLSX.readFile(filePath);
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      for (const row of rows) {
        if (!row?.length) continue;
        for (const cell of row) {
          if (cell == null) continue;
          const s = String(cell).trim().replace(/[\s\-\+\(\)]/g, '');
          if (/^\d{7,15}$/.test(s)) { phones.push(s); break; }
        }
      }
    }
    return phones;
  });

  handle('send:importFromSheets', async (url) => {
    const https = require('https');
    const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) throw new Error('رابط Google Sheets غير صحيح');
    const gidM = url.match(/[#&?]gid=(\d+)/);
    const csvUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gidM?.[1] || '0'}`;
    const text = await new Promise((resolve, reject) => {
      const get = (u, redirects = 0) => {
        https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5)
            return get(res.headers.location, redirects + 1);
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => resolve(data));
        }).on('error', reject);
      };
      get(csvUrl);
    });
    const phones = [];
    for (const row of String(text).split('\n'))
      for (const cell of row.split(',')) {
        const s = cell.trim().replace(/["\s\-\+\(\)]/g, '');
        if (/^\d{7,15}$/.test(s)) { phones.push(s); break; }
      }
    return phones;
  });
}

module.exports = { register };
