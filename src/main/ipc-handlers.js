'use strict';

/**
 * Fast Tech WA Manager — IPC Handler Registry
 * Bridges Electron's main process to all backend services.
 * Every handler is wrapped in try/catch so renderer always gets a structured response.
 */

const { v4: uuidv4 }  = require('uuid');
const path = require('path');
const fs   = require('fs');

function ok(data)  { return { ok: true,  data }; }
function err(e)    { return { ok: false, error: String(e?.message || e) }; }

function register(ipcMain, { db, waApi, waSvc, engine, scraper, scheduler, aiSvc, excel, adapter, webhookSrv, antiBanSvc }) {

  // ── Wake lock (prevent sleep during active campaigns) ─────────────────────
  const { powerSaveBlocker, BrowserWindow } = require('electron');
  let _wakeLockId = null;

  function _pushAll(channel, data) {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data));
  }
  function _enableWakeLock() {
    if (_wakeLockId !== null && powerSaveBlocker.isStarted(_wakeLockId)) return;
    _wakeLockId = powerSaveBlocker.start('prevent-app-suspension');
    _pushAll('wakelock:state', { active: true });
    console.log('[WakeLock] Enabled — preventing sleep');
  }
  function _disableWakeLock() {
    if (_wakeLockId !== null) {
      if (powerSaveBlocker.isStarted(_wakeLockId)) powerSaveBlocker.stop(_wakeLockId);
      _wakeLockId = null;
      _pushAll('wakelock:state', { active: false });
      console.log('[WakeLock] Disabled — sleep allowed');
    }
  }

  // Hook into engine events
  engine.on('queue:drained', () => _disableWakeLock());
  engine.on('antiban:blocked', ({ sessionId, reason }) => {
    _pushAll('antiban:blocked', { sessionId, reason });
  });

  // Hook WhatsApp Web auth_failure into AntiBanService
  if (waSvc && antiBanSvc) {
    waSvc.on('auth_failure_internal', (sessionId) => {
      antiBanSvc.recordAuthFailure(sessionId);
    });
    antiBanSvc.on('session:banned',    (d) => _pushAll('antiban:banned',      d));
    antiBanSvc.on('session:suspended', (d) => _pushAll('antiban:suspended',   d));
    antiBanSvc.on('warmup:complete',   (d) => _pushAll('antiban:warmup:complete', d));
    antiBanSvc.on('rate-limit',        (d) => _pushAll('antiban:rate-limit',  d));
  }

  function handle(channel, fn) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        return ok(await fn(...args));
      } catch (e) {
        console.error(`[IPC:${channel}]`, e.message);
        return err(e);
      }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ACCOUNTS
  // ══════════════════════════════════════════════════════════════════════════
  handle('accounts:list',    ()   => db.accountList());
  handle('accounts:save',    (a)  => {
    if (!a.id) a.id = uuidv4();
    db.accountUpsert(a);
    return db.accountGet(a.id);
  });
  handle('accounts:remove',  (id) => db.accountDelete(id));
  handle('accounts:test',    (id) => waApi.testAccount(id));
  handle('accounts:getInfo', (id) => waApi.getAccountInfo(id));

  // ══════════════════════════════════════════════════════════════════════════
  // CONTACTS
  // ══════════════════════════════════════════════════════════════════════════
  handle('contacts:list',  (f)  => db.contactList(f));
  handle('contacts:save',  (c)  => {
    if (!c.id) c.id = uuidv4();
    db.contactUpsert(c);
    return db.contactGet(c.id);
  });
  handle('contacts:remove', (id) => db.contactDelete(id));

  handle('contacts:importExcel', (filePath) => {
    const settings  = db.settingsGetAll();
    const result    = excel.importContacts(filePath, {
      defaultCountry: settings.default_country || 'SA',
    });
    db.contactBulkInsert(result.contacts);
    return { imported: result.contacts.length, skipped: result.skipped };
  });

  handle('contacts:exportExcel', async (opts) => {
    const contacts = db.contactList(opts?.filter || {});
    const outPath  = opts?.path || path.join(require('electron').app.getPath('downloads'), `contacts-${Date.now()}.xlsx`);
    excel.exportContacts(contacts, outPath);
    return { path: outPath };
  });

  handle('contacts:fixCountry', ({ phones, countryCode }) => {
    return excel.fixCountryCodes(phones, countryCode);
  });

  handle('contacts:deduplicate', () => {
    // Single SQL statement: keep the MIN(id) per phone, delete the rest
    const result = db._db.prepare(`
      DELETE FROM contacts
      WHERE id NOT IN (
        SELECT MIN(id) FROM contacts GROUP BY phone
      )
    `).run();
    return { removed: result.changes };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // GROUPS
  // ══════════════════════════════════════════════════════════════════════════
  handle('groups:list',       ()     => db.groupList());
  handle('groups:getMembers', (id)   => db.groupMembers(id));

  handle('groups:sync', async (accountId) => {
    // WhatsApp Business Cloud API does not support group listing via API.
    // Groups must be created/managed via the WhatsApp Business Manager UI.
    // This handler returns what's stored locally.
    return db.groupList().filter(g => g.account_id === accountId);
  });

  handle('groups:upsert', (g) => {
    if (!g.id) throw new Error('Group ID مطلوب');
    db.groupUpsert({
      id:           g.id,
      account_id:   g.account_id || 'manual',
      name:         g.name || g.id,
      description:  g.description || '',
      member_count: g.member_count || 0,
      invite_link:  g.invite_link || null,
      synced_at:    new Date().toISOString(),
    });
    return db.groupList().find(gr => gr.id === g.id);
  });

  handle('groups:getInviteLink', (groupId) => {
    const g = db.groupList().find(g => g.id === groupId);
    return g?.invite_link || null;
  });

  handle('groups:addMember',    async ({ groupId, phone }) => {
    // Member management via official API requires WhatsApp Business Management API
    // Store locally for tracking
    db._db.prepare(
      'INSERT OR IGNORE INTO group_members (group_id,phone,is_admin) VALUES (?,?,0)'
    ).run(groupId, phone);
    return { ok: true };
  });

  handle('groups:removeMember', async ({ groupId, phone }) => {
    db._db.prepare('DELETE FROM group_members WHERE group_id=? AND phone=?').run(groupId, phone);
    return { ok: true };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // MESSAGES
  // ══════════════════════════════════════════════════════════════════════════
  handle('messages:sendSingle', async ({ accountId, to, body, mediaPath, mediaType, sessionId, engine: engineOpt }) => {
    const msgId = uuidv4();
    let res, status = 'sent', errMsg = null, waId = null;

    try {
      if (mediaPath) {
        res = await adapter.sendMedia(to, mediaPath, body, { accountId, sessionId, engine: engineOpt });
      } else {
        res = await adapter.sendText(to, body, { accountId, sessionId, engine: engineOpt });
      }
      waId = res?.messages?.[0]?.id || res?.waId || null;
    } catch (e) {
      status = 'failed'; errMsg = e.message;
    }

    db.messageCreate({
      id: msgId, campaign_id: null,
      account_id: accountId || null,
      recipient: to, direction: 'out', body,
      media_url: null, wa_msg_id: waId, status,
    });
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

    // Delegate to adapter — routes to Cloud or Web engine based on setting
    adapter.sendBulk({ ...opts, campaignId }).catch(e => {
      console.error('[IPC:messages:sendBulk] Error:', e.message);
    });

    return { campaignId, started: true, engine: adapter.getMode() };
  });

  handle('messages:getHistory', (phone) => db.messageHistory(phone));
  handle('messages:getStats',   ()      => db.messageStats());
  handle('messages:search',     ({ query, limit }) => db.messagesFtsSearch(query, limit || 50));

  // ══════════════════════════════════════════════════════════════════════════
  // SCHEDULER
  // ══════════════════════════════════════════════════════════════════════════
  handle('scheduler:list',     ()     => scheduler.list());
  handle('scheduler:create',   (data) => scheduler.create(data));
  handle('scheduler:update',   (data) => scheduler.update(data));
  handle('scheduler:remove',   (id)   => scheduler.remove(id));
  handle('scheduler:pause',    (id)   => scheduler.pause(id));
  handle('scheduler:resume',   (id)   => scheduler.resume(id));
  handle('scheduler:runNow',   (id)   => scheduler.runNow(id));
  handle('scheduler:presets',  ()     => require('./scheduler').presets());

  // ══════════════════════════════════════════════════════════════════════════
  // TEMPLATES
  // ══════════════════════════════════════════════════════════════════════════
  handle('templates:list',   ()     => db.templateList());
  handle('templates:save',   (t)    => { if (!t.id) t.id = uuidv4(); db.templateUpsert(t); return t; });
  handle('templates:remove', (id)   => db.templateDelete(id));
  handle('templates:getWa',  async (accountId) => {
    if (!accountId) return [];
    return waApi.getTemplates(accountId);
  });
  handle('templates:send', async ({ templateId, recipients, sessionId, accountId, delaySec }) => {
    const tpl = db.templateList().find(t => t.id === templateId);
    if (!tpl) throw new Error('القالب غير موجود');
    if (!recipients?.length) throw new Error('لا يوجد مستقبلون');
    return adapter.sendBulk({
      sessionIds: sessionId ? [sessionId] : [],
      accountIds: accountId ? [accountId] : [],
      recipients,
      messageBody: tpl.body,
      delaySec: delaySec || 10,
      campaignName: `قالب: ${tpl.name}`,
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // CONVERSATION VIEW
  // ══════════════════════════════════════════════════════════════════════════
  handle('conversation:get', ({ phone, limit }) => db.conversationGet(phone, limit || 100));

  // ══════════════════════════════════════════════════════════════════════════
  // MEDIA LIBRARY
  // ══════════════════════════════════════════════════════════════════════════
  handle('media:list',   ()    => db.mediaList());
  handle('media:delete', (id)  => { const m = db.mediaGet(id); if (m) { try { fs.unlinkSync(m.file_path); } catch (_) {} } return db.mediaDelete(id); });
  handle('media:add', async ({ filePath }) => {
    const { app } = require('electron');
    const mediaDir = path.join(app.getPath('userData'), 'fasttech-data', 'media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
    const ext  = path.extname(filePath);
    const dest = path.join(mediaDir, `${uuidv4()}${ext}`);
    fs.copyFileSync(filePath, dest);
    const stat = fs.statSync(dest);
    const mime = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
                   '.mp4': 'video/mp4', '.pdf': 'application/pdf',
                   '.gif': 'image/gif', '.webp': 'image/webp' }[ext.toLowerCase()] || 'application/octet-stream';
    const entry = { id: uuidv4(), name: path.basename(filePath), file_path: dest, mime_type: mime, size_bytes: stat.size };
    db.mediaAdd(entry);
    return entry;
  });

  // ══════════════════════════════════════════════════════════════════════════
  // DASHBOARD STATS
  // ══════════════════════════════════════════════════════════════════════════
  handle('dashboard:stats', () => db.dashboardStats());

  // ══════════════════════════════════════════════════════════════════════════
  // CONTACTS PREVIEW IMPORT (validate phones before committing)
  // ══════════════════════════════════════════════════════════════════════════
  handle('contacts:previewImport', async (filePath) => {
    const result = await excel.importContacts(filePath, { preview: true });
    return result;
  });

  // ══════════════════════════════════════════════════════════════════════════
  // RETRY FAILED MESSAGES
  // ══════════════════════════════════════════════════════════════════════════
  handle('wa:send:retryFailed', ({ campaignId }) => {
    const n = db.queueRetryFailed(campaignId || null);
    if (n > 0) engine.wake();
    return { requeued: n };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // A/B AUTO WINNER
  // ══════════════════════════════════════════════════════════════════════════
  handle('wa:ab:autoWinner', ({ campaignId }) => db.abGetWinner(campaignId));

  // ══════════════════════════════════════════════════════════════════════════
  // ENCRYPTED BACKUP
  // ══════════════════════════════════════════════════════════════════════════
  handle('settings:backupEncrypted', async () => {
    const { app } = require('electron');
    const crypto = require('crypto');
    const dataDir = path.join(app.getPath('userData'), 'fasttech-data');
    const src  = path.join(dataDir, 'ftwa.db');
    const dst  = path.join(app.getPath('downloads'), `ftwa-backup-enc-${Date.now()}.db.enc`);
    const key  = crypto.scryptSync('ftwa-backup-key', 'fasttech-salt', 32);
    const iv   = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const input  = fs.readFileSync(src);
    const enc    = Buffer.concat([iv, cipher.update(input), cipher.final()]);
    fs.writeFileSync(dst, enc);
    return { path: dst };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // AI
  // ══════════════════════════════════════════════════════════════════════════
  handle('ai:chat',          (data) => aiSvc.chat(data));
  handle('ai:generateScript',(data) => aiSvc.generateScript(data));
  handle('ai:getKeys',       ()     => {
    const s = db.settingsGetAll();
    return {
      geminiKey: s.ai_gemini_key ? '****' + s.ai_gemini_key.slice(-4) : '',
      claudeKey: s.ai_claude_key ? '****' + s.ai_claude_key.slice(-4) : '',
      provider:  s.ai_provider || 'gemini',
    };
  });
  handle('ai:saveKeys', (keys) => aiSvc.saveKeys(keys));

  // ══════════════════════════════════════════════════════════════════════════
  // ══════════════════════════════════════════════════════════════════════════
  // CRM INTEGRATION — HubSpot, Pipedrive, Airtable, Webhook, Google Sheets
  // ══════════════════════════════════════════════════════════════════════════

  handle('crm:getConfig', () => {
    const s = db.settingsGetAll();
    return {
      hubspot_key:        s.crm_hubspot_key        || '',
      hubspot_portal_id:  s.crm_hubspot_portal_id  || '',
      hubspot_sync_freq:  s.crm_hubspot_sync_freq  || '0',
      pipedrive_key:      s.crm_pipedrive_key       || '',
      airtable_key:       s.crm_airtable_key        || '',
      airtable_base:      s.crm_airtable_base       || '',
      airtable_table:     s.crm_airtable_table      || '',
      webhook_url:        s.crm_webhook_url          || '',
      webhook_secret:     s.crm_webhook_secret       || '',
      webhook_on_send:    s.crm_webhook_on_send     || '1',
      webhook_on_reply:   s.crm_webhook_on_reply    || '1',
      gsheets_url:        s.crm_gsheets_url          || '',
      gsheets_phone_col:  s.crm_gsheets_phone_col   || 'phone',
      gsheets_name_col:   s.crm_gsheets_name_col    || 'name',
    };
  });

  handle('crm:saveConfig', (data) => {
    const map = {
      hubspot_key:        'crm_hubspot_key',
      hubspot_portal_id:  'crm_hubspot_portal_id',
      hubspot_sync_freq:  'crm_hubspot_sync_freq',
      pipedrive_key:      'crm_pipedrive_key',
      airtable_key:       'crm_airtable_key',
      airtable_base:      'crm_airtable_base',
      airtable_table:     'crm_airtable_table',
      webhook_url:        'crm_webhook_url',
      webhook_secret:     'crm_webhook_secret',
      webhook_on_send:    'crm_webhook_on_send',
      webhook_on_reply:   'crm_webhook_on_reply',
      gsheets_url:        'crm_gsheets_url',
      gsheets_phone_col:  'crm_gsheets_phone_col',
      gsheets_name_col:   'crm_gsheets_name_col',
    };
    for (const [k, dbKey] of Object.entries(map)) {
      if (data[k] !== undefined) db.settingSet(dbKey, data[k]);
    }
    return { ok: true };
  });

  handle('crm:testConnection', async (crmType) => {
    const s = db.settingsGetAll();
    const axios = require('axios');

    if (crmType === 'hubspot') {
      if (!s.crm_hubspot_key) throw new Error('أدخل HubSpot API Key أولاً');
      const res = await axios.get('https://api.hubapi.com/crm/v3/objects/contacts?limit=1&properties=firstname', {
        headers: { Authorization: `Bearer ${s.crm_hubspot_key}` }, timeout: 10000,
      });
      return { info: `HubSpot ✅ — ${res.data.total || 0} جهة اتصال إجمالاً` };
    }

    if (crmType === 'pipedrive') {
      if (!s.crm_pipedrive_key) throw new Error('أدخل Pipedrive API Token أولاً');
      const res = await axios.get(`https://api.pipedrive.com/v1/users/me?api_token=${s.crm_pipedrive_key}`, { timeout: 10000 });
      if (!res.data.success) throw new Error('Token غير صالح');
      return { info: `Pipedrive ✅ — متصل كـ: ${res.data.data?.name || 'مستخدم'}` };
    }

    if (crmType === 'airtable') {
      if (!s.crm_airtable_key) throw new Error('أدخل Airtable Personal Access Token أولاً');
      if (!s.crm_airtable_base) throw new Error('أدخل Airtable Base ID أولاً');
      const table = s.crm_airtable_table || 'Table 1';
      const url = `https://api.airtable.com/v0/${s.crm_airtable_base}/${encodeURIComponent(table)}?maxRecords=1`;
      const res = await axios.get(url, { headers: { Authorization: `Bearer ${s.crm_airtable_key}` }, timeout: 10000 });
      return { info: `Airtable ✅ — الجدول "${table}" يحتوي سجلات` };
    }

    if (crmType === 'webhook') {
      if (!s.crm_webhook_url) throw new Error('أدخل Webhook URL أولاً');
      const headers = { 'Content-Type': 'application/json' };
      if (s.crm_webhook_secret) headers['X-Webhook-Secret'] = s.crm_webhook_secret;
      const res = await axios.post(s.crm_webhook_url,
        { test: true, source: 'FAST TECH WA Manager', timestamp: new Date().toISOString() },
        { headers, timeout: 10000 }
      );
      return { info: `Webhook ✅ — استجاب بـ HTTP ${res.status}` };
    }

    if (crmType === 'gsheets') {
      if (!s.crm_gsheets_url) throw new Error('أدخل رابط Google Sheets أولاً');
      const m = s.crm_gsheets_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!m) throw new Error('رابط Google Sheets غير صحيح');
      const csvUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`;
      const res = await axios.get(csvUrl, { timeout: 15000 });
      const rows = res.data.split('\n').filter(Boolean).length;
      return { info: `Google Sheets ✅ — ${rows} صف` };
    }

    throw new Error('نوع CRM غير معروف');
  });

  handle('crm:syncLeads', async (source) => {
    const s = db.settingsGetAll();
    const axios = require('axios');
    let leads = [];

    if (source === 'hubspot' && s.crm_hubspot_key) {
      let after;
      do {
        const url = `https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,phone,email,lifecyclestage${after ? `&after=${after}` : ''}`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${s.crm_hubspot_key}` } });
        leads = leads.concat((res.data.results || []).map(r => ({
          id: uuidv4(), source: 'hubspot',
          name:  `${r.properties.firstname || ''} ${r.properties.lastname || ''}`.trim(),
          phone: r.properties.phone || '', email: r.properties.email || '',
          status: r.properties.lifecyclestage || '', raw_json: JSON.stringify(r),
        })));
        after = res.data.paging?.next?.after;
      } while (after);
    }

    if (source === 'pipedrive' && s.crm_pipedrive_key) {
      let start = 0, hasMore = true;
      while (hasMore) {
        const res = await axios.get(`https://api.pipedrive.com/v1/persons?api_token=${s.crm_pipedrive_key}&limit=100&start=${start}`);
        leads = leads.concat((res.data.data || []).map(r => ({
          id: uuidv4(), source: 'pipedrive',
          name: r.name || '', phone: r.phone?.[0]?.value || '',
          email: r.email?.[0]?.value || '', status: r.status || '', raw_json: JSON.stringify(r),
        })));
        hasMore = res.data.additional_data?.pagination?.more_items_in_collection;
        start += 100;
      }
    }

    if (source === 'airtable' && s.crm_airtable_key && s.crm_airtable_base) {
      const table = s.crm_airtable_table || 'Table 1';
      let offset;
      do {
        const url = `https://api.airtable.com/v0/${s.crm_airtable_base}/${encodeURIComponent(table)}?pageSize=100${offset ? `&offset=${offset}` : ''}`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${s.crm_airtable_key}` } });
        leads = leads.concat((res.data.records || []).map(r => ({
          id: uuidv4(), source: 'airtable',
          name:  r.fields?.Name  || r.fields?.name  || r.fields?.الاسم  || '',
          phone: String(r.fields?.Phone || r.fields?.phone || r.fields?.Mobile || r.fields?.الهاتف || ''),
          email: r.fields?.Email || r.fields?.email || '',
          status: r.fields?.Status || '', raw_json: JSON.stringify(r),
        })));
        offset = res.data.offset;
      } while (offset);
    }

    if (source === 'gsheets' && s.crm_gsheets_url) {
      const m = s.crm_gsheets_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (m) {
        const csvUrl = `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`;
        const res = await axios.get(csvUrl, { timeout: 15000 });
        // RFC-4180 compliant CSV parser — handles quoted fields with embedded commas/newlines
        const parseCSV = (text) => {
          const rows = []; let row = []; let field = ''; let inQ = false;
          for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (inQ) {
              if (ch === '"' && text[i+1] === '"') { field += '"'; i++; }
              else if (ch === '"') inQ = false;
              else field += ch;
            } else {
              if (ch === '"') inQ = true;
              else if (ch === ',') { row.push(field); field = ''; }
              else if (ch === '\n' || (ch === '\r' && text[i+1] === '\n')) {
                if (ch === '\r') i++;
                row.push(field); rows.push(row); row = []; field = '';
              } else field += ch;
            }
          }
          if (field || row.length) { row.push(field); rows.push(row); }
          return rows;
        };
        const rows = parseCSV(res.data);
        const hdr = rows[0]?.map(h => h.trim().toLowerCase()) || [];
        const phoneCol = s.crm_gsheets_phone_col?.toLowerCase() || 'phone';
        const nameCol  = s.crm_gsheets_name_col?.toLowerCase()  || 'name';
        const pi = hdr.findIndex(h => h.includes(phoneCol) || h.includes('phone') || h.includes('mobile'));
        const ni = hdr.findIndex(h => h.includes(nameCol)  || h.includes('name'));
        const ei = hdr.findIndex(h => h.includes('email'));
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const phone = (pi >= 0 ? row[pi] : '').replace(/\s/g, '');
          if (phone && /\d{6,}/.test(phone)) {
            leads.push({
              id: uuidv4(), source: 'gsheets',
              name:  ni >= 0 ? row[ni]?.trim() : '',
              phone, email: ei >= 0 ? row[ei]?.trim() : '',
              status: '', raw_json: JSON.stringify(row),
            });
          }
        }
      }
    }

    if (leads.length) db.crmLeadBulkReplace(source, leads);
    return { synced: leads.length };
  });

  handle('crm:getLeads', () => db.crmLeadList());

  handle('crm:triggerWebhook', async (payload) => {
    const s = db.settingsGetAll();
    if (!s.crm_webhook_url) throw new Error('Webhook URL غير محدد');
    // SSRF protection — only allow HTTPS to public hosts
    const _validateWebhookUrl = (raw) => {
      let u;
      try { u = new URL(raw); } catch { throw new Error('Webhook URL غير صالح'); }
      if (u.protocol !== 'https:') throw new Error('Webhook URL يجب أن يكون HTTPS');
      const h = u.hostname.toLowerCase();
      if (h === 'localhost' || h === '127.0.0.1' || h === '::1' ||
          h.startsWith('192.168.') || h.startsWith('10.') ||
          h.startsWith('172.16.') || h.endsWith('.local'))
        throw new Error('Webhook URL لا يمكن أن يشير إلى شبكة داخلية');
    };
    _validateWebhookUrl(s.crm_webhook_url);
    const axios = require('axios');
    const headers = { 'Content-Type': 'application/json' };
    if (s.crm_webhook_secret) headers['X-Webhook-Secret'] = s.crm_webhook_secret;
    const res = await axios.post(s.crm_webhook_url, payload, { headers, timeout: 15000 });
    return { status: res.status };
  });

  handle('crm:pushContacts', async (crmType) => {
    const s  = db.settingsGetAll();
    const axios = require('axios');
    const contacts = db.contactList({}).filter(c => c.phone);
    let pushed = 0, errors = 0;

    if (crmType === 'hubspot' && s.crm_hubspot_key) {
      const batchSize = 10;
      for (let i = 0; i < contacts.length; i += batchSize) {
        const batch = contacts.slice(i, i + batchSize).map(c => ({
          properties: { phone: c.phone, firstname: (c.name || '').split(' ')[0] || '', email: c.email || '' }
        }));
        try {
          await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/batch/create',
            { inputs: batch }, { headers: { Authorization: `Bearer ${s.crm_hubspot_key}` } });
          pushed += batch.length;
        } catch (_) { errors += batch.length; }
      }
    }

    if (crmType === 'pipedrive' && s.crm_pipedrive_key) {
      for (const c of contacts) {
        try {
          await axios.post(`https://api.pipedrive.com/v1/persons?api_token=${s.crm_pipedrive_key}`,
            { name: c.name || c.phone, phone: [{ value: c.phone, primary: true }], email: c.email ? [{ value: c.email }] : [] });
          pushed++;
        } catch (_) { errors++; }
      }
    }

    if (crmType === 'airtable' && s.crm_airtable_key && s.crm_airtable_base) {
      const table = s.crm_airtable_table || 'Table 1';
      const url = `https://api.airtable.com/v0/${s.crm_airtable_base}/${encodeURIComponent(table)}`;
      const batchSize = 10;
      for (let i = 0; i < contacts.length; i += batchSize) {
        const batch = contacts.slice(i, i + batchSize).map(c => ({
          fields: { Name: c.name || c.phone, Phone: c.phone, Email: c.email || '' }
        }));
        try {
          await axios.post(url, { records: batch }, { headers: { Authorization: `Bearer ${s.crm_airtable_key}` } });
          pushed += batch.length;
        } catch (_) { errors += batch.length; }
      }
    }

    return { pushed, errors };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // REPORTS
  // ══════════════════════════════════════════════════════════════════════════
  handle('reports:getSummary',  (range) => db.reportSummary(range?.days || 30));
  handle('reports:getCampaigns',()      => db.reportCampaignPerf());
  handle('reports:getReplies',  ()      => db.reportReplies());

  handle('reports:exportExcel', async (range) => {
    const { app } = require('electron');
    const outPath = path.join(app.getPath('downloads'), `ftwa-report-${Date.now()}.xlsx`);
    const days = range?.days || 30;
    const data = {
      summary:    db.reportSummary(days),
      campaigns:  db.reportCampaignPerf(),
      replies:    db.reportReplies(),
      sentDetail: db.reportSentDetail(days),
    };
    excel.exportReport(data, outPath);
    return { path: outPath };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // SETTINGS
  // ══════════════════════════════════════════════════════════════════════════
  handle('settings:get', () => {
    const s = db.settingsGetAll();
    // Mask sensitive keys
    const masked = { ...s };
    ['ai_gemini_key','ai_claude_key','crm_hubspot_key'].forEach(k => {
      if (masked[k]) masked[k] = '****' + masked[k].slice(-4);
    });
    return masked;
  });

  handle('settings:save', (data) => {
    db.settingsBulkSet(data);
    return { ok: true };
  });

  handle('settings:backup', async () => {
    const { app } = require('electron');
    const dataDir  = path.join(app.getPath('userData'), 'fasttech-data');
    const src      = path.join(dataDir, 'ftwa.db');
    const dst      = path.join(app.getPath('downloads'), `ftwa-backup-${Date.now()}.db`);
    fs.copyFileSync(src, dst);
    return { path: dst };
  });

  handle('settings:restore', (backupPath) => {
    const { app } = require('electron');
    const dataDir = path.join(app.getPath('userData'), 'fasttech-data');
    const dst     = path.join(dataDir, 'ftwa.db');

    const resolved = path.resolve(backupPath);
    if (!resolved.endsWith('.db')) throw new Error('ملف النسخة الاحتياطية يجب أن يكون .db');
    if (!fs.existsSync(resolved)) throw new Error('ملف النسخة الاحتياطية غير موجود');

    // Validate the file is a real SQLite database using the library — no raw SQL injection risk
    try {
      const Database = require('better-sqlite3');
      const testDb = new Database(resolved, { readonly: true });
      testDb.pragma('integrity_check');
      testDb.close();
    } catch (e) {
      throw new Error('الملف ليس قاعدة بيانات SQLite صالحة: ' + e.message);
    }

    db.close();
    fs.copyFileSync(resolved, dst);
    return { ok: true, message: 'تم الاستعادة. يرجى إعادة تشغيل التطبيق.' };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // WA WEB — SESSION MANAGEMENT (whatsapp-web.js engine)
  // ══════════════════════════════════════════════════════════════════════════

  handle('wa:sessions:list', () => {
    if (!waSvc) return db.sessionList();
    return waSvc.getActiveSessions();
  });

  handle('wa:sessions:create', ({ name }) => {
    if (!name?.trim()) throw new Error('اسم الجلسة مطلوب');
    const id = uuidv4();
    db.sessionCreate({ id, name: name.trim() });
    return db.sessionGet(id);
  });

  handle('wa:sessions:start', async (id) => {
    if (!waSvc) throw new Error('WhatsApp Web engine not available');
    return waSvc.startSession(id);
  });

  handle('wa:sessions:stop', async (id) => {
    if (!waSvc) throw new Error('WhatsApp Web engine not available');
    return waSvc.stopSession(id);
  });

  handle('wa:sessions:logout', async (id) => {
    if (!waSvc) throw new Error('WhatsApp Web engine not available');
    return waSvc.logoutSession(id);
  });

  handle('wa:sessions:remove', async (id) => {
    if (waSvc) {
      await waSvc.stopSession(id).catch(() => {});
    }
    db.sessionDelete(id);
    return { removed: true };
  });

  handle('wa:sessions:rename', ({ id, name }) => {
    db.sessionUpdateField(id, 'name', name);
    return db.sessionGet(id);
  });

  // ══════════════════════════════════════════════════════════════════════════
  // WA WEB — DIRECT SEND (single message)
  // ══════════════════════════════════════════════════════════════════════════

  handle('wa:send:text', async ({ sessionId, to, body }) => {
    if (!waSvc) throw new Error('WhatsApp Web engine not available');
    const res = await waSvc.sendText(sessionId, to, body);
    // outgoing — no inbox save needed
    return res;
  });

  handle('wa:send:media', async ({ sessionId, to, filePath, caption }) => {
    if (!waSvc) throw new Error('WhatsApp Web engine not available');
    return waSvc.sendMedia(sessionId, to, filePath, caption || '');
  });

  // ══════════════════════════════════════════════════════════════════════════
  // WA WEB — ANTI-BAN BULK SEND (via queue engine)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Enqueue a bulk campaign into the anti-ban send queue.
   * opts = {
   *   recipients:  string[],
   *   body?:       string,
   *   scripts?:    string[],     // message variants for A/B rotation
   *   sessionId?:  string,       // pin to session; null = auto-rotate
   *   mediaPath?:  string,
   *   delayMin?:   number,       // ms (default 15000)
   *   delayMax?:   number,       // ms (default 45000)
   *   campaignName?: string,
   * }
   */
  handle('wa:send:bulk', (opts) => {
    if (!engine) throw new Error('Sending engine not available');

    // scripts_data = [{text, mediaPath}] — new A/B format (may coexist with legacy scripts[])
    const scriptsData    = opts.scripts_data || [];
    const legacyScripts  = opts.scripts      || [];

    // Normalise to object format — support both legacy string[] and new object[]
    const allScripts = scriptsData.length
      ? scriptsData
      : legacyScripts.map(s => (typeof s === 'string' ? { text: s, mediaPath: null } : s));

    const firstText  = allScripts[0]?.text || opts.body || '';
    const firstMedia = allScripts[0]?.mediaPath || opts.mediaPath || null;

    const campaignId = uuidv4();
    db.campaignCreate({
      id:           campaignId,
      name:         opts.campaignName || `حملة ${new Date().toLocaleDateString('ar')}`,
      type:         'individual',
      account_id:   opts.sessionId || null,
      message_body: firstText,
      media_path:   firstMedia,
      media_type:   null,
      delay_sec:    Math.round((opts.delayMin || 15000) / 1000),
      total:        opts.recipients?.length || 0,
    });
    db.campaignUpdateStatus(campaignId, 'running', { sent: 0, failed: 0 });

    // Save per-script analytics rows
    if (allScripts.length) {
      try { db.campaignScriptsInsert(campaignId, allScripts); } catch (_) {}
    }

    // Distribute across allowed sessions (round-robin) or single session / auto
    const allowedSessions = opts.allowedSessions?.length ? opts.allowedSessions : null;

    const items = (opts.recipients || []).map((r, i) => ({
      recipient:   r,
      body:        opts.body || null,
      scripts:     allScripts.length ? allScripts : null,
      sessionId:   allowedSessions
                     ? allowedSessions[i % allowedSessions.length]
                     : (opts.sessionId || null),
      campaignId,
      mediaPath:   firstMedia,
      delayMin:    opts.delayMin || 15000,
      delayMax:    opts.delayMax || 45000,
    }));

    const result = engine.enqueue(items);
    if (items.length > 0) _enableWakeLock(); // prevent sleep during campaign
    return result;
  });

  // ══════════════════════════════════════════════════════════════════════════
  // A/B TESTING RESULTS
  // ══════════════════════════════════════════════════════════════════════════

  handle('wa:ab:results', (campaignId) => {
    if (campaignId) {
      const campaign = db.campaignGet(campaignId);
      const scripts  = db.campaignScriptsGet(campaignId);
      return { campaign, scripts };
    }
    return { campaigns: db.abResultsList() };
  });

  // Reply attribution: when an incoming message arrives, link it to last-sent script
  handle('wa:ab:attributeReply', (phone) => {
    try {
      const lastSent = db.queueGetLastSentForRecipient(phone);
      if (lastSent?.campaign_id && lastSent.script_index >= 0) {
        db.campaignScriptIncrReplied(lastSent.campaign_id, lastSent.script_index);
        return { attributed: true, campaignId: lastSent.campaign_id, scriptIndex: lastSent.script_index };
      }
    } catch (_) {}
    return { attributed: false };
  });

  handle('wa:send:queueStats', () => engine ? engine.stats() : null);
  handle('wa:send:pause',      () => { engine?.pause();  return { ok: true }; });
  handle('wa:send:resume',     () => { engine?.resume(); return { ok: true }; });
  handle('wa:send:clearDone',  () => { db.queueClearCompleted(); return { ok: true }; });

  // ══════════════════════════════════════════════════════════════════════════
  // WA WEB — SCRAPING / DATA EXTRACTION
  // ══════════════════════════════════════════════════════════════════════════

  handle('wa:scraper:getGroups', async (sessionId) => {
    if (!scraper) throw new Error('Scraper not available');
    return scraper.scrapeGroups(sessionId);
  });

  handle('wa:scraper:diagnose', async (sessionId) => {
    if (!waSvc) throw new Error('WA service not available');
    return waSvc.diagnoseScraping(sessionId);
  });

  handle('wa:scraper:getParticipants', async ({ sessionId, groupId }) => {
    if (!scraper) throw new Error('Scraper not available');
    return scraper.scrapeGroupParticipants(sessionId, groupId);
  });

  handle('wa:scraper:getInviteLink', async ({ sessionId, groupId }) => {
    if (!scraper) throw new Error('Scraper not available');
    return scraper.scrapeGroupInviteLink(sessionId, groupId);
  });

  handle('wa:scraper:getContacts', async (sessionId) => {
    if (!scraper) throw new Error('Scraper not available');
    return scraper.scrapeContacts(sessionId);
  });

  handle('wa:scraper:exportParticipants', async ({ sessionId, groupId, groupName }) => {
    if (!scraper) throw new Error('Scraper not available');
    const { app } = require('electron');
    const outPath  = path.join(
      app.getPath('downloads'),
      `participants-${Date.now()}.xlsx`
    );
    const participants = await scraper.scrapeGroupParticipants(sessionId, groupId);
    scraper.exportParticipantsToExcel(participants, groupName || groupId, outPath);
    return { path: outPath, count: participants.length };
  });

  handle('wa:scraper:exportContacts', async (sessionId) => {
    if (!scraper) throw new Error('Scraper not available');
    const { app } = require('electron');
    const outPath  = path.join(app.getPath('downloads'), `wa-contacts-${Date.now()}.xlsx`);
    const contacts = await scraper.scrapeContacts(sessionId);
    scraper.exportContactsToExcel(contacts, outPath);
    return { path: outPath, count: contacts.length };
  });

  handle('wa:scraper:exportGroups', async (sessionId) => {
    if (!scraper) throw new Error('Scraper not available');
    const { app } = require('electron');
    const outPath  = path.join(app.getPath('downloads'), `wa-groups-${Date.now()}.xlsx`);
    const groups   = sessionId
      ? await scraper.scrapeGroups(sessionId)
      : db.groupList();
    scraper.exportGroupsToExcel(groups, outPath);
    return { path: outPath, count: groups.length };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // WA WEB — GROUP MEMBER MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  handle('wa:groups:addMembers', async ({ sessionId, groupId, phones }) => {
    if (!waSvc) throw new Error('Web service not available');
    return waSvc.addGroupMembers(sessionId, groupId, phones);
  });

  handle('wa:groups:removeMembers', async ({ sessionId, groupId, phones, dryRun }) => {
    if (!waSvc) throw new Error('Web service not available');
    return waSvc.removeGroupMembers(sessionId, groupId, phones, !!dryRun);
  });

  handle('wa:groups:readPhonesFromExcel', (filePath) => {
    const XLSX = require('xlsx');
    const wb   = XLSX.readFile(filePath);
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const phones = [];
    for (const row of rows) {
      if (!row || !row.length) continue;
      for (const cell of row) {
        if (cell == null) continue;
        const s = String(cell).trim().replace(/[\s\-\+\(\)]/g, '');
        if (/^\d{7,15}$/.test(s)) { phones.push(s); break; }
      }
    }
    return phones;
  });

  handle('wa:groups:exportList', (groups) => {
    const XLSX = require('xlsx');
    const { app } = require('electron');
    const outPath = path.join(app.getPath('downloads'), `wa-groups-selected-${Date.now()}.xlsx`);
    const rows = (groups || []).map((g, i) => ({
      '#':             i + 1,
      'اسم المجموعة': g.name || '',
      'معرف المجموعة': g.id || '',
      'رابط دعوة المجموعة': g.invite_link || '— لم يُجلب —',
      'عدد الأعضاء':   g.member_count || 0,
      'آخر مزامنة':    g.synced_at ? new Date(g.synced_at).toLocaleString('ar') : '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    // Auto column widths
    ws['!cols'] = [
      { wch: 4 }, { wch: 30 }, { wch: 28 }, { wch: 50 }, { wch: 12 }, { wch: 22 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'المجموعات');
    XLSX.writeFile(wb, outPath);
    return { path: outPath, count: rows.length };
  });

  // ── Send Engine — import helpers ─────────────────────────────────────────

  // Read phone numbers from an Excel (.xlsx/.xls) or CSV file
  handle('send:importFromFile', (filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    const phones = [];

    if (ext === '.csv') {
      const fs   = require('fs');
      const text = fs.readFileSync(filePath, 'utf8');
      for (const row of text.split('\n')) {
        for (const cell of row.split(',')) {
          const s = cell.trim().replace(/["\s\-\+\(\)]/g, '');
          if (/^\d{7,15}$/.test(s)) { phones.push(s); break; }
        }
      }
    } else {
      const XLSX = require('xlsx');
      const wb   = XLSX.readFile(filePath);
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
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

  // Fetch phone numbers from a public Google Sheets URL (publish-to-web CSV)
  handle('send:importFromSheets', async (url) => {
    const https = require('https');
    const http  = require('http');

    // Convert edit/share URL → CSV export URL
    const m = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (!m) throw new Error('رابط Google Sheets غير صحيح — يجب أن يحتوي على /d/{ID}');
    const sheetId = m[1];
    const gidM    = url.match(/[#&?]gid=(\d+)/);
    const gid     = gidM ? gidM[1] : '0';
    const csvUrl  = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

    const text = await new Promise((resolve, reject) => {
      const get = (u, redirects = 0) => {
        const mod = u.startsWith('https') ? https : http;
        mod.get(u, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
            return get(res.headers.location, redirects + 1);
          }
          let data = '';
          res.on('data', c => data += c);
          res.on('end',  () => resolve(data));
        }).on('error', reject);
      };
      get(csvUrl);
    });

    const phones = [];
    for (const row of text.split('\n')) {
      for (const cell of row.split(',')) {
        const s = cell.trim().replace(/["\s\-\+\(\)]/g, '');
        if (/^\d{7,15}$/.test(s)) { phones.push(s); break; }
      }
    }
    return phones;
  });

  // ══════════════════════════════════════════════════════════════════════════
  // WA WEB — INBOX (incoming messages)
  // ══════════════════════════════════════════════════════════════════════════

  handle('wa:inbox:list',     (opts) => {
    // Accept (sessionId string) OR ({ sessionId, filter, limit })
    if (typeof opts === 'string' || opts === null || opts === undefined) {
      return db.incomingMessageList(opts || null);
    }
    return db.incomingMessageList(opts.sessionId || null, opts.limit || 200, opts.filter || null);
  });
  handle('wa:inbox:markRead', (id)        => { db.incomingMessageMarkRead(id); return { ok: true }; });
  handle('wa:inbox:unread',   (sessionId) => db.incomingUnreadCount(sessionId));
  handle('wa:inbox:unreplied',(sessionId) => db.incomingUnrepliedCount(sessionId));
  handle('wa:inbox:replyStats', ()        => db.incomingReplyStats());

  handle('wa:inbox:reply', async ({ id, replyBody, sessionId: replySessionId }) => {
    if (!waSvc) throw new Error('WhatsApp Web engine not available');
    const msg = db.incomingMessageGet(id);
    if (!msg) throw new Error('الرسالة غير موجودة');

    // Use provided session or fall back to the session that received the message
    const sid = replySessionId || msg.session_id;
    if (!sid) throw new Error('لا توجد جلسة محددة للرد');

    // For group messages reply to the group; for direct messages reply to the sender
    const target = msg.is_group && msg.from_number.includes('@g.us')
      ? msg.from_number                        // group JID
      : msg.from_number;                       // individual phone

    const res = await waSvc.sendText(sid, target, replyBody);
    db.incomingMessageMarkReplied(id, { replyBody, repliedBy: sid });
    db.incomingMessageMarkRead(id);
    return { ok: true, waId: res.waId };
  });

  // ══════════════════════════════════════════════════════════════════════════
  // AI — GENERATE 5 VARIANTS
  // ══════════════════════════════════════════════════════════════════════════

  handle('ai:generateVariants', (data) => aiSvc.generateVariants(data));

  // ══════════════════════════════════════════════════════════════════════════
  // ENGINE MODE
  // ══════════════════════════════════════════════════════════════════════════

  handle('engine:status',  ()        => adapter.status());
  handle('engine:setMode', (mode)    => {
    if (!['cloud','web','auto'].includes(mode)) throw new Error(`Invalid mode: ${mode}`);
    db.settingSet('active_engine', mode);
    return adapter.status();
  });

  // ══════════════════════════════════════════════════════════════════════════
  // WEBHOOK SERVER (Cloud API incoming messages)
  // ══════════════════════════════════════════════════════════════════════════

  handle('webhook:status', () => ({
    running: webhookSrv?.isRunning() || false,
    port:    webhookSrv?.getPort()   || null,
  }));

  handle('webhook:start', async (port) => {
    if (!webhookSrv) throw new Error('Webhook server not available');
    const p = await webhookSrv.start(port);
    db.settingSet('webhook_port', String(p));
    return { running: true, port: p };
  });

  handle('webhook:stop', () => {
    webhookSrv?.stop();
    return { running: false };
  });

  handle('webhook:saveConfig', ({ port, verifyToken }) => {
    if (port)        db.settingSet('webhook_port',         String(port));
    if (verifyToken) db.settingSet('webhook_verify_token', verifyToken);
    return { ok: true };
  });

  handle('webhook:getConfig', () => ({
    port:        db.settingGet('webhook_port')         || '3001',
    verifyToken: db.settingGet('webhook_verify_token') || 'ftwa-verify',
    running:     webhookSrv?.isRunning() || false,
  }));

  // ══════════════════════════════════════════════════════════════════════════
  // ANTI-BAN SERVICE
  // ══════════════════════════════════════════════════════════════════════════

  handle('antiban:getSettings', () => {
    if (!antiBanSvc) return {};
    return antiBanSvc.getSettings();
  });

  handle('antiban:setSettings', (data) => {
    const allowed = {
      antiban_enabled:         data.enabled          !== undefined ? String(data.enabled ? 1 : 0) : undefined,
      antiban_delay_profile:   data.delayProfile,
      antiban_daily_limit:     data.dailyLimit    !== undefined ? String(data.dailyLimit)    : undefined,
      antiban_hourly_limit:    data.hourlyLimit   !== undefined ? String(data.hourlyLimit)   : undefined,
      antiban_window_enabled:  data.timeWindowEnabled !== undefined ? String(data.timeWindowEnabled ? 1 : 0) : undefined,
      antiban_window_start:    data.timeWindowStart !== undefined ? String(data.timeWindowStart) : undefined,
      antiban_window_end:      data.timeWindowEnd   !== undefined ? String(data.timeWindowEnd)   : undefined,
      antiban_typing_sim:      data.typingSimEnabled !== undefined ? String(data.typingSimEnabled ? 1 : 0) : undefined,
      antiban_typing_min_ms:   data.typingMinMs  !== undefined ? String(data.typingMinMs)  : undefined,
      antiban_typing_max_ms:   data.typingMaxMs  !== undefined ? String(data.typingMaxMs)  : undefined,
    };
    for (const [k, v] of Object.entries(allowed)) {
      if (v !== undefined) db.settingSet(k, v);
    }
    if (antiBanSvc) antiBanSvc.reloadSettings();
    return { ok: true };
  });

  handle('antiban:getSessions', () => {
    if (!antiBanSvc) return db.sessionListAntiBan ? db.sessionListAntiBan() : [];
    return antiBanSvc.getAllSessionStats();
  });

  handle('antiban:getEvents', (limit) => {
    if (!antiBanSvc) return [];
    return antiBanSvc.getRecentEvents(limit || 100);
  });

  handle('antiban:resetSession', (sessionId) => {
    if (!antiBanSvc) throw new Error('Anti-ban service not available');
    antiBanSvc.resetSession(sessionId);
    return { ok: true };
  });

  handle('antiban:enableWarmup', (sessionId) => {
    if (!antiBanSvc) throw new Error('Anti-ban service not available');
    antiBanSvc.enableWarmup(sessionId);
    return { ok: true };
  });

  handle('antiban:disableWarmup', (sessionId) => {
    if (!antiBanSvc) throw new Error('Anti-ban service not available');
    antiBanSvc.disableWarmup(sessionId);
    return { ok: true };
  });

  handle('antiban:clearEvents', () => {
    db.antiBanEventClear();
    return { ok: true };
  });

  // ── AI Phase 4 — Intelligence features ───────────────────────────────────
  handle('ai:classify',        ({ text })       => aiSvc.classifyReply(text));
  handle('ai:smartReplies',    (payload)        => aiSvc.smartReplySuggestions(payload));
  handle('ai:summarize',       (payload)        => aiSvc.summarizeConversation(payload));
  handle('ai:optimizeCampaign',(payload)        => aiSvc.optimizeCampaign(payload));

  // ── AI Streaming (uses ipcMain.on for push events) ────────────────────────
  ipcMain.on('ai:streamChat', async (event, data) => {
    try {
      for await (const chunk of aiSvc.streamClaudeChat(data.messages || [], data.system)) {
        if (!event.sender.isDestroyed()) event.sender.send('ai:stream:event', chunk);
      }
    } catch (e) {
      if (!event.sender.isDestroyed()) event.sender.send('ai:stream:event', { type: 'error', text: e.message });
    }
  });

  // ── Audit Log ──────────────────────────────────────────────────────────────
  handle('audit:list',   ({ limit } = {}) => ({ ok: true, data: db.auditList(limit || 200) }));
  handle('audit:export', ()               => ({ ok: true, data: db.auditExport() }));
  handle('audit:log',    (payload)        => { db.auditLog(payload); return { ok: true }; });

  // ── Audience Builder ───────────────────────────────────────────────────────
  handle('audience:filter', ({ conditions }) => ({ ok: true, data: db.audienceFilter(conditions || []) }));
  handle('audience:save',   (payload)        => { db.audienceSave(payload); return { ok: true }; });
  handle('audience:list',   ()               => ({ ok: true, data: db.audienceList() }));
  handle('audience:delete', ({ id })         => { db.audienceDelete(id); return { ok: true }; });

  // ── Usage Stats ────────────────────────────────────────────────────────────
  handle('stats:dailySent', ({ days } = {}) => ({ ok: true, data: db.dailySentCount(days || 7) }));

}

module.exports = { register };
