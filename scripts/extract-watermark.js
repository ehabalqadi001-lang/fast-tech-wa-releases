'use strict';

/**
 * FAST TECH — Watermark Extraction Tool
 *
 * Usage:
 *   node scripts/extract-watermark.js <path/to/app.asar>
 *
 * Example (from leaked install):
 *   node scripts/extract-watermark.js "C:\leaked-app\resources\app.asar"
 *
 * Output:
 *   Customer ID    : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 *   Customer Email : customer@example.com
 *   Embedded At    : 2025-05-20T10:30:00.000Z
 */

const path             = require('path');
const WatermarkService = require('../src/main/watermark-service');

const asarPath = process.argv[2];

if (!asarPath) {
  console.log('');
  console.log('  FAST TECH — Watermark Extraction Tool');
  console.log('  ──────────────────────────────────────────────────');
  console.log('  Usage: node scripts/extract-watermark.js <app.asar>');
  console.log('');
  console.log('  Example:');
  console.log('    node scripts/extract-watermark.js "C:\\leaked-app\\resources\\app.asar"');
  console.log('');
  process.exit(0);
}

const abs = path.resolve(asarPath);
console.log('');
console.log('  FAST TECH — Watermark Extraction Tool');
console.log('  ──────────────────────────────────────────────────');
console.log(`  File: ${abs}`);
console.log('');

const data = WatermarkService.readFrom(abs);

if (!data) {
  console.log('  ❌  No watermark found.');
  console.log('      Possible reasons:');
  console.log('      • This build predates the watermark feature');
  console.log('      • The watermark slot was not injected (inject-wm-slot-hook)');
  console.log('      • Customer has not yet activated their license');
  console.log('      • File is corrupted or truncated');
  console.log('');
  process.exit(0);
}

console.log('  ✅  Watermark found!');
console.log('');
console.log(`  Customer ID    : ${data.id}`);
console.log(`  Customer Email : ${data.email || '(not set)'}`);
console.log(`  Embedded At    : ${data.ts}`);
console.log('');
console.log('  ──────────────────────────────────────────────────');
console.log('  Look up the Customer ID in your Keygen.sh dashboard');
console.log('  to identify the license holder who leaked this copy.');
console.log('');
