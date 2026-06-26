'use strict';
const { getPage } = require('../mp-browser-manager');
const { humanDelay, spinText } = require('../mp-anti-detect');
const { emit, registerTask, stopTask } = require('../mp-scheduler');
const crypto = require('crypto');

const runningCampaigns = new Map();

function register(ctx) {
  const { db, handle } = ctx;

  handle('mp:campaigns:list', (filter = {}) => {
    let q = 'SELECT * FROM mp_campaigns';
    const params = [], where = [];
    if (filter.status)   { where.push('status = ?');   params.push(filter.status); }
    if (filter.platform) { where.push('platform = ?'); params.push(filter.platform); }
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    return db._db.prepare(q + ' ORDER BY created_at DESC').all(...params);
  });

  handle('mp:campaigns:get', (id) => db._db.prepare('SELECT * FROM mp_campaigns WHERE id = ?').get(id));

  handle('mp:campaigns:create', (data) => {
    const id = crypto.randomBytes(8).toString('hex');
    db._db.prepare(`
      INSERT INTO mp_campaigns (id, name, description, platform, type, content_json, accounts_json, targets_json, schedule_json, ab_variants, hashtags, total_targets)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.name, data.description || null, data.platform, data.type || 'group_post',
      JSON.stringify(data.content), JSON.stringify(data.accounts || []),
      JSON.stringify(data.targets || []), JSON.stringify(data.schedule || {}),
      JSON.stringify(data.ab_variants || []), data.hashtags || null,
      (data.targets || []).length);
    _mpLog(db, 'campaign_created', `Campaign "${data.name}" created`, { id });
    return { ok: true, id };
  });

  handle('mp:campaigns:update', (id, data) => {
    const fields = [], vals = [];
    for (const [k, v] of Object.entries(data)) {
      if (['name','description','status','hashtags'].includes(k)) { fields.push(`${k} = ?`); vals.push(v); }
      if (['content','accounts','targets','schedule','ab_variants'].includes(k)) {
        const col = { content: 'content_json', accounts: 'accounts_json', targets: 'targets_json', schedule: 'schedule_json', ab_variants: 'ab_variants' }[k];
        fields.push(`${col} = ?`); vals.push(JSON.stringify(v));
      }
    }
    if (!fields.length) return { ok: false };
    vals.push(id);
    db._db.prepare(`UPDATE mp_campaigns SET ${fields.join(', ')} WHERE id = ?`).run(...vals);
    return { ok: true };
  });

  handle('mp:campaigns:delete', (id) => {
    _stopCampaign(id, db);
    db._db.prepare('DELETE FROM mp_campaign_logs WHERE campaign_id = ?').run(id);
    db._db.prepare('DELETE FROM mp_campaigns WHERE id = ?').run(id);
    return { ok: true };
  });

  handle('mp:campaigns:start', (id) => {
    const campaign = db._db.prepare('SELECT * FROM mp_campaigns WHERE id = ?').get(id);
    if (!campaign) return { ok: false, error: 'Not found' };
    db._db.prepare("UPDATE mp_campaigns SET status = 'running', started_at = datetime('now') WHERE id = ?").run(id);
    _startRunner(campaign, db);
    _mpLog(db, 'campaign_started', `Campaign "${campaign.name}" started`, { id });
    return { ok: true };
  });

  handle('mp:campaigns:pause', (id) => {
    db._db.prepare("UPDATE mp_campaigns SET status = 'paused' WHERE id = ?").run(id);
    stopTask('mp_campaign_' + id);
    if (runningCampaigns.has(id)) runningCampaigns.get(id).running = false;
    return { ok: true };
  });

  handle('mp:campaigns:stop', (id) => {
    _stopCampaign(id, db);
    return { ok: true };
  });

  handle('mp:campaigns:logs', (id) => {
    return db._db.prepare('SELECT * FROM mp_campaign_logs WHERE campaign_id = ? ORDER BY posted_at DESC LIMIT 200').all(id);
  });
}

function _stopCampaign(id, db) {
  db._db.prepare("UPDATE mp_campaigns SET status = 'paused' WHERE id = ? AND status = 'running'").run(id);
  stopTask('mp_campaign_' + id);
  if (runningCampaigns.has(id)) { runningCampaigns.get(id).running = false; runningCampaigns.delete(id); }
}

function _startRunner(campaign, db) {
  const ctx = { running: true };
  runningCampaigns.set(campaign.id, ctx);

  (async () => {
    const d = db._db;
    const accounts  = JSON.parse(campaign.accounts_json || '[]');
    const targets   = JSON.parse(campaign.targets_json  || '[]');
    const content   = JSON.parse(campaign.content_json  || '{}');
    const abVars    = JSON.parse(campaign.ab_variants   || '[]');
    const settings  = Object.fromEntries(d.prepare('SELECT key, value FROM mp_settings').all().map(s => [s.key, s.value]));
    const delayMin  = parseFloat(settings.mp_delay_min || 3);
    const delayMax  = parseFloat(settings.mp_delay_max || 8);
    let accountIndex = 0;

    for (const target of targets) {
      if (!ctx.running) break;
      const acctId = accounts[accountIndex++ % accounts.length];
      const acctRow = d.prepare('SELECT * FROM mp_accounts WHERE id = ?').get(acctId);
      if (!acctRow || acctRow.status === 'banned') continue;

      let postText = content.text || '';
      if (abVars.length > 0) postText = abVars[Math.floor(Math.random() * abVars.length)].text || postText;
      postText = spinText(postText);
      if (content.hashtags) postText += '\n' + content.hashtags;

      try {
        const result = await _postToTarget({ account: acctRow, target, text: postText });
        const status = result.ok ? 'success' : 'failed';
        d.prepare(`INSERT INTO mp_campaign_logs (id, campaign_id, account_id, target_id, target_type, status, error_message, post_url)
          VALUES (lower(hex(randomblob(8))), ?, ?, ?, ?, ?, ?, ?)`)
          .run(campaign.id, acctRow.id, target.id || target, target.type || 'group', status, result.error || null, result.url || null);
        if (status === 'success') d.prepare('UPDATE mp_campaigns SET completed = completed + 1 WHERE id = ?').run(campaign.id);
        else d.prepare('UPDATE mp_campaigns SET failed_count = failed_count + 1 WHERE id = ?').run(campaign.id);
        emit('mp:campaign:progress', { campaignId: campaign.id, target: target.name || target, status });
      } catch (err) {
        d.prepare("INSERT INTO mp_campaign_logs (id, campaign_id, account_id, target_id, status, error_message) VALUES (lower(hex(randomblob(8))), ?, ?, ?, 'failed', ?)")
          .run(campaign.id, acctRow.id, target.id || target, err.message);
      }
      if (ctx.running) await humanDelay(delayMin, delayMax);
    }

    if (ctx.running) {
      d.prepare("UPDATE mp_campaigns SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(campaign.id);
      emit('mp:campaign:done', { campaignId: campaign.id });
    }
    runningCampaigns.delete(campaign.id);
  })().catch(err => emit('mp:campaign:error', { campaignId: campaign.id, error: err.message }));
}

async function _postToTarget({ account, target, text }) {
  const page = await getPage(account);
  const groupId = target.group_id || target.id || target;
  const groupUrl = `https://www.facebook.com/groups/${groupId}`;
  await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await humanDelay(2, 4);
  const writeBtn = await page.$('[contenteditable="true"]');
  if (!writeBtn) return { ok: false, error: 'Write box not found' };
  await writeBtn.click();
  await humanDelay(0.8, 2);
  await page.keyboard.type(text, { delay: 30 });
  await humanDelay(1, 2);
  const postBtn = await page.$('[aria-label*="Post"], [aria-label*="نشر"]');
  if (!postBtn) return { ok: false, error: 'Post button not found' };
  await postBtn.click();
  await humanDelay(2, 4);
  return { ok: true, url: groupUrl };
}

function _mpLog(db, type, message, data = null) {
  try { db._db.prepare('INSERT INTO mp_activity_log (id, type, message, data) VALUES (lower(hex(randomblob(8))), ?, ?, ?)').run(type, message, data ? JSON.stringify(data) : null); } catch {}
}

module.exports = { register };
