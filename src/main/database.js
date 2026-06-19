'use strict';

const path    = require('path');
const Database = require('better-sqlite3');

/**
 * Fast Tech WA Manager — SQLite data layer
 * All queries use prepared statements for performance and safety.
 */
class Db {
  constructor(dataDir) {
    this._path = path.join(dataDir, 'ftwa.db');
    this._db   = null;
  }

  // ─── Init ────────────────────────────────────────────────────────────────
  initialize() {
    this._db = new Database(this._path);
    this._db.pragma('journal_mode = WAL');
    this._db.pragma('foreign_keys = ON');
    this._db.pragma('cache_size = -65536');     // 64 MB page cache
    this._db.pragma('temp_store = memory');      // temp tables in RAM
    this._db.pragma('mmap_size = 268435456');    // 256 MB memory-mapped I/O
    this._db.pragma('synchronous = NORMAL');     // safe with WAL, faster than FULL
    this._db.pragma('busy_timeout = 5000');      // 5s retry on locked db
    this._createTables();
    this._runMigrations();
    this._schedulePragmaOptimize();
    return this;
  }

  _schedulePragmaOptimize() {
    // PRAGMA optimize analyzes query patterns and updates statistics
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    this._optimizeTimer = setInterval(() => {
      try { this._db.pragma('optimize'); } catch (_) {}
    }, SIX_HOURS);
    if (this._optimizeTimer.unref) this._optimizeTimer.unref();
  }

  close() {
    if (this._optimizeTimer) clearInterval(this._optimizeTimer);
    try { this._db?.pragma('optimize'); } catch (_) {}
    this._db?.close();
  }

  // ─── Schema ──────────────────────────────────────────────────────────────
  _createTables() {
    this._db.exec(`
      -- WhatsApp Business API accounts
      CREATE TABLE IF NOT EXISTS accounts (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        phone       TEXT NOT NULL,
        token       TEXT NOT NULL,
        phone_id    TEXT NOT NULL,
        biz_acct_id TEXT NOT NULL,
        active      INTEGER DEFAULT 1,
        created_at  TEXT DEFAULT (datetime('now')),
        last_used   TEXT,
        msg_count   INTEGER DEFAULT 0
      );

      -- Contacts
      CREATE TABLE IF NOT EXISTS contacts (
        id          TEXT PRIMARY KEY,
        name        TEXT,
        phone       TEXT NOT NULL UNIQUE,
        country     TEXT,
        group_tag   TEXT,
        label       TEXT,
        notes       TEXT,
        opt_in      INTEGER DEFAULT 1,
        created_at  TEXT DEFAULT (datetime('now')),
        updated_at  TEXT DEFAULT (datetime('now'))
      );

      -- Groups (account_id is free-text: cloud account id or "web:sessionId")
      CREATE TABLE IF NOT EXISTS groups (
        id          TEXT PRIMARY KEY,
        account_id  TEXT,
        name        TEXT NOT NULL,
        description TEXT,
        member_count INTEGER DEFAULT 0,
        invite_link TEXT,
        synced_at   TEXT
      );

      -- Group members
      CREATE TABLE IF NOT EXISTS group_members (
        group_id   TEXT NOT NULL,
        phone      TEXT NOT NULL,
        name       TEXT,
        is_admin   INTEGER DEFAULT 0,
        PRIMARY KEY (group_id, phone),
        FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE
      );

      -- Message campaigns
      CREATE TABLE IF NOT EXISTS campaigns (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        type         TEXT NOT NULL CHECK(type IN ('individual','group','mixed')),
        account_id   TEXT,
        message_body TEXT NOT NULL,
        media_path   TEXT,
        media_type   TEXT,
        delay_sec    INTEGER DEFAULT 5,
        status       TEXT DEFAULT 'draft' CHECK(status IN ('draft','running','paused','done','failed')),
        total        INTEGER DEFAULT 0,
        sent         INTEGER DEFAULT 0,
        failed       INTEGER DEFAULT 0,
        created_at   TEXT DEFAULT (datetime('now')),
        finished_at  TEXT,
        FOREIGN KEY (account_id) REFERENCES accounts(id)
      );

      -- Individual message log
      CREATE TABLE IF NOT EXISTS messages (
        id          TEXT PRIMARY KEY,
        campaign_id TEXT,
        account_id  TEXT,
        recipient   TEXT NOT NULL,
        direction   TEXT DEFAULT 'out' CHECK(direction IN ('out','in')),
        body        TEXT,
        media_url   TEXT,
        wa_msg_id   TEXT,
        status      TEXT DEFAULT 'pending' CHECK(status IN ('pending','sent','delivered','read','failed')),
        error_msg   TEXT,
        sent_at     TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
        FOREIGN KEY (account_id)  REFERENCES accounts(id)
      );

      -- Scheduled tasks
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        campaign_id TEXT,
        cron_expr   TEXT NOT NULL,
        next_run    TEXT,
        last_run    TEXT,
        run_count   INTEGER DEFAULT 0,
        active      INTEGER DEFAULT 1,
        created_at  TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (campaign_id) REFERENCES campaigns(id)
      );

      -- Message templates (local store)
      CREATE TABLE IF NOT EXISTS templates (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        category   TEXT,
        body       TEXT NOT NULL,
        variables  TEXT,
        language   TEXT DEFAULT 'ar',
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Settings (key-value store)
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT
      );

      -- CRM leads cache
      CREATE TABLE IF NOT EXISTS crm_leads (
        id         TEXT PRIMARY KEY,
        source     TEXT NOT NULL,
        name       TEXT,
        phone      TEXT,
        email      TEXT,
        status     TEXT,
        raw_json   TEXT,
        synced_at  TEXT DEFAULT (datetime('now'))
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_messages_campaign  ON messages(campaign_id);
      CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient);
      CREATE INDEX IF NOT EXISTS idx_contacts_phone     ON contacts(phone);
      CREATE INDEX IF NOT EXISTS idx_messages_sent_at   ON messages(sent_at);
    `);
  }

  _runMigrations() {
    const version = this.settingGet('db_version') || '0';
    let v = parseInt(version, 10);

    if (v < 1) {
      this.settingSet('db_version', '1');
      v = 1;
    }

    if (v < 2) {
      this._db.exec(`
        -- WhatsApp Web sessions (unofficial QR-scan engine)
        CREATE TABLE IF NOT EXISTS wa_sessions (
          id          TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          phone       TEXT DEFAULT '',
          status      TEXT DEFAULT 'disconnected',
          qr_code     TEXT,
          msg_count   INTEGER DEFAULT 0,
          last_seen   TEXT,
          created_at  TEXT DEFAULT (datetime('now'))
        );

        -- Persistent send queue (anti-ban engine)
        CREATE TABLE IF NOT EXISTS send_queue (
          id           TEXT PRIMARY KEY,
          session_id   TEXT,
          campaign_id  TEXT,
          recipient    TEXT NOT NULL,
          body         TEXT,
          scripts      TEXT,           -- JSON array of message variants
          media_path   TEXT,
          delay_min_ms INTEGER DEFAULT 15000,
          delay_max_ms INTEGER DEFAULT 45000,
          priority     INTEGER DEFAULT 5,
          status       TEXT DEFAULT 'pending'
                         CHECK(status IN ('pending','processing','sent','delivered','read','failed')),
          attempts     INTEGER DEFAULT 0,
          max_attempts INTEGER DEFAULT 3,
          wa_msg_id    TEXT,
          error_msg    TEXT,
          scheduled_at TEXT DEFAULT (datetime('now')),
          processed_at TEXT,
          created_at   TEXT DEFAULT (datetime('now'))
        );

        -- Incoming messages captured by whatsapp-web.js
        CREATE TABLE IF NOT EXISTS incoming_messages (
          id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          session_id  TEXT NOT NULL,
          from_number TEXT NOT NULL,
          body        TEXT DEFAULT '',
          msg_type    TEXT DEFAULT 'chat',
          has_media   INTEGER DEFAULT 0,
          is_group    INTEGER DEFAULT 0,
          timestamp   TEXT,
          received_at TEXT DEFAULT (datetime('now')),
          read        INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_send_queue_peek
          ON send_queue(status, priority, scheduled_at)
          WHERE status = 'pending';
        CREATE INDEX IF NOT EXISTS idx_incoming_session
          ON incoming_messages(session_id, received_at DESC);
      `);
      this.settingSet('db_version', '2');
      v = 2;
    }

    if (v < 3) {
      this._db.pragma('foreign_keys = OFF');
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS groups_v3 (
          id           TEXT PRIMARY KEY,
          account_id   TEXT,
          name         TEXT NOT NULL,
          description  TEXT,
          member_count INTEGER DEFAULT 0,
          invite_link  TEXT,
          synced_at    TEXT
        );
        INSERT OR IGNORE INTO groups_v3 SELECT id,account_id,name,description,member_count,invite_link,synced_at FROM groups;
        DROP TABLE groups;
        ALTER TABLE groups_v3 RENAME TO groups;
      `);
      this._db.pragma('foreign_keys = ON');
      this.settingSet('db_version', '3');
      v = 3;
    }

    if (v < 4) {
      // Force-rebuild groups table to ensure no FK constraint exists on any existing DB
      this._db.pragma('foreign_keys = OFF');
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS groups_v4 (
          id           TEXT PRIMARY KEY,
          account_id   TEXT,
          name         TEXT NOT NULL,
          description  TEXT,
          member_count INTEGER DEFAULT 0,
          invite_link  TEXT,
          synced_at    TEXT
        );
        INSERT OR IGNORE INTO groups_v4
          SELECT id, account_id, name, description, member_count, invite_link, synced_at
          FROM groups;
        DROP TABLE IF EXISTS groups;
        ALTER TABLE groups_v4 RENAME TO groups;
      `);
      this._db.pragma('foreign_keys = ON');
      this.settingSet('db_version', '4');
      v = 4;
    }

    if (v < 5) {
      // Anti-ban tracking columns on wa_sessions (additive — safe for existing rows)
      const existingCols = this._db.pragma('table_info(wa_sessions)').map(c => c.name);
      const addCol = (col, def) => {
        if (!existingCols.includes(col))
          this._db.exec(`ALTER TABLE wa_sessions ADD COLUMN ${col} ${def}`);
      };
      addCol('daily_count',       'INTEGER DEFAULT 0');
      addCol('daily_reset_at',    'TEXT');
      addCol('hourly_count',      'INTEGER DEFAULT 0');
      addCol('hourly_reset_at',   'TEXT');
      addCol('health_score',      'INTEGER DEFAULT 80');
      addCol('ban_detected_at',   'TEXT');
      addCol('warmup_mode',       'INTEGER DEFAULT 0');
      addCol('warmup_day',        'INTEGER DEFAULT 0');
      addCol('warmup_daily_limit','INTEGER DEFAULT 0');

      // Anti-ban event log
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS anti_ban_events (
          id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          session_id  TEXT,
          event_type  TEXT NOT NULL,
          detail      TEXT,
          created_at  TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_abe_session
          ON anti_ban_events(session_id, created_at DESC);
      `);

      this.settingSet('db_version', '5');
      v = 5;
    }

    if (v < 6) {
      // Incoming messages: add group_name + reply tracking columns
      const imCols = this._db.pragma('table_info(incoming_messages)').map(c => c.name);
      const addIM = (col, def) => {
        if (!imCols.includes(col))
          this._db.exec(`ALTER TABLE incoming_messages ADD COLUMN ${col} ${def}`);
      };
      addIM('group_name',  'TEXT');
      addIM('replied',     'INTEGER DEFAULT 0');
      addIM('reply_body',  'TEXT');
      addIM('replied_at',  'TEXT');
      addIM('replied_by',  'TEXT');  // session_id used to reply

      this._db.exec(`
        CREATE INDEX IF NOT EXISTS idx_incoming_replied
          ON incoming_messages(replied, received_at DESC);
        CREATE INDEX IF NOT EXISTS idx_incoming_from
          ON incoming_messages(from_number, received_at DESC);
      `);

      this.settingSet('db_version', '6');
      v = 6;
    }

    if (v < 7) {
      // Scheduler: add message content + recipients + timezone to scheduled_tasks
      const stCols = this._db.pragma('table_info(scheduled_tasks)').map(c => c.name);
      const addST = (col, def) => {
        if (!stCols.includes(col))
          this._db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN ${col} ${def}`);
      };
      addST('message_body',      'TEXT');
      addST('media_path',        'TEXT');
      addST('media_type',        'TEXT');
      addST('recipients_type',   "TEXT DEFAULT 'all'");
      addST('recipients_json',   'TEXT');
      addST('session_id',        'TEXT');
      addST('timezone',          "TEXT DEFAULT 'Asia/Riyadh'");
      addST('template_id',       'TEXT');

      this._db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_active
          ON scheduled_tasks(active, next_run);
      `);

      this.settingSet('db_version', '7');
      v = 7;
    }

    if (v < 8) {
      // A/B Testing — per-script tracking
      const sqCols  = this._db.pragma('table_info(send_queue)').map(c => c.name);
      const addSQ   = (col, def) => {
        if (!sqCols.includes(col))
          this._db.exec(`ALTER TABLE send_queue ADD COLUMN ${col} ${def}`);
      };
      addSQ('script_index', 'INTEGER DEFAULT -1');
      addSQ('picked_body',  'TEXT');

      const cmpCols = this._db.pragma('table_info(campaigns)').map(c => c.name);
      if (!cmpCols.includes('scripts_json'))
        this._db.exec(`ALTER TABLE campaigns ADD COLUMN scripts_json TEXT`);

      this._db.exec(`
        CREATE TABLE IF NOT EXISTS campaign_scripts (
          id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          campaign_id   TEXT NOT NULL,
          script_index  INTEGER NOT NULL,
          script_text   TEXT NOT NULL,
          media_path    TEXT,
          sent_count    INTEGER DEFAULT 0,
          failed_count  INTEGER DEFAULT 0,
          replied_count INTEGER DEFAULT 0,
          UNIQUE(campaign_id, script_index)
        );
        CREATE INDEX IF NOT EXISTS idx_cs_campaign ON campaign_scripts(campaign_id);
      `);

      this.settingSet('db_version', '8');
      v = 8;
    }

    if (v < 9) {
      // Media Library — centralised file store
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS media_files (
          id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          name        TEXT NOT NULL,
          file_path   TEXT NOT NULL UNIQUE,
          mime_type   TEXT,
          size_bytes  INTEGER DEFAULT 0,
          created_at  TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_media_created ON media_files(created_at DESC);
      `);
      // Per-contact scheduled_at column on send_queue (already has scheduled_at but now user-settable)
      const sqCols9 = this._db.pragma('table_info(send_queue)').map(c => c.name);
      if (!sqCols9.includes('contact_note'))
        this._db.exec(`ALTER TABLE send_queue ADD COLUMN contact_note TEXT`);
      this.settingSet('db_version', '9');
      v = 9;
    }

    if (v < 10) {
      // FTS5 virtual table for full-text conversation search (Phase 3 prep)
      this._db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          body,
          recipient UNINDEXED,
          direction UNINDEXED,
          sent_at UNINDEXED,
          content='messages',
          content_rowid='rowid',
          tokenize='unicode61 remove_diacritics 2'
        );

        -- Triggers to keep FTS in sync with messages table
        CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, body, recipient, direction, sent_at)
          VALUES (new.rowid, new.body, new.recipient, new.direction, new.sent_at);
        END;

        CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, body, recipient, direction, sent_at)
          VALUES ('delete', old.rowid, old.body, old.recipient, old.direction, old.sent_at);
        END;

        CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, body, recipient, direction, sent_at)
          VALUES ('delete', old.rowid, old.body, old.recipient, old.direction, old.sent_at);
          INSERT INTO messages_fts(rowid, body, recipient, direction, sent_at)
          VALUES (new.rowid, new.body, new.recipient, new.direction, new.sent_at);
        END;
      `);
      this.settingSet('db_version', '10');
      v = 10;
    }

    if (v < 11) {
      // Compliance & Audit Log — tracks key user/system actions
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          event_type  TEXT NOT NULL,
          description TEXT NOT NULL,
          session_id  TEXT,
          meta        TEXT,
          created_at  TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_type    ON audit_log(event_type, created_at DESC);

        -- Audience segments — saved filter presets
        CREATE TABLE IF NOT EXISTS audiences (
          id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          name        TEXT NOT NULL,
          conditions  TEXT NOT NULL,
          count       INTEGER DEFAULT 0,
          created_at  TEXT DEFAULT (datetime('now'))
        );
      `);
      this.settingSet('db_version', '11');
      v = 11;
    }

    if (v < 12) {
      // Visual Chatbot Builder — auto-reply flows
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS chatbot_flows (
          id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          name             TEXT NOT NULL,
          nodes_json       TEXT NOT NULL DEFAULT '[]',
          active           INTEGER DEFAULT 1,
          trigger_keywords TEXT DEFAULT '',
          created_at       TEXT DEFAULT (datetime('now')),
          updated_at       TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_chatbot_active ON chatbot_flows(active);
      `);
      this.settingSet('db_version', '12');
      v = 12;
    }

    if (v < 13) {
      // Phase 6: Multi-User Team System
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS team_users (
          id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          name        TEXT NOT NULL,
          role        TEXT NOT NULL DEFAULT 'agent' CHECK(role IN ('admin','agent','viewer')),
          email       TEXT,
          pin         TEXT,
          active      INTEGER DEFAULT 1,
          color       TEXT DEFAULT '#6366f1',
          created_at  TEXT DEFAULT (datetime('now')),
          last_active TEXT
        );

        CREATE TABLE IF NOT EXISTS conversation_assignments (
          id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          phone        TEXT NOT NULL,
          session_id   TEXT,
          agent_id     TEXT,
          status       TEXT DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
          priority     TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
          tags         TEXT,
          notes        TEXT,
          assigned_at  TEXT DEFAULT (datetime('now')),
          resolved_at  TEXT,
          UNIQUE(phone)
        );

        CREATE INDEX IF NOT EXISTS idx_ca_agent  ON conversation_assignments(agent_id);
        CREATE INDEX IF NOT EXISTS idx_ca_status ON conversation_assignments(status);
        CREATE INDEX IF NOT EXISTS idx_tu_role   ON team_users(role, active);
      `);
      this.settingSet('db_version', '13');
      v = 13;
    }

    if (v < 14) {
      // Phase 7: Automation Sequences (drip campaigns)
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS sequences (
          id             TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          name           TEXT NOT NULL,
          trigger_type   TEXT NOT NULL DEFAULT 'manual'
                           CHECK(trigger_type IN ('keyword','opt_in','campaign_complete','manual')),
          trigger_value  TEXT DEFAULT '',
          session_id     TEXT DEFAULT '',
          active         INTEGER DEFAULT 1,
          created_at     TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS sequence_steps (
          id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          sequence_id  TEXT NOT NULL,
          step_order   INTEGER NOT NULL DEFAULT 0,
          delay_hours  INTEGER NOT NULL DEFAULT 24,
          message_body TEXT NOT NULL DEFAULT '',
          media_path   TEXT,
          FOREIGN KEY (sequence_id) REFERENCES sequences(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS sequence_enrollments (
          id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          sequence_id   TEXT NOT NULL,
          phone         TEXT NOT NULL,
          session_id    TEXT,
          current_step  INTEGER DEFAULT 0,
          next_send_at  TEXT,
          completed     INTEGER DEFAULT 0,
          enrolled_at   TEXT DEFAULT (datetime('now')),
          completed_at  TEXT,
          UNIQUE(sequence_id, phone)
        );

        CREATE INDEX IF NOT EXISTS idx_seq_active      ON sequences(active);
        CREATE INDEX IF NOT EXISTS idx_seqstep_seq     ON sequence_steps(sequence_id, step_order);
        CREATE INDEX IF NOT EXISTS idx_seqenr_due      ON sequence_enrollments(completed, next_send_at)
          WHERE completed=0;
        CREATE INDEX IF NOT EXISTS idx_seqenr_phone    ON sequence_enrollments(phone);
      `);
      this.settingSet('db_version', '14');
      v = 14;
    }

    if (v < 15) {
      // Phase 8: Reseller clients + branding
      this._db.exec(`
        CREATE TABLE IF NOT EXISTS reseller_clients (
          id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          name            TEXT NOT NULL,
          email           TEXT,
          license_key     TEXT UNIQUE,
          plan            TEXT DEFAULT 'basic' CHECK(plan IN ('basic','pro','enterprise')),
          max_sessions    INTEGER DEFAULT 2,
          max_msg_per_day INTEGER DEFAULT 500,
          active          INTEGER DEFAULT 1,
          expires_at      TEXT,
          notes           TEXT,
          created_at      TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS client_usage (
          id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
          client_id     TEXT NOT NULL,
          date          TEXT NOT NULL,
          messages_sent INTEGER DEFAULT 0,
          sessions_used INTEGER DEFAULT 0,
          UNIQUE(client_id, date)
        );

        CREATE INDEX IF NOT EXISTS idx_rc_active   ON reseller_clients(active);
        CREATE INDEX IF NOT EXISTS idx_cu_client   ON client_usage(client_id, date DESC);
      `);
      this.settingSet('db_version', '15');
      v = 15;
    }
  }

  // ─── FTS Search ───────────────────────────────────────────────────────────
  messagesFtsSearch(query, limit = 50) {
    return this._db.prepare(`
      SELECT m.*, snippet(messages_fts, 0, '<mark>', '</mark>', '…', 20) AS highlight
      FROM messages_fts
      JOIN messages m ON m.rowid = messages_fts.rowid
      WHERE messages_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCOUNTS
  // ═══════════════════════════════════════════════════════════════════════════
  accountList() {
    return this._db.prepare(
      'SELECT * FROM accounts ORDER BY created_at DESC'
    ).all();
  }

  accountGet(id) {
    return this._db.prepare('SELECT * FROM accounts WHERE id=?').get(id);
  }

  accountUpsert(a) {
    return this._db.prepare(`
      INSERT INTO accounts (id,name,phone,token,phone_id,biz_acct_id,active)
      VALUES (@id,@name,@phone,@token,@phone_id,@biz_acct_id,@active)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, phone=excluded.phone, token=excluded.token,
        phone_id=excluded.phone_id, biz_acct_id=excluded.biz_acct_id,
        active=excluded.active
    `).run(a);
  }

  accountDelete(id) {
    return this._db.prepare('DELETE FROM accounts WHERE id=?').run(id);
  }

  accountBumpUsage(id) {
    this._db.prepare(`
      UPDATE accounts SET last_used=datetime('now'), msg_count=msg_count+1 WHERE id=?
    `).run(id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTACTS
  // ═══════════════════════════════════════════════════════════════════════════
  contactList(filter = {}) {
    let sql = 'SELECT * FROM contacts WHERE 1=1';
    const params = [];
    if (filter.search) {
      sql += ' AND (name LIKE ? OR phone LIKE ?)';
      params.push(`%${filter.search}%`, `%${filter.search}%`);
    }
    if (filter.country) { sql += ' AND country=?'; params.push(filter.country); }
    if (filter.label)   { sql += ' AND label=?';   params.push(filter.label);   }
    sql += ' ORDER BY name ASC';
    return this._db.prepare(sql).all(...params);
  }

  contactGet(id)    { return this._db.prepare('SELECT * FROM contacts WHERE id=?').get(id); }
  contactByPhone(p) { return this._db.prepare('SELECT * FROM contacts WHERE phone=?').get(p); }

  contactUpsert(c) {
    return this._db.prepare(`
      INSERT INTO contacts (id,name,phone,country,group_tag,label,notes,opt_in)
      VALUES (@id,@name,@phone,@country,@group_tag,@label,@notes,@opt_in)
      ON CONFLICT(phone) DO UPDATE SET
        name=excluded.name, country=excluded.country,
        group_tag=excluded.group_tag, label=excluded.label,
        notes=excluded.notes, opt_in=excluded.opt_in,
        updated_at=datetime('now')
    `).run(c);
  }

  contactDelete(id) { return this._db.prepare('DELETE FROM contacts WHERE id=?').run(id); }

  contactCount() {
    return this._db.prepare('SELECT COUNT(*) as n FROM contacts').get().n;
  }

  contactBulkInsert(rows) {
    const stmt = this._db.prepare(`
      INSERT OR IGNORE INTO contacts (id,name,phone,country,group_tag,label,opt_in)
      VALUES (@id,@name,@phone,@country,@group_tag,@label,@opt_in)
    `);
    const tx = this._db.transaction((list) => {
      for (const r of list) stmt.run(r);
    });
    tx(rows);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GROUPS
  // ═══════════════════════════════════════════════════════════════════════════
  groupList() {
    return this._db.prepare('SELECT * FROM groups ORDER BY name ASC').all();
  }

  groupUpsert(g) {
    return this._db.prepare(`
      INSERT INTO groups (id,account_id,name,description,member_count,invite_link,synced_at)
      VALUES (@id,@account_id,@name,@description,@member_count,@invite_link,@synced_at)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, description=excluded.description,
        member_count=excluded.member_count, invite_link=excluded.invite_link,
        synced_at=excluded.synced_at
    `).run(g);
  }

  groupMembersReplace(groupId, members) {
    const tx = this._db.transaction(() => {
      this._db.prepare('DELETE FROM group_members WHERE group_id=?').run(groupId);
      const stmt = this._db.prepare(
        'INSERT OR IGNORE INTO group_members (group_id,phone,name,is_admin) VALUES (?,?,?,?)'
      );
      for (const m of members) stmt.run(groupId, m.phone, m.name || '', m.is_admin ? 1 : 0);
    });
    tx();
  }

  groupMembers(groupId) {
    return this._db.prepare('SELECT * FROM group_members WHERE group_id=?').all(groupId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMPAIGNS
  // ═══════════════════════════════════════════════════════════════════════════
  campaignList() {
    return this._db.prepare('SELECT * FROM campaigns ORDER BY created_at DESC').all();
  }

  campaignGet(id) {
    return this._db.prepare('SELECT * FROM campaigns WHERE id=?').get(id);
  }

  campaignCreate(c) {
    return this._db.prepare(`
      INSERT INTO campaigns (id,name,type,account_id,message_body,media_path,media_type,delay_sec,total)
      VALUES (@id,@name,@type,@account_id,@message_body,@media_path,@media_type,@delay_sec,@total)
    `).run(c);
  }

  campaignUpdateStatus(id, status, extra = {}) {
    let sql = 'UPDATE campaigns SET status=?';
    const params = [status];
    if (extra.sent   !== undefined) { sql += ', sent=?';        params.push(extra.sent);   }
    if (extra.failed !== undefined) { sql += ', failed=?';      params.push(extra.failed); }
    if (status === 'done')          { sql += ', finished_at=datetime(\'now\')'; }
    sql += ' WHERE id=?';
    params.push(id);
    return this._db.prepare(sql).run(...params);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MESSAGES
  // ═══════════════════════════════════════════════════════════════════════════
  messageCreate(m) {
    return this._db.prepare(`
      INSERT INTO messages (id,campaign_id,account_id,recipient,direction,body,media_url,wa_msg_id,status)
      VALUES (@id,@campaign_id,@account_id,@recipient,@direction,@body,@media_url,@wa_msg_id,@status)
    `).run(m);
  }

  messageUpdateStatus(id, status, errMsg) {
    return this._db.prepare(`
      UPDATE messages SET status=?, error_msg=? WHERE id=?
    `).run(status, errMsg || null, id);
  }

  messageHistory(phone) {
    return this._db.prepare(
      'SELECT * FROM messages WHERE recipient=? ORDER BY sent_at DESC LIMIT 100'
    ).all(phone);
  }

  messageStats() {
    return this._db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status='sent'      THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status='read'      THEN 1 ELSE 0 END) as read_count,
        SUM(CASE WHEN status='failed'    THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN direction='in'     THEN 1 ELSE 0 END) as replies
      FROM messages
    `).get();
  }

  messageStatsByAccount() {
    return this._db.prepare(`
      SELECT account_id, COUNT(*) as total,
        SUM(CASE WHEN status='sent' OR status='delivered' OR status='read' THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
      FROM messages
      GROUP BY account_id
    `).all();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCHEDULER
  // ═══════════════════════════════════════════════════════════════════════════
  taskList() {
    return this._db.prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC').all();
  }

  taskGet(id) { return this._db.prepare('SELECT * FROM scheduled_tasks WHERE id=?').get(id); }

  taskCreate(t) {
    return this._db.prepare(`
      INSERT INTO scheduled_tasks
        (id, name, campaign_id, cron_expr, next_run, active,
         message_body, media_path, media_type,
         recipients_type, recipients_json, session_id, timezone, template_id)
      VALUES
        (@id, @name, @campaign_id, @cron_expr, @next_run, @active,
         @message_body, @media_path, @media_type,
         @recipients_type, @recipients_json, @session_id, @timezone, @template_id)
    `).run(t);
  }

  taskUpdate(t) {
    return this._db.prepare(`
      UPDATE scheduled_tasks SET
        name=@name, cron_expr=@cron_expr, next_run=@next_run, active=@active,
        message_body=@message_body, media_path=@media_path, media_type=@media_type,
        recipients_type=@recipients_type, recipients_json=@recipients_json,
        session_id=@session_id, timezone=@timezone, template_id=@template_id
      WHERE id=@id
    `).run(t);
  }

  taskDelete(id) { return this._db.prepare('DELETE FROM scheduled_tasks WHERE id=?').run(id); }

  taskBumpRun(id, nextRun) {
    return this._db.prepare(`
      UPDATE scheduled_tasks SET last_run=datetime('now'), run_count=run_count+1, next_run=? WHERE id=?
    `).run(nextRun, id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEMPLATES
  // ═══════════════════════════════════════════════════════════════════════════
  templateList() {
    return this._db.prepare('SELECT * FROM templates ORDER BY name ASC').all();
  }

  templateUpsert(t) {
    return this._db.prepare(`
      INSERT INTO templates (id,name,category,body,variables,language)
      VALUES (@id,@name,@category,@body,@variables,@language)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, category=excluded.category, body=excluded.body,
        variables=excluded.variables, language=excluded.language
    `).run(t);
  }

  templateDelete(id) { return this._db.prepare('DELETE FROM templates WHERE id=?').run(id); }

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════
  settingGet(key) {
    const row = this._db.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row ? row.value : null;
  }

  settingSet(key, value) {
    return this._db.prepare(
      'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
    ).run(key, value);
  }

  settingsGetAll() {
    const rows = this._db.prepare('SELECT key,value FROM settings').all();
    return Object.fromEntries(rows.map(r => [r.key, r.value]));
  }

  settingsBulkSet(obj) {
    const stmt = this._db.prepare(
      'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
    );
    const tx = this._db.transaction((o) => {
      for (const [k, v] of Object.entries(o)) stmt.run(k, String(v ?? ''));
    });
    tx(obj);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CRM LEADS
  // ═══════════════════════════════════════════════════════════════════════════
  crmLeadList() {
    return this._db.prepare('SELECT * FROM crm_leads ORDER BY synced_at DESC').all();
  }

  crmLeadBulkReplace(source, rows) {
    const tx = this._db.transaction(() => {
      this._db.prepare('DELETE FROM crm_leads WHERE source=?').run(source);
      const stmt = this._db.prepare(`
        INSERT INTO crm_leads (id,source,name,phone,email,status,raw_json)
        VALUES (@id,@source,@name,@phone,@email,@status,@raw_json)
      `);
      for (const r of rows) stmt.run(r);
    });
    tx();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REPORTS
  // ═══════════════════════════════════════════════════════════════════════════
  reportSummary(days = 30) {
    return this._db.prepare(`
      SELECT
        DATE(sent_at) as day,
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('sent','delivered','read') THEN 1 ELSE 0 END) as success,
        SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed
      FROM messages
      WHERE sent_at >= datetime('now', ?)
      GROUP BY day
      ORDER BY day ASC
    `).all(`-${days} days`);
  }

  reportCampaignPerf() {
    return this._db.prepare(`
      SELECT c.name, c.type, c.total, c.sent, c.failed,
             c.created_at, c.finished_at, c.status,
             (CASE WHEN c.total>0 THEN ROUND(c.sent*100.0/c.total,1) ELSE 0 END) as success_pct
      FROM campaigns c
      ORDER BY c.created_at DESC
      LIMIT 50
    `).all();
  }

  reportSentDetail(days = 90) {
    return this._db.prepare(`
      SELECT
        sq.recipient,
        COALESCE(sq.picked_body, sq.body)      AS body,
        sq.wa_msg_id,
        sq.status,
        sq.error_msg,
        sq.processed_at,
        sq.created_at,
        sq.session_id,
        sq.campaign_id,
        c.name                                 AS contact_name,
        ws.name                                AS session_name,
        cam.name                               AS campaign_name
      FROM send_queue sq
      LEFT JOIN contacts   c   ON c.phone    = sq.recipient
      LEFT JOIN wa_sessions ws  ON ws.id      = sq.session_id
      LEFT JOIN campaigns   cam ON cam.id     = sq.campaign_id
      WHERE sq.status IN ('sent','delivered','read','failed')
        AND sq.processed_at >= datetime('now', ?)
      ORDER BY sq.processed_at DESC
      LIMIT 2000
    `).all(`-${days} days`);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // WA SESSIONS (whatsapp-web.js engine)
  // ═══════════════════════════════════════════════════════════════════════════

  sessionList() {
    return this._db.prepare(
      'SELECT * FROM wa_sessions ORDER BY created_at DESC'
    ).all();
  }

  sessionGet(id) {
    return this._db.prepare('SELECT * FROM wa_sessions WHERE id=?').get(id);
  }

  sessionCreate(s) {
    return this._db.prepare(`
      INSERT INTO wa_sessions (id, name, status)
      VALUES (@id, @name, 'disconnected')
    `).run(s);
  }

  sessionDelete(id) {
    return this._db.prepare('DELETE FROM wa_sessions WHERE id=?').run(id);
  }

  sessionUpdateField(id, field, value) {
    // Only allow known fields to prevent SQL injection
    const allowed = ['name','phone','status','qr_code','last_seen'];
    if (!allowed.includes(field)) throw new Error(`Unknown session field: ${field}`);
    this._db.prepare(`UPDATE wa_sessions SET ${field}=? WHERE id=?`).run(value, id);
  }

  sessionSetReady(id, phone) {
    this._db.prepare(`
      UPDATE wa_sessions SET status='ready', phone=?, qr_code=NULL, last_seen=datetime('now')
      WHERE id=?
    `).run(phone, id);
  }

  sessionBumpUsage(id) {
    this._db.prepare(`
      UPDATE wa_sessions SET msg_count=msg_count+1, last_seen=datetime('now') WHERE id=?
    `).run(id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SEND QUEUE (anti-ban engine)
  // ═══════════════════════════════════════════════════════════════════════════

  queueEnqueue(item) {
    return this._db.prepare(`
      INSERT INTO send_queue
        (id, session_id, campaign_id, recipient, body, scripts, media_path,
         delay_min_ms, delay_max_ms, priority, max_attempts, scheduled_at)
      VALUES
        (@id, @session_id, @campaign_id, @recipient, @body, @scripts, @media_path,
         @delay_min_ms, @delay_max_ms, @priority, @max_attempts, @scheduled_at)
    `).run(item);
  }

  /** Fetch the next pending item that is due for processing */
  queuePeek() {
    return this._db.prepare(`
      SELECT * FROM send_queue
      WHERE status = 'pending'
        AND scheduled_at <= datetime('now')
      ORDER BY priority ASC, scheduled_at ASC
      LIMIT 1
    `).get();
  }

  queueSetStatus(id, status) {
    this._db.prepare('UPDATE send_queue SET status=? WHERE id=?').run(status, id);
  }

  queueSetDone(id, waId) {
    this._db.prepare(`
      UPDATE send_queue
      SET status='sent', wa_msg_id=?, processed_at=datetime('now')
      WHERE id=?
    `).run(waId || null, id);
  }

  queueSetFailed(id, errMsg) {
    this._db.prepare(`
      UPDATE send_queue
      SET status='failed', error_msg=?, processed_at=datetime('now')
      WHERE id=?
    `).run(errMsg || null, id);
  }

  queueSetRetry(id, attempts) {
    this._db.prepare(`
      UPDATE send_queue SET status='pending', attempts=? WHERE id=?
    `).run(attempts, id);
  }

  queueUpdateByWaId(waId, status) {
    this._db.prepare(
      "UPDATE send_queue SET status=? WHERE wa_msg_id=?"
    ).run(status, waId);
  }

  queueStats() {
    return this._db.prepare(`
      SELECT
        SUM(CASE WHEN status='pending'    THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status='processing' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status='sent'       THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status='delivered'  THEN 1 ELSE 0 END) as delivered,
        SUM(CASE WHEN status='read'       THEN 1 ELSE 0 END) as read_count,
        SUM(CASE WHEN status='failed'     THEN 1 ELSE 0 END) as failed,
        COUNT(*) as total
      FROM send_queue
    `).get();
  }

  queueClearCompleted() {
    return this._db.prepare(
      "DELETE FROM send_queue WHERE status IN ('sent','delivered','read')"
    ).run();
  }

  queueClearFailed() {
    return this._db.prepare(
      "DELETE FROM send_queue WHERE status = 'failed'"
    ).run();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANTI-BAN TRACKING
  // ═══════════════════════════════════════════════════════════════════════════

  /** Returns all anti-ban fields for a session */
  sessionGetAntiBan(id) {
    return this._db.prepare(`
      SELECT id, name, phone, status,
             daily_count, daily_reset_at,
             hourly_count, hourly_reset_at,
             health_score, ban_detected_at,
             warmup_mode, warmup_day, warmup_daily_limit,
             msg_count, last_seen
      FROM wa_sessions WHERE id=?
    `).get(id);
  }

  /** Bulk-fetch anti-ban stats for all sessions */
  sessionListAntiBan() {
    return this._db.prepare(`
      SELECT id, name, phone, status,
             daily_count, daily_reset_at,
             hourly_count, hourly_reset_at,
             health_score, ban_detected_at,
             warmup_mode, warmup_day, warmup_daily_limit,
             msg_count, last_seen
      FROM wa_sessions ORDER BY created_at DESC
    `).all();
  }

  /** Atomically bump daily + hourly counters and update reset timestamps */
  sessionBumpAntiBanCounters(id) {
    const now     = new Date();
    const todayStr  = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const hourStr   = now.toISOString().slice(0, 13); // YYYY-MM-DDTHH

    const row = this._db.prepare(
      'SELECT daily_reset_at, hourly_reset_at FROM wa_sessions WHERE id=?'
    ).get(id);
    if (!row) return;

    const sameDay  = row.daily_reset_at  && row.daily_reset_at.startsWith(todayStr);
    const sameHour = row.hourly_reset_at && row.hourly_reset_at.startsWith(hourStr);

    this._db.prepare(`
      UPDATE wa_sessions SET
        daily_count      = CASE WHEN ? THEN daily_count+1 ELSE 1 END,
        daily_reset_at   = CASE WHEN ? THEN daily_reset_at ELSE ? END,
        hourly_count     = CASE WHEN ? THEN hourly_count+1 ELSE 1 END,
        hourly_reset_at  = CASE WHEN ? THEN hourly_reset_at ELSE ? END
      WHERE id=?
    `).run(
      sameDay  ? 1 : 0, sameDay  ? 1 : 0, now.toISOString(),
      sameHour ? 1 : 0, sameHour ? 1 : 0, now.toISOString(),
      id
    );
  }

  sessionUpdateHealthScore(id, score) {
    const clamped = Math.max(0, Math.min(100, score));
    this._db.prepare('UPDATE wa_sessions SET health_score=? WHERE id=?').run(clamped, id);
  }

  sessionSetBanDetected(id) {
    this._db.prepare(`
      UPDATE wa_sessions SET ban_detected_at=datetime('now'), health_score=0 WHERE id=?
    `).run(id);
  }

  sessionSetWarmup(id, mode, day, dailyLimit) {
    this._db.prepare(`
      UPDATE wa_sessions SET warmup_mode=?, warmup_day=?, warmup_daily_limit=? WHERE id=?
    `).run(mode ? 1 : 0, day, dailyLimit, id);
  }

  sessionResetDailyCounters() {
    const todayStr = new Date().toISOString().slice(0, 10);
    return this._db.prepare(`
      UPDATE wa_sessions
      SET daily_count=0, daily_reset_at=datetime('now')
      WHERE daily_reset_at IS NULL
         OR substr(daily_reset_at,1,10) < ?
    `).run(todayStr).changes;
  }

  sessionResetHourlyCounters() {
    const hourStr = new Date().toISOString().slice(0, 13);
    return this._db.prepare(`
      UPDATE wa_sessions
      SET hourly_count=0, hourly_reset_at=datetime('now')
      WHERE hourly_reset_at IS NULL
         OR substr(hourly_reset_at,1,13) < ?
    `).run(hourStr).changes;
  }

  antiBanEventLog({ session_id, event_type, detail }) {
    return this._db.prepare(`
      INSERT INTO anti_ban_events (session_id, event_type, detail)
      VALUES (?, ?, ?)
    `).run(session_id || null, event_type, detail || null);
  }

  antiBanEventList(limit = 100) {
    return this._db.prepare(`
      SELECT abe.*, ws.name as session_name
      FROM anti_ban_events abe
      LEFT JOIN wa_sessions ws ON ws.id = abe.session_id
      ORDER BY abe.created_at DESC
      LIMIT ?
    `).all(limit);
  }

  antiBanEventClear() {
    return this._db.prepare(`
      DELETE FROM anti_ban_events
      WHERE created_at < datetime('now', '-30 days')
    `).run();
  }

  // ─── Campaign increments (used by sending engine) ─────────────────────────
  campaignIncrSent(id) {
    this._db.prepare(
      'UPDATE campaigns SET sent=sent+1 WHERE id=?'
    ).run(id);
  }

  campaignIncrFailed(id) {
    this._db.prepare(
      'UPDATE campaigns SET failed=failed+1 WHERE id=?'
    ).run(id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAMPAIGN SCRIPTS (A/B Testing per-variant tracking)
  // ═══════════════════════════════════════════════════════════════════════════

  campaignScriptsInsert(campaignId, scripts) {
    const stmt = this._db.prepare(`
      INSERT OR REPLACE INTO campaign_scripts
        (campaign_id, script_index, script_text, media_path)
      VALUES (?, ?, ?, ?)
    `);
    const tx = this._db.transaction(() => {
      scripts.forEach((s, i) => {
        const text      = typeof s === 'string' ? s : (s.text      || '');
        const mediaPath = typeof s === 'string' ? null : (s.mediaPath || null);
        stmt.run(campaignId, i, text, mediaPath);
      });
    });
    tx();
  }

  campaignScriptsGet(campaignId) {
    return this._db.prepare(
      'SELECT * FROM campaign_scripts WHERE campaign_id=? ORDER BY script_index ASC'
    ).all(campaignId);
  }

  campaignScriptIncrSent(campaignId, scriptIndex) {
    this._db.prepare(
      'UPDATE campaign_scripts SET sent_count=sent_count+1 WHERE campaign_id=? AND script_index=?'
    ).run(campaignId, scriptIndex);
  }

  campaignScriptIncrFailed(campaignId, scriptIndex) {
    this._db.prepare(
      'UPDATE campaign_scripts SET failed_count=failed_count+1 WHERE campaign_id=? AND script_index=?'
    ).run(campaignId, scriptIndex);
  }

  campaignScriptIncrReplied(campaignId, scriptIndex) {
    this._db.prepare(
      'UPDATE campaign_scripts SET replied_count=replied_count+1 WHERE campaign_id=? AND script_index=?'
    ).run(campaignId, scriptIndex);
  }

  // ─── send_queue: store chosen variant index ────────────────────────────────
  queueSetScriptIndex(id, scriptIndex, pickedBody) {
    this._db.prepare(
      'UPDATE send_queue SET script_index=?, picked_body=? WHERE id=?'
    ).run(scriptIndex, pickedBody || null, id);
  }

  /** Get last successfully-sent queue item for a phone (reply attribution) */
  queueGetLastSentForRecipient(phone) {
    return this._db.prepare(`
      SELECT * FROM send_queue
      WHERE recipient=? AND status IN ('sent','delivered','read')
        AND script_index >= 0 AND campaign_id IS NOT NULL
      ORDER BY processed_at DESC
      LIMIT 1
    `).get(phone);
  }

  /** A/B results: campaigns that have per-script data */
  abResultsList() {
    return this._db.prepare(`
      SELECT c.id, c.name, c.status, c.total, c.sent, c.failed,
             c.created_at, c.finished_at
      FROM campaigns c
      WHERE EXISTS (SELECT 1 FROM campaign_scripts cs WHERE cs.campaign_id = c.id)
      ORDER BY c.created_at DESC
      LIMIT 30
    `).all();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INCOMING MESSAGES (whatsapp-web.js replies / inbox)
  // ═══════════════════════════════════════════════════════════════════════════

  incomingMessageSave(m) {
    return this._db.prepare(`
      INSERT INTO incoming_messages
        (session_id, from_number, body, msg_type, has_media, is_group, group_name, timestamp)
      VALUES
        (@session_id, @from_number, @body, @msg_type, @has_media, @is_group, @group_name, @timestamp)
    `).run(m);
  }

  /** List with session_name joined from wa_sessions, optional replied filter */
  incomingMessageList(sessionId, limit = 200, repliedFilter = null) {
    let sql = `
      SELECT im.*,
             ws.name AS session_name,
             c.name  AS contact_name
      FROM incoming_messages im
      LEFT JOIN wa_sessions ws ON ws.id = im.session_id
      LEFT JOIN contacts     c  ON c.phone = im.from_number
      WHERE 1=1
    `;
    const params = [];
    if (sessionId) { sql += ' AND im.session_id=?'; params.push(sessionId); }
    if (repliedFilter === 'replied')    { sql += ' AND im.replied=1'; }
    if (repliedFilter === 'unreplied')  { sql += ' AND im.replied=0'; }
    sql += ' ORDER BY im.received_at DESC LIMIT ?';
    params.push(limit);
    return this._db.prepare(sql).all(...params);
  }

  incomingMessageGet(id) {
    return this._db.prepare(`
      SELECT im.*, ws.name AS session_name
      FROM incoming_messages im
      LEFT JOIN wa_sessions ws ON ws.id = im.session_id
      WHERE im.id = ?
    `).get(id);
  }

  incomingMessageMarkRead(id) {
    return this._db.prepare('UPDATE incoming_messages SET read=1 WHERE id=?').run(id);
  }

  incomingMessageMarkReplied(id, { replyBody, repliedBy }) {
    return this._db.prepare(`
      UPDATE incoming_messages
      SET replied=1, reply_body=?, replied_by=?, replied_at=datetime('now'), read=1
      WHERE id=?
    `).run(replyBody || null, repliedBy || null, id);
  }

  incomingUnreadCount(sessionId) {
    const sql = sessionId
      ? 'SELECT COUNT(*) as n FROM incoming_messages WHERE session_id=? AND read=0'
      : 'SELECT COUNT(*) as n FROM incoming_messages WHERE read=0';
    const params = sessionId ? [sessionId] : [];
    return this._db.prepare(sql).get(...params).n;
  }

  incomingUnrepliedCount(sessionId) {
    const sql = sessionId
      ? 'SELECT COUNT(*) as n FROM incoming_messages WHERE session_id=? AND replied=0'
      : 'SELECT COUNT(*) as n FROM incoming_messages WHERE replied=0';
    const params = sessionId ? [sessionId] : [];
    return this._db.prepare(sql).get(...params).n;
  }

  incomingReplyStats() {
    return this._db.prepare(`
      SELECT
        COUNT(*)                                                  AS total,
        SUM(CASE WHEN replied=1 THEN 1 ELSE 0 END)               AS replied_count,
        SUM(CASE WHEN replied=0 THEN 1 ELSE 0 END)               AS unreplied_count,
        SUM(CASE WHEN is_group=1 THEN 1 ELSE 0 END)              AS from_groups,
        SUM(CASE WHEN is_group=0 THEN 1 ELSE 0 END)              AS from_direct
      FROM incoming_messages
    `).get();
  }

  /** reportReplies with full session name + reply status */
  reportReplies() {
    return this._db.prepare(`
      SELECT
        im.id,
        im.from_number,
        im.body,
        im.msg_type,
        im.is_group,
        im.group_name,
        im.session_id,
        im.received_at,
        im.read,
        im.replied,
        im.reply_body,
        im.replied_at,
        im.replied_by,
        ws.name  AS session_name,
        c.name   AS from_name
      FROM incoming_messages im
      LEFT JOIN wa_sessions ws ON ws.id = im.session_id
      LEFT JOIN contacts    c  ON c.phone = im.from_number
      ORDER BY im.received_at DESC
      LIMIT 200
    `).all();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONVERSATION VIEW — all in+out messages for a phone number
  // ═══════════════════════════════════════════════════════════════════════════
  conversationGet(phone, limit = 100) {
    // Outbound from send_queue
    const out = this._db.prepare(`
      SELECT 'out' AS dir,
             COALESCE(picked_body, body) AS body,
             processed_at AS ts,
             status, wa_msg_id, session_id
      FROM send_queue
      WHERE recipient=? AND status IN ('sent','delivered','read','failed')
      ORDER BY processed_at DESC LIMIT ?
    `).all(phone, limit);
    // Inbound from incoming_messages
    const inc = this._db.prepare(`
      SELECT 'in' AS dir, body, received_at AS ts,
             'received' AS status, NULL AS wa_msg_id, session_id
      FROM incoming_messages
      WHERE from_number=?
      ORDER BY received_at DESC LIMIT ?
    `).all(phone, limit);
    return [...out, ...inc].sort((a, b) => (a.ts > b.ts ? -1 : 1)).slice(0, limit);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MEDIA LIBRARY
  // ═══════════════════════════════════════════════════════════════════════════
  mediaList() {
    return this._db.prepare('SELECT * FROM media_files ORDER BY created_at DESC').all();
  }

  mediaAdd(m) {
    return this._db.prepare(`
      INSERT OR IGNORE INTO media_files (id, name, file_path, mime_type, size_bytes)
      VALUES (@id, @name, @file_path, @mime_type, @size_bytes)
    `).run(m);
  }

  mediaDelete(id) {
    return this._db.prepare('DELETE FROM media_files WHERE id=?').run(id);
  }

  mediaGet(id) {
    return this._db.prepare('SELECT * FROM media_files WHERE id=?').get(id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LIVE DASHBOARD STATS
  // ═══════════════════════════════════════════════════════════════════════════
  dashboardStats() {
    const today = new Date().toISOString().slice(0, 10);
    const queue = this._db.prepare(`
      SELECT
        SUM(CASE WHEN status='pending'   THEN 1 ELSE 0 END) AS queued,
        SUM(CASE WHEN status='sent' OR status='delivered' OR status='read' THEN 1 ELSE 0 END) AS sent_today,
        SUM(CASE WHEN status='failed'    THEN 1 ELSE 0 END) AS failed_today
      FROM send_queue WHERE DATE(created_at)=?
    `).get(today);

    const sessions = this._db.prepare(`
      SELECT id, name, status, health_score, daily_count,
             warmup_mode, ban_detected_at, hourly_count
      FROM wa_sessions WHERE status IN ('ready','authenticated')
    `).all();

    const todayMsgs = this._db.prepare(`
      SELECT COUNT(*) AS n FROM messages WHERE DATE(sent_at)=?
    `).get(today);

    const unread = this._db.prepare(
      'SELECT COUNT(*) AS n FROM incoming_messages WHERE read=0'
    ).get();

    return {
      queue:      queue   || { queued: 0, sent_today: 0, failed_today: 0 },
      sessions,
      todayMsgs:  todayMsgs?.n  || 0,
      unreadInbox: unread?.n || 0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CHATBOT FLOWS
  // ═══════════════════════════════════════════════════════════════════════════
  chatbotList() {
    return this._db.prepare('SELECT * FROM chatbot_flows ORDER BY created_at DESC').all();
  }

  chatbotGet(id) {
    return this._db.prepare('SELECT * FROM chatbot_flows WHERE id=?').get(id);
  }

  chatbotSave({ id, name, nodes_json, trigger_keywords, active }) {
    if (id) {
      return this._db.prepare(`
        UPDATE chatbot_flows SET name=?, nodes_json=?, trigger_keywords=?, active=?, updated_at=datetime('now')
        WHERE id=?
      `).run(name, nodes_json, trigger_keywords || '', active ?? 1, id);
    }
    return this._db.prepare(`
      INSERT INTO chatbot_flows (name, nodes_json, trigger_keywords, active)
      VALUES (?, ?, ?, ?)
    `).run(name, nodes_json, trigger_keywords || '', active ?? 1);
  }

  chatbotDelete(id) {
    return this._db.prepare('DELETE FROM chatbot_flows WHERE id=?').run(id);
  }

  chatbotGetActive() {
    return this._db.prepare('SELECT * FROM chatbot_flows WHERE active=1').all();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT LOG
  // ═══════════════════════════════════════════════════════════════════════════
  auditLog({ event_type, description, session_id = null, meta = null }) {
    return this._db.prepare(`
      INSERT INTO audit_log (event_type, description, session_id, meta)
      VALUES (?, ?, ?, ?)
    `).run(event_type, description, session_id, meta ? JSON.stringify(meta) : null);
  }

  auditList(limit = 200) {
    return this._db.prepare(`
      SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  }

  auditExport() {
    return this._db.prepare(`
      SELECT created_at, event_type, description, session_id, meta
      FROM audit_log ORDER BY created_at DESC
    `).all();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIENCE BUILDER — multi-condition contact filter
  // ═══════════════════════════════════════════════════════════════════════════
  audienceFilter(conditions = []) {
    // conditions: [{field, op, value}]
    let where = ['1=1'];
    const params = [];
    for (const c of conditions) {
      const field = ['name','phone','country','group_tag','label','opt_in'].includes(c.field) ? c.field : null;
      if (!field) continue;
      if (c.op === 'eq')       { where.push(`LOWER(${field})=LOWER(?)`); params.push(c.value); }
      else if (c.op === 'contains') { where.push(`LOWER(${field}) LIKE LOWER(?)`); params.push('%' + c.value + '%'); }
      else if (c.op === 'starts')   { where.push(`LOWER(${field}) LIKE LOWER(?)`); params.push(c.value + '%'); }
      else if (c.op === 'neq')  { where.push(`LOWER(${field})!=LOWER(?)`); params.push(c.value); }
      else if (c.op === 'empty'){ where.push(`(${field} IS NULL OR ${field}='')`); }
    }
    return this._db.prepare(
      `SELECT * FROM contacts WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 5000`
    ).all(...params);
  }

  audienceSave({ name, conditions, count }) {
    return this._db.prepare(`
      INSERT INTO audiences (name, conditions, count) VALUES (?, ?, ?)
    `).run(name, JSON.stringify(conditions), count || 0);
  }

  audienceList() {
    return this._db.prepare('SELECT * FROM audiences ORDER BY created_at DESC').all();
  }

  audienceDelete(id) {
    return this._db.prepare('DELETE FROM audiences WHERE id=?').run(id);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ADVANCED ANALYTICS — funnel
  // ═══════════════════════════════════════════════════════════════════════════
  analyticsFunnel(days = 30) {
    const from = new Date(); from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().slice(0, 10);
    const sent      = this._db.prepare(`SELECT COUNT(*) AS n FROM send_queue WHERE status IN ('sent','delivered','read') AND DATE(created_at)>=?`).get(fromStr)?.n || 0;
    const delivered = this._db.prepare(`SELECT COUNT(*) AS n FROM send_queue WHERE status IN ('delivered','read') AND DATE(created_at)>=?`).get(fromStr)?.n || 0;
    const read      = this._db.prepare(`SELECT COUNT(*) AS n FROM send_queue WHERE status='read' AND DATE(created_at)>=?`).get(fromStr)?.n || 0;
    const replied   = this._db.prepare(`SELECT COUNT(*) AS n FROM incoming_messages WHERE DATE(received_at)>=?`).get(fromStr)?.n || 0;
    return { sent, delivered, read, replied };
  }

  analyticsHeatmap(days = 30) {
    const from = new Date(); from.setDate(from.getDate() - days);
    const fromStr = from.toISOString().slice(0, 10);
    return this._db.prepare(`
      SELECT strftime('%w', created_at) AS dow,
             strftime('%H', created_at) AS hour,
             COUNT(*) AS count
      FROM send_queue
      WHERE status IN ('sent','delivered','read') AND DATE(created_at)>=?
      GROUP BY dow, hour
      ORDER BY dow, hour
    `).all(fromStr);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DAILY USAGE STATS — for usage alerts
  // ═══════════════════════════════════════════════════════════════════════════
  dailySentCount(days = 7) {
    const rows = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const r = this._db.prepare(
        `SELECT COUNT(*) AS n FROM messages WHERE DATE(sent_at)=?`
      ).get(dateStr);
      rows.push({ date: dateStr, count: r?.n || 0 });
    }
    return rows;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RETRY FAILED MESSAGES
  // ═══════════════════════════════════════════════════════════════════════════
  queueRetryFailed(campaignId) {
    const sql = campaignId
      ? `UPDATE send_queue SET status='pending', attempts=0, error_msg=NULL,
           scheduled_at=datetime('now') WHERE status='failed' AND campaign_id=?`
      : `UPDATE send_queue SET status='pending', attempts=0, error_msg=NULL,
           scheduled_at=datetime('now') WHERE status='failed'`;
    const params = campaignId ? [campaignId] : [];
    return this._db.prepare(sql).run(...params).changes;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // A/B AUTO WINNER
  // ═══════════════════════════════════════════════════════════════════════════
  abGetWinner(campaignId) {
    return this._db.prepare(`
      SELECT script_index, script_text, sent_count, failed_count, replied_count,
        CASE WHEN sent_count > 0
             THEN ROUND(replied_count * 100.0 / sent_count, 2)
             ELSE 0
        END AS reply_rate
      FROM campaign_scripts
      WHERE campaign_id=? AND sent_count > 0
      ORDER BY reply_rate DESC, replied_count DESC
      LIMIT 1
    `).get(campaignId);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 6 — TEAM USERS
  // ═══════════════════════════════════════════════════════════════════════════
  teamUserList() {
    return this._db.prepare('SELECT * FROM team_users ORDER BY role ASC, name ASC').all();
  }

  teamUserGet(id) {
    return this._db.prepare('SELECT * FROM team_users WHERE id=?').get(id);
  }

  teamUserSave(u) {
    const existing = u.id ? this.teamUserGet(u.id) : null;
    if (existing) {
      this._db.prepare(`
        UPDATE team_users SET name=?, role=?, email=?, color=?, active=?
        ${u.pin ? ', pin=?' : ''}
        WHERE id=?
      `).run(...(u.pin
        ? [u.name, u.role, u.email||'', u.color||'#6366f1', u.active??1, u.pin, u.id]
        : [u.name, u.role, u.email||'', u.color||'#6366f1', u.active??1, u.id]
      ));
    } else {
      if (!u.id) u.id = require('crypto').randomUUID?.() || require('uuid').v4();
      this._db.prepare(`
        INSERT INTO team_users (id,name,role,email,pin,color,active)
        VALUES (?,?,?,?,?,?,?)
      `).run(u.id, u.name, u.role||'agent', u.email||'', u.pin||'', u.color||'#6366f1', u.active??1);
    }
    return this.teamUserGet(u.id);
  }

  teamUserDelete(id) {
    this._db.prepare('DELETE FROM team_users WHERE id=?').run(id);
  }

  teamUserTouch(id) {
    this._db.prepare(`UPDATE team_users SET last_active=datetime('now') WHERE id=?`).run(id);
  }

  // ─── Conversation Assignments ─────────────────────────────────────────────
  assignmentList({ status, agentId } = {}) {
    let sql = `
      SELECT ca.*, tu.name AS agent_name, tu.color AS agent_color,
             im.body AS last_message, im.received_at AS last_msg_at
      FROM conversation_assignments ca
      LEFT JOIN team_users tu ON tu.id = ca.agent_id
      LEFT JOIN (
        SELECT from_number, body, received_at,
               ROW_NUMBER() OVER (PARTITION BY from_number ORDER BY received_at DESC) rn
        FROM incoming_messages
      ) im ON im.from_number = ca.phone AND im.rn = 1
      WHERE 1=1
    `;
    const params = [];
    if (status)  { sql += ' AND ca.status=?';   params.push(status); }
    if (agentId) { sql += ' AND ca.agent_id=?'; params.push(agentId); }
    sql += ' ORDER BY ca.assigned_at DESC';
    return this._db.prepare(sql).all(...params);
  }

  assignmentUpsert(a) {
    return this._db.prepare(`
      INSERT INTO conversation_assignments (phone, session_id, agent_id, status, priority, tags, notes)
      VALUES (@phone, @session_id, @agent_id, @status, @priority, @tags, @notes)
      ON CONFLICT(phone) DO UPDATE SET
        agent_id=excluded.agent_id, status=excluded.status,
        priority=excluded.priority, tags=excluded.tags,
        notes=excluded.notes, session_id=excluded.session_id,
        assigned_at=CASE WHEN excluded.agent_id != conversation_assignments.agent_id
                         THEN datetime('now') ELSE conversation_assignments.assigned_at END
    `).run({
      phone:      a.phone,
      session_id: a.session_id || '',
      agent_id:   a.agent_id   || null,
      status:     a.status     || 'open',
      priority:   a.priority   || 'normal',
      tags:       a.tags       || '',
      notes:      a.notes      || '',
    });
  }

  assignmentResolve(phone) {
    this._db.prepare(`
      UPDATE conversation_assignments SET status='resolved', resolved_at=datetime('now')
      WHERE phone=?
    `).run(phone);
  }

  assignmentStats() {
    const rows = this._db.prepare(`
      SELECT ca.agent_id, tu.name AS agent_name, tu.color,
             COUNT(*) AS total,
             SUM(CASE WHEN ca.status='resolved' THEN 1 ELSE 0 END) AS resolved,
             SUM(CASE WHEN ca.status='open' OR ca.status='in_progress' THEN 1 ELSE 0 END) AS open_count
      FROM conversation_assignments ca
      LEFT JOIN team_users tu ON tu.id = ca.agent_id
      GROUP BY ca.agent_id
    `).all();
    return rows;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 7 — AUTOMATION SEQUENCES
  // ═══════════════════════════════════════════════════════════════════════════
  sequenceList() {
    const seqs = this._db.prepare('SELECT * FROM sequences ORDER BY created_at DESC').all();
    for (const s of seqs) {
      s.steps = this._db.prepare(
        'SELECT * FROM sequence_steps WHERE sequence_id=? ORDER BY step_order ASC'
      ).all(s.id);
      s.enrolled = this._db.prepare(
        'SELECT COUNT(*) AS n FROM sequence_enrollments WHERE sequence_id=? AND completed=0'
      ).get(s.id)?.n || 0;
    }
    return seqs;
  }

  sequenceGet(id) {
    const s = this._db.prepare('SELECT * FROM sequences WHERE id=?').get(id);
    if (!s) return null;
    s.steps = this._db.prepare(
      'SELECT * FROM sequence_steps WHERE sequence_id=? ORDER BY step_order ASC'
    ).all(id);
    return s;
  }

  sequenceSave(seq) {
    const steps = seq.steps || [];
    const tx = this._db.transaction(() => {
      if (seq.id) {
        this._db.prepare(`
          UPDATE sequences SET name=?, trigger_type=?, trigger_value=?, session_id=?, active=?
          WHERE id=?
        `).run(seq.name, seq.trigger_type||'manual', seq.trigger_value||'',
               seq.session_id||'', seq.active??1, seq.id);
        this._db.prepare('DELETE FROM sequence_steps WHERE sequence_id=?').run(seq.id);
      } else {
        seq.id = require('crypto').randomUUID?.() || require('uuid').v4();
        this._db.prepare(`
          INSERT INTO sequences (id, name, trigger_type, trigger_value, session_id, active)
          VALUES (?,?,?,?,?,?)
        `).run(seq.id, seq.name, seq.trigger_type||'manual',
               seq.trigger_value||'', seq.session_id||'', seq.active??1);
      }
      const stmt = this._db.prepare(`
        INSERT INTO sequence_steps (sequence_id, step_order, delay_hours, message_body, media_path)
        VALUES (?,?,?,?,?)
      `);
      steps.forEach((st, i) => stmt.run(seq.id, i, st.delay_hours||24, st.message_body||'', st.media_path||null));
    });
    tx();
    return this.sequenceGet(seq.id);
  }

  sequenceDelete(id) {
    this._db.prepare('DELETE FROM sequences WHERE id=?').run(id);
  }

  sequenceToggle(id) {
    this._db.prepare(`
      UPDATE sequences SET active = CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id=?
    `).run(id);
    return this._db.prepare('SELECT active FROM sequences WHERE id=?').get(id)?.active;
  }

  // ─── Enrollments ──────────────────────────────────────────────────────────
  sequenceEnroll({ sequenceId, phone, sessionId }) {
    const seq = this.sequenceGet(sequenceId);
    if (!seq || !seq.steps.length) return null;
    const firstStep = seq.steps[0];
    const nextSend = new Date(Date.now() + firstStep.delay_hours * 3600000).toISOString();
    try {
      this._db.prepare(`
        INSERT OR IGNORE INTO sequence_enrollments
          (sequence_id, phone, session_id, current_step, next_send_at, completed)
        VALUES (?,?,?,0,?,0)
      `).run(sequenceId, phone, sessionId||'', nextSend);
    } catch (_) {}
    return this._db.prepare(
      'SELECT * FROM sequence_enrollments WHERE sequence_id=? AND phone=?'
    ).get(sequenceId, phone);
  }

  sequenceUnenroll({ sequenceId, phone }) {
    this._db.prepare(
      'DELETE FROM sequence_enrollments WHERE sequence_id=? AND phone=?'
    ).run(sequenceId, phone);
  }

  sequenceEnrollmentList(sequenceId) {
    return this._db.prepare(
      'SELECT * FROM sequence_enrollments WHERE sequence_id=? ORDER BY enrolled_at DESC'
    ).all(sequenceId);
  }

  sequenceDueEnrollments() {
    return this._db.prepare(`
      SELECT se.*, s.name AS seq_name, s.session_id AS default_session,
             ss.message_body, ss.media_path, ss.step_order, ss.delay_hours,
             (SELECT COUNT(*) FROM sequence_steps WHERE sequence_id=se.sequence_id) AS total_steps
      FROM sequence_enrollments se
      JOIN sequences s ON s.id = se.sequence_id AND s.active=1
      JOIN sequence_steps ss ON ss.sequence_id=se.sequence_id AND ss.step_order=se.current_step
      WHERE se.completed=0 AND se.next_send_at <= datetime('now')
      ORDER BY se.next_send_at ASC
      LIMIT 50
    `).all();
  }

  sequenceAdvanceEnrollment({ id, nextStep, totalSteps, delayHours }) {
    if (nextStep >= totalSteps) {
      this._db.prepare(`
        UPDATE sequence_enrollments SET completed=1, completed_at=datetime('now') WHERE id=?
      `).run(id);
    } else {
      const nextSend = new Date(Date.now() + delayHours * 3600000).toISOString();
      this._db.prepare(`
        UPDATE sequence_enrollments SET current_step=?, next_send_at=? WHERE id=?
      `).run(nextStep, nextSend, id);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 8 — RESELLER CLIENTS
  // ═══════════════════════════════════════════════════════════════════════════
  resellerClientList() {
    const clients = this._db.prepare(
      'SELECT * FROM reseller_clients ORDER BY created_at DESC'
    ).all();
    for (const c of clients) {
      const today = new Date().toISOString().slice(0, 10);
      const usage = this._db.prepare(
        'SELECT * FROM client_usage WHERE client_id=? AND date=?'
      ).get(c.id, today);
      c.today_messages = usage?.messages_sent || 0;
      c.today_sessions = usage?.sessions_used || 0;
    }
    return clients;
  }

  resellerClientGet(id) {
    return this._db.prepare('SELECT * FROM reseller_clients WHERE id=?').get(id);
  }

  resellerClientSave(c) {
    if (!c.id) {
      c.id = require('crypto').randomUUID?.() || require('uuid').v4();
      if (!c.license_key) c.license_key = this._genLicenseKey();
      this._db.prepare(`
        INSERT INTO reseller_clients (id,name,email,license_key,plan,max_sessions,max_msg_per_day,active,expires_at,notes)
        VALUES (@id,@name,@email,@license_key,@plan,@max_sessions,@max_msg_per_day,@active,@expires_at,@notes)
      `).run({
        id: c.id, name: c.name, email: c.email||'',
        license_key: c.license_key, plan: c.plan||'basic',
        max_sessions: c.max_sessions||2, max_msg_per_day: c.max_msg_per_day||500,
        active: c.active??1, expires_at: c.expires_at||null, notes: c.notes||'',
      });
    } else {
      this._db.prepare(`
        UPDATE reseller_clients SET name=@name,email=@email,plan=@plan,
          max_sessions=@max_sessions,max_msg_per_day=@max_msg_per_day,
          active=@active,expires_at=@expires_at,notes=@notes
        WHERE id=@id
      `).run({
        id: c.id, name: c.name, email: c.email||'', plan: c.plan||'basic',
        max_sessions: c.max_sessions||2, max_msg_per_day: c.max_msg_per_day||500,
        active: c.active??1, expires_at: c.expires_at||null, notes: c.notes||'',
      });
    }
    return this.resellerClientGet(c.id);
  }

  resellerClientDelete(id) {
    this._db.prepare('DELETE FROM client_usage WHERE client_id=?').run(id);
    this._db.prepare('DELETE FROM reseller_clients WHERE id=?').run(id);
  }

  resellerClientUsage(clientId, days = 30) {
    const from = new Date(); from.setDate(from.getDate() - days);
    return this._db.prepare(
      'SELECT * FROM client_usage WHERE client_id=? AND date>=? ORDER BY date ASC'
    ).all(clientId, from.toISOString().slice(0, 10));
  }

  resellerBumpUsage(clientId) {
    const today = new Date().toISOString().slice(0, 10);
    this._db.prepare(`
      INSERT INTO client_usage (client_id, date, messages_sent, sessions_used)
      VALUES (?,?,1,0)
      ON CONFLICT(client_id,date) DO UPDATE SET messages_sent=messages_sent+1
    `).run(clientId, today);
  }

  resellerStats() {
    const total   = this._db.prepare('SELECT COUNT(*) AS n FROM reseller_clients').get()?.n || 0;
    const active  = this._db.prepare('SELECT COUNT(*) AS n FROM reseller_clients WHERE active=1').get()?.n || 0;
    const today   = new Date().toISOString().slice(0, 10);
    const msgs    = this._db.prepare(
      'SELECT COALESCE(SUM(messages_sent),0) AS n FROM client_usage WHERE date=?'
    ).get(today)?.n || 0;
    return { total, active, messages_today: msgs };
  }

  _genLicenseKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const seg   = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `FT-${seg(4)}-${seg(4)}-${seg(4)}-${seg(4)}`;
  }

  // ─── Branding ─────────────────────────────────────────────────────────────
  brandingGet() {
    return {
      app_name:     this.settingGet('brand_app_name')     || 'Fast Tech',
      logo_path:    this.settingGet('brand_logo_path')    || '',
      primary_color:this.settingGet('brand_primary_color')|| '#6366f1',
      footer_text:  this.settingGet('brand_footer_text')  || 'Powered by Fast Tech',
      show_powered: this.settingGet('brand_show_powered') !== '0',
    };
  }

  brandingSave({ app_name, logo_path, primary_color, footer_text, show_powered }) {
    if (app_name     !== undefined) this.settingSet('brand_app_name',     app_name);
    if (logo_path    !== undefined) this.settingSet('brand_logo_path',    logo_path);
    if (primary_color!== undefined) this.settingSet('brand_primary_color',primary_color);
    if (footer_text  !== undefined) this.settingSet('brand_footer_text',  footer_text);
    if (show_powered !== undefined) this.settingSet('brand_show_powered', show_powered ? '1' : '0');
    return this.brandingGet();
  }
}

module.exports = Db;
