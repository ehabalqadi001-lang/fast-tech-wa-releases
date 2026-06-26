'use strict';
const axios = require('axios');
const crypto = require('crypto');

function register(ctx) {
  const { db, handle } = ctx;

  handle('mp:settings:get', (key) => {
    const row = db._db.prepare('SELECT value FROM mp_settings WHERE key = ?').get(key);
    return row ? row.value : null;
  });

  handle('mp:settings:set', (key, value) => {
    db._db.prepare("INSERT OR REPLACE INTO mp_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))").run(key, value);
    return { ok: true };
  });

  handle('mp:settings:all', () => {
    const rows = db._db.prepare('SELECT key, value FROM mp_settings').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  });

  // PROXIES
  handle('mp:settings:proxies:list', () => db._db.prepare('SELECT * FROM mp_proxies ORDER BY status ASC').all());

  handle('mp:settings:proxies:add', (data) => {
    const id = crypto.randomBytes(8).toString('hex');
    db._db.prepare(`
      INSERT INTO mp_proxies (id, host, port, protocol, username, password, country)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.host, data.port, data.protocol || 'http', data.username || null, data.password || null, data.country || null);
    return { ok: true, id };
  });

  handle('mp:settings:proxies:delete', (id) => {
    db._db.prepare('DELETE FROM mp_proxies WHERE id = ?').run(id);
    return { ok: true };
  });

  handle('mp:settings:proxies:check', async () => {
    const proxies = db._db.prepare('SELECT * FROM mp_proxies').all();
    let active = 0;
    for (const proxy of proxies) {
      try {
        const start = Date.now();
        const proxyUrl = `${proxy.protocol}://${proxy.username ? proxy.username + ':' + proxy.password + '@' : ''}${proxy.host}:${proxy.port}`;
        await axios.get('https://api.ipify.org?format=json', {
          proxy: false,
          httpsAgent: require('https').Agent ? undefined : undefined,
          timeout: 8000
        });
        const latency = Date.now() - start;
        db._db.prepare("UPDATE mp_proxies SET status = 'active', latency_ms = ?, last_checked = datetime('now') WHERE id = ?").run(latency, proxy.id);
        active++;
      } catch {
        db._db.prepare("UPDATE mp_proxies SET status = 'failed', last_checked = datetime('now') WHERE id = ?").run(proxy.id);
      }
    }
    return { ok: true, active };
  });

  // TEMPLATES
  handle('mp:settings:templates:list', (category) => {
    if (category) return db._db.prepare('SELECT * FROM mp_templates WHERE category = ? ORDER BY name ASC').all(category);
    return db._db.prepare('SELECT * FROM mp_templates ORDER BY category, name ASC').all();
  });

  handle('mp:settings:templates:add', (data) => {
    const id = crypto.randomBytes(8).toString('hex');
    db._db.prepare(`
      INSERT INTO mp_templates (id, name, category, platform, content, media_path, tags, is_ar)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.category || 'general', data.platform || null,
      data.content, data.media_path || null, data.tags || null, data.is_ar ? 1 : 0);
    return { ok: true, id };
  });

  handle('mp:settings:templates:delete', (id) => {
    db._db.prepare('DELETE FROM mp_templates WHERE id = ?').run(id);
    return { ok: true };
  });
}

module.exports = { register };
