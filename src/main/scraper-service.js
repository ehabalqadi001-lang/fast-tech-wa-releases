'use strict';

/**
 * FAST TECH WhatsApp Cyber Nexus — Scraper / Data Extraction Service
 *
 * Extracts contacts, group IDs, invite links, and participants from
 * WhatsApp via whatsapp-web.js, then stores/exports the data.
 */

const XLSX = require('xlsx');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class ScraperService {
  /**
   * @param {import('./database')} db
   * @param {import('./whatsapp-web-service')} waSvc
   */
  constructor(db, waSvc) {
    this._db = db;
    this._wa = waSvc;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GROUPS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Fetch all group chats from a session and persist them in the DB.
   * @returns {Promise<Array>} group list
   */
  async scrapeGroups(sessionId) {
    const chats  = await this._wa.getAllChats(sessionId);
    const groups = chats.filter(c => c.isGroup);
    const now    = new Date().toISOString();
    const accId  = `web:${sessionId}`;

    // Persist to DB in a single transaction — best effort (errors logged, not thrown)
    try {
      this._db._db.pragma('foreign_keys = OFF');
      const stmt = this._db._db.prepare(`
        INSERT INTO groups (id, account_id, name, description, member_count, invite_link, synced_at)
        VALUES (@id, @account_id, @name, @description, @member_count, @invite_link, @synced_at)
        ON CONFLICT(id) DO UPDATE SET
          account_id=excluded.account_id,
          name=excluded.name,
          member_count=excluded.member_count,
          synced_at=excluded.synced_at
      `);
      const tx = this._db._db.transaction((list) => {
        for (const g of list) stmt.run(g);
      });
      tx(groups.map(g => ({
        id:           g.id,
        account_id:   accId,
        name:         g.name || g.id,
        description:  '',
        member_count: g.memberCount || 0,
        invite_link:  null,
        synced_at:    now,
      })));
      this._db._db.pragma('foreign_keys = ON');
      console.log(`[Scraper] Saved ${groups.length} groups to DB for session ${sessionId}`);
    } catch (dbErr) {
      console.error('[Scraper] DB save error (non-fatal):', dbErr.message);
    }

    // Always return the live scraped data — never depend on DB filter
    const result = groups.map(g => ({
      id:           g.id,
      account_id:   accId,
      name:         g.name || g.id,
      description:  '',
      member_count: g.memberCount || 0,
      invite_link:  null,
      synced_at:    now,
    }));

    console.log(`[Scraper] scrapeGroups: returning ${result.length} groups for session ${sessionId}`);
    return result;
  }

  /**
   * Fetch all participants of a group, store them as contacts + group_members.
   * @returns {Promise<Array<{phone, isAdmin, isSuperAdmin}>>}
   */
  async scrapeGroupParticipants(sessionId, groupId) {
    const participants = await this._wa.getGroupParticipants(sessionId, groupId);

    // Persist in group_members table
    this._db.groupMembersReplace(
      groupId,
      participants.map(p => ({
        phone:    p.phone,
        name:     '',
        is_admin: (p.isAdmin || p.isSuperAdmin) ? 1 : 0,
      }))
    );

    // Also upsert as contacts so they appear in contact lists
    const contactRows = participants.map(p => ({
      id:        uuidv4(),
      name:      '',
      phone:     p.phone,
      country:   '',
      group_tag: groupId,
      label:     'مشارك في مجموعة',
      notes:     '',
      opt_in:    1,
    }));
    this._db.contactBulkInsert(contactRows);

    // Update member_count on the group record
    this._db._db.prepare(
      'UPDATE groups SET member_count=? WHERE id=?'
    ).run(participants.length, groupId);

    console.log(`[Scraper] Scraped ${participants.length} participants from group ${groupId}`);
    return participants;
  }

  /**
   * Retrieve the invite link for a group and store it in the DB.
   * @returns {Promise<string>} invite URL
   */
  async scrapeGroupInviteLink(sessionId, groupId) {
    const link = await this._wa.getGroupInviteLink(sessionId, groupId);
    this._db._db.prepare('UPDATE groups SET invite_link=? WHERE id=?').run(link, groupId);
    console.log(`[Scraper] Invite link for ${groupId}: ${link}`);
    return link;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CONTACTS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Extract phone contacts from the device and persist them.
   * @returns {Promise<Array>}
   */
  async scrapeContacts(sessionId) {
    const contacts = await this._wa.getPhoneContacts(sessionId);

    const rows = contacts.map(c => ({
      id:        uuidv4(),
      name:      c.name,
      phone:     c.phone,
      country:   '',
      group_tag: '',
      label:     'جهة اتصال واتساب',
      notes:     '',
      opt_in:    1,
    }));
    this._db.contactBulkInsert(rows);

    console.log(`[Scraper] Scraped ${contacts.length} contacts from session ${sessionId}`);
    return contacts;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EXCEL EXPORTS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Export group participants to an Excel file.
   * @param {Array}  participants  — result of scrapeGroupParticipants
   * @param {string} groupName
   * @param {string} outPath      — absolute .xlsx path
   */
  exportParticipantsToExcel(participants, groupName, outPath) {
    const rows = participants.map(p => ({
      'رقم الهاتف': p.phone,
      'مشرف':       p.isAdmin || p.isSuperAdmin ? 'نعم' : 'لا',
      'معرف واتساب': p.id,
    }));

    const wb = XLSX.utils.book_new();
    const sheetName = (groupName || 'المجموعة').slice(0, 31);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), sheetName);
    XLSX.writeFile(wb, outPath);
    return outPath;
  }

  /**
   * Export scraped contacts to Excel.
   * @param {Array}  contacts — result of scrapeContacts
   * @param {string} outPath
   */
  exportContactsToExcel(contacts, outPath) {
    const rows = contacts.map(c => ({
      'الاسم':            c.name || '',
      'رقم الهاتف':       c.phone,
      'في جهات الاتصال':  c.isMyContact ? 'نعم' : 'لا',
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'جهات الاتصال');
    XLSX.writeFile(wb, outPath);
    return outPath;
  }

  /**
   * Export groups list (with invite links) to Excel.
   * @param {Array}  groups   — from scrapeGroups or db.groupList()
   * @param {string} outPath
   */
  exportGroupsToExcel(groups, outPath) {
    const rows = groups.map(g => ({
      'اسم المجموعة': g.name,
      'معرف المجموعة': g.id,
      'رابط الدعوة':   g.invite_link || '',
      'عدد الأعضاء':   g.member_count || 0,
      'آخر مزامنة':    g.synced_at || '',
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'المجموعات');
    XLSX.writeFile(wb, outPath);
    return outPath;
  }
}

module.exports = ScraperService;
