'use strict';
const { getPage } = require('../mp-browser-manager');
const { humanDelay, humanScroll } = require('../mp-anti-detect');
const { emit } = require('../mp-scheduler');
const crypto = require('crypto');

function register(ctx) {
  const { db, handle } = ctx;

  handle('mp:groups:list', (filter = {}) => {
    let q = 'SELECT * FROM mp_groups';
    const params = [], where = [];
    if (filter.platform)    { where.push('platform = ?');     params.push(filter.platform); }
    if (filter.account_id)  { where.push('account_id = ?');   params.push(filter.account_id); }
    if (filter.keyword)     { where.push('name LIKE ?');       params.push('%' + filter.keyword + '%'); }
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    return db._db.prepare(q + ' ORDER BY members_count DESC').all(...params);
  });

  handle('mp:groups:add', (data) => {
    const id = crypto.randomBytes(8).toString('hex');
    try {
      db._db.prepare(`
        INSERT OR REPLACE INTO mp_groups (id, platform, group_id, name, url, members_count, is_open, account_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, data.platform || 'facebook', data.group_id, data.name || null,
        data.url || null, data.members_count || null, data.is_open !== false ? 1 : 0, data.account_id || null);
      return { ok: true, id };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('mp:groups:delete', (id) => {
    db._db.prepare('DELETE FROM mp_groups WHERE id = ?').run(id);
    return { ok: true };
  });

  handle('mp:groups:fetch', async (accountId) => {
    const account = db._db.prepare('SELECT * FROM mp_accounts WHERE id = ?').get(accountId);
    if (!account) return { ok: false, error: 'Account not found' };
    try {
      const page = await getPage(account);
      await page.goto('https://www.facebook.com/groups/feed/', { waitUntil: 'domcontentloaded', timeout: 20000 });
      await humanDelay(2, 4);

      const fetchId = crypto.randomBytes(4).toString('hex');
      emit('mp:groups:fetchProgress', { fetchId, status: 'scrolling' });

      const groups = new Map();
      for (let i = 0; i < 15; i++) {
        const found = await page.evaluate(() => {
          const links = document.querySelectorAll('a[href*="/groups/"]');
          const results = [];
          links.forEach(a => {
            const m = a.href.match(/facebook\.com\/groups\/([^/?]+)/);
            if (!m) return;
            const gId = m[1];
            if (/^\d+$/.test(gId) || gId.length > 3)
              results.push({ group_id: gId, name: a.textContent.trim() || '', url: a.href.split('?')[0] });
          });
          return results;
        });
        for (const g of found) { if (g.name && !groups.has(g.group_id)) groups.set(g.group_id, g); }
        await humanScroll(page, 1000);
        await humanDelay(1, 3);
      }

      const upsert = db._db.prepare(`
        INSERT OR REPLACE INTO mp_groups (id, platform, group_id, name, url, account_id, is_member)
        VALUES (lower(hex(randomblob(8))), 'facebook', ?, ?, ?, ?, 1)
      `);
      let saved = 0;
      for (const [, g] of groups) { try { upsert.run(g.group_id, g.name, g.url, accountId); saved++; } catch {} }
      emit('mp:groups:fetchDone', { fetchId, count: saved });
      return { ok: true, count: saved };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('mp:groups:join', async (opts) => {
    const { accountId, groupUrls } = opts;
    const account = db._db.prepare('SELECT * FROM mp_accounts WHERE id = ?').get(accountId);
    if (!account) return { ok: false, error: 'Account not found' };
    const page = await getPage(account);
    const results = [];
    for (const url of groupUrls) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await humanDelay(2, 4);
        const joinBtn = await page.$('div[aria-label*="Join"], div[aria-label*="انضم"]');
        if (joinBtn) { await joinBtn.click(); await humanDelay(2, 5); results.push({ url, status: 'requested' }); }
        else results.push({ url, status: 'already_member' });
        await humanDelay(3, 8);
      } catch (err) { results.push({ url, status: 'error', error: err.message }); }
    }
    return { ok: true, results };
  });

  handle('mp:groups:publish', async (opts) => {
    const { groupIds, accountIds, text, delayMin = 3, delayMax = 10 } = opts;
    const publishId = crypto.randomBytes(6).toString('hex');
    const ctx = { running: true };

    (async () => {
      let done = 0, failed = 0, acctIdx = 0;
      for (const groupId of groupIds) {
        if (!ctx.running) break;
        const accountId = accountIds[acctIdx++ % accountIds.length];
        const account = db._db.prepare('SELECT * FROM mp_accounts WHERE id = ?').get(accountId);
        if (!account) continue;
        try {
          const page = await getPage(account);
          const group = db._db.prepare('SELECT * FROM mp_groups WHERE id = ?').get(groupId);
          const url = group?.url || `https://www.facebook.com/groups/${group?.group_id || groupId}`;
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await humanDelay(2, 3);
          const box = await page.$('[contenteditable="true"]');
          if (box) {
            await box.click(); await humanDelay(0.5, 1);
            await page.keyboard.type(text, { delay: 40 }); await humanDelay(1, 2);
            const postBtn = await page.$('[aria-label*="Post"], [aria-label*="نشر"]');
            if (postBtn) { await postBtn.click(); done++; } else failed++;
          } else failed++;
        } catch { failed++; }
        emit('mp:groups:publishProgress', { publishId, done, failed, total: groupIds.length });
        await humanDelay(delayMin, delayMax);
      }
      emit('mp:groups:publishDone', { publishId, done, failed });
    })();

    return { ok: true, publishId };
  });
}

module.exports = { register };
