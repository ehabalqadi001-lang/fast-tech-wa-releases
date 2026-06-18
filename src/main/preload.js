'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ─── Expose a safe API to the renderer ───────────────────────────────────────
// Only whitelisted channels can pass through. No raw Node/Electron APIs exposed.

contextBridge.exposeInMainWorld('ftwa', {

  // ── Window controls ──────────────────────────────────────────────────────
  minimize:  () => ipcRenderer.send('window:minimize'),
  maximize:  () => ipcRenderer.send('window:maximize'),
  close:     () => ipcRenderer.send('window:close'),

  // ── Dialogs ──────────────────────────────────────────────────────────────
  openFile:  (opts)  => ipcRenderer.invoke('dialog:openFile', opts),
  saveFile:  (opts)  => ipcRenderer.invoke('dialog:saveFile', opts),

  // ── App info ──────────────────────────────────────────────────────────────
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  getDataDir: () => ipcRenderer.invoke('app:getDataDir'),

  // ── Accounts ─────────────────────────────────────────────────────────────
  accounts: {
    list:    ()      => ipcRenderer.invoke('accounts:list'),
    save:    (data)  => ipcRenderer.invoke('accounts:save',   data),
    remove:  (id)    => ipcRenderer.invoke('accounts:remove', id),
    test:    (id)    => ipcRenderer.invoke('accounts:test',   id),
    getInfo: (id)    => ipcRenderer.invoke('accounts:getInfo', id),
  },

  // ── Contacts ─────────────────────────────────────────────────────────────
  contacts: {
    list:          (filter) => ipcRenderer.invoke('contacts:list',          filter),
    save:          (data)   => ipcRenderer.invoke('contacts:save',          data),
    remove:        (id)     => ipcRenderer.invoke('contacts:remove',        id),
    importExcel:   (path)   => ipcRenderer.invoke('contacts:importExcel',   path),
    exportExcel:   (opts)   => ipcRenderer.invoke('contacts:exportExcel',   opts),
    fixCountry:    (data)   => ipcRenderer.invoke('contacts:fixCountry',    data),
    deduplicate:   ()       => ipcRenderer.invoke('contacts:deduplicate'),
    previewImport: (path)   => ipcRenderer.invoke('contacts:previewImport', path),
  },

  // ── Groups ────────────────────────────────────────────────────────────────
  groups: {
    list:          ()     => ipcRenderer.invoke('groups:list'),
    upsert:        (data) => ipcRenderer.invoke('groups:upsert',       data),
    sync:          (id)   => ipcRenderer.invoke('groups:sync',         id),
    getMembers:    (id)   => ipcRenderer.invoke('groups:getMembers',   id),
    addMember:     (data) => ipcRenderer.invoke('groups:addMember',    data),
    removeMember:  (data) => ipcRenderer.invoke('groups:removeMember', data),
    getInviteLink: (id)   => ipcRenderer.invoke('groups:getInviteLink',id),
  },

  // ── Messages / Campaigns ─────────────────────────────────────────────────
  messages: {
    sendSingle:  (data)  => ipcRenderer.invoke('messages:sendSingle',  data),
    sendBulk:    (data)  => ipcRenderer.invoke('messages:sendBulk',    data),
    getHistory:  (phone) => ipcRenderer.invoke('messages:getHistory',  phone),
    getStats:    ()      => ipcRenderer.invoke('messages:getStats'),
  },

  // ── Scheduler ─────────────────────────────────────────────────────────────
  scheduler: {
    list:     ()      => ipcRenderer.invoke('scheduler:list'),
    create:   (data)  => ipcRenderer.invoke('scheduler:create',  data),
    update:   (data)  => ipcRenderer.invoke('scheduler:update',  data),
    remove:   (id)    => ipcRenderer.invoke('scheduler:remove',  id),
    pause:    (id)    => ipcRenderer.invoke('scheduler:pause',   id),
    resume:   (id)    => ipcRenderer.invoke('scheduler:resume',  id),
    runNow:   (id)    => ipcRenderer.invoke('scheduler:runNow',  id),
    presets:  ()      => ipcRenderer.invoke('scheduler:presets'),
  },

  // ── Templates ─────────────────────────────────────────────────────────────
  templates: {
    list:    ()       => ipcRenderer.invoke('templates:list'),
    save:    (data)   => ipcRenderer.invoke('templates:save',   data),
    remove:  (id)     => ipcRenderer.invoke('templates:remove', id),
    getWa:   (acctId) => ipcRenderer.invoke('templates:getWa',  acctId),
    send:    (data)   => ipcRenderer.invoke('templates:send',   data),
  },

  // ── Conversation view ─────────────────────────────────────────────────────
  conversation: {
    get: (phone, limit) => ipcRenderer.invoke('conversation:get', { phone, limit }),
  },

  // ── Media library ─────────────────────────────────────────────────────────
  media: {
    list:   ()           => ipcRenderer.invoke('media:list'),
    add:    (filePath)   => ipcRenderer.invoke('media:add',    { filePath }),
    delete: (id)         => ipcRenderer.invoke('media:delete', id),
  },

  // ── Dashboard ─────────────────────────────────────────────────────────────
  dashboard: {
    stats: () => ipcRenderer.invoke('dashboard:stats'),
  },

  // ── AI ────────────────────────────────────────────────────────────────────
  ai: {
    chat:             (data)  => ipcRenderer.invoke('ai:chat',             data),
    generateScript:   (data)  => ipcRenderer.invoke('ai:generateScript',   data),
    generateVariants: (data)  => ipcRenderer.invoke('ai:generateVariants', data),
    getKeys:          ()      => ipcRenderer.invoke('ai:getKeys'),
    saveKeys:         (keys)  => ipcRenderer.invoke('ai:saveKeys',         keys),
  },

  // ── CRM ───────────────────────────────────────────────────────────────────
  crm: {
    getConfig:      ()          => ipcRenderer.invoke('crm:getConfig'),
    saveConfig:     (data)      => ipcRenderer.invoke('crm:saveConfig',      data),
    testConnection: (type)      => ipcRenderer.invoke('crm:testConnection',  type),
    syncLeads:      (source)    => ipcRenderer.invoke('crm:syncLeads',       source),
    getLeads:       ()          => ipcRenderer.invoke('crm:getLeads'),
    triggerWebhook: (payload)   => ipcRenderer.invoke('crm:triggerWebhook',  payload),
    pushContacts:   (crmType)   => ipcRenderer.invoke('crm:pushContacts',    crmType),
  },

  // ── Reports ───────────────────────────────────────────────────────────────
  reports: {
    getSummary:   (range)  => ipcRenderer.invoke('reports:getSummary',  range),
    getCampaigns: ()       => ipcRenderer.invoke('reports:getCampaigns'),
    getReplies:   ()       => ipcRenderer.invoke('reports:getReplies'),
    exportExcel:  (range)  => ipcRenderer.invoke('reports:exportExcel', range),
  },

  // ── Settings ──────────────────────────────────────────────────────────────
  settings: {
    get:             ()      => ipcRenderer.invoke('settings:get'),
    save:            (data)  => ipcRenderer.invoke('settings:save',            data),
    backup:          ()      => ipcRenderer.invoke('settings:backup'),
    restore:         (path)  => ipcRenderer.invoke('settings:restore',         path),
    backupEncrypted: ()      => ipcRenderer.invoke('settings:backupEncrypted'),
  },

  // ── Engine mode ───────────────────────────────────────────────────────────
  engine: {
    status:  ()      => ipcRenderer.invoke('engine:status'),
    setMode: (mode)  => ipcRenderer.invoke('engine:setMode', mode),
  },

  // ── Webhook server ────────────────────────────────────────────────────────
  webhook: {
    status:     ()      => ipcRenderer.invoke('webhook:status'),
    start:      (port)  => ipcRenderer.invoke('webhook:start',      port),
    stop:       ()      => ipcRenderer.invoke('webhook:stop'),
    saveConfig: (data)  => ipcRenderer.invoke('webhook:saveConfig', data),
    getConfig:  ()      => ipcRenderer.invoke('webhook:getConfig'),
  },

  // ── WhatsApp Web sessions ─────────────────────────────────────────────────
  wa: {
    // Session lifecycle
    sessions: {
      list:    ()              => ipcRenderer.invoke('wa:sessions:list'),
      create:  (data)          => ipcRenderer.invoke('wa:sessions:create',  data),
      start:   (id)            => ipcRenderer.invoke('wa:sessions:start',   id),
      stop:    (id)            => ipcRenderer.invoke('wa:sessions:stop',    id),
      logout:  (id)            => ipcRenderer.invoke('wa:sessions:logout',  id),
      remove:  (id)            => ipcRenderer.invoke('wa:sessions:remove',  id),
      rename:  (data)          => ipcRenderer.invoke('wa:sessions:rename',  data),
    },
    // Direct send
    send: {
      text:             (data)       => ipcRenderer.invoke('wa:send:text',           data),
      media:            (data)       => ipcRenderer.invoke('wa:send:media',          data),
      bulk:             (opts)       => ipcRenderer.invoke('wa:send:bulk',           opts),
      queueStats:       ()           => ipcRenderer.invoke('wa:send:queueStats'),
      pause:            ()           => ipcRenderer.invoke('wa:send:pause'),
      resume:           ()           => ipcRenderer.invoke('wa:send:resume'),
      clearDone:        ()           => ipcRenderer.invoke('wa:send:clearDone'),
      importFromFile:   (path)       => ipcRenderer.invoke('send:importFromFile',    path),
      importFromSheets: (url)        => ipcRenderer.invoke('send:importFromSheets',  url),
      retryFailed:      (campaignId) => ipcRenderer.invoke('wa:send:retryFailed',    { campaignId }),
    },
    // A/B Testing results
    ab: {
      results:        (campaignId) => ipcRenderer.invoke('wa:ab:results',     campaignId),
      attributeReply: (phone)      => ipcRenderer.invoke('wa:ab:attributeReply', phone),
      autoWinner:     (campaignId) => ipcRenderer.invoke('wa:ab:autoWinner',  { campaignId }),
    },
    // Data extraction / scraping
    scraper: {
      getGroups:          (sessionId)            => ipcRenderer.invoke('wa:scraper:getGroups',         sessionId),
      getParticipants:    (data)                 => ipcRenderer.invoke('wa:scraper:getParticipants',   data),
      getInviteLink:      (data)                 => ipcRenderer.invoke('wa:scraper:getInviteLink',     data),
      getContacts:        (sessionId)            => ipcRenderer.invoke('wa:scraper:getContacts',       sessionId),
      exportParticipants: (data)                 => ipcRenderer.invoke('wa:scraper:exportParticipants',data),
      exportContacts:     (sessionId)            => ipcRenderer.invoke('wa:scraper:exportContacts',    sessionId),
      exportGroups:       (sessionId)            => ipcRenderer.invoke('wa:scraper:exportGroups',      sessionId),
      diagnose:           (sessionId)            => ipcRenderer.invoke('wa:scraper:diagnose',          sessionId),
    },
    // Inbox (incoming messages)
    inbox: {
      list:       (opts)       => ipcRenderer.invoke('wa:inbox:list',       opts),
      markRead:   (id)         => ipcRenderer.invoke('wa:inbox:markRead',   id),
      unread:     (sessionId)  => ipcRenderer.invoke('wa:inbox:unread',     sessionId),
      unreplied:  (sessionId)  => ipcRenderer.invoke('wa:inbox:unreplied',  sessionId),
      replyStats: ()           => ipcRenderer.invoke('wa:inbox:replyStats'),
      reply:      (data)       => ipcRenderer.invoke('wa:inbox:reply',      data),
    },
    // Group member management
    groups: {
      addMembers:          (data)     => ipcRenderer.invoke('wa:groups:addMembers',          data),
      removeMembers:       (data)     => ipcRenderer.invoke('wa:groups:removeMembers',       data),
      readPhonesFromExcel: (filePath) => ipcRenderer.invoke('wa:groups:readPhonesFromExcel', filePath),
      exportList:          (groups)   => ipcRenderer.invoke('wa:groups:exportList',          groups),
    },
  },

  // ── Anti-Ban ──────────────────────────────────────────────────────────────
  antiBan: {
    getSettings:     ()            => ipcRenderer.invoke('antiban:getSettings'),
    setSettings:     (data)        => ipcRenderer.invoke('antiban:setSettings',     data),
    getSessions:     ()            => ipcRenderer.invoke('antiban:getSessions'),
    getEvents:       (limit)       => ipcRenderer.invoke('antiban:getEvents',        limit),
    resetSession:    (id)          => ipcRenderer.invoke('antiban:resetSession',     id),
    enableWarmup:    (id)          => ipcRenderer.invoke('antiban:enableWarmup',     id),
    disableWarmup:   (id)          => ipcRenderer.invoke('antiban:disableWarmup',    id),
    clearEvents:     ()            => ipcRenderer.invoke('antiban:clearEvents'),
  },

  // ── License ───────────────────────────────────────────────────────────────
  license: {
    getMachineId:    ()    => ipcRenderer.invoke('license:getMachineId'),
    check:           ()    => ipcRenderer.invoke('license:check'),
    activate:        (key) => ipcRenderer.invoke('license:activate', key),
    deactivate:      ()    => ipcRenderer.invoke('license:deactivate'),
    getInfo:         ()    => ipcRenderer.invoke('license:getInfo'),
    expiryWarning:   ()    => ipcRenderer.invoke('license:expiryWarning'),
    openExternal:    (url) => ipcRenderer.invoke('license:openExternal', url),
  },

  // ── Auto-update ───────────────────────────────────────────────────────────
  update: {
    download: () => ipcRenderer.invoke('update:download'),
    install:  () => ipcRenderer.invoke('update:install'),
  },

  // ── Push notifications from main ──────────────────────────────────────────
  on: (channel, cb) => {
    const allowed = [
      'navigate',
      'notify',
      'campaign:progress',
      'campaign:done',
      // WhatsApp Web events
      'wa:qr',
      'wa:authenticated',
      'wa:ready',
      'wa:authFailed',
      'wa:disconnected',
      'wa:stateChange',
      'wa:message',
      'wa:ack',
      'wa:error',
      // Webhook / Cloud API events
      'wa:inbox:new',
      'wa:status:update',
      // Update events
      'update:checking',
      'update:available',
      'update:not-available',
      'update:progress',
      'update:downloaded',
      'update:error',
      'wakelock:state',
      // Anti-ban events
      'antiban:blocked',
      'antiban:banned',
      'antiban:suspended',
      'antiban:warmup:complete',
      'antiban:rate-limit',
      // Campaign progress
      'campaign:progress:live',
    ];
    if (allowed.includes(channel)) {
      // Wrap cb so we can remove it by reference via off()
      const handler = (_, ...args) => cb(...args);
      cb._ipcHandler = handler;  // store wrapper so off() can remove it
      ipcRenderer.on(channel, handler);
    }
  },
  off: (channel, cb) => {
    const handler = cb._ipcHandler || cb;
    ipcRenderer.removeListener(channel, handler);
  },
  offAll: (channel) => ipcRenderer.removeAllListeners(channel),
});
