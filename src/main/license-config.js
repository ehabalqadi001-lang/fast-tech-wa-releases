'use strict';

/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║          FAST TECH — LICENSE SERVER CONFIGURATION                   ║
 * ║                                                                      ║
 * ║  1. Create a free account at https://keygen.sh                      ║
 * ║  2. Create a Product and a Policy (1 machine, 1 year, etc.)         ║
 * ║  3. Replace the placeholder values below with your actual IDs        ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

module.exports = {
  // ── Keygen.sh account UUID (Settings → Account ID) ──────────────────────
  KEYGEN_ACCOUNT_ID: 'e9a442f5-579f-456a-9327-bcc11004356c',

  // ── Product ID (Products → your product → ID) ───────────────────────────
  KEYGEN_PRODUCT_ID: 'd991e320-7e1b-4c38-b005-5995f0579881',

  // ── Policy ID (Policies → your policy → ID) — used when creating keys ───
  KEYGEN_POLICY_ID:  '7a97d794-46b7-4dec-b930-cb22ebd156af',

  // ── Grace period: how many days offline the app keeps working ───────────
  GRACE_PERIOD_DAYS: 3,

  // ── Warning: how many days before expiry to show a renewal notice ────────
  EXPIRY_WARN_DAYS: 14,

  // ── How often to re-validate online (milliseconds) ──────────────────────
  ONLINE_CHECK_INTERVAL_MS: 24 * 60 * 60 * 1000,   // 24 hours

  // ── App edition label shown in the UI ───────────────────────────────────
  APP_EDITION: 'Professional',
};
