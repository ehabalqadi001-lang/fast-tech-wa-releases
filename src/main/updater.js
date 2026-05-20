'use strict';

/**
 * FAST TECH — Auto-Updater
 *
 * Uses electron-updater to check for new versions and notify the renderer.
 * Publish target: GitHub Releases (configure in package.json → build.publish).
 *
 * Renderer listens on:
 *   'update:checking'      — started checking
 *   'update:available'     { version, releaseNotes }
 *   'update:not-available' — already on latest
 *   'update:progress'      { percent, bytesPerSecond, total, transferred }
 *   'update:downloaded'    { version }
 *   'update:error'         { message }
 */

let _autoUpdater = null;
let _win         = null;

function _push(channel, payload) {
  try { _win?.webContents?.send(channel, payload); } catch (_) {}
}

function initUpdater(win) {
  _win = win;

  try {
    const { autoUpdater } = require('electron-updater');

    // Disable auto-downloading — we want user consent first
    autoUpdater.autoDownload        = false;
    autoUpdater.autoInstallOnAppQuit = true;

    // In development: skip update check entirely
    if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
      console.log('[Updater] Skipped in dev mode');
      return;
    }

    autoUpdater.on('checking-for-update', () => {
      _push('update:checking', {});
      console.log('[Updater] Checking for update...');
    });

    autoUpdater.on('update-available', (info) => {
      _push('update:available', {
        version:      info.version,
        releaseNotes: info.releaseNotes || '',
        releaseDate:  info.releaseDate  || '',
      });
      console.log('[Updater] Update available:', info.version);
    });

    autoUpdater.on('update-not-available', () => {
      _push('update:not-available', {});
      console.log('[Updater] App is up-to-date');
    });

    autoUpdater.on('download-progress', (progress) => {
      _push('update:progress', {
        percent:          Math.round(progress.percent),
        bytesPerSecond:   progress.bytesPerSecond,
        transferred:      progress.transferred,
        total:            progress.total,
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      _push('update:downloaded', { version: info.version });
      console.log('[Updater] Update downloaded:', info.version);
    });

    autoUpdater.on('error', (err) => {
      _push('update:error', { message: err.message });
      console.warn('[Updater] Error:', err.message);
    });

    _autoUpdater = autoUpdater;

  } catch (err) {
    // electron-updater not installed — silently skip
    console.warn('[Updater] electron-updater not available:', err.message);
  }
}

/** Check for updates now (called on app startup, after license verified) */
function checkForUpdates() {
  if (!_autoUpdater) return;
  // Delay 5s so the main window has time to render first
  setTimeout(() => {
    _autoUpdater.checkForUpdates().catch(e =>
      console.warn('[Updater] Check failed:', e.message)
    );
  }, 5000);
}

/** Download the pending update (called from renderer via IPC) */
function downloadUpdate() {
  if (!_autoUpdater) return;
  _autoUpdater.downloadUpdate().catch(e =>
    console.warn('[Updater] Download failed:', e.message)
  );
}

/** Install the downloaded update and restart (called from renderer via IPC) */
function installUpdate() {
  if (!_autoUpdater) return;
  _autoUpdater.quitAndInstall(false, true);
}

module.exports = { initUpdater, checkForUpdates, downloadUpdate, installUpdate };
