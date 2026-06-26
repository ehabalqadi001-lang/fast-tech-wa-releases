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
    sendSingle:  (data)         => ipcRenderer.invoke('messages:sendSingle',  data),
    sendBulk:    (data)         => ipcRenderer.invoke('messages:sendBulk',    data),
    getHistory:  (phone)        => ipcRenderer.invoke('messages:getHistory',  phone),
    getStats:    ()             => ipcRenderer.invoke('messages:getStats'),
    search:      (query, limit) => ipcRenderer.invoke('messages:search',      { query, limit }),
    inboxSearch: (query, limit) => ipcRenderer.invoke('messages:inboxSearch', { query, limit }),
  },

  campaigns: {
    list: () => ipcRenderer.invoke('campaigns:list'),
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
    chat:             (data)    => ipcRenderer.invoke('ai:chat',              data),
    generateScript:   (data)    => ipcRenderer.invoke('ai:generateScript',    data),
    generateVariants: (data)    => ipcRenderer.invoke('ai:generateVariants',  data),
    getKeys:          ()        => ipcRenderer.invoke('ai:getKeys'),
    saveKeys:         (keys)    => ipcRenderer.invoke('ai:saveKeys',          keys),
    classify:         (text)    => ipcRenderer.invoke('ai:classify',         { text }),
    smartReplies:     (payload) => ipcRenderer.invoke('ai:smartReplies',      payload),
    summarize:        (payload) => ipcRenderer.invoke('ai:summarize',         payload),
    optimizeCampaign: (payload) => ipcRenderer.invoke('ai:optimizeCampaign',  payload),
    streamChat:       (data)    => ipcRenderer.send('ai:streamChat',          data),
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
      removeMembersByIds:  (data)     => ipcRenderer.invoke('wa:groups:removeMembersByIds',  data),
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
    adaptiveStatus:  ()            => ipcRenderer.invoke('antiban:adaptiveStatus'),
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

  // ── Phase 5: Chatbot Builder ──────────────────────────────────────────────
  chatbot: {
    list:   ()        => ipcRenderer.invoke('chatbot:list'),
    get:    (id)      => ipcRenderer.invoke('chatbot:get',    { id }),
    save:   (payload) => ipcRenderer.invoke('chatbot:save',   payload),
    delete: (id)      => ipcRenderer.invoke('chatbot:delete', { id }),
  },

  // ── Phase 5: Advanced Analytics ───────────────────────────────────────────
  analytics: {
    funnel:  (days) => ipcRenderer.invoke('analytics:funnel',  { days }),
    heatmap: (days) => ipcRenderer.invoke('analytics:heatmap', { days }),
  },

  // ── Phase 5: Reports PDF Export ───────────────────────────────────────────
  reports: {
    exportPDF: () => ipcRenderer.invoke('reports:exportPDF'),
  },

  // ── Phase 5: API Developer Mode ───────────────────────────────────────────
  devApi: {
    getKey:    ()      => ipcRenderer.invoke('api:getKey'),
    setKey:    (key)   => ipcRenderer.invoke('api:setKey',    { key }),
    getStatus: ()      => ipcRenderer.invoke('api:getStatus'),
  },

  // ── Audit Log ─────────────────────────────────────────────────────────────
  audit: {
    list:   (limit)   => ipcRenderer.invoke('audit:list',   { limit }),
    export: ()        => ipcRenderer.invoke('audit:export'),
    log:    (payload) => ipcRenderer.invoke('audit:log',    payload),
  },

  // ── Audience Builder ──────────────────────────────────────────────────────
  audience: {
    filter: (conditions) => ipcRenderer.invoke('audience:filter', { conditions }),
    save:   (payload)    => ipcRenderer.invoke('audience:save',   payload),
    list:   ()           => ipcRenderer.invoke('audience:list'),
    delete: (id)         => ipcRenderer.invoke('audience:delete', { id }),
  },

  // ── Usage Stats ───────────────────────────────────────────────────────────
  stats: {
    dailySent: (days) => ipcRenderer.invoke('stats:dailySent', { days }),
  },

  // ── Auto-update ───────────────────────────────────────────────────────────
  update: {
    download: () => ipcRenderer.invoke('update:download'),
    install:  () => ipcRenderer.invoke('update:install'),
  },

  // ── Phase 6: Team Management ─────────────────────────────────────────────
  team: {
    list:   ()      => ipcRenderer.invoke('team:list'),
    save:   (u)     => ipcRenderer.invoke('team:save',   u),
    delete: (id)    => ipcRenderer.invoke('team:delete', { id }),
  },

  // ── Phase 6: Conversation Assignments ────────────────────────────────────
  assign: {
    list:    (opts)    => ipcRenderer.invoke('assign:list',    opts),
    upsert:  (a)       => ipcRenderer.invoke('assign:upsert',  a),
    resolve: (phone)   => ipcRenderer.invoke('assign:resolve', { phone }),
    stats:   ()        => ipcRenderer.invoke('assign:stats'),
  },

  // ── Phase 7: Automation Sequences ────────────────────────────────────────
  sequences: {
    list:        ()       => ipcRenderer.invoke('seq:list'),
    get:         (id)     => ipcRenderer.invoke('seq:get',         { id }),
    save:        (seq)    => ipcRenderer.invoke('seq:save',        seq),
    delete:      (id)     => ipcRenderer.invoke('seq:delete',      { id }),
    toggle:      (id)     => ipcRenderer.invoke('seq:toggle',      { id }),
    enroll:      (opts)   => ipcRenderer.invoke('seq:enroll',      opts),
    unenroll:    (opts)   => ipcRenderer.invoke('seq:unenroll',    opts),
    enrollments: (id)     => ipcRenderer.invoke('seq:enrollments', { id }),
  },

  // ── Phase 8: Reseller Management ─────────────────────────────────────────
  reseller: {
    list:    ()           => ipcRenderer.invoke('reseller:list'),
    save:    (c)          => ipcRenderer.invoke('reseller:save',   c),
    delete:  (id)         => ipcRenderer.invoke('reseller:delete', { id }),
    usage:   (id, days)   => ipcRenderer.invoke('reseller:usage',  { id, days }),
    stats:   ()           => ipcRenderer.invoke('reseller:stats'),
    genKey:  ()           => ipcRenderer.invoke('reseller:genKey'),
  },

  // ── Phase 8: Branding ────────────────────────────────────────────────────
  branding: {
    get:  ()     => ipcRenderer.invoke('branding:get'),
    save: (data) => ipcRenderer.invoke('branding:save', data),
  },

  // ── E-Commerce ────────────────────────────────────────────────────────────
  ec: {
    // Categories
    categories: {
      list:   ()      => ipcRenderer.invoke('ec:categories:list'),
      save:   (data)  => ipcRenderer.invoke('ec:categories:save',   data),
      delete: (id)    => ipcRenderer.invoke('ec:categories:delete', id),
    },
    // Products
    products: {
      list:        (opts)  => ipcRenderer.invoke('ec:products:list',        opts),
      get:         (id)    => ipcRenderer.invoke('ec:products:get',         id),
      featured:    ()      => ipcRenderer.invoke('ec:products:featured'),
      lowStock:    ()      => ipcRenderer.invoke('ec:products:lowStock'),
      save:        (data)  => ipcRenderer.invoke('ec:products:save',        data),
      delete:      (id)    => ipcRenderer.invoke('ec:products:delete',      id),
      adjustStock: (data)  => ipcRenderer.invoke('ec:products:adjustStock', data),
      uploadImage: (data)  => ipcRenderer.invoke('ec:products:uploadImage', data),
    },
    // Variants
    variants: {
      list:   (productId) => ipcRenderer.invoke('ec:variants:list',   productId),
      save:   (data)      => ipcRenderer.invoke('ec:variants:save',   data),
      delete: (id)        => ipcRenderer.invoke('ec:variants:delete', id),
    },
    // Customers
    customers: {
      list:          (opts) => ipcRenderer.invoke('ec:customers:list',          opts),
      get:           (id)   => ipcRenderer.invoke('ec:customers:get',           id),
      save:          (data) => ipcRenderer.invoke('ec:customers:save',          data),
      loyaltyAdjust: (data) => ipcRenderer.invoke('ec:customers:loyaltyAdjust', data),
    },
    // Cart
    cart: {
      get:   (data) => ipcRenderer.invoke('ec:cart:get',    data),
      upsert:(data) => ipcRenderer.invoke('ec:cart:upsert', data),
      clear: (data) => ipcRenderer.invoke('ec:cart:clear',  data),
    },
    // Coupon
    coupon: {
      validate: (data) => ipcRenderer.invoke('ec:coupon:validate', data),
    },
    // Checkout
    checkout: (data) => ipcRenderer.invoke('ec:checkout', data),
    // Orders
    orders: {
      list:                (opts) => ipcRenderer.invoke('ec:orders:list',                opts),
      get:                 (id)   => ipcRenderer.invoke('ec:orders:get',                 id),
      updateStatus:        (data) => ipcRenderer.invoke('ec:orders:updateStatus',        data),
      updateTracking:      (data) => ipcRenderer.invoke('ec:orders:updateTracking',      data),
      triggerWaConfirmation:(data)=> ipcRenderer.invoke('ec:orders:triggerWaConfirmation',data),
    },
    // Coupons
    coupons: {
      list:   ()     => ipcRenderer.invoke('ec:coupons:list'),
      get:    (id)   => ipcRenderer.invoke('ec:coupons:get',    id),
      save:   (data) => ipcRenderer.invoke('ec:coupons:save',   data),
      delete: (id)   => ipcRenderer.invoke('ec:coupons:delete', id),
    },
    // Loyalty
    loyalty: {
      config:     ()      => ipcRenderer.invoke('ec:loyalty:config'),
      saveConfig: (data)  => ipcRenderer.invoke('ec:loyalty:saveConfig', data),
      history:    (id)    => ipcRenderer.invoke('ec:loyalty:history',    id),
    },
    // Shipping
    shipping: {
      list:      ()      => ipcRenderer.invoke('ec:shipping:list'),
      save:      (data)  => ipcRenderer.invoke('ec:shipping:save',      data),
      delete:    (id)    => ipcRenderer.invoke('ec:shipping:delete',    id),
      calculate: (data)  => ipcRenderer.invoke('ec:shipping:calculate', data),
    },
    // Reviews
    reviews: {
      list:    (productId) => ipcRenderer.invoke('ec:reviews:list',    productId),
      pending: ()          => ipcRenderer.invoke('ec:reviews:pending'),
      save:    (data)      => ipcRenderer.invoke('ec:reviews:save',    data),
      approve: (id)        => ipcRenderer.invoke('ec:reviews:approve', id),
    },
    // Analytics
    analytics: {
      overview:    ()      => ipcRenderer.invoke('ec:analytics:overview'),
      salesByDay:  (days)  => ipcRenderer.invoke('ec:analytics:salesByDay',  days),
      topProducts: (limit) => ipcRenderer.invoke('ec:analytics:topProducts', limit),
    },
    // WA Bot
    bot: {
      list:       ()   => ipcRenderer.invoke('ec:bot:list'),
      getByOrder: (id) => ipcRenderer.invoke('ec:bot:getByOrder', id),
    },
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
      'wa:qrExpired',
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
      'antiban:adaptive',
      // Campaign progress
      'campaign:progress:live',
      // AI streaming
      'ai:stream:event',
      // E-Commerce / WA Bot
      'ec:order:confirmed',
      'ec:order:cancelled',
      'ec:order:new',
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

// ── Marketing Pro Bridge (window.mp) ──────────────────────────────────────────
contextBridge.exposeInMainWorld('mp', {

  // Real-time IPC event listeners
  on:  (ch, fn) => ipcRenderer.on(ch, (_, d) => fn(d)),
  off: (ch, fn) => ipcRenderer.removeListener(ch, fn),

  // Social media accounts
  accounts: {
    list:    (f)   => ipcRenderer.invoke('mp:accounts:list',   f),
    add:     (d)   => ipcRenderer.invoke('mp:accounts:add',    d),
    update:  (i,d) => ipcRenderer.invoke('mp:accounts:update', i, d),
    delete:  (i)   => ipcRenderer.invoke('mp:accounts:delete', i),
    check:   (i)   => ipcRenderer.invoke('mp:accounts:check',  i),
    login:   (i)   => ipcRenderer.invoke('mp:accounts:login',  i),
    logout:  (i)   => ipcRenderer.invoke('mp:accounts:logout', i),
    groups:  (i)   => ipcRenderer.invoke('mp:accounts:groups', i),
  },

  // Dashboard
  dashboard: {
    stats:    ()  => ipcRenderer.invoke('mp:dashboard:stats'),
    activity: (n) => ipcRenderer.invoke('mp:dashboard:activity', n),
  },

  // Data extractor
  extractor: {
    start:       (o) => ipcRenderer.invoke('mp:extractor:start',       o),
    stop:        (i) => ipcRenderer.invoke('mp:extractor:stop',        i),
    leads:       (f) => ipcRenderer.invoke('mp:extractor:leads',       f),
    export:      (o) => ipcRenderer.invoke('mp:extractor:export',      o),
    deleteLead:  (i) => ipcRenderer.invoke('mp:extractor:deleteLead',  i),
  },

  // Campaigns (social media posts)
  campaigns: {
    list:   (f)   => ipcRenderer.invoke('mp:campaigns:list',   f),
    get:    (i)   => ipcRenderer.invoke('mp:campaigns:get',    i),
    create: (d)   => ipcRenderer.invoke('mp:campaigns:create', d),
    update: (i,d) => ipcRenderer.invoke('mp:campaigns:update', i, d),
    delete: (i)   => ipcRenderer.invoke('mp:campaigns:delete', i),
    start:  (i)   => ipcRenderer.invoke('mp:campaigns:start',  i),
    pause:  (i)   => ipcRenderer.invoke('mp:campaigns:pause',  i),
    stop:   (i)   => ipcRenderer.invoke('mp:campaigns:stop',   i),
    logs:   (i)   => ipcRenderer.invoke('mp:campaigns:logs',   i),
  },

  // Facebook Groups
  groups: {
    list:    (f)  => ipcRenderer.invoke('mp:groups:list',    f),
    add:     (d)  => ipcRenderer.invoke('mp:groups:add',     d),
    delete:  (i)  => ipcRenderer.invoke('mp:groups:delete',  i),
    fetch:   (ai) => ipcRenderer.invoke('mp:groups:fetch',   ai),
    join:    (o)  => ipcRenderer.invoke('mp:groups:join',    o),
    publish: (o)  => ipcRenderer.invoke('mp:groups:publish', o),
  },

  // Facebook Pages
  pages: {
    list:      (f) => ipcRenderer.invoke('mp:pages:list',      f),
    add:       (d) => ipcRenderer.invoke('mp:pages:add',       d),
    delete:    (i) => ipcRenderer.invoke('mp:pages:delete',    i),
    post:      (o) => ipcRenderer.invoke('mp:pages:post',      o),
    schedule:  (o) => ipcRenderer.invoke('mp:pages:schedule',  o),
    scheduled: (f) => ipcRenderer.invoke('mp:pages:scheduled', f),
  },

  // Broadcast / DM
  broadcast: {
    list:   (f)   => ipcRenderer.invoke('mp:broadcast:list',   f),
    create: (d)   => ipcRenderer.invoke('mp:broadcast:create', d),
    update: (i,d) => ipcRenderer.invoke('mp:broadcast:update', i, d),
    delete: (i)   => ipcRenderer.invoke('mp:broadcast:delete', i),
    import: (p)   => ipcRenderer.invoke('mp:broadcast:import', p),
    start:  (i)   => ipcRenderer.invoke('mp:broadcast:start',  i),
    pause:  (i)   => ipcRenderer.invoke('mp:broadcast:pause',  i),
    stop:   (i)   => ipcRenderer.invoke('mp:broadcast:stop',   i),
    logs:   (i)   => ipcRenderer.invoke('mp:broadcast:logs',   i),
  },

  // Smart Mention Campaigns
  mention: {
    list:    (f) => ipcRenderer.invoke('mp:mention:list',    f),
    get:     (i) => ipcRenderer.invoke('mp:mention:get',     i),
    create:  (d) => ipcRenderer.invoke('mp:mention:create',  d),
    delete:  (i) => ipcRenderer.invoke('mp:mention:delete',  i),
    extract: (o) => ipcRenderer.invoke('mp:mention:extract', o),
    publish: (o) => ipcRenderer.invoke('mp:mention:publish', o),
    start:   (i) => ipcRenderer.invoke('mp:mention:start',   i),
    pause:   (i) => ipcRenderer.invoke('mp:mention:pause',   i),
    stop:    (i) => ipcRenderer.invoke('mp:mention:stop',    i),
    logs:    (i) => ipcRenderer.invoke('mp:mention:logs',    i),
    members: (o) => ipcRenderer.invoke('mp:mention:members', o),
  },

  // Settings / Proxies / Templates
  settings: {
    get:  (k)   => ipcRenderer.invoke('mp:settings:get',  k),
    set:  (k,v) => ipcRenderer.invoke('mp:settings:set',  k, v),
    all:  ()    => ipcRenderer.invoke('mp:settings:all'),
    proxies: {
      list:   ()  => ipcRenderer.invoke('mp:settings:proxies:list'),
      add:    (d) => ipcRenderer.invoke('mp:settings:proxies:add',    d),
      delete: (i) => ipcRenderer.invoke('mp:settings:proxies:delete', i),
      check:  ()  => ipcRenderer.invoke('mp:settings:proxies:check'),
    },
    templates: {
      list:   (c) => ipcRenderer.invoke('mp:settings:templates:list',   c),
      add:    (d) => ipcRenderer.invoke('mp:settings:templates:add',    d),
      delete: (i) => ipcRenderer.invoke('mp:settings:templates:delete', i),
    },
  },

  // Shared utilities
  openFile: (o) => ipcRenderer.invoke('dialog:openFile', o),
  saveFile: (o) => ipcRenderer.invoke('dialog:saveFile', o),
});
