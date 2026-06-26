'use strict';
const { getPage } = require('../mp-browser-manager');
const { humanDelay } = require('../mp-anti-detect');
const { emit } = require('../mp-scheduler');
const crypto = require('crypto');

function register(ctx) {
  const { db, handle } = ctx;

  handle('mp:pages:list', (filter = {}) => {
    let q = 'SELECT * FROM mp_pages';
    const params = [], where = [];
    if (filter.platform)    { where.push('platform = ?');   params.push(filter.platform); }
    if (filter.account_id)  { where.push('account_id = ?'); params.push(filter.account_id); }
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    return db._db.prepare(q).all(...params);
  });

  handle('mp:pages:add', (data) => {
    const id = crypto.randomBytes(8).toString('hex');
    db._db.prepare(`
      INSERT INTO mp_pages (id, platform, page_id, name, url, account_id, category, followers, auto_reply, reply_rules, working_hours, away_message)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.platform || 'facebook', data.page_id, data.name || null, data.url || null,
      data.account_id || null, data.category || null, data.followers || 0,
      data.auto_reply ? 1 : 0, JSON.stringify(data.reply_rules || []),
      JSON.stringify(data.working_hours || {}), data.away_message || null);
    return { ok: true, id };
  });

  handle('mp:pages:delete', (id) => {
    db._db.prepare('DELETE FROM mp_pages WHERE id = ?').run(id);
    return { ok: true };
  });

  handle('mp:pages:post', async (opts) => {
    const { pageId, accountId, text } = opts;
    const account = db._db.prepare('SELECT * FROM mp_accounts WHERE id = ?').get(accountId);
    const pageRow = db._db.prepare('SELECT * FROM mp_pages WHERE id = ?').get(pageId);
    if (!account || !pageRow) return { ok: false, error: 'Not found' };
    try {
      const page = await getPage(account);
      const url = pageRow.url || `https://www.facebook.com/${pageRow.page_id}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await humanDelay(2, 4);
      const box = await page.$('[contenteditable="true"]');
      if (!box) return { ok: false, error: 'Post box not found' };
      await box.click(); await humanDelay(0.5, 1);
      await page.keyboard.type(text, { delay: 40 }); await humanDelay(1, 2);
      const postBtn = await page.$('[aria-label*="Post"], [aria-label*="نشر"]');
      if (!postBtn) return { ok: false, error: 'Post button not found' };
      await postBtn.click(); await humanDelay(2, 3);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('mp:pages:schedule', (opts) => {
    const id = crypto.randomBytes(8).toString('hex');
    db._db.prepare(`
      INSERT INTO mp_scheduled_posts (id, page_id, content_json, scheduled_at) VALUES (?, ?, ?, ?)
    `).run(id, opts.pageId, JSON.stringify({ text: opts.text, media: opts.mediaPath }), opts.scheduledAt);
    return { ok: true, id };
  });

  handle('mp:pages:scheduled', (filter = {}) => {
    let q = "SELECT * FROM mp_scheduled_posts WHERE status = 'pending'";
    if (filter.pageId) q += ` AND page_id = '${filter.pageId}'`;
    return db._db.prepare(q + ' ORDER BY scheduled_at ASC').all();
  });
}

module.exports = { register };
