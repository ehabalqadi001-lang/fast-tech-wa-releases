'use strict';

const path = require('path');
const fs   = require('fs');

/** @param {import('../types').HandlerContext} ctx */
function register(ctx) {
  const { handle, db, waSvc, scraper, engine, antiBanSvc, uuidv4, pushAll, enableWakeLock } = ctx;

  // ── Sessions ───────────────────────────────────────────────────────────────
  handle('wa:sessions:list',   () => waSvc ? waSvc.getActiveSessions() : db.sessionList());
  handle('wa:sessions:create', ({ name }) => {
    if (!name?.trim()) throw new Error('اسم الجلسة مطلوب');
    const id = uuidv4();
    db.sessionCreate({ id, name: name.trim() });
    return db.sessionGet(id);
  });
  handle('wa:sessions:start',  async (id) => { if (!waSvc) throw new Error('Web engine N/A'); return waSvc.startSession(id); });
  handle('wa:sessions:stop',   async (id) => { if (!waSvc) throw new Error('Web engine N/A'); return waSvc.stopSession(id); });
  handle('wa:sessions:logout', async (id) => { if (!waSvc) throw new Error('Web engine N/A'); return waSvc.logoutSession(id); });
  handle('wa:sessions:remove', async (id) => {
    if (waSvc) await waSvc.stopSession(id).catch(() => {});
    db.sessionDelete(id);
    return { removed: true };
  });
  handle('wa:sessions:rename', ({ id, name }) => { db.sessionUpdateField(id, 'name', name); return db.sessionGet(id); });

  // ── Direct send ────────────────────────────────────────────────────────────
  handle('wa:send:text',  async ({ sessionId, to, body })           => { if (!waSvc) throw new Error('Web engine N/A'); return waSvc.sendText(sessionId, to, body); });
  handle('wa:send:media', async ({ sessionId, to, filePath, caption }) => { if (!waSvc) throw new Error('Web engine N/A'); return waSvc.sendMedia(sessionId, to, filePath, caption || ''); });

  // ── Bulk send via queue ────────────────────────────────────────────────────
  handle('wa:send:bulk', (opts) => {
    if (!engine) throw new Error('Send engine N/A');
    const scriptsData   = opts.scripts_data || [];
    const legacyScripts = opts.scripts      || [];
    const allScripts = scriptsData.length
      ? scriptsData
      : legacyScripts.map(s => (typeof s === 'string' ? { text: s, mediaPath: null } : s));
    const firstText  = allScripts[0]?.text || opts.body || '';
    const firstMedia = allScripts[0]?.mediaPath || opts.mediaPath || null;
    const campaignId = uuidv4();
    const campaignAccountId = (() => {
      if (!opts.sessionId) return null;
      try { return db.accountGet(opts.sessionId) ? opts.sessionId : null; } catch { return null; }
    })();
    db.campaignCreate({
      id: campaignId, name: opts.campaignName || `حملة ${new Date().toLocaleDateString('ar')}`,
      type: 'individual', account_id: campaignAccountId, message_body: firstText,
      media_path: firstMedia, media_type: null,
      delay_sec: Math.round((opts.delayMin || 15000) / 1000), total: opts.recipients?.length || 0,
    });
    db.campaignUpdateStatus(campaignId, 'running', { sent: 0, failed: 0 });
    if (allScripts.length) { try { db.campaignScriptsInsert(campaignId, allScripts); } catch (_) {} }
    const allowedSessions = opts.allowedSessions?.length ? opts.allowedSessions : null;
    const items = (opts.recipients || []).map((r, i) => ({
      recipient: r, body: opts.body || null, scripts: allScripts.length ? allScripts : null,
      sessionId: allowedSessions ? allowedSessions[i % allowedSessions.length] : (opts.sessionId || null),
      campaignId, mediaPath: firstMedia, delayMin: opts.delayMin || 15000, delayMax: opts.delayMax || 45000,
    }));
    const result = engine.enqueue(items);
    if (items.length > 0) enableWakeLock();
    return result;
  });

  handle('wa:send:queueStats', () => engine ? engine.stats() : null);
  handle('wa:send:pause',      () => { engine?.pause();  return { ok: true }; });
  handle('wa:send:resume',     () => { engine?.resume(); return { ok: true }; });
  handle('wa:send:clearDone',  () => { db.queueClearCompleted(); return { ok: true }; });
  handle('wa:send:retryFailed',({ campaignId }) => {
    const n = db.queueRetryFailed(campaignId || null);
    if (n > 0) engine?.wake?.();
    return { requeued: n };
  });

  // ── A/B Testing ────────────────────────────────────────────────────────────
  handle('wa:ab:results', (campaignId) => {
    if (campaignId) return { campaign: db.campaignGet(campaignId), scripts: db.campaignScriptsGet(campaignId) };
    return { campaigns: db.abResultsList() };
  });
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
  handle('wa:ab:autoWinner', ({ campaignId }) => db.abGetWinner(campaignId));

  // ── Scraper ────────────────────────────────────────────────────────────────
  handle('wa:scraper:getGroups',       async (sessionId)        => { if (!scraper) throw new Error('Scraper N/A'); return scraper.scrapeGroups(sessionId); });
  handle('wa:scraper:diagnose',        async (sessionId)        => { if (!waSvc)   throw new Error('WA N/A'); return waSvc.diagnoseScraping(sessionId); });
  handle('wa:scraper:getParticipants', async ({ sessionId, groupId }) => { if (!scraper) throw new Error('Scraper N/A'); return scraper.scrapeGroupParticipants(sessionId, groupId); });
  handle('wa:scraper:getInviteLink',   async ({ sessionId, groupId }) => { if (!scraper) throw new Error('Scraper N/A'); return scraper.scrapeGroupInviteLink(sessionId, groupId); });
  handle('wa:scraper:getContacts',     async (sessionId)        => { if (!scraper) throw new Error('Scraper N/A'); return scraper.scrapeContacts(sessionId); });

  handle('wa:scraper:exportParticipants', async ({ sessionId, groupId, groupName }) => {
    if (!scraper) throw new Error('Scraper N/A');
    const { app } = require('electron');
    const outPath = path.join(app.getPath('downloads'), `participants-${Date.now()}.xlsx`);
    const parts = await scraper.scrapeGroupParticipants(sessionId, groupId);
    scraper.exportParticipantsToExcel(parts, groupName || groupId, outPath);
    return { path: outPath, count: parts.length };
  });

  handle('wa:scraper:exportContacts', async (sessionId) => {
    if (!scraper) throw new Error('Scraper N/A');
    const { app } = require('electron');
    const outPath = path.join(app.getPath('downloads'), `wa-contacts-${Date.now()}.xlsx`);
    const contacts = await scraper.scrapeContacts(sessionId);
    scraper.exportContactsToExcel(contacts, outPath);
    return { path: outPath, count: contacts.length };
  });

  handle('wa:scraper:exportGroups', async (sessionId) => {
    if (!scraper) throw new Error('Scraper N/A');
    const { app } = require('electron');
    const outPath = path.join(app.getPath('downloads'), `wa-groups-${Date.now()}.xlsx`);
    const groups = sessionId ? await scraper.scrapeGroups(sessionId) : db.groupList();
    scraper.exportGroupsToExcel(groups, outPath);
    return { path: outPath, count: groups.length };
  });

  // ── Group member management ────────────────────────────────────────────────
  handle('wa:groups:addMembers',       async ({ sessionId, groupId, phones })           => { if (!waSvc) throw new Error('Web N/A'); return waSvc.addGroupMembers(sessionId, groupId, phones); });
  handle('wa:groups:removeMembers',    async ({ sessionId, groupId, phones, dryRun })   => { if (!waSvc) throw new Error('Web N/A'); return waSvc.removeGroupMembers(sessionId, groupId, phones, !!dryRun); });
  handle('wa:groups:removeMembersByIds',async ({ sessionId, groupId, memberIds })       => { if (!waSvc) throw new Error('Web N/A'); return waSvc.removeMembersByIds(sessionId, groupId, memberIds); });

  handle('wa:groups:readPhonesFromExcel', (filePath) => {
    const XLSX = require('xlsx');
    const wb   = XLSX.readFile(filePath);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
    const phones = [];
    for (const row of rows) {
      if (!row?.length) continue;
      for (const cell of row) {
        const s = String(cell ?? '').trim().replace(/[\s\-\+\(\)]/g, '');
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
      '#': i+1, 'اسم المجموعة': g.name||'', 'معرف المجموعة': g.id||'',
      'رابط دعوة المجموعة': g.invite_link||'— لم يُجلب —',
      'عدد الأعضاء': g.member_count||0, 'آخر مزامنة': g.synced_at ? new Date(g.synced_at).toLocaleString('ar') : '',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{wch:4},{wch:30},{wch:28},{wch:50},{wch:12},{wch:22}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'المجموعات');
    XLSX.writeFile(wb, outPath);
    return { path: outPath, count: rows.length };
  });

  // ── Inbox ──────────────────────────────────────────────────────────────────
  handle('wa:inbox:list', (opts) => {
    if (typeof opts === 'string' || opts == null) return db.incomingMessageList(opts || null);
    return db.incomingMessageList(opts.sessionId || null, opts.limit || 200, opts.filter || null);
  });
  handle('wa:inbox:markRead',   (id)        => { db.incomingMessageMarkRead(id); return { ok: true }; });
  handle('wa:inbox:unread',     (sessionId) => db.incomingUnreadCount(sessionId));
  handle('wa:inbox:unreplied',  (sessionId) => db.incomingUnrepliedCount(sessionId));
  handle('wa:inbox:replyStats', ()          => db.incomingReplyStats());
  handle('wa:inbox:reply', async ({ id, replyBody, sessionId: replySessionId }) => {
    if (!waSvc) throw new Error('Web engine N/A');
    const msg = db.incomingMessageGet(id);
    if (!msg) throw new Error('الرسالة غير موجودة');
    const sid = replySessionId || msg.session_id;
    if (!sid) throw new Error('لا توجد جلسة للرد');
    const res = await waSvc.sendText(sid, msg.from_number, replyBody);
    db.incomingMessageMarkReplied(id, { replyBody, repliedBy: sid });
    db.incomingMessageMarkRead(id);
    return { ok: true, waId: res.waId };
  });

  // ── Engine mode ────────────────────────────────────────────────────────────
  handle('engine:status',  ()     => ctx.adapter.status());
  handle('engine:setMode', (mode) => {
    if (!['cloud','web','auto'].includes(mode)) throw new Error(`Invalid mode: ${mode}`);
    db.settingSet('active_engine', mode);
    return ctx.adapter.status();
  });
}

module.exports = { register };
