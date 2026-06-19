// core.js — Navigation, GP, Theme, Modals, Notifications
// Modular architecture with dynamic page loading

let _dashRefreshTimer = null;

// ── DYNAMIC NAVIGATION ───────────────────────────────────────────────────
async function nav(page) {
  document.querySelectorAll('.ni').forEach(n => n.classList.remove('on'));
  document.querySelectorAll(`.ni[onclick*="'${page}'"]`).forEach(n => n.classList.add('on'));

  if (!window._pgCache) window._pgCache = {};
  if (!window._pgCache[page]) {
    try {
      const resp = await fetch(`./pages/p-${page}.html`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      window._pgCache[page] = await resp.text();
    } catch(e) {
      console.error('[nav] load failed:', page, e);
      return;
    }
  }

  const main = document.getElementById('main');
  main.innerHTML = window._pgCache[page];

  // Show the injected page (CSS default is display:none, .on = display:block)
  document.getElementById('p-' + page)?.classList.add('on');

  // Re-bind modal backdrop listeners
  main.querySelectorAll('.mo').forEach(m => {
    m.addEventListener('click', e => { if(e.target === m) m.classList.remove('open'); });
  });
  // Re-bind tab groups
  main.querySelectorAll('.tabs').forEach(tg => {
    tg.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', function() {
        tg.querySelectorAll('.tab').forEach(x => x.classList.remove('on'));
        this.classList.add('on');
      });
    });
  });

  if (page === 'dashboard') startDashAutoRefresh();
  else stopDashAutoRefresh();

  // Call page-specific init
  const fn = window['_pg_' + page];
  if (fn) fn();
}

function startDashAutoRefresh() {
  stopDashAutoRefresh();
  _dashRefreshTimer = setTimeout(() => {
    if (typeof loadDashboard === 'function') loadDashboard();
  }, 30000);
}

function stopDashAutoRefresh() {
  if (_dashRefreshTimer) {
    clearTimeout(_dashRefreshTimer);
    _dashRefreshTimer = null;
  }
}

// ── GLOBAL PROGRESS BAR ──────────────────────────────────────────────────
const GP = (() => {
  let _timer = null;
  const el    = () => document.getElementById('gp');
  const fill  = () => document.getElementById('gp-fill');
  const label = () => document.getElementById('gp-label');
  const pctEl = () => document.getElementById('gp-pct');
  const phase = () => document.getElementById('gp-phase');

  function _set(lbl, pct, ph) {
    const p = Math.min(100, Math.max(0, pct || 0));
    if (fill())  fill().style.width  = p + '%';
    if (label()) label().textContent = lbl || '';
    if (pctEl()) pctEl().textContent = Math.round(p) + '%';
    if (phase()) phase().textContent = ph  || '';
  }

  return {
    show(lbl, pct = 0, ph = '') {
      clearTimeout(_timer);
      _set(lbl, pct, ph);
      el()?.classList.add('show');
    },
    update(lbl, pct, ph = '') {
      _set(lbl, pct, ph);
    },
    step(lbl, current, total, ph = '') {
      const pct = total > 0 ? Math.round((current / total) * 100) : 0;
      _set(lbl, pct, ph || `${current}/${total}`);
    },
    done(lbl = 'اكتملت العملية ✅') {
      _set(lbl, 100, '');
      clearTimeout(_timer);
      _timer = setTimeout(() => el()?.classList.remove('show'), 2200);
    },
    hide() {
      clearTimeout(_timer);
      el()?.classList.remove('show');
    }
  };
})();

// ── THEME ──
function setT(theme, el) {
  const cls = ['t-green','t-blue','t-purple','t-red','t-gold','t-teal','t-pink','t-silver','t-orange','t-indigo'];
  cls.forEach(c => document.getElementById('APP').classList.remove(c));
  document.getElementById('APP').classList.add(theme);
  document.querySelectorAll('.td').forEach(d => d.classList.remove('on'));
  el.classList.add('on');
}

// ── MODALS ──
function openM(id) { document.getElementById(id).classList.add('open'); }
function closeM(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.mo').forEach(m => m.addEventListener('click', function(e) {
  if (e.target === this) this.classList.remove('open');
}));

// ── NOTIFICATION ──
let notifTimer;
let _ncItems = [];

function showN(title, text, icon='ℹ️') {
  clearTimeout(notifTimer);
  const n = document.getElementById('notif');
  document.getElementById('notif-tt').textContent = title;
  document.getElementById('notif-tx').textContent = text;
  document.getElementById('notif-ic').textContent = icon;
  n.classList.add('show');
  notifTimer = setTimeout(() => n.classList.remove('show'), 3500);
  _ncPush(title, text, icon);
}

function _ncPush(title, text, icon) {
  const now = new Date();
  const timeStr = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  _ncItems.unshift({ title, text, icon, time: timeStr });
  if (_ncItems.length > 50) _ncItems.pop();
  _ncRender();
  document.getElementById('nc-dot').classList.add('show');
}

function _ncRender() {
  const list = document.getElementById('nc-list');
  if (!_ncItems.length) { list.innerHTML = '<div class="nc-empty">لا توجد إشعارات</div>'; return; }
  list.innerHTML = _ncItems.map(it => `
    <div class="nc-item">
      <div class="nc-item-ic">${it.icon}</div>
      <div class="nc-item-body">
        <div class="nc-item-title">${it.title}</div>
        <div class="nc-item-text">${it.text}</div>
        <div class="nc-item-time">${it.time}</div>
      </div>
    </div>`).join('');
}

function toggleNC() {
  const p = document.getElementById('nc-panel');
  p.classList.toggle('show');
  if (p.classList.contains('show')) {
    document.getElementById('nc-dot').classList.remove('show');
    document.addEventListener('click', _ncOutside, { once: true, capture: true });
  }
}

function _ncOutside(e) {
  const p = document.getElementById('nc-panel');
  if (!p.contains(e.target) && !e.target.closest('.hbtn-notif')) p.classList.remove('show');
  else if (p.classList.contains('show')) document.addEventListener('click', _ncOutside, { once: true, capture: true });
}

function clearNC() {
  _ncItems = [];
  _ncRender();
}

// ── UPDATE HEADER STATS (initial dummy) ──────────────────────────────────
function updateStats() {
  // Real implementation is in app.js
}

// ── INIT ──────────────────────────────────────────────────────────────────
showN('مرحباً', 'تم تحميل Fast Tech WhatsApp Manager بنجاح 🚀', '🟢');
