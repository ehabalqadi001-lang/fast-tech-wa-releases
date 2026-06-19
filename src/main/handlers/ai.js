'use strict';

/** @param {import('../types').HandlerContext} ctx */
function register(ctx) {
  const { handle, db, aiSvc, secStore, V, ipcMain } = ctx;

  handle('ai:chat',           (data)           => aiSvc.chat(data));
  handle('ai:generateScript', (data)           => aiSvc.generateScript(data));
  handle('ai:generateVariants',(data)          => aiSvc.generateVariants(data));
  handle('ai:classify',       ({ text })       => aiSvc.classifyReply(text));
  handle('ai:smartReplies',   (payload)        => aiSvc.smartReplySuggestions(payload));
  handle('ai:summarize',      (payload)        => aiSvc.summarizeConversation(payload));
  handle('ai:optimizeCampaign',(payload)       => aiSvc.optimizeCampaign(payload));

  handle('ai:getKeys', () => ({
    geminiKey: secStore.mask('ai_gemini_key'),
    claudeKey: secStore.mask('ai_claude_key'),
    provider:  db.settingGet('ai_provider') || 'gemini',
  }));

  handle('ai:saveKeys', (keys) => {
    const { geminiKey, claudeKey, provider, geminiModel } = keys || {};
    if (geminiKey  !== undefined) { const v = V.optStr(geminiKey, 500, 'مفتاح Gemini'); if (!v.ok) return v; secStore.set('ai_gemini_key', geminiKey); }
    if (claudeKey  !== undefined) { const v = V.optStr(claudeKey, 500, 'مفتاح Claude'); if (!v.ok) return v; secStore.set('ai_claude_key', claudeKey); }
    if (provider   !== undefined) db.settingSet('ai_provider',     provider);
    if (geminiModel!== undefined) db.settingSet('ai_gemini_model', geminiModel);
    aiSvc.reloadKeys();
    return { ok: true };
  });

  // Streaming (uses ipcMain.on for push events)
  ipcMain.on('ai:streamChat', async (event, data) => {
    try {
      for await (const chunk of aiSvc.streamClaudeChat(data.messages || [], data.system)) {
        if (!event.sender.isDestroyed()) event.sender.send('ai:stream:event', chunk);
      }
    } catch (e) {
      if (!event.sender.isDestroyed()) event.sender.send('ai:stream:event', { type: 'error', text: e.message });
    }
  });

  // Chatbot builder
  handle('chatbot:list',   ()         => ({ ok: true, data: db.chatbotList() }));
  handle('chatbot:get',    ({ id })   => ({ ok: true, data: db.chatbotGet(id) }));
  handle('chatbot:save',   (payload)  => { db.chatbotSave(payload); return { ok: true }; });
  handle('chatbot:delete', ({ id })   => { db.chatbotDelete(id); return { ok: true }; });
}

module.exports = { register };
