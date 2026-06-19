'use strict';

/**
 * FAST TECH WhatsApp Cyber Nexus — WhatsApp Web Multi-Session Manager
 *
 * Manages up to 25 simultaneous whatsapp-web.js sessions via Puppeteer.
 * Auth data is persisted locally (LocalAuth) — QR is only needed once per device.
 * QR codes and all session events are pushed to the renderer via IPC.
 */

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode       = require('qrcode');
const path         = require('path');
const EventEmitter = require('events');

const MAX_SESSIONS = 25;

class WhatsAppWebService extends EventEmitter {
  /**
   * @param {import('./database')} db
   * @param {string} dataDir  — persistent data directory (app.getPath('userData')/fasttech-data)
   */
  constructor(db, dataDir) {
    super();
    this._db            = db;
    this._dataDir       = dataDir;
    this._clients       = new Map();   // sessionId → Client instance
    this._states        = new Map();   // sessionId → state string
    this._win           = null;        // BrowserWindow — set after window creation
    this._qrTimers      = new Map();   // sessionId → QR expiry timeout handle
    this._keepAlive     = new Map();   // sessionId → keep-alive interval handle
    this._reconnecting  = new Set();   // sessions currently reconnecting
  }

  // ── QR timeout helpers ────────────────────────────────────────────────────
  _startQrTimer(sessionId) {
    this._clearQrTimer(sessionId);
    const t = setTimeout(async () => {
      if (this._states.get(sessionId) !== 'qr') return;
      console.warn(`[WA-WEB] QR expired for ${sessionId}`);
      this._setState(sessionId, 'qr_expired');
      this._db.sessionUpdateField(sessionId, 'status',  'qr_expired');
      this._db.sessionUpdateField(sessionId, 'qr_code', null);
      this._push('wa:qrExpired', { sessionId });
      const c = this._clients.get(sessionId);
      if (c) { await c.destroy().catch(() => {}); this._clients.delete(sessionId); }
      this._qrTimers.delete(sessionId);
    }, 90_000); // 90 seconds — give user time to open phone
    this._qrTimers.set(sessionId, t);
  }

  _clearQrTimer(sessionId) {
    const t = this._qrTimers.get(sessionId);
    if (t) { clearTimeout(t); this._qrTimers.delete(sessionId); }
  }

  // ── Keep-alive helpers ────────────────────────────────────────────────────
  _startKeepAlive(sessionId) {
    this._stopKeepAlive(sessionId);
    const interval = setInterval(async () => {
      const client = this._clients.get(sessionId);
      if (!client) { this._stopKeepAlive(sessionId); return; }
      try {
        const state = await client.getState();
        if (state !== 'CONNECTED') {
          console.warn(`[WA-WEB] Keep-alive: ${sessionId} not connected (${state}) — triggering reconnect`);
          this._stopKeepAlive(sessionId);
          this._handleSilentDisconnect(sessionId, client, state || 'TIMEOUT');
        }
      } catch (err) {
        console.warn(`[WA-WEB] Keep-alive check failed for ${sessionId}:`, err.message);
        this._stopKeepAlive(sessionId);
        this._handleSilentDisconnect(sessionId, client, 'KEEP_ALIVE_ERROR');
      }
    }, 30_000); // check every 30 seconds
    this._keepAlive.set(sessionId, interval);
  }

  _stopKeepAlive(sessionId) {
    const iv = this._keepAlive.get(sessionId);
    if (iv) { clearInterval(iv); this._keepAlive.delete(sessionId); }
  }

  async _handleSilentDisconnect(sessionId, client, reason) {
    if (this._reconnecting.has(sessionId)) return;
    this._reconnecting.add(sessionId);
    this._setState(sessionId, 'disconnected');
    this._db.sessionUpdateField(sessionId, 'status', 'disconnected');
    this._push('wa:disconnected', { sessionId, reason });
    try { await client.destroy().catch(() => {}); } catch (_) {}
    this._clients.delete(sessionId);
    this._states.delete(sessionId);
    this._reconnecting.delete(sessionId);
    console.log(`[WA-WEB] Silent disconnect handled for ${sessionId}`);
  }

  /** Must be called after createWindow() so IPC events reach the renderer */
  setWindow(win) { this._win = win; }

  // ─── IPC push helper ───────────────────────────────────────────────────────
  _push(channel, payload) {
    try { this._win?.webContents?.send(channel, payload); } catch (_) {}
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SESSION LIFECYCLE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Start (or resume) a WhatsApp web session.
   * If auth data exists on disk, the session resumes without a new QR scan.
   * If not, a QR code is generated and pushed to the renderer via 'wa:qr'.
   *
   * @param {string} sessionId  — must already exist in wa_sessions table
   */
  async startSession(sessionId) {
    if (this._clients.has(sessionId)) {
      return { started: false, message: 'Session already running' };
    }
    if (this._clients.size >= MAX_SESSIONS) {
      throw new Error(`Maximum of ${MAX_SESSIONS} concurrent sessions reached`);
    }

    const record = this._db.sessionGet(sessionId);
    if (!record) throw new Error(`Session not found in DB: ${sessionId}`);

    this._setState(sessionId, 'initializing');

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: sessionId,
        dataPath:  path.join(this._dataDir, 'wa-auth'),
      }),
      puppeteer: {
        headless: true,
        protocolTimeout: 180000,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-extensions',
          '--disable-gpu',
        ],
      },
    });

    // ── QR code received ────────────────────────────────────────────────────
    client.on('qr', async (raw) => {
      try {
        const dataUrl = await qrcode.toDataURL(raw, { width: 300, margin: 2 });
        this._setState(sessionId, 'qr');
        this._db.sessionUpdateField(sessionId, 'qr_code', dataUrl);
        this._db.sessionUpdateField(sessionId, 'status',  'qr');
        this._push('wa:qr', { sessionId, qr: dataUrl });
        this._startQrTimer(sessionId); // ← auto-expire if not scanned in 90s
      } catch (err) {
        console.error('[WA-WEB] QR error:', err.message);
      }
    });

    // ── Authenticated (session keys saved, not yet ready) ───────────────────
    client.on('authenticated', () => {
      this._clearQrTimer(sessionId); // ← QR was scanned successfully
      this._setState(sessionId, 'authenticated');
      this._db.sessionUpdateField(sessionId, 'status', 'authenticated');
      this._push('wa:authenticated', { sessionId });
    });

    // ── Client fully ready to send/receive ──────────────────────────────────
    client.on('ready', () => {
      this._clearQrTimer(sessionId);
      const info  = client.info;
      const phone = info?.wid?.user || '';
      this._setState(sessionId, 'ready');
      this._db.sessionSetReady(sessionId, phone);
      this._push('wa:ready', { sessionId, phone, pushname: info?.pushname || record.name });
      this._startKeepAlive(sessionId); // ← heartbeat: detect silent disconnects
      console.log(`[WA-WEB] Ready: ${sessionId} (${phone})`);
    });

    // ── Auth failure (bad session / banned) ─────────────────────────────────
    client.on('auth_failure', (msg) => {
      this._clearQrTimer(sessionId);
      this._stopKeepAlive(sessionId);
      this._setState(sessionId, 'auth_failed');
      this._db.sessionUpdateField(sessionId, 'status', 'auth_failed');
      this._db.sessionUpdateField(sessionId, 'qr_code', null);
      this._clients.delete(sessionId);
      this._push('wa:authFailed', { sessionId, message: msg });
      this.emit('auth_failure_internal', sessionId);
      console.warn(`[WA-WEB] Auth failure: ${sessionId}`);
    });

    // ── Disconnected (network / logged out from phone) ──────────────────────
    client.on('disconnected', (reason) => {
      this._clearQrTimer(sessionId);
      this._stopKeepAlive(sessionId);
      this._setState(sessionId, 'disconnected');
      this._db.sessionUpdateField(sessionId, 'status', 'disconnected');
      this._db.sessionUpdateField(sessionId, 'qr_code', null);
      this._clients.delete(sessionId);
      this._states.delete(sessionId);
      this._push('wa:disconnected', { sessionId, reason });
      console.log(`[WA-WEB] Disconnected: ${sessionId} — ${reason}`);
    });

    // ── Incoming message ────────────────────────────────────────────────────
    client.on('message', async (msg) => {
      if (msg.fromMe) return;
      const isGroup = msg.from.includes('@g.us');
      const from    = msg.from.replace(/@[cg]\.us$/, '');

      // Resolve group name for display
      let groupName = null;
      if (isGroup) {
        try {
          const chat = await msg.getChat();
          groupName  = chat.name || null;
          // Sync to DB if we have it stored
          const stored = this._db.groupList().find(g => g.id === msg.from);
          if (stored && !stored.name && groupName) {
            this._db._db.prepare('UPDATE groups SET name=? WHERE id=?').run(groupName, msg.from);
          }
        } catch (_) {}
      }

      this._db.incomingMessageSave({
        session_id:  sessionId,
        from_number: from,
        body:        msg.body || '',
        msg_type:    msg.type || 'chat',
        has_media:   msg.hasMedia ? 1 : 0,
        is_group:    isGroup ? 1 : 0,
        group_name:  groupName || null,
        timestamp:   new Date(msg.timestamp * 1000).toISOString(),
      });

      this._push('wa:message', {
        sessionId,
        from,
        groupName,
        body:      msg.body,
        type:      msg.type,
        timestamp: msg.timestamp,
        isGroup,
      });
    });

    // ── Delivery / read acknowledgement ────────────────────────────────────
    client.on('message_ack', (msg, ack) => {
      const statusMap = { 2: 'sent', 3: 'delivered', 4: 'read', 5: 'played' };
      const status = statusMap[ack];
      if (status && msg.id?._serialized) {
        this._db.queueUpdateByWaId(msg.id._serialized, status);
        this._push('wa:ack', { sessionId, waId: msg.id._serialized, ack, status });
      }
    });

    this._clients.set(sessionId, client);

    // initialize() launches Puppeteer asynchronously — errors surface here
    client.initialize().catch((err) => {
      console.error(`[WA-WEB] Init error for ${sessionId}:`, err.message);
      this._clients.delete(sessionId);
      this._setState(sessionId, 'error');
      this._db.sessionUpdateField(sessionId, 'status', 'error');
      this._push('wa:error', { sessionId, error: err.message });
    });

    return { started: true, sessionId };
  }

  /**
   * Stop session without logging out.
   * Auth data remains on disk — next startSession() will resume without QR.
   */
  async stopSession(sessionId) {
    this._clearQrTimer(sessionId);
    this._stopKeepAlive(sessionId);
    const client = this._clients.get(sessionId);
    if (client) {
      await client.destroy().catch(() => {});
      this._clients.delete(sessionId);
    }
    this._states.delete(sessionId);
    this._db.sessionUpdateField(sessionId, 'status', 'stopped');
    this._push('wa:stateChange', { sessionId, state: 'stopped' });
    return { stopped: true };
  }

  async logoutSession(sessionId) {
    this._clearQrTimer(sessionId);
    this._stopKeepAlive(sessionId);
    const client = this._clients.get(sessionId);
    if (client) {
      await client.logout().catch(() => {});
      await client.destroy().catch(() => {});
      this._clients.delete(sessionId);
    }
    this._states.delete(sessionId);
    this._db.sessionUpdateField(sessionId, 'status', 'logged_out');
    this._db.sessionUpdateField(sessionId, 'phone',  '');
    this._push('wa:stateChange', { sessionId, state: 'logged_out' });
    return { loggedOut: true };
  }

  /** Returns all DB sessions with their current runtime state merged in */
  getActiveSessions() {
    return this._db.sessionList().map(s => ({
      ...s,
      active: this._clients.has(s.id),
      state:  this._states.get(s.id) || s.status,
    }));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MESSAGING
  // ══════════════════════════════════════════════════════════════════════════

  async sendText(sessionId, to, text) {
    const client = this._readyClient(sessionId);
    const chatId = this._toChatId(to);
    const msg    = await client.sendMessage(chatId, text);
    this._db.sessionBumpUsage(sessionId);
    return { waId: msg.id._serialized };
  }

  async sendMedia(sessionId, to, filePath, caption = '') {
    const client = this._readyClient(sessionId);
    const chatId = this._toChatId(to);
    const media  = MessageMedia.fromFilePath(filePath);
    const msg    = await client.sendMessage(chatId, media, { caption });
    this._db.sessionBumpUsage(sessionId);
    return { waId: msg.id._serialized };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SCRAPING / EXTRACTION
  // ══════════════════════════════════════════════════════════════════════════

  // ─── internal: read current chat store snapshot ─────────────────────────
  async _readChatStore(pupPage) {
    return pupPage.evaluate(() => {
      try {
        let store = null;
        if (window.require) {
          try { store = window.require('WAWebCollections').Chat; } catch (_) {}
          if (!store) try { store = window.require('WAWebCollections').ChatCollection; } catch (_) {}
        }
        if (!store && window.Store) store = window.Store.Chat;

        if (!store || typeof store.getModelsArray !== 'function') {
          return { __error: 'Chat store not found', __storeKeys: Object.keys(window.Store || {}).join(',') };
        }

        const models = store.getModelsArray();
        return {
          __count: models.length,
          chats: models
            .filter(c => c && c.id && c.id._serialized)
            .map(c => {
              const id = c.id._serialized;
              const isGroup = !!c.isGroup || id.endsWith('@g.us');
              // Try all known locations for participant count (no server call)
              const memberCount = isGroup ? (
                c.groupMetadata?.size
                || c.groupMetadata?.participants?.getModelsArray?.()?.length
                || c.groupMetadata?.participants?.length
                || c.groupMetadata?.memberCount
                || c.participantsCount
                || 0
              ) : 0;
              return {
                id,
                name:        c.name || c.formattedTitle || c.displayName || c.id.user || '',
                isGroup,
                memberCount,
                unread:      c.unreadCount || 0,
                timestamp:   c.t || 0,
              };
            }),
        };
      } catch (e) {
        return { __error: e.message };
      }
    });
  }

  async _readContactStore(pupPage) {
    return pupPage.evaluate(() => {
      try {
        let store = null;
        if (window.require) {
          try { store = window.require('WAWebCollections').Contact; } catch (_) {}
          if (!store) try { store = window.require('WAWebCollections').ContactCollection; } catch (_) {}
        }
        if (!store && window.Store) store = window.Store.Contact;

        if (!store || typeof store.getModelsArray !== 'function') {
          return { __error: 'Contact store not found' };
        }

        const models = store.getModelsArray();
        return {
          __count: models.length,
          contacts: models
            .filter(c => {
              if (!c || !c.id || !c.id._serialized) return false;
              const id = c.id._serialized;
              // only real individual contacts
              return id.endsWith('@c.us') && !c.isMe && c.id.user;
            })
            .map(c => ({
              id:          c.id._serialized,
              phone:       c.id.user,
              name:        c.pushname || c.name || c.shortName || '',
              isMyContact: !!c.isMyContact,
            })),
        };
      } catch (e) {
        return { __error: e.message };
      }
    });
  }

  // ─── internal: trigger WA Web UI to load all groups into memory ─────────
  async _forceLoadAllGroups(pupPage) {
    // Global 25-second timeout — prevents UI freeze if WhatsApp is slow
    const timeoutP = new Promise((_, rej) =>
      setTimeout(() => rej(new Error('forceLoadAllGroups timeout after 25s')), 25000)
    );
    const workP = pupPage.evaluate(async () => {
      try {
        // 1. Click the "Groups" filter tab to make WA fetch all groups from server
        const allBtns = Array.from(document.querySelectorAll('[data-tab], [role="tab"], .zoWT4'));
        const groupsTab = allBtns.find(b =>
          (b.dataset && b.dataset.tab === '3') ||
          (b.innerText && /group|جروب|مجموعة/i.test(b.innerText))
        );
        if (groupsTab) {
          groupsTab.click();
          await new Promise(r => setTimeout(r, 2000));
        }

        // 2. Scroll chat pane to force lazy-loading more chats (max 20 iterations)
        const pane = document.querySelector('#pane-side') ||
                     document.querySelector('[data-testid="chat-list"]') ||
                     document.querySelector('.chat-list');
        if (pane) {
          for (let i = 0; i < 20; i++) {
            pane.scrollTop = pane.scrollHeight;
            await new Promise(r => setTimeout(r, 250));
          }
          pane.scrollTop = 0;
          await new Promise(r => setTimeout(r, 300));
          for (let i = 0; i < 20; i++) {
            pane.scrollTop = pane.scrollHeight;
            await new Promise(r => setTimeout(r, 150));
          }
        }

        // 3. Click "All" tab to restore default view
        const allTab = allBtns.find(b =>
          (b.dataset && b.dataset.tab === '1') ||
          (b.innerText && /^all$|^الكل$/i.test(b.innerText.trim()))
        );
        if (allTab) { allTab.click(); await new Promise(r => setTimeout(r, 800)); }

        return { done: true };
      } catch (e) {
        return { done: false, error: e.message };
      }
    });
    try {
      return await Promise.race([workP, timeoutP]);
    } catch (e) {
      console.warn('[WA-WEB] _forceLoadAllGroups:', e.message);
      return { done: false, error: e.message };
    }
  }

  async getAllChats(sessionId) {
    const client = this._readyClient(sessionId);

    // Phase 1 — fast read: what's already in memory?
    let snap = await this._readChatStore(client.pupPage);

    if (snap.__error) {
      console.error('[WA-WEB] Chat store error:', snap.__error, '| storeKeys:', snap.__storeKeys);
      throw new Error(`فشل الوصول لمتجر المحادثات: ${snap.__error}`);
    }

    const beforeCount = snap.__count || 0;
    console.log(`[WA-WEB] Initial store snapshot: ${beforeCount} chats`);

    // Phase 2 — if we got a suspiciously small number, trigger a full UI load
    if (beforeCount < 50) {
      console.log('[WA-WEB] Store seems incomplete — triggering full group load via UI...');
      const loadResult = await this._forceLoadAllGroups(client.pupPage);
      console.log('[WA-WEB] Force-load result:', loadResult);

      // Wait a moment for the store to settle
      await new Promise(r => setTimeout(r, 2000));

      // Re-read the store
      snap = await this._readChatStore(client.pupPage);
      if (snap.__error) throw new Error(`فشل إعادة قراءة المتجر: ${snap.__error}`);
      console.log(`[WA-WEB] After force-load: ${snap.__count} chats`);
    }

    const all = (snap.chats || []).filter(
      c => !c.id.startsWith('status@') && !c.id.startsWith('newsletter@')
    );
    const groups = all.filter(c => c.isGroup);

    console.log(`[WA-WEB] getAllChats: ${all.length} total (${groups.length} groups) — session ${sessionId}`);

    if (all.length === 0) {
      throw new Error('قائمة المحادثات فارغة — تأكد أن الجلسة متصلة بالكامل ثم أعد المحاولة');
    }

    return all;
  }

  // ─── Diagnostic: expose store info to renderer for debugging ─────────────
  async diagnoseScraping(sessionId) {
    const client = this._readyClient(sessionId);
    const snap   = await this._readChatStore(client.pupPage);

    const allChats  = snap.chats || [];
    const groups    = allChats.filter(c => c.isGroup);
    const contacts  = allChats.filter(c => !c.isGroup);

    return {
      ok:            !snap.__error,
      error:         snap.__error || null,
      storeKeys:     snap.__storeKeys || null,
      totalInStore:  snap.__count || 0,
      groups:        groups.length,
      contacts:      contacts.length,
      sample:        groups.slice(0, 5).map(g => ({ id: g.id, name: g.name })),
    };
  }

  async getGroupParticipants(sessionId, groupId) {
    const client = this._readyClient(sessionId);

    const result = await client.pupPage.evaluate((gid) => {
      try {
        let chatStore = null;
        if (window.require) {
          try { chatStore = window.require('WAWebCollections').Chat; } catch (_) {}
        }
        if (!chatStore && window.Store) chatStore = window.Store.Chat;

        const chat = chatStore?.get?.(gid)
          || chatStore?.getModelsArray?.()?.find?.(c => c.id?._serialized === gid);

        if (!chat) return { __error: 'المجموعة غير موجودة في الذاكرة: ' + gid };

        const gm = chat.groupMetadata;
        if (!gm) return { __error: 'بيانات المجموعة غير محمّلة — افتح المجموعة في واتساب أولاً: ' + gid };

        // participants may be a Backbone collection or a plain array
        const list = typeof gm.participants?.getModelsArray === 'function'
          ? gm.participants.getModelsArray()
          : (Array.isArray(gm.participants) ? gm.participants : []);

        // toPn converts a LID wid → phone wid (needed since WA now stores participants as LIDs)
        let toPn = null;
        try { toPn = window.require('WAWebLidMigrationUtils').toPn; } catch (_) {}

        return list
          .filter(p => p && p.id && p.id._serialized)
          .map(p => {
            let phoneUser = p.id.user;
            // If ID is a LID (server === 'lid'), resolve to actual phone number
            if (p.id.server === 'lid' && toPn) {
              try {
                const phoneWid = toPn(p.id);
                if (phoneWid?.user) phoneUser = phoneWid.user;
              } catch (_) {}
            }
            return {
              id:           p.id._serialized,   // original (may be @lid) — needed for removal
              phone:        phoneUser,           // actual phone number for matching
              isAdmin:      !!p.isAdmin,
              isSuperAdmin: !!p.isSuperAdmin,
            };
          });
      } catch (e) {
        return { __error: e.message };
      }
    }, groupId);

    if (!Array.isArray(result)) {
      throw new Error(result?.__error || 'فشل جلب المشاركين');
    }

    return result;
  }

  async getGroupInviteLink(sessionId, groupId) {
    const chat = await this._readyClient(sessionId).getChatById(groupId);
    if (!chat.isGroup) throw new Error('Not a group chat');
    const code = await chat.getInviteCode();
    return `https://chat.whatsapp.com/${code}`;
  }

  async addGroupMembers(sessionId, groupId, phones) {
    const client = this._readyClient(sessionId);
    const chat   = await client.getChatById(groupId);
    if (!chat.isGroup) throw new Error('ليس محادثة مجموعة');

    const BATCH = 5;
    let added = 0;
    for (let i = 0; i < phones.length; i += BATCH) {
      const ids = phones.slice(i, i + BATCH).map(p => this._toChatId(p));
      await chat.addParticipants(ids);
      added += ids.length;
      if (i + BATCH < phones.length) await new Promise(r => setTimeout(r, 2000));
    }
    return { added };
  }

  async removeGroupMembers(sessionId, groupId, phones, dryRun = false) {
    const client = this._readyClient(sessionId);

    // Build member map inside Puppeteer to avoid IPC serialisation issues with LIDs.
    // Returns { members: [{id, phone}], error? }
    const lookup = await client.pupPage.evaluate((gid) => {
      try {
        const chatStore = window.require('WAWebCollections').Chat;
        const chat = chatStore?.get?.(gid)
          || chatStore?.getModelsArray?.()?.find?.(c => c.id?._serialized === gid);
        if (!chat) return { __error: 'المجموعة غير موجودة: ' + gid };

        const gm = chat.groupMetadata;
        if (!gm) return { __error: 'بيانات المجموعة غير محمّلة — افتح المجموعة في واتساب أولاً' };

        const list = typeof gm.participants?.getModelsArray === 'function'
          ? gm.participants.getModelsArray()
          : (Array.isArray(gm.participants) ? gm.participants : []);

        let toPn = null;
        try { toPn = window.require('WAWebLidMigrationUtils').toPn; } catch (_) {}

        return list
          .filter(p => p && p.id && p.id._serialized)
          .map(p => {
            let phoneUser = p.id.user;
            if (p.id.server === 'lid' && toPn) {
              try { const w = toPn(p.id); if (w?.user) phoneUser = w.user; } catch (_) {}
            }
            return { id: p.id._serialized, phone: phoneUser };
          });
      } catch (e) {
        return { __error: e.message };
      }
    }, groupId);

    if (!Array.isArray(lookup)) {
      throw new Error(lookup?.__error || 'فشل جلب أعضاء المجموعة');
    }

    // Build multi-key phone → id map for flexible matching
    // Handles: exact, leading-zero strip, suffix (last 9 digits for country-code mismatches)
    const memberMap = new Map(); // normalized phone → id
    const suffixMap = new Map(); // last-9-digits → {phone, id}
    for (const m of lookup) {
      const phone = String(m.phone || '').replace(/\D/g, '');
      if (!phone || phone.length < 6) continue;
      memberMap.set(phone, m.id);
      if (phone.startsWith('0')) memberMap.set(phone.slice(1), m.id);
      const suf = phone.slice(-9);
      if (suf.length >= 8 && !suffixMap.has(suf)) suffixMap.set(suf, { phone, id: m.id });
    }

    const found    = [];
    const notFound = [];
    for (const raw of phones) {
      const clean = String(raw).replace(/\D/g, '');
      if (!clean) continue;
      if (memberMap.has(clean)) {
        found.push({ phone: clean, id: memberMap.get(clean) });
      } else {
        const suf   = clean.slice(-9);
        const match = suf.length >= 8 ? suffixMap.get(suf) : null;
        if (match) found.push({ phone: match.phone, id: match.id });
        else        notFound.push(clean);
      }
    }

    // Compute sample phones (real phone numbers only, no LIDs) for user hint
    const samplePhones = lookup
      .map(m => m.phone).filter(p => p && /^\d{7,}$/.test(p) && p.length <= 15)
      .slice(0, 3).join(', ');

    if (dryRun) {
      return {
        dryRun:       true,
        found:        found.map(f => f.phone),
        notFound,
        removed:      0,
        memberCount:  lookup.length,
        sampleFormat: samplePhones,
      };
    }

    if (!found.length) {
      return {
        removed: 0, found: [], notFound,
        warning: `لم يُعثر على الأرقام المدخلة في المجموعة (${lookup.length} عضو)`,
        hint:    samplePhones ? `أمثلة من أرقام المجموعة: ${samplePhones}` : 'تأكد من إدخال الأرقام بالتنسيق الدولي (بدون +)',
      };
    }

    // Direct removal via Backbone models — bypasses enforceLidAndPnRetrieval which fails for LIDs
    const BATCH = 5;
    let removed = 0;
    for (let i = 0; i < found.length; i += BATCH) {
      const batchIds = found.slice(i, i + BATCH).map(f => f.id);
      await client.pupPage.evaluate(async (chatId, ids) => {
        const chatModel = await window.WWebJS.getChat(chatId, { getAsModel: false });
        const toRemove = ids
          .map(id => chatModel.groupMetadata.participants.get(id))
          .filter(Boolean);
        if (!toRemove.length) throw new Error('الأعضاء غير موجودين في الـ store');
        await window.require('WAWebModifyParticipantsGroupAction').removeParticipants(chatModel, toRemove);
      }, groupId, batchIds);
      removed += batchIds.length;
      if (i + BATCH < found.length) await new Promise(r => setTimeout(r, 1500));
    }
    return { removed, found: found.map(f => f.phone), notFound };
  }

  // Remove members by their raw participant IDs (@lid or @s.whatsapp.net) — bypasses phone matching entirely
  async removeMembersByIds(sessionId, groupId, memberIds) {
    const client = this._readyClient(sessionId);
    const BATCH  = 5;
    let removed  = 0;
    const errors = [];

    for (let i = 0; i < memberIds.length; i += BATCH) {
      const batchIds = memberIds.slice(i, i + BATCH);
      try {
        await client.pupPage.evaluate(async (chatId, ids) => {
          const chatModel = await window.WWebJS.getChat(chatId, { getAsModel: false });
          const toRemove  = ids.map(id => chatModel.groupMetadata.participants.get(id)).filter(Boolean);
          if (!toRemove.length) throw new Error('الأعضاء غير موجودين في الـ store');
          await window.require('WAWebModifyParticipantsGroupAction').removeParticipants(chatModel, toRemove);
        }, groupId, batchIds);
        removed += batchIds.length;
      } catch (e) {
        errors.push(e.message);
      }
      if (i + BATCH < memberIds.length) await new Promise(r => setTimeout(r, 1500));
    }

    return { removed, errors };
  }

  async getPhoneContacts(sessionId) {
    const client = this._readyClient(sessionId);

    // Phase 1 — read Contact store directly (no server round-trips)
    const contactSnap = await this._readContactStore(client.pupPage);
    if (!contactSnap.__error && contactSnap.contacts?.length > 0) {
      console.log(`[WA-WEB] getPhoneContacts: ${contactSnap.contacts.length} from Contact store`);
      return contactSnap.contacts;
    }
    console.warn('[WA-WEB] Contact store empty/unavailable, falling back to Chat store');

    // Phase 2 — extract individual contacts from the Chat store (already loaded)
    const chatSnap = await this._readChatStore(client.pupPage);
    if (!chatSnap.__error && chatSnap.chats?.length > 0) {
      const contacts = chatSnap.chats
        .filter(c => !c.isGroup && c.id.endsWith('@c.us'))
        .map(c => ({
          id:          c.id,
          phone:       c.id.replace('@c.us', ''),
          name:        c.name || '',
          isMyContact: true,
        }));
      console.log(`[WA-WEB] getPhoneContacts: ${contacts.length} from Chat store fallback`);
      return contacts;
    }

    console.warn('[WA-WEB] Both stores empty — returning []');
    return [];
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ══════════════════════════════════════════════════════════════════════════

  _readyClient(sessionId) {
    const client = this._clients.get(sessionId);
    if (!client) throw new Error(`Session not active: ${sessionId}`);
    const state  = this._states.get(sessionId);
    if (state !== 'ready') throw new Error(`Session not ready (${state}): ${sessionId}`);
    return client;
  }

  _toChatId(phone) {
    if (String(phone).includes('@')) return phone;
    return `${String(phone).replace(/\D/g, '')}@c.us`;
  }

  _setState(sessionId, state) {
    this._states.set(sessionId, state);
    this._push('wa:stateChange', { sessionId, state });
  }

  /** Called by SendingEngine to check whether a session can accept messages */
  isReady(sessionId) {
    return this._states.get(sessionId) === 'ready';
  }

  /** Graceful shutdown — destroy all Puppeteer instances */
  async destroyAll() {
    const tasks = [...this._clients.values()].map(c => c.destroy().catch(() => {}));
    await Promise.allSettled(tasks);
    this._clients.clear();
    this._states.clear();
    console.log('[WA-WEB] All sessions destroyed');
  }
}

module.exports = WhatsAppWebService;
