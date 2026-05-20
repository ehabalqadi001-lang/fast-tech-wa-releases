'use strict';

/**
 * Hardware Fingerprint — produces a stable SHA-256 ID for the current machine.
 * Combines: MAC address, BIOS UUID, disk serial, hostname, CPU model.
 * Windows-only WMI queries with graceful fallback for each component.
 */

const { execSync } = require('child_process');
const crypto = require('crypto');
const os     = require('os');

let _cached = null;

function _ps(cmd) {
  try {
    return execSync(cmd, {
      shell:       'powershell.exe',
      timeout:     7000,
      windowsHide: true,
      stdio:       ['pipe', 'pipe', 'pipe'],
    })
      .toString()
      .trim()
      .replace(/\s+/g, '');
  } catch (_) {
    return '';
  }
}

function _getMac() {
  try {
    const ifaces = os.networkInterfaces();
    for (const list of Object.values(ifaces)) {
      for (const iface of list) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          return iface.mac.replace(/:/g, '');
        }
      }
    }
  } catch (_) {}
  return 'no-mac';
}

function _getBiosUuid() {
  if (process.platform !== 'win32') return '';
  return _ps('(Get-WmiObject Win32_ComputerSystemProduct).UUID');
}

function _getDiskSerial() {
  if (process.platform !== 'win32') return '';
  return _ps('(Get-WmiObject Win32_DiskDrive | Select-Object -First 1).SerialNumber');
}

function _getCpuId() {
  if (process.platform !== 'win32') return '';
  return _ps('(Get-WmiObject Win32_Processor | Select-Object -First 1).ProcessorId');
}

/**
 * Returns a stable 64-char hex string unique to this physical machine.
 * Result is cached in memory after first call.
 */
function getMachineId() {
  if (_cached) return _cached;

  const parts = [
    _getMac(),
    _getBiosUuid(),
    _getDiskSerial(),
    _getCpuId(),
    os.hostname(),
    os.type(),
  ].filter(Boolean);

  _cached = crypto.createHash('sha256').update(parts.join('||')).digest('hex');
  return _cached;
}

/**
 * Short display version — first 16 chars + ... + last 8 chars
 */
function getMachineIdShort() {
  const full = getMachineId();
  return `${full.slice(0, 8)}-${full.slice(8, 16)}-${full.slice(16, 24)}-${full.slice(24, 32)}`;
}

module.exports = { getMachineId, getMachineIdShort };
