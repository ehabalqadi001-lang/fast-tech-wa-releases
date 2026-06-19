'use strict';

const path = require('path');
const fs   = require('fs');

/** @param {import('../types').HandlerContext} ctx */
function register(ctx) {
  const { handle, db } = ctx;

  // ── Media library ──────────────────────────────────────────────────────────
  handle('media:list',   ()    => db.mediaList());
  handle('media:delete', (id)  => {
    const m = db.mediaGet(id);
    if (m) { try { fs.unlinkSync(m.file_path); } catch (_) {} }
    return db.mediaDelete(id);
  });
  handle('media:add', async ({ filePath }) => {
    const { app } = require('electron');
    const { v4: uuidv4 } = require('uuid');
    const mediaDir = path.join(app.getPath('userData'), 'fasttech-data', 'media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
    const ext  = path.extname(filePath);
    const dest = path.join(mediaDir, `${uuidv4()}${ext}`);
    fs.copyFileSync(filePath, dest);
    const stat = fs.statSync(dest);
    const mime = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png',
                   '.mp4':'video/mp4','.pdf':'application/pdf',
                   '.gif':'image/gif','.webp':'image/webp' }[ext.toLowerCase()] || 'application/octet-stream';
    const entry = { id: uuidv4(), name: path.basename(filePath), file_path: dest, mime_type: mime, size_bytes: stat.size };
    db.mediaAdd(entry);
    return entry;
  });

  // ── Dashboard ──────────────────────────────────────────────────────────────
  handle('dashboard:stats', () => db.dashboardStats());

  // ── Advanced analytics ─────────────────────────────────────────────────────
  handle('analytics:funnel',  ({ days } = {}) => ({ ok: true, data: db.analyticsFunnel(days || 30) }));
  handle('analytics:heatmap', ({ days } = {}) => ({ ok: true, data: db.analyticsHeatmap(days || 30) }));

  // ── Audit log ──────────────────────────────────────────────────────────────
  handle('audit:list',   ({ limit } = {}) => ({ ok: true, data: db.auditList(limit || 200) }));
  handle('audit:export', ()               => ({ ok: true, data: db.auditExport() }));
  handle('audit:log',    (payload)        => { db.auditLog(payload); return { ok: true }; });

  // ── Audience builder ───────────────────────────────────────────────────────
  handle('audience:filter', ({ conditions }) => ({ ok: true, data: db.audienceFilter(conditions || []) }));
  handle('audience:save',   (payload)        => { db.audienceSave(payload); return { ok: true }; });
  handle('audience:list',   ()               => ({ ok: true, data: db.audienceList() }));
  handle('audience:delete', ({ id })         => { db.audienceDelete(id); return { ok: true }; });

  // ── Usage stats ────────────────────────────────────────────────────────────
  handle('stats:dailySent', ({ days } = {}) => ({ ok: true, data: db.dailySentCount(days || 7) }));
}

module.exports = { register };
