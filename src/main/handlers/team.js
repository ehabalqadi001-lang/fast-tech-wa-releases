'use strict';

/** @param {import('../types').HandlerContext} ctx */
function register(ctx) {
  const { handle, db, seqSvc } = ctx;

  // ── Team users ─────────────────────────────────────────────────────────────
  handle('team:list',   ()       => ({ ok: true, data: db.teamUserList() }));
  handle('team:save',   (u)      => ({ ok: true, data: db.teamUserSave(u) }));
  handle('team:delete', ({ id }) => { db.teamUserDelete(id); return { ok: true }; });

  // ── Conversation assignments ───────────────────────────────────────────────
  handle('assign:list',    (opts)     => ({ ok: true, data: db.assignmentList(opts || {}) }));
  handle('assign:upsert',  (a)        => { db.assignmentUpsert(a); return { ok: true }; });
  handle('assign:resolve', ({ phone }) => { db.assignmentResolve(phone); return { ok: true }; });
  handle('assign:stats',   ()         => ({ ok: true, data: db.assignmentStats() }));

  // ── Automation sequences ───────────────────────────────────────────────────
  handle('seq:list',        ()        => ({ ok: true, data: db.sequenceList() }));
  handle('seq:get',         ({ id })  => ({ ok: true, data: db.sequenceGet(id) }));
  handle('seq:save',        (seq)     => ({ ok: true, data: db.sequenceSave(seq) }));
  handle('seq:delete',      ({ id })  => { db.sequenceDelete(id); return { ok: true }; });
  handle('seq:toggle',      ({ id })  => ({ ok: true, data: { active: db.sequenceToggle(id) } }));
  handle('seq:enroll',      (opts)    => {
    if (!seqSvc) { db.sequenceEnroll(opts); return { ok: true }; }
    return { ok: true, data: seqSvc.enroll(opts) };
  });
  handle('seq:unenroll',    (opts)    => {
    if (seqSvc) seqSvc.unenroll(opts); else db.sequenceUnenroll(opts);
    return { ok: true };
  });
  handle('seq:enrollments', ({ id })  => ({ ok: true, data: db.sequenceEnrollmentList(id) }));
}

module.exports = { register };
