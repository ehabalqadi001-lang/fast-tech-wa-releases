'use strict';
const { getPage } = require('../mp-browser-manager');
const { humanDelay, spinText, detectRateLimit } = require('../mp-anti-detect');
const { emit } = require('../mp-scheduler');
const crypto = require('crypto');

const activeJobs = new Map();

function register(ctx) {
  const { db, handle } = ctx;

  handle('mp:mention:list', (filter = {}) => {
    let q = 'SELECT * FROM mp_mention_campaigns';
    if (filter.status) q += ` WHERE status = '${filter.status}'`;
    return db._db.prepare(q + ' ORDER BY created_at DESC').all();
  });

  handle('mp:mention:get', (id) => db._db.prepare('SELECT * FROM mp_mention_campaigns WHERE id = ?').get(id));

  handle('mp:mention:create', (data) => {
    const id = crypto.randomBytes(8).toString('hex');
    db._db.prepare(`
      INSERT INTO mp_mention_campaigns (id, name, group_id, post_content, config_json)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, data.name, data.group_id, data.post_content || null, JSON.stringify(data.config || {}));
    return { ok: true, id };
  });

  handle('mp:mention:delete', (id) => {
    if (activeJobs.has(id)) { activeJobs.get(id).running = false; activeJobs.delete(id); }
    db._db.prepare('DELETE FROM mp_mention_logs WHERE campaign_id = ?').run(id);
    db._db.prepare('DELETE FROM mp_mention_campaigns WHERE id = ?').run(id);
    return { ok: true };
  });

  handle('mp:mention:extract', async (opts) => {
    const { campaignId, accountId, groupUrl, maxMembers = 5000 } = opts;
    const account = db._db.prepare('SELECT * FROM mp_accounts WHERE id = ?').get(accountId);
    if (!account) return { ok: false, error: 'Account not found' };
    db._db.prepare("UPDATE mp_mention_campaigns SET status = 'extracting' WHERE id = ?").run(campaignId);
    _extractGroupMembers({ campaignId, account, groupUrl, maxMembers, db: db._db })
      .catch(err => emit('mp:mention:error', { campaignId, error: err.message }));
    return { ok: true };
  });

  handle('mp:mention:publish', async (opts) => {
    const { campaignId, accountId, groupUrl, postText } = opts;
    const account = db._db.prepare('SELECT * FROM mp_accounts WHERE id = ?').get(accountId);
    if (!account) return { ok: false, error: 'Account not found' };
    try {
      const page = await getPage(account);
      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await humanDelay(2, 4);
      const box = await page.$('[contenteditable="true"]');
      if (!box) return { ok: false, error: 'Post box not found' };
      await box.click(); await humanDelay(0.5, 1.5);
      await page.keyboard.type(postText, { delay: 40 }); await humanDelay(1, 2);
      const postBtn = await page.$('[aria-label*="Post"], [aria-label*="نشر"]');
      if (!postBtn) return { ok: false, error: 'Post button not found' };
      await postBtn.click(); await humanDelay(3, 6);
      const pageUrl = page.url();
      const postId = pageUrl.match(/permalink\/(\d+)/)?.[1] || pageUrl.match(/posts\/(\d+)/)?.[1] || null;
      db._db.prepare("UPDATE mp_mention_campaigns SET status = 'running', post_id = ?, post_url = ?, started_at = datetime('now') WHERE id = ?")
        .run(postId, pageUrl, campaignId);
      return { ok: true, postUrl: pageUrl, postId };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  handle('mp:mention:start', (id) => {
    const campaign = db._db.prepare('SELECT * FROM mp_mention_campaigns WHERE id = ?').get(id);
    if (!campaign) return { ok: false, error: 'Not found' };
    db._db.prepare("UPDATE mp_mention_campaigns SET status = 'running' WHERE id = ?").run(id);
    _runMentionCampaign(campaign, db._db);
    return { ok: true };
  });

  handle('mp:mention:pause', (id) => {
    if (activeJobs.has(id)) activeJobs.get(id).running = false;
    db._db.prepare("UPDATE mp_mention_campaigns SET status = 'paused' WHERE id = ?").run(id);
    return { ok: true };
  });

  handle('mp:mention:stop', (id) => {
    if (activeJobs.has(id)) { activeJobs.get(id).running = false; activeJobs.delete(id); }
    db._db.prepare("UPDATE mp_mention_campaigns SET status = 'paused' WHERE id = ?").run(id);
    return { ok: true };
  });

  handle('mp:mention:logs', (id) => {
    return db._db.prepare('SELECT * FROM mp_mention_logs WHERE campaign_id = ? ORDER BY posted_at DESC LIMIT 500').all(id);
  });

  handle('mp:mention:members', (opts) => {
    let q = 'SELECT * FROM mp_group_members WHERE group_id = ?';
    const params = [opts.groupId];
    if (opts.status) { q += ' AND mention_status = ?'; params.push(opts.status); }
    q += ' ORDER BY extracted_at ASC';
    if (opts.limit) { q += ' LIMIT ?'; params.push(opts.limit); }
    return db._db.prepare(q).all(...params);
  });
}

async function _extractGroupMembers({ campaignId, account, groupUrl, maxMembers, db }) {
  const page = await getPage(account);
  const groupId = groupUrl.match(/groups\/([^/?]+)/)?.[1] || 'unknown';
  await page.goto(`${groupUrl}/members`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await humanDelay(2, 4);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO mp_group_members (id, group_id, member_name, profile_url, fb_user_id, mention_tag, mention_status)
    VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, ?, 'pending')
  `);

  let total = 0, scrolls = 0;
  while (total < maxMembers && scrolls < 300) {
    const members = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('a[href*="/user/"], a[href*="facebook.com/"]').forEach(a => {
        const href = a.href || '';
        if (!href.includes('facebook.com')) return;
        const idM = href.match(/\/user\/(\d+)/);
        const slugM = href.match(/facebook\.com\/([a-zA-Z0-9._]+)\/?(\?|$)/);
        const fbId = idM ? idM[1] : null;
        const name = a.textContent.trim();
        if (!name || name.length < 2) return;
        results.push({ name, profile_url: href.split('?')[0], fb_user_id: fbId, mention_tag: fbId ? `@[${fbId}:0]` : `@${slugM?.[1] || ''}` });
      });
      return [...new Map(results.map(r => [r.profile_url, r])).values()];
    });

    for (const m of members) {
      if (total >= maxMembers) break;
      try { insert.run(groupId, m.name, m.profile_url, m.fb_user_id, m.mention_tag); total++; } catch {}
    }

    db.prepare('UPDATE mp_mention_campaigns SET total_members = ? WHERE id = ?').run(total, campaignId);
    emit('mp:mention:extractProgress', { campaignId, total, maxMembers });
    await page.evaluate(() => window.scrollBy(0, 800));
    await humanDelay(1.5, 3.5);
    scrolls++;
  }

  db.prepare("UPDATE mp_mention_campaigns SET status = 'posting', total_members = ? WHERE id = ?").run(total, campaignId);
  emit('mp:mention:extractDone', { campaignId, total });
}

async function _runMentionCampaign(campaign, d) {
  const config = JSON.parse(campaign.config_json || '{}');
  const {
    mentionsPerComment = 3, delayMin = 20, delayMax = 45, batchDelay = 120,
    maxPerSession = 500, accounts: accountIds = [],
    commentTemplates = [
      '{mentions}\n👆 شوف المنشور ده مهم جداً 🔥',
      '{mentions}\n🔥 لا يفوتك المنشور ده 👆'
    ]
  } = config;

  const ctx = { running: true };
  activeJobs.set(campaign.id, ctx);
  let acctIdx = 0, sessionMentions = 0, commentCount = 0;

  while (ctx.running) {
    const batch = d.prepare("SELECT * FROM mp_group_members WHERE group_id = ? AND mention_status = 'pending' LIMIT ?")
      .all(campaign.group_id, mentionsPerComment);
    if (batch.length === 0) break;

    const accountId = accountIds[acctIdx++ % accountIds.length];
    const account = d.prepare('SELECT * FROM mp_accounts WHERE id = ?').get(accountId);
    if (!account) { await humanDelay(5, 10); continue; }

    const mentions = batch.map(m => m.mention_tag || `@${m.member_name}`).join(' ');
    const tpl = commentTemplates[Math.floor(Math.random() * commentTemplates.length)];
    const commentText = spinText(tpl.replace('{mentions}', mentions));

    try {
      const page = await getPage(account);
      if (campaign.post_url) {
        await page.goto(campaign.post_url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await humanDelay(2, 4);
      }
      const commentBox = await page.$('[aria-label*="Write a comment"], [aria-label*="اكتب تعليقاً"], [contenteditable="true"][aria-label]');
      if (!commentBox) throw new Error('Comment box not found');
      await commentBox.click(); await humanDelay(0.5, 1.5);
      await page.keyboard.type(commentText, { delay: 35 }); await humanDelay(1, 2);
      await page.keyboard.press('Enter'); await humanDelay(2, 4);

      const html = await page.content();
      if (detectRateLimit(html)) { emit('mp:mention:rateLimit', { campaignId: campaign.id, accountId }); await humanDelay(30, 60); continue; }

      const upd = d.prepare("UPDATE mp_group_members SET mention_status = 'done', last_mentioned_at = datetime('now'), mention_count = mention_count + 1 WHERE id = ?");
      for (const m of batch) upd.run(m.id);
      commentCount++; sessionMentions += batch.length;

      d.prepare("INSERT INTO mp_mention_logs (id, campaign_id, account_id, members_json, comment_text, status) VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, 'success')")
        .run(campaign.id, account.id, JSON.stringify(batch.map(m => m.member_name)), commentText);
      d.prepare('UPDATE mp_mention_campaigns SET mentioned_count = mentioned_count + ?, comments_posted = comments_posted + 1 WHERE id = ?')
        .run(batch.length, campaign.id);

      const mentioned = d.prepare('SELECT mentioned_count FROM mp_mention_campaigns WHERE id = ?').get(campaign.id)?.mentioned_count;
      emit('mp:mention:progress', { campaignId: campaign.id, mentioned, total: campaign.total_members, commentsPosted: commentCount });

    } catch (err) {
      d.prepare("INSERT INTO mp_mention_logs (id, campaign_id, account_id, status, error_message) VALUES (lower(hex(randomblob(8))), ?, ?, 'failed', ?)")
        .run(campaign.id, accountId || 'unknown', err.message);
      d.prepare('UPDATE mp_mention_campaigns SET failed_count = failed_count + 1 WHERE id = ?').run(campaign.id);
    }

    if (sessionMentions >= maxPerSession) {
      emit('mp:mention:sessionPause', { campaignId: campaign.id });
      await humanDelay(batchDelay, batchDelay + 60);
      sessionMentions = 0;
    } else {
      await humanDelay(delayMin, delayMax);
    }
  }

  if (ctx.running) {
    d.prepare("UPDATE mp_mention_campaigns SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(campaign.id);
    emit('mp:mention:done', { campaignId: campaign.id });
  }
  activeJobs.delete(campaign.id);
}

module.exports = { register };
