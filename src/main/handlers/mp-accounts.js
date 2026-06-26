'use strict';
const { encrypt, decrypt } = require('../mp-secure-store');
const { launchBrowser, getPage, closeBrowser } = require('../mp-browser-manager');
const { humanDelay, humanType } = require('../mp-anti-detect');
const { emit } = require('../mp-scheduler');
const crypto = require('crypto');

function register(ctx) {
  const { db, handle } = ctx;

  handle('mp:accounts:list', (filter = {}) => {
    let q = 'SELECT * FROM mp_accounts';
    const params = [];
    const where = [];
    if (filter.platform) { where.push('platform = ?'); params.push(filter.platform); }
    if (filter.status)   { where.push('status = ?');   params.push(filter.status); }
    if (filter.group_name) { where.push('group_name = ?'); params.push(filter.group_name); }
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    q += ' ORDER BY created_at DESC';
    const rows = db._db.prepare(q).all(...params);
    return rows.map(r => ({ ...r, password_enc: r.password_enc ? '***' : null }));
  });

  handle('mp:accounts:add', (data) => {
    const id = crypto.randomBytes(8).toString('hex');
    db._db.prepare(`
      INSERT INTO mp_accounts (id, platform, username, password_enc, proxy, proxy_type, user_agent, group_name, totp_secret, notes, daily_limit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.platform, data.username,
      data.password ? encrypt(data.password) : null,
      data.proxy || null, data.proxy_type || 'http',
      data.user_agent || null, data.group_name || null,
      data.totp_secret ? encrypt(data.totp_secret) : null,
      data.notes || null, data.daily_limit || 200);
    _mpLog(db, 'account_added', `Added ${data.platform} account: ${data.username}`, { id });
    return { ok: true, id };
  });

  handle('mp:accounts:update', (id, data) => {
    const fields = [], vals = [];
    const allowed = ['username', 'proxy', 'proxy_type', 'user_agent', 'group_name', 'notes', 'daily_limit', 'status'];
    for (const k of allowed) {
      if (k in data) { fields.push(`${k} = ?`); vals.push(data[k]); }
    }
    if (data.password) { fields.push('password_enc = ?'); vals.push(encrypt(data.password)); }
    if (!fields.length) return { ok: false, error: 'Nothing to update' };
    vals.push(id);
    db._db.prepare(`UPDATE mp_accounts SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  });

  handle('mp:accounts:delete', async (id) => {
    await closeBrowser(id).catch(() => {});
    db._db.prepare('DELETE FROM mp_accounts WHERE id = ?').run(id);
    _mpLog(db, 'account_deleted', `Deleted account ${id}`);
    return { ok: true };
  });

  handle('mp:accounts:check', async (id) => {
    const account = db._db.prepare('SELECT * FROM mp_accounts WHERE id = ?').get(id);
    if (!account) return { ok: false, error: 'Account not found' };
    try {
      const page = await getPage(account);
      if (account.platform === 'facebook') {
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
        const url = page.url();
        const isLoggedIn = !url.includes('/login') && !url.includes('/checkpoint');
        const status = isLoggedIn ? 'active' : 'inactive';
        db._db.prepare("UPDATE mp_accounts SET status = ?, last_used = datetime('now') WHERE id = ?").run(status, id);
        return { ok: true, status };
      }
      return { ok: true, status: 'unknown' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('mp:accounts:login', async (id) => {
    const account = db._db.prepare('SELECT * FROM mp_accounts WHERE id = ?').get(id);
    if (!account) return { ok: false, error: 'Not found' };
    const password = decrypt(account.password_enc);
    if (!password) return { ok: false, error: 'No password stored' };
    try {
      const page = await getPage(account);
      if (account.platform === 'facebook') {
        await page.goto('https://www.facebook.com/login', { waitUntil: 'networkidle2', timeout: 20000 });
        await humanDelay(1, 2);
        await humanType(page, '#email', account.username);
        await humanDelay(0.5, 1.5);
        await humanType(page, '#pass', password);
        await humanDelay(0.5, 1);
        await page.keyboard.press('Enter');
        await page.waitForNavigation({ timeout: 15000 }).catch(() => {});
        await humanDelay(2, 4);
        const url = page.url();
        const success = !url.includes('/login') && !url.includes('/checkpoint');
        if (success) {
          const cookies = await page.cookies();
          db._db.prepare("UPDATE mp_accounts SET status = 'active', cookies_json = ?, last_login = datetime('now') WHERE id = ?")
            .run(JSON.stringify(cookies), id);
        }
        return { ok: success, url };
      }
      return { ok: false, error: 'Platform login not implemented' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('mp:accounts:logout', async (id) => {
    await closeBrowser(id).catch(() => {});
    db._db.prepare("UPDATE mp_accounts SET status = 'inactive', cookies_json = NULL WHERE id = ?").run(id);
    return { ok: true };
  });

  handle('mp:accounts:groups', (id) => {
    return db._db.prepare("SELECT * FROM mp_groups WHERE account_id = ? AND is_member = 1").all(id);
  });

  handle('mp:dashboard:stats', () => {
    const d = db._db;
    return {
      totalAccounts:    d.prepare('SELECT COUNT(*) as c FROM mp_accounts').get().c,
      activeAccounts:   d.prepare("SELECT COUNT(*) as c FROM mp_accounts WHERE status='active'").get().c,
      activeCampaigns:  d.prepare("SELECT COUNT(*) as c FROM mp_campaigns WHERE status='running'").get().c,
      leadsToday:       d.prepare("SELECT COUNT(*) as c FROM mp_leads WHERE date(extracted_at)=date('now')").get().c,
      postsToday:       d.prepare("SELECT COUNT(*) as c FROM mp_campaign_logs WHERE date(posted_at)=date('now') AND status='success'").get().c,
      mentionCampaigns: d.prepare("SELECT COUNT(*) as c FROM mp_mention_campaigns WHERE status='running'").get().c,
      totalLeads:       d.prepare('SELECT COUNT(*) as c FROM mp_leads').get().c
    };
  });

  handle('mp:dashboard:activity', (limit = 20) => {
    return db._db.prepare('SELECT * FROM mp_activity_log ORDER BY created_at DESC LIMIT ?').all(limit);
  });
}

function _mpLog(db, type, message, data = null) {
  try {
    db._db.prepare('INSERT INTO mp_activity_log (id, type, message, data) VALUES (lower(hex(randomblob(8))), ?, ?, ?)')
      .run(type, message, data ? JSON.stringify(data) : null);
  } catch {}
}

module.exports = { register };
