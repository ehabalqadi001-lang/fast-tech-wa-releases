'use strict';

/**
 * Fast Tech WA Manager — IPC Handler Registry (v6.2.0)
 * Thin orchestrator: sets up shared context, then delegates to domain modules.
 */

const { v4: uuidv4 }  = require('uuid');
const V               = require('./validate');
const SecureStore     = require('./secure-store');

// Domain handler modules
const accountsH  = require('./handlers/accounts');
const contactsH  = require('./handlers/contacts');
const messagingH = require('./handlers/messaging');
const waH        = require('./handlers/wa');
const aiH        = require('./handlers/ai');
const crmH       = require('./handlers/crm');
const settingsH  = require('./handlers/settings');
const antibanH   = require('./handlers/antiban');
const teamH      = require('./handlers/team');
const resellerH  = require('./handlers/reseller');
const analyticsH = require('./handlers/analytics');
const ecH        = require('./handlers/ecommerce');

function register(ipcMain, deps) {
  const { db, engine, waSvc, antiBanSvc } = deps;

  // ── Shared infrastructure ─────────────────────────────────────────────────
  const secStore = new SecureStore(db);
  try { secStore.migrateExisting(); } catch (e) { console.warn('[SecureStore] migrate:', e.message); }
  if (deps.aiSvc && typeof deps.aiSvc._secStore !== 'undefined') deps.aiSvc._secStore = secStore;

  const { powerSaveBlocker, BrowserWindow } = require('electron');
  let _wakeLockId = null;

  function pushAll(channel, data) {
    BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, data));
  }
  function enableWakeLock() {
    if (_wakeLockId !== null && powerSaveBlocker.isStarted(_wakeLockId)) return;
    _wakeLockId = powerSaveBlocker.start('prevent-app-suspension');
    pushAll('wakelock:state', { active: true });
  }
  function disableWakeLock() {
    if (_wakeLockId !== null) {
      if (powerSaveBlocker.isStarted(_wakeLockId)) powerSaveBlocker.stop(_wakeLockId);
      _wakeLockId = null;
      pushAll('wakelock:state', { active: false });
    }
  }

  // Engine & anti-ban event hooks
  engine.on('queue:drained', () => disableWakeLock());
  engine.on('antiban:blocked', ({ sessionId, reason }) => pushAll('antiban:blocked', { sessionId, reason }));

  if (waSvc && antiBanSvc) {
    waSvc.on('auth_failure_internal', (sessionId) => antiBanSvc.recordAuthFailure(sessionId));
    antiBanSvc.on('session:banned',    (d) => pushAll('antiban:banned',          d));
    antiBanSvc.on('session:suspended', (d) => pushAll('antiban:suspended',       d));
    antiBanSvc.on('warmup:complete',   (d) => pushAll('antiban:warmup:complete', d));
    antiBanSvc.on('rate-limit',        (d) => pushAll('antiban:rate-limit',      d));
    antiBanSvc.on('adaptive:adjusted', (d) => pushAll('antiban:adaptive',        d));
  }

  // Wrapped handler — every IPC call gets try/catch + ok/err envelope
  function handle(channel, fn) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        const result = await fn(...args);
        // If the handler already returns { ok, ... } pass it through; otherwise wrap
        if (result && typeof result === 'object' && 'ok' in result) return result;
        return { ok: true, data: result };
      } catch (e) {
        console.error(`[IPC:${channel}]`, e.message);
        return { ok: false, error: String(e?.message || e) };
      }
    });
  }

  // ── Build shared handler context ─────────────────────────────────────────
  const ctx = {
    ...deps,
    secStore,
    V,
    uuidv4,
    handle,
    pushAll,
    enableWakeLock,
    disableWakeLock,
    ipcMain,
  };

  // ── Register all domain handlers ─────────────────────────────────────────
  accountsH.register(ctx);
  contactsH.register(ctx);
  messagingH.register(ctx);
  waH.register(ctx);
  aiH.register(ctx);
  crmH.register(ctx);
  settingsH.register(ctx);
  antibanH.register(ctx);
  teamH.register(ctx);
  resellerH.register(ctx);
  analyticsH.register(ctx);
  ecH.register(ctx);
}

module.exports = { register };
