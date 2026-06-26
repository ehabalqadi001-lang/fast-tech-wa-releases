'use strict';
const cron = require('node-cron');

const runningTasks = new Map();
let _mainWindow = null;

function setWindow(win) { _mainWindow = win; }

function emit(event, data) {
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    _mainWindow.webContents.send(event, data);
  }
}

function initScheduler(db) {
  // Check mp scheduled posts every minute
  cron.schedule('* * * * *', () => {
    try {
      const due = db.prepare(`
        SELECT * FROM mp_scheduled_posts
        WHERE status = 'pending' AND scheduled_at <= datetime('now')
      `).all();
      for (const post of due) emit('mp:scheduledPost:due', post);
    } catch {}
  });

  // Reset mp account daily counters at midnight
  cron.schedule('0 0 * * *', () => {
    try { db.prepare('UPDATE mp_accounts SET actions_today = 0').run(); } catch {}
  });
}

function registerTask(id, intervalFn, intervalMs) {
  if (runningTasks.has(id)) clearInterval(runningTasks.get(id));
  const timer = setInterval(intervalFn, intervalMs);
  runningTasks.set(id, timer);
}

function stopTask(id) {
  if (runningTasks.has(id)) {
    clearInterval(runningTasks.get(id));
    runningTasks.delete(id);
  }
}

function stopAll() {
  for (const [id] of runningTasks) stopTask(id);
}

module.exports = { setWindow, emit, initScheduler, registerTask, stopTask, stopAll };
