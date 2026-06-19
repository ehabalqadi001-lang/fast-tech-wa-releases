'use strict';

const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── Service imports ────────────────────────────────────────────────────────
const Database       = require('./database');
const WaApi          = require('./whatsapp-api');
const WaWebService   = require('./whatsapp-web-service');
const SendingEngine  = require('./sending-engine');
const ScraperService = require('./scraper-service');
const Scheduler      = require('./scheduler');
const AiService      = require('./ai-service');
const Excel          = require('./excel-handler');
const EngineAdapter  = require('./engine-adapter');
const WebhookServer  = require('./webhook-server');
const IpcHandlers    = require('./ipc-handlers');
const LicenseService = require('./license-service');
const Updater        = require('./updater');
const { AntiBanService } = require('./anti-ban-service');
const SequenceService = require('./sequence-service');
const EventEmitter   = require('events');

// Internal bus — used to signal from IPC handlers to window lifecycle code
const _bus = new EventEmitter();

// ─── Globals ─────────────────────────────────────────────────────────────────
let mainWindow    = null;
let licenseWindow = null;
let tray          = null;
let db            = null;
let waSvc         = null;
let engine        = null;
let webhookSrv    = null;
let DATA_DIR      = null;
let licenseSvc    = null;

// ─── Static paths (safe at module init) ─────────────────────────────────────
const ICON_PATH    = path.join(__dirname, '..', '..', 'assets', 'icon.ico');
const HTML_PATH    = path.join(__dirname, '..', 'renderer', 'index.html');
const LICENSE_HTML = path.join(__dirname, '..', 'renderer', 'license.html');

// ─── Single instance lock ────────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

// ─── Security: block remote navigation & new windows ─────────────────────────
app.on('web-contents-created', (_, contents) => {
  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) {
      event.preventDefault();
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
});

// ─── License IPC (registered early — needed by license window) ───────────────
function registerLicenseIpc() {
  ipcMain.handle('license:getMachineId', () => licenseSvc.getMachineIdShort());
  ipcMain.handle('license:check',        () => licenseSvc.check());
  ipcMain.handle('license:activate',     async (_, key) => {
    const result = await licenseSvc.activate(key);
    if (result.success) {
      // Signal showLicenseWindow() to close the window and proceed
      _bus.emit('license:activated');
    }
    return result;
  });
  ipcMain.handle('license:deactivate',   () => licenseSvc.deactivate());
  ipcMain.handle('license:getInfo',      () => licenseSvc.getLocalInfo());
  ipcMain.handle('license:openExternal', (_, url) => {
    if (url && (url.startsWith('https://') || url.startsWith('mailto:'))) {
      shell.openExternal(url);
    }
  });
}

// ─── License window (shown when no valid license found) ──────────────────────
function showLicenseWindow() {
  return new Promise((resolve) => {
    licenseWindow = new BrowserWindow({
      width:           620,
      height:          540,
      frame:           false,
      resizable:       false,
      center:          true,
      alwaysOnTop:     true,
      backgroundColor: '#080c14',
      icon:            ICON_PATH,
      show:            false,
      webPreferences: {
        preload:          path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration:  false,
        sandbox:          false,
        webSecurity:      true,
      },
    });

    licenseWindow.loadFile(LICENSE_HTML);
    licenseWindow.once('ready-to-show', () => licenseWindow.show());

    // Activated successfully — close the license window and continue boot
    const onActivated = () => {
      const w = licenseWindow;
      licenseWindow = null;     // null BEFORE close so the 'closed' handler ignores it
      w?.close();
      resolve(true);
    };
    _bus.once('license:activated', onActivated);

    // User clicked X → quit the app
    licenseWindow.on('closed', () => {
      _bus.removeListener('license:activated', onActivated);
      if (licenseWindow === null) return; // was a programmatic close — already resolved
      resolve(false);
    });
  });
}

// ─── Create main window ───────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    frame: false,          // Custom title bar in renderer
    backgroundColor: '#0a0e1a',
    icon: ICON_PATH,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.loadFile(HTML_PATH);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Open DevTools in dev mode
    if (process.argv.includes('--dev')) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── System tray ─────────────────────────────────────────────────────────────
function createTray() {
  const iconExists = fs.existsSync(ICON_PATH);
  const img = iconExists
    ? nativeImage.createFromPath(ICON_PATH)
    : nativeImage.createEmpty();

  tray = new Tray(img);
  tray.setToolTip('Fast Tech WhatsApp Manager');

  const menu = Menu.buildFromTemplate([
    { label: 'فتح التطبيق',    click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: 'إخفاء',          click: () => mainWindow?.hide() },
    { type: 'separator' },
    {
      label: 'الحسابات النشطة',
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.send('navigate', 'accounts');
      },
    },
    {
      label: 'الحملات المجدولة',
      click: () => {
        mainWindow?.show();
        mainWindow?.webContents.send('navigate', 'scheduler');
      },
    },
    { type: 'separator' },
    {
      label: 'إغلاق',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', () => { mainWindow?.show(); mainWindow?.focus(); });
}

// ─── App menu (minimal — custom UI handles most things) ──────────────────────
function setAppMenu() {
  Menu.setApplicationMenu(null);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    // 0. Resolve data directory (must be inside whenReady — app.getPath requires Electron ready)
    DATA_DIR = path.join(app.getPath('userData'), 'fasttech-data');
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    // 1. License check (before anything else)
    licenseSvc = new LicenseService(DATA_DIR);
    registerLicenseIpc();

    const licStatus = await licenseSvc.check();
    if (!licStatus.valid) {
      const activated = await showLicenseWindow();
      if (!activated) {
        app.quit();
        return;
      }
    } else if (licStatus.grace) {
      console.warn(`[FTWA] License in grace period — ${licStatus.graceLeft} day(s) left`);
    } else if (licStatus.expiryWarning) {
      console.warn(`[FTWA] License expiring in ${licStatus.daysLeft} day(s)`);
    }

    // 2. Database
    db = new Database(DATA_DIR);
    await db.initialize();

    // 2. Core services
    const waApi  = new WaApi(db);
    const aiSvc  = new AiService(db);
    const excel  = new Excel();

    // 3. WhatsApp Web engine (unofficial multi-session)
    waSvc              = new WaWebService(db, DATA_DIR);
    const antiBanSvc   = new AntiBanService(db);
    antiBanSvc.start();
    engine             = new SendingEngine(db, waSvc, antiBanSvc);
    const scraper      = new ScraperService(db, waSvc);

    // 4. Engine adapter — unified routing (Cloud API or Web)
    const adapter = new EngineAdapter(db, waApi, waSvc, engine);

    // 5. Scheduler (now uses adapter — auto-selects engine)
    const scheduler = new Scheduler(db, adapter);

    // 6. Webhook server (Cloud API incoming messages)
    webhookSrv = new WebhookServer(db);
    // Auto-start webhook if previously enabled
    if (db.settingGet('webhook_autostart') === '1') {
      webhookSrv.start().catch(e =>
        console.warn('[FTWA] Webhook auto-start failed:', e.message)
      );
    }

    // 7. Sequence engine (Phase 7)
    const seqSvc = new SequenceService(db, engine, waSvc);
    seqSvc.start();

    // Wire keyword trigger: check incoming messages for sequence triggers
    if (waSvc) {
      waSvc.on('message', ({ sessionId, from, body }) => {
        seqSvc.checkKeywordTrigger(body, from?.replace('@c.us',''), sessionId).catch(() => {});
      });
    }

    // 8. IPC handlers (all services registered)
    IpcHandlers.register(ipcMain, {
      db, waApi, waSvc, engine, scraper, scheduler,
      aiSvc, excel, adapter, webhookSrv, antiBanSvc, seqSvc,
    });

    // 6. Window + tray
    setAppMenu();
    createWindow();
    createTray();

    // 8. Wire waSvc + webhookSrv to main window for IPC push events
    waSvc.setWindow(mainWindow);
    webhookSrv.setWindow(mainWindow);

    // 8b. Auto-updater (only for licensed users)
    Updater.initUpdater(mainWindow);
    Updater.checkForUpdates();

    // IPC: update actions from renderer
    ipcMain.handle('update:download', () => { Updater.downloadUpdate(); });
    ipcMain.handle('update:install',  () => { Updater.installUpdate(); });

    // IPC: license info from main window settings page
    ipcMain.handle('license:expiryWarning', () => {
      const s = licenseSvc.getLocalInfo();
      if (!s?.expiry) return null;
      const days = Math.ceil((new Date(s.expiry) - Date.now()) / 86400000);
      return days <= 14 ? { days } : null;
    });

    // 9. Start background services
    engine.start();
    await scheduler.loadAndStart();

    // 10. Auto-restart sessions that were 'ready' before last shutdown
    const prevReady = db.sessionList().filter(s => s.status === 'ready');
    for (const s of prevReady) {
      waSvc.startSession(s.id).catch(e =>
        console.warn(`[FTWA] Failed to resume session ${s.id}:`, e.message)
      );
    }

    console.log('[FTWA] App ready — data dir:', DATA_DIR);
  } catch (err) {
    console.error('[FTWA] Startup error:', err);
    dialog.showErrorBox(
      'خطأ في التشغيل',
      `فشل تشغيل التطبيق:\n${err.message}\n\nتحقق من ملف السجل وأعد المحاولة.`
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // Keep running in tray on Windows
  if (process.platform !== 'darwin') {
    // do NOT quit — tray keeps it alive
  }
});

app.on('activate', () => {
  if (!mainWindow) createWindow();
});

app.on('before-quit', async () => {
  app.isQuitting = true;
  engine?.stop();
  webhookSrv?.stop();
  await waSvc?.destroyAll().catch(() => {});
  db?.close();
});

// ─── IPC: Window controls (custom title bar) ─────────────────────────────────
ipcMain.on('window:minimize',    () => mainWindow?.minimize());
ipcMain.on('window:maximize',    () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close',       () => mainWindow?.hide());

// ─── IPC: Open file dialog ───────────────────────────────────────────────────
ipcMain.handle('dialog:openFile', async (_, opts = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: opts.filters || [{ name: 'All Files', extensions: ['*'] }],
  });
  return result.canceled ? null : result.filePaths[0];
});

// ─── IPC: Save file dialog ───────────────────────────────────────────────────
ipcMain.handle('dialog:saveFile', async (_, opts = {}) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: opts.defaultPath || 'export.xlsx',
    filters: opts.filters || [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  return result.canceled ? null : result.filePath;
});

// ─── IPC: App info ───────────────────────────────────────────────────────────
ipcMain.handle('app:getVersion',  () => app.getVersion());
ipcMain.handle('app:getDataDir',  () => DATA_DIR);

module.exports = { getMainWindow: () => mainWindow };
