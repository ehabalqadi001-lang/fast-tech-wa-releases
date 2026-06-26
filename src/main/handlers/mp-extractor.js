'use strict';
const { getPage } = require('../mp-browser-manager');
const { humanDelay, humanScroll, humanMouseMove, detectRateLimit } = require('../mp-anti-detect');
const { emit } = require('../mp-scheduler');
const crypto = require('crypto');
const XLSX = require('xlsx');

const activeExtractions = new Map();

function register(ctx) {
  const { db, handle } = ctx;

  handle('mp:extractor:start', async (opts) => {
    const { accountId, groupUrl, groupId, maxMembers = 5000, activeOnly = false, campaignId } = opts;
    const account = db._db.prepare('SELECT * FROM mp_accounts WHERE id = ?').get(accountId);
    if (!account) return { ok: false, error: 'Account not found' };

    const extractionId = crypto.randomBytes(6).toString('hex');
    activeExtractions.set(extractionId, { running: true });

    extractMembers({ extractionId, account, groupUrl, groupId, maxMembers, activeOnly, campaignId, db: db._db })
      .catch(err => {
        _mpLog(db, 'extractor_error', err.message, { groupUrl }, 'error');
        emit('mp:extractor:error', { extractionId, error: err.message });
      });

    return { ok: true, extractionId };
  });

  handle('mp:extractor:stop', (id) => {
    if (activeExtractions.has(id)) {
      activeExtractions.get(id).running = false;
      activeExtractions.delete(id);
      return { ok: true };
    }
    return { ok: false, error: 'Not found' };
  });

  handle('mp:extractor:leads', (filter = {}) => {
    let q = 'SELECT * FROM mp_leads';
    const params = [], where = [];
    if (filter.platform)    { where.push('platform = ?');   params.push(filter.platform); }
    if (filter.source_id)   { where.push('source_id = ?');  params.push(filter.source_id); }
    if (filter.campaign_id) { where.push('campaign_id = ?');params.push(filter.campaign_id); }
    if (filter.hasPhone)    { where.push("phone IS NOT NULL AND phone != ''"); }
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    q += ' ORDER BY extracted_at DESC';
    if (filter.limit) { q += ' LIMIT ?'; params.push(filter.limit); }
    return db._db.prepare(q).all(...params);
  });

  handle('mp:extractor:export', async (opts) => {
    const { filter = {}, filePath, format = 'xlsx' } = opts;
    const leads = db._db.prepare('SELECT * FROM mp_leads' + (filter.source_id ? ' WHERE source_id = ?' : '')).all(
      ...(filter.source_id ? [filter.source_id] : [])
    );
    if (format === 'xlsx') {
      const ws = XLSX.utils.json_to_sheet(leads.map(l => ({
        'الاسم': l.name, 'رابط الملف الشخصي': l.profile_url,
        'ID الفيسبوك': l.fb_user_id, 'رابط الإشارة': l.mention_tag,
        'رقم الهاتف': l.phone || '', 'البريد الإلكتروني': l.email || '',
        'الموقع': l.location || '', 'تاريخ الاستخراج': l.extracted_at
      })));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Leads');
      XLSX.writeFile(wb, filePath);
    } else {
      require('fs').writeFileSync(filePath, JSON.stringify(leads, null, 2), 'utf8');
    }
    return { ok: true, count: leads.length };
  });

  handle('mp:extractor:deleteLead', (id) => {
    db._db.prepare('DELETE FROM mp_leads WHERE id = ?').run(id);
    return { ok: true };
  });
}

async function extractMembers({ extractionId, account, groupUrl, groupId, maxMembers, campaignId, db }) {
  const ctx = activeExtractions.get(extractionId);
  const page = await getPage(account);
  const url = groupUrl || `https://www.facebook.com/groups/${groupId}/members`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await humanDelay(2, 4);

  const membersBtn = await page.$('a[href*="/members"]');
  if (membersBtn) { await membersBtn.click(); await humanDelay(1, 3); }

  const insertLead = db.prepare(`
    INSERT OR IGNORE INTO mp_leads (id, platform, source_id, name, profile_url, fb_user_id, mention_tag, extracted_at, campaign_id)
    VALUES (lower(hex(randomblob(8))), 'facebook', ?, ?, ?, ?, ?, datetime('now'), ?)
  `);

  const srcGroupId = groupUrl?.split('/groups/')[1]?.split('/')[0] || groupId || 'unknown';
  let total = 0, scrolls = 0;
  const maxScrolls = Math.ceil(maxMembers / 20) + 10;

  while (ctx.running && total < maxMembers && scrolls < maxScrolls) {
    const members = await page.evaluate(() => {
      const cards = document.querySelectorAll('a[href*="/user/"], a[href*="facebook.com/"][role="link"]');
      const results = [];
      cards.forEach(a => {
        const href = a.href || '';
        const idMatch = href.match(/\/user\/(\d+)/) || href.match(/facebook\.com\/([^/?]+)/);
        if (!idMatch) return;
        const name = a.textContent.trim() || a.getAttribute('aria-label') || '';
        if (!name || name.length < 2) return;
        const fbId = href.includes('/user/') ? idMatch[1] : null;
        results.push({ name, profile_url: href.split('?')[0], fb_user_id: fbId, mention_tag: fbId ? `@[${fbId}:0]` : null });
      });
      return [...new Map(results.map(r => [r.profile_url, r])).values()];
    });

    const html = await page.content();
    if (detectRateLimit(html)) { emit('mp:extractor:rateLimit', { extractionId }); await humanDelay(30, 60); }

    for (const m of members) {
      if (!ctx.running || total >= maxMembers) break;
      try { insertLead.run(srcGroupId, m.name, m.profile_url, m.fb_user_id, m.mention_tag, campaignId || null); total++; } catch {}
    }

    emit('mp:extractor:progress', { extractionId, total, maxMembers });
    await humanScroll(page, 800);
    await humanMouseMove(page);
    await humanDelay(1.5, 4);
    scrolls++;
  }

  emit('mp:extractor:done', { extractionId, total });
  activeExtractions.delete(extractionId);
}

function _mpLog(db, type, message, data = null) {
  try { db._db.prepare('INSERT INTO mp_activity_log (id, type, message, data) VALUES (lower(hex(randomblob(8))), ?, ?, ?)').run(type, message, data ? JSON.stringify(data) : null); } catch {}
}

module.exports = { register };
