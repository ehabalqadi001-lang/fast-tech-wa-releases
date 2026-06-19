'use strict';

const path = require('path');

/** @param {import('../types').HandlerContext} ctx */
function register(ctx) {
  const { handle, db, excel, secStore, uuidv4 } = ctx;

  handle('crm:getConfig', () => {
    const s = db.settingsGetAll();
    return {
      hubspot_key:       secStore.mask('crm_hubspot_key'),
      hubspot_portal_id: s.crm_hubspot_portal_id  || '',
      hubspot_sync_freq: s.crm_hubspot_sync_freq  || '0',
      pipedrive_key:     secStore.mask('crm_pipedrive_key'),
      airtable_key:      secStore.mask('crm_airtable_key'),
      airtable_base:     s.crm_airtable_base       || '',
      airtable_table:    s.crm_airtable_table      || '',
      webhook_url:       s.crm_webhook_url          || '',
      webhook_secret:    secStore.mask('crm_webhook_secret'),
      webhook_on_send:   s.crm_webhook_on_send     || '1',
      webhook_on_reply:  s.crm_webhook_on_reply    || '1',
      gsheets_url:       s.crm_gsheets_url          || '',
      gsheets_phone_col: s.crm_gsheets_phone_col   || 'phone',
      gsheets_name_col:  s.crm_gsheets_name_col    || 'name',
    };
  });

  handle('crm:saveConfig', (data) => {
    const secureMap = { hubspot_key:'crm_hubspot_key', pipedrive_key:'crm_pipedrive_key',
                        airtable_key:'crm_airtable_key', webhook_secret:'crm_webhook_secret' };
    const plainMap  = { hubspot_portal_id:'crm_hubspot_portal_id', hubspot_sync_freq:'crm_hubspot_sync_freq',
                        airtable_base:'crm_airtable_base', airtable_table:'crm_airtable_table',
                        webhook_url:'crm_webhook_url', webhook_on_send:'crm_webhook_on_send',
                        webhook_on_reply:'crm_webhook_on_reply', gsheets_url:'crm_gsheets_url',
                        gsheets_phone_col:'crm_gsheets_phone_col', gsheets_name_col:'crm_gsheets_name_col' };
    for (const [k, dbKey] of Object.entries(secureMap)) if (data[k] !== undefined) secStore.set(dbKey, data[k]);
    for (const [k, dbKey] of Object.entries(plainMap))  if (data[k] !== undefined) db.settingSet(dbKey, data[k]);
    return { ok: true };
  });

  handle('crm:testConnection', async (crmType) => {
    const s = db.settingsGetAll();
    const axios = require('axios');
    if (crmType === 'hubspot') {
      if (!s.crm_hubspot_key) throw new Error('أدخل HubSpot API Key أولاً');
      const res = await axios.get('https://api.hubapi.com/crm/v3/objects/contacts?limit=1&properties=firstname',
        { headers: { Authorization: `Bearer ${s.crm_hubspot_key}` }, timeout: 10000 });
      return { info: `HubSpot ✅ — ${res.data.total || 0} جهة اتصال` };
    }
    if (crmType === 'pipedrive') {
      if (!s.crm_pipedrive_key) throw new Error('أدخل Pipedrive API Token أولاً');
      const res = await axios.get(`https://api.pipedrive.com/v1/users/me?api_token=${s.crm_pipedrive_key}`, { timeout: 10000 });
      if (!res.data.success) throw new Error('Token غير صالح');
      return { info: `Pipedrive ✅ — متصل كـ: ${res.data.data?.name || 'مستخدم'}` };
    }
    if (crmType === 'airtable') {
      if (!s.crm_airtable_key) throw new Error('أدخل Airtable Token أولاً');
      if (!s.crm_airtable_base) throw new Error('أدخل Airtable Base ID أولاً');
      const table = s.crm_airtable_table || 'Table 1';
      await axios.get(`https://api.airtable.com/v0/${s.crm_airtable_base}/${encodeURIComponent(table)}?maxRecords=1`,
        { headers: { Authorization: `Bearer ${s.crm_airtable_key}` }, timeout: 10000 });
      return { info: `Airtable ✅ — الجدول "${table}"` };
    }
    if (crmType === 'webhook') {
      if (!s.crm_webhook_url) throw new Error('أدخل Webhook URL أولاً');
      const headers = { 'Content-Type': 'application/json' };
      if (s.crm_webhook_secret) headers['X-Webhook-Secret'] = s.crm_webhook_secret;
      const res = await axios.post(s.crm_webhook_url,
        { test: true, source: 'FAST TECH WA Manager', timestamp: new Date().toISOString() },
        { headers, timeout: 10000 });
      return { info: `Webhook ✅ — HTTP ${res.status}` };
    }
    if (crmType === 'gsheets') {
      if (!s.crm_gsheets_url) throw new Error('أدخل رابط Google Sheets أولاً');
      const m = s.crm_gsheets_url.match(/\/d\/([a-zA-Z0-9-_]+)/);
      if (!m) throw new Error('رابط غير صحيح');
      const res = await axios.get(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv`, { timeout: 15000 });
      return { info: `Google Sheets ✅ — ${res.data.split('\n').filter(Boolean).length} صف` };
    }
    throw new Error('نوع CRM غير معروف');
  });

  handle('crm:syncLeads', async (source) => {
    const s = db.settingsGetAll();
    const axios = require('axios');
    let leads = [];
    if (source === 'hubspot' && s.crm_hubspot_key) {
      let after;
      do {
        const url = `https://api.hubapi.com/crm/v3/objects/contacts?limit=100&properties=firstname,lastname,phone,email,lifecyclestage${after ? `&after=${after}` : ''}`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${s.crm_hubspot_key}` } });
        leads = leads.concat((res.data.results || []).map(r => ({
          id: uuidv4(), source: 'hubspot',
          name: `${r.properties.firstname||''} ${r.properties.lastname||''}`.trim(),
          phone: r.properties.phone||'', email: r.properties.email||'',
          status: r.properties.lifecyclestage||'', raw_json: JSON.stringify(r),
        })));
        after = res.data.paging?.next?.after;
      } while (after);
    }
    if (source === 'pipedrive' && s.crm_pipedrive_key) {
      let start = 0, hasMore = true;
      while (hasMore) {
        const res = await axios.get(`https://api.pipedrive.com/v1/persons?api_token=${s.crm_pipedrive_key}&limit=100&start=${start}`);
        leads = leads.concat((res.data.data || []).map(r => ({
          id: uuidv4(), source: 'pipedrive', name: r.name||'',
          phone: r.phone?.[0]?.value||'', email: r.email?.[0]?.value||'',
          status: r.status||'', raw_json: JSON.stringify(r),
        })));
        hasMore = res.data.additional_data?.pagination?.more_items_in_collection;
        start += 100;
      }
    }
    if (source === 'airtable' && s.crm_airtable_key && s.crm_airtable_base) {
      const table = s.crm_airtable_table || 'Table 1';
      let offset;
      do {
        const url = `https://api.airtable.com/v0/${s.crm_airtable_base}/${encodeURIComponent(table)}?pageSize=100${offset ? `&offset=${offset}` : ''}`;
        const res = await axios.get(url, { headers: { Authorization: `Bearer ${s.crm_airtable_key}` } });
        leads = leads.concat((res.data.records || []).map(r => ({
          id: uuidv4(), source: 'airtable',
          name: r.fields?.Name||r.fields?.name||r.fields?.الاسم||'',
          phone: String(r.fields?.Phone||r.fields?.phone||r.fields?.Mobile||r.fields?.الهاتف||''),
          email: r.fields?.Email||r.fields?.email||'', status: r.fields?.Status||'', raw_json: JSON.stringify(r),
        })));
        offset = res.data.offset;
      } while (offset);
    }
    if (leads.length) db.crmLeadBulkReplace(source, leads);
    return { synced: leads.length };
  });

  handle('crm:getLeads', () => db.crmLeadList());

  handle('crm:triggerWebhook', async (payload) => {
    const s = db.settingsGetAll();
    if (!s.crm_webhook_url) throw new Error('Webhook URL غير محدد');
    let u; try { u = new URL(s.crm_webhook_url); } catch { throw new Error('URL غير صالح'); }
    if (u.protocol !== 'https:') throw new Error('يجب HTTPS');
    const h = u.hostname.toLowerCase();
    if (h === 'localhost' || h === '127.0.0.1' || h.startsWith('192.168.') || h.startsWith('10.') || h.endsWith('.local'))
      throw new Error('لا يمكن Webhook داخلي');
    const axios = require('axios');
    const headers = { 'Content-Type': 'application/json' };
    if (s.crm_webhook_secret) headers['X-Webhook-Secret'] = s.crm_webhook_secret;
    const res = await axios.post(s.crm_webhook_url, payload, { headers, timeout: 15000 });
    return { status: res.status };
  });

  handle('crm:pushContacts', async (crmType) => {
    const s = db.settingsGetAll();
    const axios = require('axios');
    const contacts = db.contactList({}).filter(c => c.phone);
    let pushed = 0, errors = 0;
    if (crmType === 'hubspot' && s.crm_hubspot_key) {
      for (let i = 0; i < contacts.length; i += 10) {
        const batch = contacts.slice(i, i+10).map(c => ({ properties: { phone: c.phone, firstname: (c.name||'').split(' ')[0]||'', email: c.email||'' } }));
        try { await axios.post('https://api.hubapi.com/crm/v3/objects/contacts/batch/create', { inputs: batch }, { headers: { Authorization: `Bearer ${s.crm_hubspot_key}` } }); pushed += batch.length; } catch (_) { errors += batch.length; }
      }
    }
    if (crmType === 'pipedrive' && s.crm_pipedrive_key) {
      for (const c of contacts) {
        try { await axios.post(`https://api.pipedrive.com/v1/persons?api_token=${s.crm_pipedrive_key}`, { name: c.name||c.phone, phone: [{ value: c.phone, primary: true }] }); pushed++; } catch (_) { errors++; }
      }
    }
    if (crmType === 'airtable' && s.crm_airtable_key && s.crm_airtable_base) {
      const table = s.crm_airtable_table || 'Table 1';
      const url = `https://api.airtable.com/v0/${s.crm_airtable_base}/${encodeURIComponent(table)}`;
      for (let i = 0; i < contacts.length; i += 10) {
        const batch = contacts.slice(i, i+10).map(c => ({ fields: { Name: c.name||c.phone, Phone: c.phone, Email: c.email||'' } }));
        try { await axios.post(url, { records: batch }, { headers: { Authorization: `Bearer ${s.crm_airtable_key}` } }); pushed += batch.length; } catch (_) { errors += batch.length; }
      }
    }
    return { pushed, errors };
  });

  // ── Reports ────────────────────────────────────────────────────────────────
  handle('reports:getSummary',  (range) => db.reportSummary(range?.days || 30));
  handle('reports:getCampaigns',()      => db.reportCampaignPerf());
  handle('reports:getReplies',  ()      => db.reportReplies());
  handle('reports:exportExcel', async (range) => {
    const { app } = require('electron');
    const outPath = path.join(app.getPath('downloads'), `ftwa-report-${Date.now()}.xlsx`);
    const days = range?.days || 30;
    excel.exportReport({ summary: db.reportSummary(days), campaigns: db.reportCampaignPerf(),
      replies: db.reportReplies(), sentDetail: db.reportSentDetail(days) }, outPath);
    return { path: outPath };
  });
  handle('reports:exportPDF', async () => {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.getFocusedWindow();
    if (!win) return { ok: false, error: 'No active window' };
    try {
      const data = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
      const os = require('os');
      const outPath = path.join(os.homedir(), 'Desktop', `ftwa-report-${Date.now()}.pdf`);
      require('fs').writeFileSync(outPath, data);
      return { ok: true, data: outPath };
    } catch (e) { return { ok: false, error: e.message }; }
  });
}

module.exports = { register };
