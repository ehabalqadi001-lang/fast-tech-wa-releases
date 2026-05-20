'use strict';

/**
 * electron-builder afterPack hook — Injects watermark slot into app.asar
 *
 * Called automatically after each platform pack, BEFORE the installer is created.
 * Appends a 512-byte placeholder block to app.asar so WatermarkService can
 * overwrite it at activation time.
 *
 * Block layout:
 *   [0..7]    MAGIC  'FTWAWMV1'
 *   [8..511]  zeros  (payload written here at activation)
 *
 * Safe to run multiple times — checks for existing magic before injecting.
 */

const fs   = require('fs');
const path = require('path');

const WM_MAGIC = Buffer.from([0x46, 0x54, 0x57, 0x41, 0x57, 0x4D, 0x56, 0x31]);
const WM_TOTAL = 512;

exports.default = async (context) => {
  const asarPath = path.join(context.appOutDir, 'resources', 'app.asar');

  if (!fs.existsSync(asarPath)) {
    console.log('[WM-Hook] app.asar not found — skipping:', asarPath);
    return;
  }

  const stat = fs.statSync(asarPath);

  // Check if already injected (magic at expected offset)
  if (stat.size >= WM_TOTAL) {
    const fd   = fs.openSync(asarPath, 'r');
    const tail = Buffer.alloc(WM_MAGIC.length);
    fs.readSync(fd, tail, 0, WM_MAGIC.length, stat.size - WM_TOTAL);
    fs.closeSync(fd);
    if (tail.equals(WM_MAGIC)) {
      console.log('[WM-Hook] Slot already present — skipping:', asarPath);
      return;
    }
  }

  // Append 512-byte placeholder block
  const block = Buffer.alloc(WM_TOTAL, 0x00);
  WM_MAGIC.copy(block, 0);
  fs.appendFileSync(asarPath, block);

  console.log(`[WM-Hook] Watermark slot injected (+${WM_TOTAL} bytes): ${asarPath}`);
};
