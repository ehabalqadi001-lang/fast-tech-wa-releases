'use strict';
const { getPage } = require('../mp-browser-manager');
const { humanDelay, spinText } = require('../mp-anti-detect');
const { emit } = require('../mp-scheduler');
const crypto = require('crypto');
const XLSX = require('xlsx');

const activeJobs = new Map();

function register(ctx) {
  const { db, handle } = ctx;

  handle('mp:broadcast:list', (filter = {}) => {
    let q = 'SELECT * FROM mp_broadcasts';
    if (filter.platform) q += ` WHERE platform = '${filter.platform}'`;
    return db._db.prepare(q + ' ORDER BY created_at DESC').all();
  });

  handle('mp:broadcast:create', (data) => {
    const id = crypto.randomBytes(8).toString('hex');
    db._db.prepare(`
      INSERT INTO mp_broadcasts (id, name, platform, template_text, media_path, contacts_json, account_id, delay_min, delay_max, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.platform, data.template_text, data.media_path || null,
      JSON.stringify(data.contacts || []), data.account_id, data.delay_min || 5, data.delay_max || 15,
      (data.contacts || []).length);
    return { ok: true, id };
  });

  handle('mp:broadcast:update', (id, data) => {
    const allowed = ['name', 'template_text', 'delay_min', 'delay_max', 'status'];
    const fields = [], vals = [];
    for (const k of allowed) { if (k in data) { fields.push(`${k} = ?`); vals.push(data[k]); } }
    if (!fields.length) return { ok: false };
    vals.push(id);
    db._db.prepare(`UPDATE mp_broadcasts SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  });

  handle('mp:broadcast:delete', (id) => {
    if (activeJobs.has(id)) activeJobs.get(id).running = false;
    db._db.prepare('DELETE FROM mp_broadcasts WHERE id = ?').run(id);
    return { ok: true };
  });

  handle('mp:broadcast:import', (filePath) => {
    try {
      const wb = XLSX.readFile(filePath);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws);
      const contacts = rows.map(r => ({
        name:  r['الاسم']  || r['name']  || r['Name']  || '',
        phone: String(r['الهاتف'] || r['phone'] || r['Phone'] || r['رقم'] || '').replace(/\D/g, '')
      })).filter(c => c.phone.length >= 8);
      return { ok: true, contacts, count: contacts.length };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('mp:broadcast:start', (id) => {
    const broadcast = db._db.prepare('SELECT * FROM mp_broadcasts WHERE id = ?').get(id);
    if (!broadcast) return { ok: false, error: 'Not found' };
    db._db.prepare("UPDATE mp_broadcasts SET status = 'running', started_at = datetime('now') WHERE id = ?").run(id);
    _runBroadcast(broadcast, db._db);
    return { ok: true };
  });

  handle('mp:broadcast:pause', (id) => {
    if (activeJobs.has(id)) activeJobs.get(id).running = false;
    db._db.prepare("UPDATE mp_broadcasts SET status = 'paused' WHERE id = ?").run(id);
    return { ok: true };
  });

  handle('mp:broadcast:stop', (id) => {
    if (activeJobs.has(id)) { activeJobs.get(id).running = false; activeJobs.delete(id); }
    db._db.prepare("UPDATE mp_broadcasts SET status = 'paused' WHERE id = ?").run(id);
    return { ok: true };
  });

  handle('mp:broadcast:logs', (id) => {
    return db._db.prepare('SELECT * FROM mp_broadcast_logs WHERE broadcast_id = ? ORDER BY sent_at DESC LIMIT 200').all(id);
  });
}

async function _runBroadcast(broadcast, d) {
  const ctx = { running: true };
  activeJobs.set(broadcast.id, ctx);
  const contacts = JSON.parse(broadcast.contacts_json || '[]');
  const account  = d.prepare('SELECT * FROM mp_accounts WHERE id = ?').get(broadcast.account_id);
  if (!account) { d.prepare("UPDATE mp_broadcasts SET status = 'failed' WHERE id = ?").run(broadcast.id); return; }

  let sent = 0, failed = 0;

  for (const contact of contacts) {
    if (!ctx.running) break;
    let text = spinText(broadcast.template_text);
    text = text.replace(/\{name\}/gi, contact.name || '').replace(/\{phone\}/gi, contact.phone || '');

    try {
      if (broadcast.platform === 'whatsapp') {
        const page = await getPage(account);
        const url = `https://web.whatsapp.com/send?phone=${contact.phone}&text=${encodeURIComponent(text)}`;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await humanDelay(3, 6);
        const sendBtn = await page.$('[data-testid="send"], button[aria-label*="Send message"]');
        if (sendBtn) {
          await sendBtn.click(); await humanDelay(2, 4); sent++;
          d.prepare("INSERT INTO mp_broadcast_logs (id, broadcast_id, contact_name, contact_phone, status) VALUES (lower(hex(randomblob(8))), ?, ?, ?, 'sent')")
            .run(broadcast.id, contact.name, contact.phone);
        } else {
          failed++;
          d.prepare("INSERT INTO mp_broadcast_logs (id, broadcast_id, contact_name, contact_phone, status, error_message) VALUES (lower(hex(randomblob(8))), ?, ?, ?, 'failed', 'Send button not found')")
            .run(broadcast.id, contact.name, contact.phone);
        }
      }
    } catch (err) {
      failed++;
      d.prepare("INSERT INTO mp_broadcast_logs (id, broadcast_id, contact_name, contact_phone, status, error_message) VALUES (lower(hex(randomblob(8))), ?, ?, ?, 'failed', ?)")
        .run(broadcast.id, contact.name, contact.phone, err.message);
    }

    d.prepare('UPDATE mp_broadcasts SET sent = ?, failed_count = ? WHERE id = ?').run(sent, failed, broadcast.id);
    emit('mp:broadcast:progress', { broadcastId: broadcast.id, sent, failed, total: contacts.length });
    await new Promise(r => setTimeout(r, (Math.random() * (broadcast.delay_max - broadcast.delay_min) + broadcast.delay_min) * 1000));
  }

  d.prepare("UPDATE mp_broadcasts SET status = 'completed' WHERE id = ?").run(broadcast.id);
  emit('mp:broadcast:done', { broadcastId: broadcast.id, sent, failed });
  activeJobs.delete(broadcast.id);
}

module.exports = { register };
