'use strict';

const path = require('path');

/** @param {import('../types').HandlerContext} ctx */
function register(ctx) {
  const { handle, db, excel, V, uuidv4 } = ctx;

  handle('contacts:list',  (f)  => db.contactList(f));
  handle('contacts:save',  (c)  => {
    const v = V.phone(c?.phone);
    if (!v.ok) return { ok: false, error: v.error };
    const vn = V.optStr(c?.name, 200, 'الاسم');
    if (!vn.ok) return { ok: false, error: vn.error };
    if (!c.id) c.id = uuidv4();
    db.contactUpsert(c);
    return db.contactGet(c.id);
  });
  handle('contacts:remove', (id) => db.contactDelete(id));

  handle('contacts:importExcel', (filePath) => {
    const settings = db.settingsGetAll();
    const result   = excel.importContacts(filePath, { defaultCountry: settings.default_country || 'SA' });
    db.contactBulkInsert(result.contacts);
    return { imported: result.contacts.length, skipped: result.skipped };
  });

  handle('contacts:exportExcel', async (opts) => {
    const contacts = db.contactList(opts?.filter || {});
    const outPath  = opts?.path || path.join(require('electron').app.getPath('downloads'), `contacts-${Date.now()}.xlsx`);
    excel.exportContacts(contacts, outPath);
    return { path: outPath };
  });

  handle('contacts:fixCountry',     ({ phones, countryCode }) => excel.fixCountryCodes(phones, countryCode));
  handle('contacts:previewImport',  async (filePath)          => excel.importContacts(filePath, { preview: true }));

  handle('contacts:deduplicate', () => {
    const result = db._db.prepare(
      'DELETE FROM contacts WHERE id NOT IN (SELECT MIN(id) FROM contacts GROUP BY phone)'
    ).run();
    return { removed: result.changes };
  });

  // Groups (Cloud API groups — stored locally)
  handle('groups:list',       ()     => db.groupList());
  handle('groups:getMembers', (id)   => db.groupMembers(id));

  handle('groups:sync', async (accountId) => {
    return db.groupList().filter(g => g.account_id === accountId);
  });

  handle('groups:upsert', (g) => {
    if (!g.id) throw new Error('Group ID مطلوب');
    db.groupUpsert({
      id: g.id, account_id: g.account_id || 'manual', name: g.name || g.id,
      description: g.description || '', member_count: g.member_count || 0,
      invite_link: g.invite_link || null, synced_at: new Date().toISOString(),
    });
    return db.groupList().find(gr => gr.id === g.id);
  });

  handle('groups:getInviteLink', (groupId) => {
    const g = db.groupList().find(g => g.id === groupId);
    return g?.invite_link || null;
  });

  handle('groups:addMember', async ({ groupId, phone }) => {
    db._db.prepare('INSERT OR IGNORE INTO group_members (group_id,phone,is_admin) VALUES (?,?,0)').run(groupId, phone);
    return { ok: true };
  });

  handle('groups:removeMember', async ({ groupId, phone }) => {
    db._db.prepare('DELETE FROM group_members WHERE group_id=? AND phone=?').run(groupId, phone);
    return { ok: true };
  });

  handle('conversation:get', ({ phone, limit }) => db.conversationGet(phone, limit || 100));
}

module.exports = { register };
