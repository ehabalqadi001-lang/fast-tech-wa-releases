'use strict';

/** @param {import('../types').HandlerContext} ctx */
function register(ctx) {
  const { handle, db, antiBanSvc } = ctx;

  handle('antiban:getSettings', () => antiBanSvc ? antiBanSvc.getSettings() : {});

  handle('antiban:setSettings', (data) => {
    const allowed = {
      antiban_enabled:        data.enabled          !== undefined ? String(data.enabled ? 1 : 0) : undefined,
      antiban_delay_profile:  data.delayProfile,
      antiban_daily_limit:    data.dailyLimit    !== undefined ? String(data.dailyLimit)    : undefined,
      antiban_hourly_limit:   data.hourlyLimit   !== undefined ? String(data.hourlyLimit)   : undefined,
      antiban_window_enabled: data.timeWindowEnabled !== undefined ? String(data.timeWindowEnabled ? 1 : 0) : undefined,
      antiban_window_start:   data.timeWindowStart !== undefined ? String(data.timeWindowStart) : undefined,
      antiban_window_end:     data.timeWindowEnd   !== undefined ? String(data.timeWindowEnd)   : undefined,
      antiban_typing_sim:     data.typingSimEnabled !== undefined ? String(data.typingSimEnabled ? 1 : 0) : undefined,
      antiban_typing_min_ms:  data.typingMinMs  !== undefined ? String(data.typingMinMs)  : undefined,
      antiban_typing_max_ms:  data.typingMaxMs  !== undefined ? String(data.typingMaxMs)  : undefined,
    };
    for (const [k, v] of Object.entries(allowed)) if (v !== undefined) db.settingSet(k, v);
    if (antiBanSvc) antiBanSvc.reloadSettings();
    return { ok: true };
  });

  handle('antiban:getSessions',      () => antiBanSvc ? antiBanSvc.getAllSessionStats() : (db.sessionListAntiBan?.() || []));
  handle('antiban:getEvents',   (limit) => antiBanSvc ? antiBanSvc.getRecentEvents(limit || 100) : []);
  handle('antiban:resetSession', (sessionId) => {
    if (!antiBanSvc) throw new Error('Anti-ban N/A');
    antiBanSvc.resetSession(sessionId);
    return { ok: true };
  });
  handle('antiban:enableWarmup',  (sessionId) => { if (!antiBanSvc) throw new Error('Anti-ban N/A'); antiBanSvc.enableWarmup(sessionId);  return { ok: true }; });
  handle('antiban:disableWarmup', (sessionId) => { if (!antiBanSvc) throw new Error('Anti-ban N/A'); antiBanSvc.disableWarmup(sessionId); return { ok: true }; });
  handle('antiban:clearEvents',   ()          => { db.antiBanEventClear(); return { ok: true }; });
  handle('antiban:adaptiveStatus',()          => (antiBanSvc && typeof antiBanSvc.getAdaptiveStatus === 'function') ? antiBanSvc.getAdaptiveStatus() : {});
}

module.exports = { register };
