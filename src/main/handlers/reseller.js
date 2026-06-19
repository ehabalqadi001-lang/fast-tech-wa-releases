'use strict';

/** @param {import('../types').HandlerContext} ctx */
function register(ctx) {
  const { handle, db } = ctx;

  // ── Reseller clients ───────────────────────────────────────────────────────
  handle('reseller:list',   ()              => ({ ok: true, data: db.resellerClientList() }));
  handle('reseller:save',   (c)             => ({ ok: true, data: db.resellerClientSave(c) }));
  handle('reseller:delete', ({ id })        => { db.resellerClientDelete(id); return { ok: true }; });
  handle('reseller:usage',  ({ id, days })  => ({ ok: true, data: db.resellerClientUsage(id, days || 30) }));
  handle('reseller:stats',  ()              => ({ ok: true, data: db.resellerStats() }));
  handle('reseller:genKey', ()              => ({ ok: true, data: { key: db._genLicenseKey() } }));

  // ── Branding / White-Label ─────────────────────────────────────────────────
  handle('branding:get',  ()     => ({ ok: true, data: db.brandingGet() }));
  handle('branding:save', (data) => ({ ok: true, data: db.brandingSave(data) }));
}

module.exports = { register };
