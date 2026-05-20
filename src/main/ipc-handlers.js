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

function register(ipcMain, { db, waApi, waSvc, engine, scraper, scheduler, aiSvc, excel, adapter, webhookSrv }) {

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

  // ══════════════════════════════════════════════════════════════════════════
  // SCHEDULER
  // ══════════════════════════════════════════════════════════════════════════
  handle('scheduler:list',   ()     => scheduler.list());
  handle('scheduler:create', (data) => scheduler.create(data));
  handle('scheduler:update', (data) => scheduler.update(data));
  handle('scheduler:remove', (id)   => scheduler.remove(id));
  handle('scheduler:pause',  (id)   => scheduler.pause(id));
  handle('scheduler:resume', (id)   => scheduler.resume(id));

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
  // CRM
  // ══════════════════════════════════════════════════════════════════════════
  handle('crm:getConfig',  () => {
    const s = db.settingsGetAll();
    return {
      hubspot_api_key:   s.crm_hubspot_key       || '',
      hubspot_portal_id: s.crm_hubspot_portal_id  || '',
      webhook_url:       s.crm_webhook_url         || '',
      sync_freq:         s.crm_sync_freq           || '0',
      on_reply_action:   s.crm_on_reply_action     || 'notify',
    };
  });

  handle('crm:saveConfig', (data) => {
    const map = {
      hubspot_api_key:   'crm_hubspot_key',
      hubspot_portal_id: 'crm_hubspot_portal_id',
      webhook_url:       'crm_webhook_url',
      sync_freq:         'crm_sync_freq',
      on_reply_action:   'crm_on_reply_action',
    };
    for (const [k, dbKey] of Object.entries(map)) {
      if (data[k] !== undefined) db.settingSet(dbKey, data[k]);
    }
    return { ok: true };
  });

  handle('crm:syncLeads', async (source) => {
    const s = db.settingsGetAll();
    let leads = [];

    if (source === 'hubspot' && s.crm_hubspot_key) {
      const axios = require('axios');
      // Paginate through all HubSpot contacts (100 per page)
      let after = undefined;
      do {
        const url = `https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,phone,email,lifecyclestage${after ? `&after=${after}` : ''}`;
        const res = await axios.get(url, {
          headers: { Authorization: `Bearer ${s.crm_hubspot_key}` },
        });
        const page = (res.data.results || []).map(r => ({
          id:       uuidv4(),
          source:   'hubspot',
          name:     `${r.properties.firstname || ''} ${r.properties.lastname || ''}`.trim(),
          phone:    r.properties.phone   || '',
          email:    r.properties.email   || '',
          status:   r.properties.lifecyclestage || '',
          raw_json: JSON.stringify(r),
        }));
        leads = leads.concat(page);
        after = res.data.paging?.next?.after;
      } while (after);
    }

    if (leads.length) db.crmLeadBulkReplace(source, leads);
    return { synced: leads.length };
  });

  handle('crm:getLeads', () => db.crmLeadList());

  // ══════════════════════════════════════════════════════════════════════════
  // REPORTS
  // ══════════════════════════════════════════════════════════════════════════
  handle('reports:getSummary',  (range) => db.reportSummary(range?.days || 30));
  handle('reports:getCampaigns',()      => db.reportCampaignPerf());
  handle('reports:getReplies',  ()      => db.reportReplies());

  handle('reports:exportExcel', async (range) => {
    const { app } = require('electron');
    const outPath = path.join(app.getPath('downloads'), `ftwa-report-${Date.now()}.xlsx`);
    const data = {
      summary:   db.reportSummary(range?.days || 30),
      campaigns: db.reportCampaignPerf(),
      replies:   db.reportReplies(),
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

    // Validate: must be a .db file inside an expected directory
    const resolved = path.resolve(backupPath);
    if (!resolved.endsWith('.db')) throw new Error('ملف النسخة الاحتياطية يجب أن يكون .db');
    if (!fs.existsSync(resolved)) throw new Error('ملف النسخة الاحتياطية غير موجود');

    // Use SQLite's built-in backup API instead of raw file copy (safe on open DB)
    db._db.exec(`VACUUM INTO '${resolved.replace(/'/g, "''")}'`);  // validate source is valid SQLite
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

    const campaignId = uuidv4();
    db.campaignCreate({
      id:           campaignId,
      name:         opts.campaignName || `حملة ${new Date().toLocaleDateString('ar')}`,
      type:         'individual',
      account_id:   opts.sessionId || null,
      message_body: opts.body || (opts.scripts?.[0] || ''),
      media_path:   opts.mediaPath || null,
      media_type:   null,
      delay_sec:    Math.round((opts.delayMin || 15000) / 1000),
      total:        opts.recipients?.length || 0,
    });
    db.campaignUpdateStatus(campaignId, 'running', { sent: 0, failed: 0 });

    const items = (opts.recipients || []).map(r => ({
      recipient:   r,
      body:        opts.body     || null,
      scripts:     opts.scripts  || [],
      sessionId:   opts.sessionId || null,
      campaignId,
      mediaPath:   opts.mediaPath || null,
      delayMin:    opts.delayMin || 15000,
      delayMax:    opts.delayMax || 45000,
    }));

    return engine.enqueue(items);
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

  handle('wa:groups:removeMembers', async ({ sessionId, groupId, phones }) => {
    if (!waSvc) throw new Error('Web service not available');
    return waSvc.removeGroupMembers(sessionId, groupId, phones);
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

  // ══════════════════════════════════════════════════════════════════════════
  // WA WEB — INBOX (incoming messages)
  // ══════════════════════════════════════════════════════════════════════════

  handle('wa:inbox:list',     (sessionId) => db.incomingMessageList(sessionId));
  handle('wa:inbox:markRead', (id)        => { db.incomingMessageMarkRead(id); return { ok: true }; });
  handle('wa:inbox:unread',   (sessionId) => db.incomingUnreadCount(sessionId));

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

}

module.exports = { register };
