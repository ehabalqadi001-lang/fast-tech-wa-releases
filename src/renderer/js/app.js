const BE = window.ftwa || null;
const IS_ELECTRON = !!BE;

function beErr(msg) { showN('خطأ', msg, '❌'); }
function beOk(msg)  { showN('نجاح', msg, '✅'); }

// ── Real header stats ──────────────────────────────────────────────────────
async function updateStats() {
  if (!IS_ELECTRON) return;
  try {
    const [sr, ar] = await Promise.all([BE.messages.getStats(), BE.accounts.list()]);
    if (sr.ok) {
      const el = document.getElementById('h-ms');
      if (el) el.textContent = (sr.data.sent||0).toLocaleString();
    }
    if (ar.ok) {
      const el = document.getElementById('h-ac');
      if (el) el.textContent = ar.data.filter(a=>a.active).length;
    }
    const tr = await BE.scheduler.list();
    if (tr.ok) {
      const el = document.getElementById('h-sc');
      if (el) el.textContent = tr.data.filter(t=>t.active).length;
    }
  } catch(_) {}
}
setInterval(updateStats, 10000);

// ── AI chat ────────────────────────────────────────────────────────────────
let _aiMsgs = [];

async function sendAI() {
  const inp  = document.getElementById('ai-input');
  const chat = document.getElementById('ai-chat');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';
  chat.innerHTML += `<div class="ai-msg user"><div class="ai-av user">👤</div><div class="ai-bub">${text.replace(/</g,'&lt;')}</div></div>`;
  const typId = 'typ' + Date.now();
  chat.innerHTML += `<div class="ai-msg bot" id="${typId}"><div class="ai-av bot">🤖</div><div class="ai-bub" style="opacity:.5">...</div></div>`;
  chat.scrollTop = chat.scrollHeight;
  if (!IS_ELECTRON) {
    const demos=['إليك رسالة احترافية:\n\n"السلام عليكم {{الاسم}}،\nنسعد بإعلامكم عن عرض استثنائي 🎉\nللاستفادة تواصل معنا الآن."','تم تحسين النص! النسخة الجديدة أكثر إقناعاً.','سكريبت المبيعات:\n1️⃣ الترحيب\n2️⃣ تحديد الاحتياج\n3️⃣ عرض الحل\n4️⃣ دعوة للتصرف'];
    setTimeout(()=>{const el=document.getElementById(typId);if(el)el.querySelector('.ai-bub').innerHTML=demos[Math.floor(Math.random()*demos.length)].replace(/\n/g,'<br>');chat.scrollTop=chat.scrollHeight;},900);
    return;
  }
  _aiMsgs.push({ role:'user', content:text });
  try {
    const r = await BE.ai.chat({ messages: _aiMsgs });
    const bub = document.getElementById(typId)?.querySelector('.ai-bub');
    if (r.ok) {
      _aiMsgs.push({ role:'assistant', content:r.data.content });
      if (bub) bub.innerHTML = r.data.content.replace(/</g,'&lt;').replace(/\n/g,'<br>');
    } else {
      _aiMsgs.pop(); // remove failed user msg so next send doesn't cause user→user
      if (bub) bub.textContent = '⚠️ ' + (r.error||'خطأ');
    }
  } catch(e) {
    _aiMsgs.pop(); // remove failed user msg so next send doesn't cause user→user
    const bub = document.getElementById(typId)?.querySelector('.ai-bub');
    if (bub) bub.textContent = '⚠️ ' + e.message;
  }
  chat.scrollTop = chat.scrollHeight;
}

function aiCmd(cmd) {
  if (!document.getElementById('p-ai')) { nav('ai').then(() => { document.getElementById('ai-input').value = cmd; sendAI(); }); return; }
  document.getElementById('ai-input').value = cmd;
  sendAI();
}
// ai-input keypress moved to _pg_ai init

// ── Accounts ───────────────────────────────────────────────────────────────
async function loadAccounts() {
  if (!IS_ELECTRON) return;
  loadEngineStatus();
  const r = await BE.accounts.list();
  if (!r.ok) return;
  const badge = document.getElementById('nb-accounts');
  if (badge) badge.textContent = r.data.filter(a=>a.active).length;
  const tbody = document.getElementById('accounts-tbody');
  if (!tbody) return;
  tbody.innerHTML = r.data.length ? r.data.map(a=>`
    <tr>
      <td>${a.name}</td>
      <td class="fm f11">${a.phone||'—'}</td>
      <td><span class="bge ${a.active?'bg-g':'bg-r'}">${a.active?'نشط':'موقوف'}</span></td>
      <td class="f11">${(a.msg_count||0).toLocaleString()}</td>
      <td class="f11">${a.last_used?a.last_used.slice(0,10):'—'}</td>
      <td>
        <button class="btn bo bsm" onclick="testAcct('${a.id}')">🔍 اختبار</button>
        <button class="btn bd bsm" onclick="delAcct('${a.id}')">🗑️</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;padding:24px;opacity:.5">لا توجد حسابات — أضف حساباً جديداً</td></tr>';
}

async function saveAccount() {
  if (!IS_ELECTRON) { beOk('تم الحفظ (وضع العرض)'); closeM('m-add-acc'); return; }
  const g = id => document.getElementById(id)?.value?.trim()||'';
  const name=g('acc-name'), token=g('acc-token'), pid=g('acc-phone-id'), bid=g('acc-biz-id'), phone=g('acc-phone');
  if (!name||!token||!pid||!bid) { beErr('يرجى ملء جميع الحقول المطلوبة'); return; }
  const r = await BE.accounts.save({ name, token, phone_id:pid, biz_acct_id:bid, phone, active:1 });
  if (r.ok) { beOk('تم حفظ الحساب'); closeM('m-add-acc'); loadAccounts(); updateStats(); }
  else beErr(r.error);
}

async function testAcct(id) {
  showN('اختبار','جاري التحقق من الاتصال...','🔍');
  if (!IS_ELECTRON) { setTimeout(()=>beOk('الاتصال ناجح (وضع العرض)'),800); return; }
  const r = await BE.accounts.test(id);
  if (r.ok && r.data?.ok) beOk('الاتصال ناجح ✓');
  else beErr('فشل الاتصال: '+(r.data?.error||r.error||'تحقق من البيانات'));
}

async function delAcct(id) {
  if (!confirm('هل تريد حذف هذا الحساب نهائياً؟')) return;
  const r = IS_ELECTRON ? await BE.accounts.remove(id) : {ok:true};
  if (r.ok) { beOk('تم حذف الحساب'); loadAccounts(); updateStats(); }
  else beErr(r.error);
}

// saveAccount button wired in _pg_accounts init

// ── Engine Mode ────────────────────────────────────────────────────────────

let _engineStatus = null;

async function loadEngineStatus() {
  if (!IS_ELECTRON) return;
  const r = await BE.engine.status();
  if (!r.ok) return;
  _engineStatus = r.data;
  renderEngineStatus(r.data);
}

function renderEngineStatus(s) {
  if (!s) return;
  const modeLabels = { cloud:'🌐 Cloud API', web:'📱 Web', auto:'🔄 Auto', none:'⚠️ غير متاح' };
  const modeColors = { cloud:'bg-g', web:'bg-b', auto:'bg-b', none:'bg-r' };
  const label = modeLabels[s.mode] || s.mode;
  const cls   = modeColors[s.mode] || 'bg-b';

  // Header badge
  const hdrBadge = document.getElementById('hdr-engine-badge');
  if (hdrBadge) {
    hdrBadge.textContent = label;
    hdrBadge.className = `bge ${cls} f11`;
    hdrBadge.style.cssText += ';cursor:pointer;-webkit-app-region:no-drag';
  }
  // Accounts page badges
  const modeBadge = document.getElementById('engine-mode-badge');
  if (modeBadge) { modeBadge.textContent = label; modeBadge.className = `bge ${cls} f12`; }
  const cloudCount = document.getElementById('engine-cloud-count');
  if (cloudCount) cloudCount.textContent = s.cloudAccounts + ' حساب';
  const webCount = document.getElementById('engine-web-count');
  if (webCount) webCount.textContent = s.webSessions + ' جلسة';
  const modeSel = document.getElementById('engine-mode-sel');
  if (modeSel) modeSel.value = s.setting || 'auto';

  // Settings page
  const setBadge = document.getElementById('set-engine-status-badge');
  if (setBadge) { setBadge.textContent = label; setBadge.className = `bge ${cls} f12`; }
  const setCloud = document.getElementById('set-cloud-count');
  if (setCloud) setCloud.textContent = s.cloudAccounts;
  const setWeb = document.getElementById('set-web-count');
  if (setWeb) setWeb.textContent = s.webSessions;
  const setModeSel = document.getElementById('set-engine-mode');
  if (setModeSel) setModeSel.value = s.setting || 'auto';
}

async function setEngineMode(mode) {
  if (!IS_ELECTRON) return;
  const r = await BE.engine.setMode(mode);
  if (r.ok) {
    renderEngineStatus(r.data);
    beOk('تم تغيير محرك الإرسال إلى: ' + mode);
  } else {
    beErr(r.error);
  }
}

// ── Accounts Page Tabs ─────────────────────────────────────────────────────

let _acctTab = 'cloud';

function switchAcctTab(tab) {
  _acctTab = tab;
  document.getElementById('acct-tab-cloud').style.display = tab === 'cloud' ? '' : 'none';
  document.getElementById('acct-tab-web').style.display   = tab === 'web'   ? '' : 'none';
  document.getElementById('tab-cloud').style.borderBottomColor = tab === 'cloud' ? 'var(--hp)' : 'transparent';
  document.getElementById('tab-cloud').style.color = tab === 'cloud' ? 'var(--hp)' : 'var(--ts)';
  document.getElementById('tab-web').style.borderBottomColor   = tab === 'web'   ? 'var(--hp)' : 'transparent';
  document.getElementById('tab-web').style.color   = tab === 'web'   ? 'var(--hp)' : 'var(--ts)';
  document.getElementById('btn-acct-add').style.display = tab === 'cloud' ? '' : 'none';
  if (tab === 'web') loadWebSessions();
}

// ── Web Sessions (in Accounts page) ────────────────────────────────────────

async function loadWebSessions() {
  if (!IS_ELECTRON) return;
  const r = await BE.wa.sessions.list();
  if (!r.ok) return;
  const sessions = r.data || [];
  const tbody = document.getElementById('web-sessions-tbody');
  const count = document.getElementById('web-sessions-count');
  if (count) count.textContent = sessions.length;
  if (!tbody) return;

  const stateLabel = { ready:'🟢 متصل', qr:'📱 انتظار QR', initializing:'⏳ جارٍ التهيئة', disconnected:'🔴 غير متصل', stopped:'⚫ متوقف', authenticated:'🔐 مصادق', auth_failed:'❌ فشل المصادقة', error:'❌ خطأ' };
  const stateCls   = { ready:'bg-g', qr:'', initializing:'', disconnected:'bg-r', stopped:'', authenticated:'bg-b', auth_failed:'bg-r', error:'bg-r' };

  tbody.innerHTML = sessions.length ? sessions.map(s => {
    const state = s.state || s.status || 'disconnected';
    const lbl = stateLabel[state] || state;
    const cls = stateCls[state] || '';
    return `<tr>
      <td>${s.name||s.id}</td>
      <td class="fm f11">${s.phone||'—'}</td>
      <td><span class="bge ${cls} f11">${lbl}</span></td>
      <td class="f11">${(s.msg_count||0).toLocaleString()}</td>
      <td>
        ${state==='disconnected'||state==='stopped'?`<button class="btn bp bsm" onclick="startWebSession('${s.id}')">▶️ بدء</button>`:''}
        ${state==='ready'||state==='authenticated'?`<button class="btn bo bsm" onclick="stopWebSession('${s.id}')">⏹️ إيقاف</button>`:''}
        ${state==='qr'?`<button class="btn bo bsm" onclick="showAcctQR('${s.id}')">📱 QR</button>`:''}
        <button class="btn bd bsm" onclick="removeWebSession('${s.id}')">🗑️</button>
      </td>
    </tr>`;
  }).join('') : '<tr><td colspan="5" class="ta f12 ts" style="padding:24px">لا توجد جلسات — اضغط "إضافة جلسة"</td></tr>';
}

async function createWebSession() {
  const name = prompt('اسم الجلسة (مثال: حساب المبيعات):');
  if (!name?.trim()) return;
  if (!IS_ELECTRON) { beOk('تم إنشاء الجلسة (وضع العرض)'); return; }
  const r = await BE.wa.sessions.create({ name: name.trim() });
  if (r.ok) {
    beOk('تم إنشاء الجلسة. اضغط ▶️ بدء لمسح QR');
    loadWebSessions();
  } else beErr(r.error);
}

async function startWebSession(id) {
  if (!IS_ELECTRON) return;
  showN('بدء الجلسة', 'جارٍ التهيئة...', '⏳');
  const r = await BE.wa.sessions.start(id);
  if (r.ok) { beOk('بدأت الجلسة. انتظر QR Code...'); loadWebSessions(); }
  else beErr('فشل بدء الجلسة: ' + r.error);
}

async function stopWebSession(id) {
  if (!IS_ELECTRON) return;
  const r = await BE.wa.sessions.stop(id);
  if (r.ok) { beOk('تم إيقاف الجلسة'); loadWebSessions(); }
  else beErr(r.error);
}

async function removeWebSession(id) {
  if (!confirm('حذف هذه الجلسة نهائياً؟')) return;
  if (!IS_ELECTRON) { beOk('تم الحذف (وضع العرض)'); return; }
  const r = await BE.wa.sessions.remove(id);
  if (r.ok) { beOk('تم حذف الجلسة'); loadWebSessions(); loadEngineStatus(); }
  else beErr(r.error);
}

function showAcctQR(sessionId) {
  const sec = document.getElementById('acct-qr-section');
  if (sec) sec.style.display = '';
}

// Listen for QR events and show in accounts page
if (IS_ELECTRON) {
  BE.on('wa:qr', (data) => {
    const img = document.getElementById('acct-qr-img');
    const msg = document.getElementById('acct-qr-msg');
    if (img && data?.qr) {
      img.innerHTML = `<img src="${data.qr}" style="max-width:220px;border-radius:8px">`;
    }
    if (msg) msg.textContent = 'امسح الكود من واتساب ← القائمة ← الأجهزة المرتبطة';
    const sec = document.getElementById('acct-qr-section');
    if (sec) sec.style.display = '';
    if (_acctTab === 'web') loadWebSessions();
  });
  BE.on('wa:ready', () => { loadWebSessions(); loadEngineStatus(); });
  BE.on('wa:disconnected', () => { loadWebSessions(); loadEngineStatus(); });
  BE.on('wa:inbox:new', (msg) => {
    const src = msg.isGroup ? (msg.groupName || msg.from_number) : msg.from_number;
    showN('رسالة واردة', `من: ${src} — ${(msg.body||'').slice(0,50)}`, msg.isGroup ? '👥' : '📩');
    const badge = document.getElementById('nb-accounts');
    // refresh inbox if open
  });
}

// ── Groups Manual Input ─────────────────────────────────────────────────────

let _grpMethod = 'web';

function switchGroupMethod(method) {
  _grpMethod = method;
  ['web','manual','excel'].forEach(m => {
    const sec = document.getElementById(`groups-${m}-section`);
    const btn = document.getElementById(`grp-method-${m}`);
    if (sec) sec.style.display = m === method ? '' : 'none';
    if (btn) {
      btn.style.borderColor = m === method ? 'var(--hp)' : '';
      btn.style.color       = m === method ? 'var(--hp)' : '';
    }
  });
}

async function addGroupManually() {
  if (!IS_ELECTRON) { beOk('تم إضافة المجموعة (وضع العرض)'); return; }
  const name    = document.getElementById('grp-manual-name')?.value?.trim();
  const id      = document.getElementById('grp-manual-id')?.value?.trim();
  const members = parseInt(document.getElementById('grp-manual-members')?.value || '0', 10);
  if (!name || !id) { beErr('الاسم و Group ID مطلوبان'); return; }

  const r = await BE.groups.upsert({ id, name, member_count: members, account_id: 'manual' });
  if (r.ok) {
    beOk(`تم إضافة المجموعة "${name}"`);
    document.getElementById('grp-manual-name').value   = '';
    document.getElementById('grp-manual-id').value     = '';
    document.getElementById('grp-manual-members').value = '';
    loadGroupsPage();
  } else {
    beErr('فشل إضافة المجموعة: ' + r.error);
  }
}

async function importGroupsExcel() {
  if (!IS_ELECTRON) { beOk('استيراد (وضع العرض)'); return; }
  const fp = await BE.openFile({ filters:[{name:'Excel',extensions:['xlsx','xls','csv']}] });
  if (!fp) return;
  showN('استيراد','جارٍ معالجة الملف...','📂');
  const r = await BE.contacts.importExcel(fp);
  if (r.ok) { beOk('تم الاستيراد'); loadGroupsPage(); }
  else beErr(r.error);
}

async function clearGroups() {
  if (!confirm('مسح كل المجموعات من القائمة؟')) return;
  _groupsSelected.clear();
  updateGroupsBulkBar();
  _groupsData = [];
  renderGroupsTable([]);
  beOk('تم مسح قائمة المجموعات');
}

// ── Webhook Settings ────────────────────────────────────────────────────────

async function loadWebhookSettings() {
  if (!IS_ELECTRON) return;
  const r = await BE.webhook.getConfig();
  if (!r.ok) return;
  const d = r.data;
  const pIn = document.getElementById('set-webhook-port');
  const tIn = document.getElementById('set-webhook-token');
  const uIn = document.getElementById('set-webhook-url');
  if (pIn) pIn.value = d.port || '3001';
  if (tIn) tIn.value = d.verifyToken || 'ftwa-verify';
  if (uIn) uIn.value = `http://YOUR-IP:${d.port||3001}/webhook`;
  updateWebhookBadge(d.running);
}

function updateWebhookBadge(running) {
  const badge = document.getElementById('webhook-status-badge');
  const btn   = document.getElementById('btn-webhook-start');
  if (badge) {
    badge.textContent = running ? '🟢 يعمل' : '🔴 متوقف';
    badge.className = `bge ${running ? 'bg-g' : 'bg-r'} f11`;
  }
  if (btn) btn.textContent = running ? '⏹️ إيقاف' : '▶️ تشغيل';
}

async function toggleWebhook() {
  if (!IS_ELECTRON) return;
  const statusR = await BE.webhook.status();
  if (!statusR.ok) return;

  if (statusR.data.running) {
    const r = await BE.webhook.stop();
    if (r.ok) { updateWebhookBadge(false); beOk('تم إيقاف Webhook Server'); }
    else beErr(r.error);
  } else {
    // Save config first
    const port  = parseInt(document.getElementById('set-webhook-port')?.value || '3001', 10);
    const token = document.getElementById('set-webhook-token')?.value?.trim() || 'ftwa-verify';
    await BE.webhook.saveConfig({ port, verifyToken: token });
    // Set autostart
    await BE.settings.save({ webhook_autostart: '1' });
    const r = await BE.webhook.start(port);
    if (r.ok) {
      updateWebhookBadge(true);
      const uIn = document.getElementById('set-webhook-url');
      if (uIn) uIn.value = `http://YOUR-IP:${r.data.port}/webhook`;
      beOk(`Webhook Server يعمل على المنفذ ${r.data.port}`);
    } else beErr('فشل تشغيل Webhook: ' + r.error);
  }
}

// ── Contacts ───────────────────────────────────────────────────────────────
async function importContactsExcel() {
  if (!IS_ELECTRON) { beOk('استيراد (وضع العرض)'); return; }
  const fp = await BE.openFile({ filters:[{name:'Excel/CSV',extensions:['xlsx','xls','csv']}] });
  if (!fp) return;
  await openImportPreview(fp);
}

async function exportContactsExcel() {
  if (!IS_ELECTRON) { beOk('تصدير (وضع العرض)'); return; }
  const fp = await BE.saveFile({ defaultPath:'contacts.xlsx', filters:[{name:'Excel',extensions:['xlsx']}] });
  if (!fp) return;
  const r = await BE.contacts.exportExcel({ path:fp });
  if (r.ok) beOk('تم تصدير جهات الاتصال بنجاح'); else beErr(r.error);
}

// ── Reports ────────────────────────────────────────────────────────────────
async function loadReportStats() {
  if (!IS_ELECTRON) return;
  const r = await BE.messages.getStats();
  if (!r.ok) return;
  const s = r.data;
  const sent = s.sent||0;
  const set = (id,v) => { const el=document.getElementById(id); if(el) el.textContent=v; };
  set('rep-s-sent',    sent.toLocaleString());
  set('rep-s-read',    (s.read_count||0).toLocaleString());
  set('rep-s-replies', (s.replies||0).toLocaleString());
  set('rep-s-rate',    (sent ? ((s.replies||0)/sent*100).toFixed(1) : '0') + '%');
}

async function exportReportExcel() {
  if (!IS_ELECTRON) { beOk('تصدير التقرير (وضع العرض)'); return; }
  showN('تصدير','جاري إنشاء ملف Excel...','📊');
  const r = await BE.reports.exportExcel({ days:30 });
  if (r.ok) beOk('تم التصدير: ' + r.data.path); else beErr(r.error);
}

// ── Dashboard ─────────────────────────────────────────────────────────────
// _dashRefreshTimer managed in core.js

async function loadDashboard() {
  await updateStats();
  if (!IS_ELECTRON) return;
  try {
    const [statsR, inboxR, queueR, unrepliedR] = await Promise.all([
      BE.messages.getStats(),
      BE.wa.inbox.list(null),
      BE.wa.send.queueStats(),
      BE.wa.inbox.unreplied(null),
    ]);
    if (statsR.ok) {
      const s = statsR.data;
      const sent = s.sent || 0;
      const read = s.read_count || 0;
      const rep  = s.replies || 0;
      const pct  = sent ? Math.round(rep / sent * 100) : 0;
      document.getElementById('dash-s-sent').textContent     = sent.toLocaleString();
      document.getElementById('dash-s-replies').textContent  = rep.toLocaleString();
      document.getElementById('dash-p-sent').textContent     = sent.toLocaleString();
      document.getElementById('dash-p-read').textContent     = read.toLocaleString();
      document.getElementById('dash-p-rep').textContent      = rep.toLocaleString();
      document.getElementById('dash-pb-sent').style.width    = (sent ? Math.min(100, sent/(sent||1)*100) : 0) + '%';
      document.getElementById('dash-pb-read').style.width    = (sent ? Math.min(100, read/sent*100) : 0) + '%';
      document.getElementById('dash-pb-rep').style.width     = (sent ? Math.min(100, rep/sent*100) : 0) + '%';
      document.getElementById('dash-donut-pct').textContent  = pct + '%';
      document.getElementById('dash-donut').style.background = `conic-gradient(var(--acc) 0% ${pct}%,rgba(var(--ar),.08) ${pct}% 100%)`;
    }
    if (queueR && queueR.ok) {
      const q = queueR.data;
      document.getElementById('dash-q-pending').textContent = (q.pending||0).toLocaleString();
      document.getElementById('dash-q-sent').textContent    = (q.sent||0).toLocaleString();
      document.getElementById('dash-q-failed').textContent  = (q.failed||0).toLocaleString();
    }
    if (unrepliedR && unrepliedR.ok) {
      const cnt = unrepliedR.data || 0;
      const el = document.getElementById('dash-s-unreplied');
      if (el) { el.textContent = cnt.toLocaleString(); el.style.color = cnt > 0 ? 'var(--hp)' : ''; }
    }
    if (inboxR && inboxR.ok) {
      const msgs = inboxR.data.slice(0,6);
      const tbody = document.getElementById('dash-activity-tbody');
      if (tbody) {
        tbody.innerHTML = msgs.length ? msgs.map(m=>`
          <tr>
            <td class="fm f11">${esc(m.contact_name||('+'+(m.from_number||'')))}</td>
            <td class="f11 ts">${m.is_group ? esc(m.group_name||'مجموعة') : '—'}</td>
            <td style="max-width:220px;word-break:break-word">${esc(bodyText(m).slice(0,80))}</td>
            <td class="f11 ts">${esc(m.session_name||m.session_id||'').slice(0,16)}</td>
            <td class="f11 ts" style="white-space:nowrap">${m.received_at?m.received_at.slice(0,16):'—'}</td>
            <td>${!m.replied ? '<span class="bge bg-y f11" style="cursor:pointer" onclick="nav(\'inbox\')">يحتاج رد</span>' : '<span class="bge f11">تم الرد</span>'}</td>
          </tr>`).join('')
          : '<tr><td colspan="6" class="ta f12 ts" style="padding:24px">لا توجد رسائل واردة حتى الآن</td></tr>';
      }
    }
    const sessR = await BE.wa.sessions.list();
    if (sessR.ok) {
      const ready = sessR.data.filter(s=>s.state==='ready').length;
      document.getElementById('dash-s-accounts').textContent = ready;
      document.getElementById('dash-q-devices').textContent  = ready;
      drawSparkline('spark-accounts', Array.from({length:7}, (_,i) => Math.max(0, ready - (6-i))), '#22c55e');
    }
    if (statsR.ok) {
      const s = statsR.data;
      const sent = s.sent || 0;
      drawSparkline('spark-sent', Array.from({length:7}, (_,i) => Math.round(sent * (0.3 + i * 0.1))), 'var(--acc)');
    }
    const schR = await BE.scheduler.list();
    if (schR.ok) {
      document.getElementById('dash-s-scheduled').textContent = schR.data.filter(t=>t.active).length;
    }
  } catch(_) {}
  // Auto-refresh handled by core.js startDashAutoRefresh()
  startDashAutoRefresh();
}

// ── Contacts ────────────────────────────────────────────────────────────────
let _allContacts = [];
async function loadContacts() {
  if (!IS_ELECTRON) return;
  const r = await BE.contacts.list({});
  if (!r.ok) { beErr(r.error); return; }
  _allContacts = r.data;
  renderContactsTable(_allContacts);
}

// ── Virtual scrolling contacts table ─────────────────────────────────────
let _ctPage = 0;
const CT_PAGE_SIZE = 200;
let _ctCurrentList = [];

function renderContactsTable(list) {
  _ctCurrentList = list;
  _ctPage = 0;
  const label = document.getElementById('contacts-count-label');
  const sub   = document.getElementById('contacts-subtitle');
  if (label) label.textContent = list.length.toLocaleString() + ' جهة اتصال';
  if (sub)   sub.textContent = 'إدارة جهات الاتصال — ' + list.length.toLocaleString() + ' جهة';
  const tbody = document.getElementById('contacts-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';
  _renderContactsChunk(tbody);
}

function _renderContactsChunk(tbody) {
  // Remove sentinel if it exists
  const oldSentinel = document.getElementById('ct-sentinel');
  if (oldSentinel) oldSentinel.remove();

  const start = _ctPage * CT_PAGE_SIZE;
  const slice = _ctCurrentList.slice(start, start + CT_PAGE_SIZE);
  if (!slice.length && !_ctPage) {
    tbody.innerHTML = '<tr><td colspan="7" class="ta f12 ts" style="padding:32px">لا توجد جهات اتصال</td></tr>';
    return;
  }
  slice.forEach(c => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" class="contact-chk" data-id="${esc(c.id||'')}"></td>
      <td>${esc(c.name||'—')}</td>
      <td class="fm f11">${esc(c.phone||'—')}</td>
      <td>${esc(c.country||'—')}</td>
      <td class="f11 ts">${esc(c.group_tag||'—')}</td>
      <td><span class="bge ${c.opt_in?'bg-g':'bg-r'}">${c.opt_in?'نشط':'محظور'}</span></td>
      <td><div class="flex gap6"><button class="btn bd bsm" onclick="deleteContact('${esc(c.id||'')}')">🗑️</button></div></td>
    `;
    tbody.appendChild(tr);
  });
  _ctPage++;

  // Add sentinel if more pages exist
  const remaining = _ctCurrentList.length - (_ctPage * CT_PAGE_SIZE);
  if (remaining > 0) {
    const sentinel = document.createElement('tr');
    sentinel.id = 'ct-sentinel';
    sentinel.innerHTML = `<td colspan="7" class="ta" style="padding:16px;opacity:.6;font-size:11px;cursor:pointer" onclick="_renderContactsChunk(document.getElementById('contacts-tbody'))">⬇ تحميل ${Math.min(remaining, CT_PAGE_SIZE)} من ${remaining.toLocaleString()} المتبقية</td>`;
    tbody.appendChild(sentinel);
    // IntersectionObserver for auto-scroll load
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { obs.disconnect(); _renderContactsChunk(tbody); }
    }, { threshold: 0.1 });
    obs.observe(sentinel);
  }
}

function filterContacts() {
  const q = document.getElementById('contacts-search')?.value?.toLowerCase() || '';
  const filtered = q ? _allContacts.filter(c =>
    (c.name||'').toLowerCase().includes(q) || (c.phone||'').includes(q)
  ) : _allContacts;
  renderContactsTable(filtered);
}

function toggleAllContacts(cb) {
  document.querySelectorAll('.contact-chk').forEach(c => c.checked = cb.checked);
}

async function deleteContact(id) {
  if (!confirm('حذف هذه الجهة نهائياً؟')) return;
  if (!IS_ELECTRON) return;
  const r = await BE.contacts.remove(id);
  if (r.ok) { beOk('تم الحذف'); loadContacts(); }
  else beErr(r.error);
}

async function deleteSelectedContacts() {
  const ids = [...document.querySelectorAll('.contact-chk:checked')].map(c=>c.dataset.id).filter(Boolean);
  if (!ids.length) { beErr('لم تختر أي جهة اتصال'); return; }
  if (!confirm(`حذف ${ids.length} جهة اتصال نهائياً؟`)) return;
  if (!IS_ELECTRON) return;
  await Promise.all(ids.map(id => BE.contacts.remove(id)));
  beOk(`تم حذف ${ids.length} جهة`);
  loadContacts();
}

async function saveNewContact() {
  const name    = document.getElementById('new-contact-name')?.value.trim();
  const phone   = document.getElementById('new-contact-phone')?.value.trim().replace(/\s/g,'');
  const country = document.getElementById('new-contact-country')?.value || '';
  const group   = document.getElementById('new-contact-group')?.value.trim() || '';
  const notes   = document.getElementById('new-contact-notes')?.value.trim() || '';
  if (!phone) { beErr('أدخل رقم الهاتف'); return; }
  if (!IS_ELECTRON) { beOk('تمت الإضافة (وضع العرض)'); closeM('m-add-contact'); return; }
  const r = await BE.contacts.save({ name, phone, country, group_tag:group, notes, opt_in:1 });
  if (r.ok) { beOk('تمت إضافة جهة الاتصال'); closeM('m-add-contact'); loadContacts(); }
  else beErr(r.error);
}

async function fixCountryCode() {
  if (!IS_ELECTRON) { beOk('تصحيح (وضع العرض)'); return; }
  const countryCode = document.getElementById('contact-fix-country')?.value || '966';
  showN('تصحيح','جاري تصحيح أكواد الدول...','🌍');
  const listR = await BE.contacts.list({});
  if (!listR.ok) { beErr(listR.error); return; }
  const contacts = listR.data;
  const phones   = contacts.map(c => c.phone || '');
  const fixR     = await BE.contacts.fixCountry({ phones, countryCode });
  if (!fixR.ok) { beErr(fixR.error); return; }
  // Re-query to map results — build index by phone
  const fixedMap = {};
  (fixR.data.fixed||[]).forEach(fp => { fixedMap[fp] = true; });
  let fixed = 0;
  await Promise.all(contacts.map(async c => {
    const orig = c.phone || '';
    const cleanOrig = orig.replace(/\D/g,'');
    const cleanNew  = cleanOrig.startsWith(countryCode) ? cleanOrig : countryCode + cleanOrig.replace(/^0+/,'');
    if (cleanNew !== cleanOrig) {
      fixed++;
      await BE.contacts.save({ ...c, phone: cleanNew });
    }
  }));
  beOk(`تم تصحيح ${fixed} رقم هاتف`);
  loadContacts();
}

async function deduplicateContacts() {
  if (!IS_ELECTRON) { beOk('تنظيف (وضع العرض)'); return; }
  showN('تنظيف','جاري إزالة التكرارات...','🧹');
  const r = await BE.contacts.deduplicate();
  if (r.ok) { beOk(`تم حذف ${r.data?.removed||0} تكرار`); loadContacts(); }
  else beErr(r.error);
}

// ── Campaigns ──────────────────────────────────────────────────────────────
async function loadCampaigns() {
  if (!IS_ELECTRON) return;
  const r = await BE.messages.getStats();
  const el = document.getElementById('campaigns-list');
  if (!el) return;
  if (!r.ok) {
    el.innerHTML = '<div class="f12 ts" style="padding:18px;text-align:center">لا توجد بيانات</div>';
    return;
  }
  const s = r.data;
  const sub = document.getElementById('campaigns-subtitle');
  if (sub) sub.textContent = `إجمالي المُرسَل: ${(s.sent||0).toLocaleString()} رسالة`;
  el.innerHTML = `
    <div class="flex gap20" style="padding:18px 0;border-bottom:1px solid rgba(var(--ar),.08)">
      <div><div class="ta fm f13">${(s.sent||0).toLocaleString()}</div><div class="f11 ts">إجمالي مُرسَل</div></div>
      <div><div class="fm f13" style="color:#3b82f6">${(s.read_count||0).toLocaleString()}</div><div class="f11 ts">مقروء</div></div>
      <div><div class="fm f13" style="color:#bf00ff">${(s.replies||0).toLocaleString()}</div><div class="f11 ts">ردود</div></div>
      <div><div class="fm f13" style="color:#ef4444">${(s.failed||0).toLocaleString()}</div><div class="f11 ts">فاشل</div></div>
    </div>
    <div class="f12 ts mt14">لعرض تفاصيل الحملات والإرسال الجماعي — استخدم <button class="btn bo bsm" onclick="nav('engine')">⚡ محرك الإرسال</button></div>`;
}

function setCampaignsView(view) {
  const listEl   = document.getElementById('campaigns-list');
  const kanbanEl = document.getElementById('campaigns-kanban');
  const btnList  = document.getElementById('campaigns-view-list');
  const btnKanban= document.getElementById('campaigns-view-kanban');
  if (!listEl || !kanbanEl) return;
  if (view === 'kanban') {
    listEl.style.display   = 'none';
    kanbanEl.style.display = '';
    if (btnList)   { btnList.style.borderColor=''; btnList.style.color=''; }
    if (btnKanban) { btnKanban.style.borderColor='var(--acc)'; btnKanban.style.color='var(--acc)'; }
    renderCampaignsKanban();
  } else {
    listEl.style.display   = '';
    kanbanEl.style.display = 'none';
    if (btnList)   { btnList.style.borderColor='var(--acc)'; btnList.style.color='var(--acc)'; }
    if (btnKanban) { btnKanban.style.borderColor=''; btnKanban.style.color=''; }
  }
}

async function renderCampaignsKanban() {
  const kanbanEl = document.getElementById('campaigns-kanban');
  if (!kanbanEl) return;
  if (!IS_ELECTRON) {
    kanbanEl.innerHTML = '<div class="f12 ts" style="padding:24px;text-align:center">لا توجد بيانات (وضع العرض)</div>';
    return;
  }
  const r = await BE.messages.getStats();
  const cols = [
    { key:'pending',  label:'⏳ في الانتظار', color:'#f59e0b', items:[] },
    { key:'running',  label:'🚀 جاري الإرسال', color:'var(--acc)', items:[] },
    { key:'paused',   label:'⏸ موقوف',         color:'#64748b', items:[] },
    { key:'done',     label:'✅ مكتمل',         color:'#22c55e', items:[] },
    { key:'failed',   label:'❌ فشل',           color:'#ef4444', items:[] },
  ];
  if (r.ok) {
    const s = r.data;
    cols.find(c=>c.key==='done').items.push({ label:'إجمالي مُرسَل', value:(s.sent||0).toLocaleString() });
    if (s.failed > 0) cols.find(c=>c.key==='failed').items.push({ label:'رسائل فاشلة', value:(s.failed||0).toLocaleString() });
    if (s.read_count > 0) cols.find(c=>c.key==='done').items.push({ label:'مقروء', value:(s.read_count||0).toLocaleString() });
    if (s.replies > 0)    cols.find(c=>c.key==='done').items.push({ label:'ردود', value:(s.replies||0).toLocaleString() });
  }
  kanbanEl.innerHTML = cols.map(col => `
    <div class="kanban-col">
      <div class="kanban-col-hd" style="color:${col.color}">${col.label}<span class="kanban-col-cnt">${col.items.length}</span></div>
      <div class="kanban-col-body">
        ${col.items.length
          ? col.items.map(item=>`<div class="kanban-card"><span class="f12 ts">${esc(item.label)}</span><span class="fw6 f13" style="color:${col.color}">${esc(item.value)}</span></div>`).join('')
          : `<div class="f11 ts" style="text-align:center;padding:18px;opacity:.5">لا توجد عناصر</div>`}
      </div>
    </div>`).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULER
// ═══════════════════════════════════════════════════════════════════════════

async function loadScheduler() {
  const el  = document.getElementById('tasks-list');
  const cnt = document.getElementById('sch-count');
  const sub = document.getElementById('scheduler-subtitle');
  if (!IS_ELECTRON) { if(el) el.innerHTML='<div class="f12 ts" style="padding:40px;text-align:center">لا توجد مهام</div>'; return; }

  const r = await BE.scheduler.list();
  if (!r.ok) { beErr(r.error); return; }
  const tasks = r.data;

  const active  = tasks.filter(t => t.active);
  const paused  = tasks.filter(t => !t.active);
  const runs    = tasks.reduce((s, t) => s + (t.run_count || 0), 0);

  if (cnt) cnt.textContent = tasks.length + ' مهمة';
  if (sub) sub.textContent = `جدولة الرسائل بمواعيد محددة — ${tasks.length} مهمة`;

  const setEl = (id, v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  setEl('sch-stat-active', active.length);
  setEl('sch-stat-paused', paused.length);
  setEl('sch-stat-runs',   runs.toLocaleString());

  // Nearest upcoming run
  const upcoming = active.filter(t=>t.next_run).sort((a,b)=>a.next_run.localeCompare(b.next_run));
  setEl('sch-stat-next', upcoming.length ? _fmtNextRun(upcoming[0].next_run) : '—');

  const badge = document.getElementById('nb-scheduler');
  if (badge) { badge.textContent = active.length; badge.style.display = active.length ? '' : 'none'; }

  if (!el) return;
  el.innerHTML = tasks.length ? tasks.map(t => {
    const running   = t.running;
    const statusCls = running ? 'bg-b' : t.active ? 'bg-g' : 'bg-r';
    const statusLbl = running ? '▶ يعمل الآن' : t.active ? 'نشط' : 'موقوف';
    const bodyPrev  = t.message_body ? esc(t.message_body.slice(0, 70)) + (t.message_body.length > 70 ? '…' : '') : '<span class="ts">لا توجد رسالة محددة</span>';
    const nextRunLbl = t.next_run ? _fmtNextRun(t.next_run) : '—';
    const recLabel  = _recipientsLabel(t);
    return `
    <div style="border:1px solid rgba(var(--ar),.12);border-radius:10px;padding:14px 16px;margin-bottom:10px;background:rgba(var(--ar),.03)">
      <div class="flex ic jb mb8">
        <div class="flex ic gap10">
          <span style="font-size:20px">📅</span>
          <div>
            <div class="fw6 f13">${esc(t.name||'مهمة')}</div>
            <div class="f11 ts mt2">${esc(_cronLabel(t.cron_expr||''))} · منطقة: ${esc(t.timezone||'Asia/Riyadh')}</div>
          </div>
        </div>
        <span class="bge ${statusCls} f11">${statusLbl}</span>
      </div>
      <div class="f12 ts mb8" style="padding:8px 10px;background:rgba(var(--ar),.05);border-radius:6px;font-style:italic">${bodyPrev}</div>
      <div class="flex ic gap16 f11 ts mb10">
        <span>👥 ${recLabel}</span>
        <span>⏰ ${nextRunLbl}</span>
        <span>🔁 ${t.run_count||0} تشغيل</span>
        ${t.last_run ? `<span>⏱ آخر تشغيل: ${t.last_run.slice(0,16)}</span>` : ''}
      </div>
      <div class="flex gap6">
        <button class="btn bp bsm" onclick="runTaskNow('${esc(t.id)}')" ${running?'disabled':''}>▶ الآن</button>
        ${t.active
          ? `<button class="btn bo bsm" onclick="pauseTask('${esc(t.id)}')">⏸ إيقاف</button>`
          : `<button class="btn bo bsm" onclick="resumeTask('${esc(t.id)}')">▶ تفعيل</button>`}
        <button class="btn bo bsm" onclick="editTask('${esc(t.id)}')">✏ تعديل</button>
        <button class="btn bd bsm" onclick="deleteSchedule('${esc(t.id)}')">🗑</button>
      </div>
    </div>`;
  }).join('')
  : '<div style="text-align:center;padding:40px;opacity:.4" class="f12 ts">لا توجد مهام مجدولة — اضغط "جدولة جديدة" للإضافة</div>';
}

function _fmtNextRun(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = d - now;
    if (diff < 0) return 'منتهية';
    if (diff < 60000)   return 'خلال ثوانٍ';
    if (diff < 3600000) return `خلال ${Math.round(diff/60000)} دقيقة`;
    if (diff < 86400000) return `خلال ${Math.round(diff/3600000)} ساعة`;
    return d.toLocaleDateString('ar-SA') + ' ' + d.toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'});
  } catch(_) { return iso.slice(0,16); }
}

function _cronLabel(expr) {
  const map = {
    '0 9 * * *':    'يومياً 9 صباحاً',
    '0 12 * * *':   'يومياً 12 ظهراً',
    '0 18 * * *':   'يومياً 6 مساءً',
    '0 9 * * 0-4':  'الأيام الاعتيادية 9ص',
    '0 10 * * 0':   'كل أحد 10ص',
    '0 9 1 * *':    'أول كل شهر 9ص',
    '0 * * * *':    'كل ساعة',
    '*/30 * * * *': 'كل 30 دقيقة',
  };
  return map[expr] || expr;
}

function _recipientsLabel(t) {
  const type = t.recipients_type || 'all';
  if (type === 'all')    return 'كل جهات الاتصال';
  if (type === 'label')  return 'تصنيف: ' + (t.recipients_json || '—');
  if (type === 'manual') {
    try {
      const phones = JSON.parse(t.recipients_json || '[]');
      return `${phones.length} رقم يدوي`;
    } catch(_) { return 'قائمة يدوية'; }
  }
  return '—';
}

// ── Modal helpers ──────────────────────────────────────────────────────────

async function openSchModal(task) {
  // Reset
  document.getElementById('sch-edit-id').value     = task?.id || '';
  document.getElementById('sch-modal-title').textContent = task ? '✏️ تعديل جدولة' : '📅 جدولة مهمة جديدة';
  document.getElementById('sch-name').value         = task?.name || '';
  document.getElementById('sch-body').value         = task?.message_body || '';
  document.getElementById('sch-media-path').value   = task?.media_path || '';
  document.getElementById('sch-media-type').value   = task?.media_type || '';
  document.getElementById('sch-media-label').textContent = task?.media_path ? task.media_path.split(/[\\/]/).pop() : 'لا يوجد ملف مرفق';
  document.getElementById('btn-sch-clear-media').style.display = task?.media_path ? '' : 'none';
  document.getElementById('sch-label-input').value  = '';
  document.getElementById('sch-phones-input').value = '';

  // Recipients
  const rType = task?.recipients_type || 'all';
  document.getElementById('sch-recipients-type').value = rType;
  if (rType === 'label')  document.getElementById('sch-label-input').value  = task?.recipients_json || '';
  if (rType === 'manual') {
    try { document.getElementById('sch-phones-input').value = JSON.parse(task?.recipients_json||'[]').join('\n'); } catch(_) {}
  }
  onSchRecipientsChange();

  // Repeat & datetime
  const repeatVal = task ? _cronToRepeat(task.cron_expr) : 'once';
  document.getElementById('sch-repeat').value = repeatVal;

  // Set datetime from next_run or now+1hr
  const base = task?.next_run ? new Date(task.next_run) : (() => { const d=new Date(); d.setHours(d.getHours()+1,0,0,0); return d; })();
  document.getElementById('sch-datetime').value = base.toISOString().slice(0,16);

  // DOW
  if (repeatVal === 'weekly' && task?.cron_expr) {
    const parts = task.cron_expr.split(' ');
    const days  = (parts[4]||'').split(',');
    [0,1,2,3,4,5,6].forEach(d => {
      const cb = document.getElementById(`dow-${d}`);
      if (cb) cb.checked = days.includes(String(d));
    });
  }

  // Custom cron
  document.getElementById('sch-cron-custom').value = repeatVal === 'custom' ? (task?.cron_expr||'') : '';
  onSchRepeatChange();

  // Timezone
  document.getElementById('sch-timezone').value = task?.timezone || 'Asia/Riyadh';

  // Session dropdown
  const schSel = document.getElementById('sch-session');
  schSel.innerHTML = '<option value="">توزيع تلقائي</option>';
  if (IS_ELECTRON) {
    const sessR = await BE.wa.sessions.list();
    if (sessR.ok) sessR.data.forEach(s => {
      const o = document.createElement('option'); o.value=s.id; o.textContent='📱 '+(s.name||s.id);
      if (task?.session_id === s.id) o.selected = true;
      schSel.appendChild(o);
    });
  }

  // Template dropdown
  const tmplSel = document.getElementById('sch-tmpl-sel');
  tmplSel.innerHTML = '<option value="">اختر من القوالب...</option>';
  if (IS_ELECTRON) {
    const tR = await BE.templates.list();
    if (tR.ok) tR.data.forEach(t => {
      const o = document.createElement('option'); o.value=t.body||''; o.textContent=t.name; tmplSel.appendChild(o);
    });
  }

  // Preset buttons
  const presetsRow = document.getElementById('sch-presets-row');
  if (presetsRow && IS_ELECTRON) {
    const pr = await BE.scheduler.presets();
    if (pr.ok) {
      presetsRow.innerHTML = pr.data.map(p =>
        `<button class="btn bo bsm" onclick="applySchPreset('${p.value.replace(/'/g,"\\'")}','${p.label.replace(/'/g,"\\'")}')">⚡ ${p.label}</button>`
      ).join('');
    }
  }

  updateSchPreview();
  openM('m-scheduler');
  setTimeout(() => document.getElementById('sch-name').focus(), 120);
}

function applySchTemplate() {
  const sel  = document.getElementById('sch-tmpl-sel');
  const body = document.getElementById('sch-body');
  if (sel.value) { body.value = sel.value; sel.value = ''; }
}

function applySchPreset(cronVal, label) {
  // Parse cron to detect repeat type and set fields accordingly
  document.getElementById('sch-repeat').value = 'custom';
  document.getElementById('sch-cron-custom').value = cronVal;
  onSchRepeatChange();
  updateSchPreview();
  beOk('تم تطبيق: ' + label);
}

function onSchRecipientsChange() {
  const type = document.getElementById('sch-recipients-type')?.value;
  document.getElementById('sch-label-row').style.display  = type === 'label'  ? '' : 'none';
  document.getElementById('sch-manual-row').style.display = type === 'manual' ? '' : 'none';
}

function onSchRepeatChange() {
  const v = document.getElementById('sch-repeat')?.value;
  document.getElementById('sch-dow-row').style.display  = v === 'weekly' ? '' : 'none';
  document.getElementById('sch-cron-row').style.display = v === 'custom' ? '' : 'none';
  updateSchPreview();
}

function updateSchPreview() {
  const el = document.getElementById('sch-preview');
  if (!el) return;
  try {
    const expr = _buildCronExpr();
    el.textContent = expr ? _cronLabel(expr) + '  (' + expr + ')' : '—';
  } catch(_) { el.textContent = '—'; }
}

async function pickSchMedia() {
  if (!IS_ELECTRON) return;
  const fp = await BE.openFile({ filters:[
    { name:'وسائط', extensions:['jpg','jpeg','png','gif','mp4','mov','pdf','doc','docx','xls','xlsx','zip'] }
  ]});
  if (!fp) return;
  const ext = fp.split('.').pop().toLowerCase();
  const type = ['jpg','jpeg','png','gif','webp'].includes(ext) ? 'image'
             : ['mp4','mov','avi'].includes(ext) ? 'video'
             : 'document';
  document.getElementById('sch-media-path').value = fp;
  document.getElementById('sch-media-type').value = type;
  document.getElementById('sch-media-label').textContent = fp.split(/[\\/]/).pop();
  document.getElementById('btn-sch-clear-media').style.display = '';
}

function clearSchMedia() {
  document.getElementById('sch-media-path').value = '';
  document.getElementById('sch-media-type').value = '';
  document.getElementById('sch-media-label').textContent = 'لا يوجد ملف مرفق';
  document.getElementById('btn-sch-clear-media').style.display = 'none';
}

function _buildCronExpr() {
  const repeat = document.getElementById('sch-repeat')?.value || 'once';
  const dt     = document.getElementById('sch-datetime')?.value;

  if (repeat === 'custom') return document.getElementById('sch-cron-custom')?.value.trim() || '';
  if (repeat === 'hourly') return '0 * * * *';

  if (!dt) return '';
  const d = new Date(dt);
  const m = d.getMinutes();
  const h = d.getHours();
  const day = d.getDate();
  const mon = d.getMonth() + 1;

  switch (repeat) {
    case 'daily':     return `${m} ${h} * * *`;
    case 'workdays':  return `${m} ${h} * * 0-4`;
    case 'weekly': {
      const checked = [0,1,2,3,4,5,6].filter(i => document.getElementById(`dow-${i}`)?.checked);
      const days = checked.length ? checked.join(',') : String(d.getDay());
      return `${m} ${h} * * ${days}`;
    }
    case 'monthly':   return `${m} ${h} ${day} * *`;
    default:          return `${m} ${h} ${day} ${mon} *`;  // once
  }
}

function _cronToRepeat(expr) {
  if (!expr) return 'once';
  const p = expr.split(' ');
  if (p[4] === '0-4' || p[4] === '1-5') return 'workdays';
  if (p[2] === '*' && p[3] === '*' && p[4] === '*') return 'daily';
  if (p[0] === '0' && p[1] === '*')  return 'hourly';
  if (p[2] !== '*' && p[3] !== '*')  return 'once';
  if (p[4] !== '*' && p[2] === '*')  return 'weekly';
  if (p[2] !== '*' && p[3] === '*')  return 'monthly';
  return 'custom';
}

async function saveSchedule() {
  if (!IS_ELECTRON) { beOk('جدولة (وضع العرض)'); return; }

  const name    = document.getElementById('sch-name')?.value.trim();
  const body    = document.getElementById('sch-body')?.value.trim();
  const editId  = document.getElementById('sch-edit-id')?.value;

  if (!name)  { beErr('أدخل اسم المهمة'); return; }
  if (!body)  { beErr('أدخل نص الرسالة'); return; }

  const cron_expr = _buildCronExpr();
  if (!cron_expr) { beErr('حدد التاريخ والوقت أو أدخل Cron expression صحيح'); return; }

  const rType = document.getElementById('sch-recipients-type')?.value || 'all';
  let recipients_json = null;
  if (rType === 'label')  recipients_json = document.getElementById('sch-label-input')?.value.trim() || null;
  if (rType === 'manual') {
    const lines = (document.getElementById('sch-phones-input')?.value || '').split('\n').map(l=>l.trim()).filter(Boolean);
    recipients_json = JSON.stringify(lines);
  }

  const payload = {
    name,
    cron_expr,
    message_body:    body,
    media_path:      document.getElementById('sch-media-path')?.value || null,
    media_type:      document.getElementById('sch-media-type')?.value || null,
    recipients_type: rType,
    recipients_json,
    session_id:      document.getElementById('sch-session')?.value || null,
    timezone:        document.getElementById('sch-timezone')?.value || 'Asia/Riyadh',
    active:          1,
  };

  const btn = document.getElementById('btn-sch-save');
  if (btn) { btn.disabled=true; btn.textContent='⏳ جاري الحفظ...'; }

  try {
    const r = editId
      ? await BE.scheduler.update({ ...payload, id: editId })
      : await BE.scheduler.create(payload);

    if (r.ok) {
      beOk(editId ? 'تم تعديل الجدولة ✅' : 'تمت الجدولة بنجاح ✅');
      closeM('m-scheduler');
      loadScheduler();
    } else {
      beErr(r.error || 'تأكد من صحة البيانات');
    }
  } finally {
    if (btn) { btn.disabled=false; btn.textContent='📅 حفظ الجدولة'; }
  }
}

async function editTask(id) {
  if (!IS_ELECTRON) return;
  const r = await BE.scheduler.list();
  if (!r.ok) return;
  const task = r.data.find(t => t.id === id);
  if (task) openSchModal(task);
}

async function runTaskNow(id) {
  if (!IS_ELECTRON) return;
  if (!confirm('تشغيل هذه المهمة الآن فوراً؟')) return;
  const r = await BE.scheduler.runNow(id);
  if (r.ok) { beOk('تم تشغيل المهمة'); loadScheduler(); }
  else beErr(r.error);
}

async function pauseTask(id) {
  if (!IS_ELECTRON) return;
  const r = await BE.scheduler.pause(id);
  if (r.ok) { beOk('تم إيقاف المهمة مؤقتاً'); loadScheduler(); }
  else beErr(r.error);
}

async function resumeTask(id) {
  if (!IS_ELECTRON) return;
  const r = await BE.scheduler.resume(id);
  if (r.ok) { beOk('تم تفعيل المهمة'); loadScheduler(); }
  else beErr(r.error);
}

async function deleteSchedule(id) {
  if (!confirm('حذف هذه الجدولة نهائياً؟')) return;
  if (!IS_ELECTRON) return;
  const r = await BE.scheduler.remove(id);
  if (r.ok) { beOk('تم الحذف'); loadScheduler(); }
  else beErr(r.error);
}

// ── Templates ──────────────────────────────────────────────────────────────
async function loadTemplates() {
  if (!IS_ELECTRON) return;
  const r = await BE.templates.list();
  if (!r.ok) return;
  const list = r.data;
  _allTemplates = list;
  const sub  = document.getElementById('templates-subtitle');
  if (sub) sub.textContent = `قوالب الرسائل — ${list.length} قالب`;
  const el = document.getElementById('templates-list');
  if (!el) return;
  const catBadge = {marketing:'bg-g',order:'bg-b',support:'bg-y',welcome:'bg-p',followup:'bg-b'};
  const catLabel = {marketing:'📢 تسويق',order:'📦 طلبات',support:'🛎️ دعم',welcome:'👋 ترحيب',followup:'🔄 متابعة'};
  const cards = list.map(t=>`
    <div class="card">
      <div class="flex ic jb mb10"><b class="f13">${esc(t.name)}</b><span class="bge ${catBadge[t.category]||'bg-b'} f11">${catLabel[t.category]||t.category}</span></div>
      <div class="f12 ts" style="line-height:1.7;white-space:pre-wrap">${esc((t.body||'').slice(0,150))}${(t.body||'').length>150?'…':''}</div>
      <div class="flex gap8 mt14">
        <button class="btn bo bsm fi" onclick="useTemplate('${esc(t.id||'')}')">🚀 استخدام</button>
        <button class="btn bp bsm" onclick="openSendTemplate('${esc(t.id||'')}',${JSON.stringify((t.body||'').slice(0,300))})">📤 إرسال</button>
        <button class="btn bd bsm" onclick="deleteTemplate('${esc(t.id||'')}')">🗑️</button>
      </div>
    </div>`).join('');
  const addAI = `<div class="card" onclick="nav('ai')" style="border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:28px;cursor:pointer"><div style="font-size:30px">🤖</div><div class="fw6 f12">إنشاء بالـ AI</div><div class="f11 ts" style="text-align:center">أخبر الـ AI بفكرتك وسيكتب القالب لك</div><button class="btn bp bsm mt8">⚡ ابدأ الآن</button></div>`;
  const addNew = `<div class="card" onclick="openM('m-new-template')" style="border-style:dashed;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:28px;cursor:pointer"><div style="font-size:30px;opacity:.25">➕</div><div class="fw6 f12">قالب جديد</div></div>`;
  el.innerHTML = cards + addAI + addNew;
}

function setTemplatesView(view) {
  const el       = document.getElementById('templates-list');
  const btnGal   = document.getElementById('tpl-view-gallery');
  const btnList  = document.getElementById('tpl-view-list');
  if (!el) return;
  if (view === 'list') {
    el.className = 'tpl-list-view';
    if (btnGal)  { btnGal.style.borderColor=''; btnGal.style.color=''; }
    if (btnList) { btnList.style.borderColor='var(--acc)'; btnList.style.color='var(--acc)'; }
  } else {
    el.className = 'g3';
    if (btnGal)  { btnGal.style.borderColor='var(--acc)'; btnGal.style.color='var(--acc)'; }
    if (btnList) { btnList.style.borderColor=''; btnList.style.color=''; }
  }
}

async function saveTemplate() {
  if (!IS_ELECTRON) { beOk('حفظ (وضع العرض)'); closeM('m-new-template'); return; }
  const name = document.getElementById('tpl-name')?.value.trim();
  const body = document.getElementById('tpl-body')?.value.trim();
  const cat  = document.getElementById('tpl-cat')?.value || 'marketing';
  if (!name||!body) { beErr('يرجى ملء اسم القالب والنص'); return; }
  const r = await BE.templates.save({ name, body, category:cat });
  if (r.ok) { beOk('تم حفظ القالب'); closeM('m-new-template'); loadTemplates(); }
  else beErr(r.error);
}

async function deleteTemplate(id) {
  if (!confirm('حذف هذا القالب نهائياً؟')) return;
  if (!IS_ELECTRON) return;
  const r = await BE.templates.remove(id);
  if (r.ok) { beOk('تم الحذف'); loadTemplates(); }
  else beErr(r.error);
}

function useTemplate(id) {
  const t = (_allTemplates||[]).find(x=>String(x.id)===String(id));
  if (t) {
    nav('engine');
    _ensureAbInit();
    // Clear existing slots and load template body into first slot
    const container = document.getElementById('ab-scripts-container');
    if (container) container.innerHTML = '';
    _abSlotCounter = 0;
    addAbScript(t.body || '');
    beOk('تم تحميل القالب في محرك الإرسال');
  } else {
    nav('engine');
  }
}
let _allTemplates = [];

// ── AI Settings ────────────────────────────────────────────────────────────
async function loadAiSettings() {
  if (!IS_ELECTRON) return;
  const r = await BE.ai.getKeys();
  if (!r.ok) return;
  const sv = (id,v) => { const el=document.getElementById(id); if(el&&v) el.value=v; };
  sv('ai-gemini-key',   r.data.geminiKey);
  sv('ai-claude-key',   r.data.claudeKey);
  sv('set-gemini-key',  r.data.geminiKey);
  sv('set-claude-key',  r.data.claudeKey);
  if (r.data.provider)    { const el=document.getElementById('ai-model-pref');   if(el) el.value=r.data.provider; }
  if (r.data.geminiModel) { const el=document.getElementById('ai-gemini-model'); if(el) el.value=r.data.geminiModel; }
  const gs = document.getElementById('ai-gemini-status');
  const cs = document.getElementById('ai-claude-status');
  if (gs) { const ok=!!(r.data.geminiKey); gs.textContent=`🌟 Gemini: ${ok?'✅ متصل':'غير مُهيأ'}`; gs.className=`bge f11 ${ok?'bg-g':'bg-r'}`; gs.style.padding='6px 10px'; }
  if (cs) { const ok=!!(r.data.claudeKey); cs.textContent=`🤖 Claude: ${ok?'✅ متصل':'غير مُهيأ'}`; cs.className=`bge f11 ${ok?'bg-g':'bg-r'}`; cs.style.padding='6px 10px'; }
}

async function saveAiSettings() {
  if (!IS_ELECTRON) { beOk('تم الحفظ (وضع العرض)'); return; }
  const gemini      = document.getElementById('ai-gemini-key')?.value.trim()   || '';
  const claude      = document.getElementById('ai-claude-key')?.value.trim()   || '';
  const provider    = document.getElementById('ai-model-pref')?.value          || 'gemini';
  const geminiModel = document.getElementById('ai-gemini-model')?.value        || 'gemini-2.0-flash';
  const r = await BE.ai.saveKeys({ geminiKey:gemini, claudeKey:claude, provider, geminiModel });
  if (r.ok) { beOk('تم حفظ إعدادات AI ✅'); loadAiSettings(); }
  else beErr(r.error);
}

// ── CRM ────────────────────────────────────────────────────────────────────
// ── CRM Integration ───────────────────────────────────────────────────────

let _crmActive = null;
let _crmConfig  = {};

function _crmBadge(id, hasKey) {
  const el = document.getElementById('crm-st-' + id);
  if (!el) return;
  el.textContent = hasKey ? 'متصل' : 'غير متصل';
  el.className   = `bge ${hasKey ? 'bg-g' : 'bg-r'}`;
}
function _crmSetActive(card) {
  document.querySelectorAll('.crm-c').forEach(c => c.style.borderColor = '');
  const el = document.getElementById('crm-card-' + card);
  if (el) el.style.borderColor = 'var(--acc)';
}

async function loadCRM() {
  if (!IS_ELECTRON) return;
  const r = await BE.crm.getConfig();
  if (!r.ok) return;
  const c = _crmConfig = r.data;
  const sv = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };

  sv('crm-hub-key',     c.hubspot_key);
  sv('crm-hub-portal',  c.hubspot_portal_id);
  sv('crm-hub-freq',    c.hubspot_sync_freq);
  sv('crm-pipe-key',    c.pipedrive_key);
  sv('crm-air-key',     c.airtable_key);
  sv('crm-air-base',    c.airtable_base);
  sv('crm-air-table',   c.airtable_table);
  sv('crm-wh-url',      c.webhook_url);
  sv('crm-wh-secret',   c.webhook_secret);
  sv('crm-gs-url',      c.gsheets_url);
  sv('crm-gs-phone-col',c.gsheets_phone_col);
  sv('crm-gs-name-col', c.gsheets_name_col);

  const wh = document.getElementById('crm-wh-on-send');
  if (wh) wh.checked = c.webhook_on_send !== '0';
  const wr = document.getElementById('crm-wh-on-reply');
  if (wr) wr.checked = c.webhook_on_reply !== '0';

  _crmBadge('hubspot',  !!c.hubspot_key);
  _crmBadge('pipedrive',!!c.pipedrive_key);
  _crmBadge('airtable', !!(c.airtable_key && c.airtable_base));
  _crmBadge('webhook',  !!c.webhook_url);
  _crmBadge('gsheets',  !!c.gsheets_url);
}

function crmSelect(type) {
  _crmActive = type;
  _crmSetActive(type);
  document.getElementById('crm-settings-panel').style.display = 'block';
  ['hubspot','pipedrive','airtable','webhook','gsheets'].forEach(t => {
    const p = document.getElementById('crm-panel-' + t);
    if (p) p.style.display = t === type ? 'block' : 'none';
  });
}

async function crmSave(type) {
  if (!IS_ELECTRON) { beOk('تم الحفظ (وضع العرض)'); return; }
  const gv = id => document.getElementById(id)?.value?.trim() || '';
  const data = {};

  if (type === 'hubspot') {
    data.hubspot_key = gv('crm-hub-key');
    data.hubspot_portal_id = gv('crm-hub-portal');
    data.hubspot_sync_freq = gv('crm-hub-freq');
  } else if (type === 'pipedrive') {
    data.pipedrive_key = gv('crm-pipe-key');
  } else if (type === 'airtable') {
    data.airtable_key = gv('crm-air-key');
    data.airtable_base = gv('crm-air-base');
    data.airtable_table = gv('crm-air-table');
  } else if (type === 'webhook') {
    data.webhook_url = gv('crm-wh-url');
    data.webhook_secret = gv('crm-wh-secret');
    data.webhook_on_send  = document.getElementById('crm-wh-on-send')?.checked  ? '1' : '0';
    data.webhook_on_reply = document.getElementById('crm-wh-on-reply')?.checked ? '1' : '0';
  } else if (type === 'gsheets') {
    data.gsheets_url       = gv('crm-gs-url');
    data.gsheets_phone_col = gv('crm-gs-phone-col');
    data.gsheets_name_col  = gv('crm-gs-name-col');
  }

  const r = await BE.crm.saveConfig(data);
  if (r.ok) { beOk(`✅ تم حفظ إعدادات ${type}`); loadCRM(); }
  else beErr(r.error);
}

async function crmTest(type) {
  if (!IS_ELECTRON) return;
  const resEl = document.getElementById('crm-test-result-' + type);
  if (resEl) { resEl.textContent = '⏳ جارٍ الاختبار...'; resEl.style.color = 'var(--ts)'; }
  const r = await BE.crm.testConnection(type);
  if (resEl) {
    if (r.ok) {
      resEl.textContent = '✅ ' + (r.data?.info || 'متصل');
      resEl.style.color = '#22c55e';
      _crmBadge(type, true);
    } else {
      resEl.textContent = '❌ ' + (r.error || 'فشل الاتصال');
      resEl.style.color = '#ef4444';
    }
  }
}

async function crmSync(source) {
  if (!IS_ELECTRON) return;
  GP.show(`جارٍ مزامنة ${source}...`, 50, 'جلب');
  const r = await BE.crm.syncLeads(source);
  if (r.ok) {
    GP.done(`تم استيراد ${r.data?.synced || 0} جهة اتصال`);
    beOk(`✅ ${r.data?.synced || 0} جهة اتصال من ${source}`);
    loadCRMLeads();
  } else {
    GP.hide();
    beErr(`فشل مزامنة ${source}: ${r.error}`);
  }
}

async function crmPush(type) {
  if (!IS_ELECTRON) return;
  if (!confirm(`سيتم تصدير جميع جهات الاتصال المحفوظة إلى ${type}. هل تريد المتابعة؟`)) return;
  GP.show(`جارٍ التصدير إلى ${type}...`, 30, 'تصدير');
  const r = await BE.crm.pushContacts(type);
  if (r.ok) {
    GP.done(`تم تصدير ${r.data?.pushed || 0} جهة اتصال`);
    beOk(`✅ ${r.data?.pushed || 0} تم تصديرها — ${r.data?.errors || 0} فشل`);
  } else {
    GP.hide();
    beErr('فشل التصدير: ' + r.error);
  }
}

async function loadCRMLeads() {
  if (!IS_ELECTRON) return;
  const r = await BE.crm.getLeads();
  if (!r.ok) return;
  const leads = r.data || [];
  const card = document.getElementById('crm-leads-card');
  const tbody = document.getElementById('crm-leads-tbody');
  if (!tbody) return;
  if (!leads.length) { tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;opacity:.5">لا توجد بيانات</td></tr>'; return; }
  card.style.display = 'block';
  tbody.innerHTML = leads.map(l => `
    <tr>
      <td><span class="bge bg-y" style="font-size:10px">${l.source || '?'}</span></td>
      <td>${esc(l.name || '—')}</td>
      <td class="fm f11">${l.phone || '—'}</td>
      <td class="f11">${l.email || '—'}</td>
      <td class="f11">${l.status || '—'}</td>
    </tr>`).join('');
}

// ── Wake Lock ─────────────────────────────────────────────────────────────
if (IS_ELECTRON) {
  BE.on('wakelock:state', ({ active }) => {
    const bar = document.getElementById('eng-wakelock-bar');
    if (bar) bar.style.display = active ? 'flex' : 'none';
    if (active) showN('☀️ منع وضع السكون', 'الجهاز لن يدخل وضع النوم أثناء الحملة', '⚡');
    else        showN('🌙 انتهت الحملة', 'الجهاز عاد لوضعه الطبيعي', '✅');
  });
}

// ── Reports (enhanced) ─────────────────────────────────────────────────────
async function loadReports() {
  if (!IS_ELECTRON) return;
  const days        = parseInt(document.getElementById('reports-period')?.value||'30');
  const repSession  = document.getElementById('reports-session')?.value  || null;
  const repFilter   = document.getElementById('reports-reply-filter')?.value || null;
  try {
    const [statsR, repliesR, accountsR, replyStatsR] = await Promise.all([
      BE.messages.getStats(),
      BE.wa.inbox.list({ sessionId: repSession, filter: repFilter || null, limit: 500 }),
      BE.accounts.list(),
      BE.wa.inbox.replyStats(),
    ]);
    if (statsR.ok) {
      const s = statsR.data;
      const sent = s.sent||0;
      document.getElementById('rep-s-sent').textContent    = sent.toLocaleString();
      document.getElementById('rep-s-read').textContent    = (s.read_count||0).toLocaleString();
      document.getElementById('rep-s-replies').textContent = (s.replies||0).toLocaleString();
      document.getElementById('rep-s-rate').textContent    = (sent ? ((s.replies||0)/sent*100).toFixed(1) : '0') + '%';
    }
    if (replyStatsR && replyStatsR.ok) {
      const rs = replyStatsR.data || {};
      const setEl = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=(v||0).toLocaleString(); };
      setEl('rep-rs-total',     rs.total);
      setEl('rep-rs-unreplied', rs.unreplied_count);
      setEl('rep-rs-replied',   rs.replied_count);
    }
    if (accountsR.ok && accountsR.data.length) {
      const accs = accountsR.data;
      const max  = Math.max(...accs.map(a=>a.msg_count||0), 1);
      document.getElementById('rep-accounts-bars').innerHTML = accs.map(a=>`
        <div class="cbr">
          <div class="cbl">${esc(a.name||'—')}</div>
          <div class="cbt"><div class="cbf" style="width:${Math.round((a.msg_count||0)/max*100)}%"></div></div>
          <div class="cbv">${(a.msg_count||0).toLocaleString()}</div>
        </div>`).join('');
    }
    // Populate session dropdown in reports
    const repSelEl = document.getElementById('reports-session');
    if (repSelEl && repSelEl.options.length <= 1) {
      const sessR = await BE.wa.sessions.list();
      if (sessR.ok) sessR.data.forEach(s => {
        const o = document.createElement('option'); o.value = s.id;
        o.textContent = '📱 ' + (s.name||s.id); repSelEl.appendChild(o);
        if (repSession === s.id) o.selected = true;
      });
    }
    if (repliesR && repliesR.ok) {
      const msgs = repliesR.data;
      document.getElementById('rep-replies-tbody').innerHTML = msgs.length
        ? msgs.map(m=>{
            const fromName = m.is_group
              ? `<span class="bge bg-b f11">جروب</span> ${esc(m.group_name||m.from_number||'—')}`
              : esc(m.contact_name ? m.contact_name : ('+' + (m.from_number||'')));
            return `
          <tr>
            <td>${fromName}</td>
            <td class="f11 ts">${esc(m.session_name||m.session_id||'').slice(0,16)}</td>
            <td class="f12" style="max-width:220px;word-break:break-word">${esc(bodyText(m).slice(0,80))}</td>
            <td class="f11 ts">${m.received_at?m.received_at.slice(0,16):'—'}</td>
            <td>${m.replied ? '<span class="bge bg-g f11">تم الرد</span>' : '<span class="bge bg-y f11">لم يُرد</span>'}</td>
          </tr>`;}).join('')
        : '<tr><td colspan="5" class="ta f12 ts" style="padding:24px">لا توجد ردود حتى الآن</td></tr>';
    }
  } catch(_) {}
}

// ── Settings (enhanced) ─────────────────────────────────────────────────────
async function loadSettings() {
  if (!IS_ELECTRON) return;
  try {
    const [sR, vR] = await Promise.all([BE.settings.get(), BE.getVersion()]);
    if (sR.ok) {
      const s = sR.data;
      const sv = (id,v) => { const el=document.getElementById(id); if(el&&v!==undefined&&v!==null) el.value=v; };
      sv('set-wa-token',   s.wa_default_token);
      sv('set-wa-pid',     s.wa_default_phone_id);
      sv('set-wa-bid',     s.wa_default_biz_id);
      sv('set-gemini-key', s.ai_gemini_key);
      sv('set-claude-key', s.ai_claude_key);
    }
    if (vR) {
      const el = document.getElementById('sys-version');
      if (el) el.textContent = 'v' + vR;
      const dt = document.getElementById('sys-date');
      if (dt) dt.textContent = new Date().toISOString().slice(0,10);
    }
    // Load engine status and webhook config
    loadEngineStatus();
    loadWebhookSettings();
  } catch(_) {}
}

async function saveAllSettings() {
  if (!IS_ELECTRON) { beOk('تم حفظ الإعدادات (وضع العرض)'); return; }
  const gv = id => document.getElementById(id)?.value?.trim()||'';
  const data = { wa_default_token:gv('set-wa-token'), wa_default_phone_id:gv('set-wa-pid'),
    wa_default_biz_id:gv('set-wa-bid'), ai_gemini_key:gv('set-gemini-key'), ai_claude_key:gv('set-claude-key') };
  Object.keys(data).forEach(k=>{ if(!data[k]||data[k].startsWith('****')) delete data[k]; });
  const r = await BE.settings.save(data);
  if (r.ok) beOk('تم حفظ الإعدادات بنجاح'); else beErr(r.error);
}

async function backupData() {
  if (!IS_ELECTRON) { beOk('نسخ احتياطي (وضع العرض)'); return; }
  const r = await BE.settings.backup();
  if (r.ok) beOk('تم حفظ النسخة: ' + r.data.path); else beErr(r.error);
}

async function restoreData() {
  if (!IS_ELECTRON) { beOk('استعادة (وضع العرض)'); return; }
  const fp = await BE.openFile({ filters:[{name:'Database',extensions:['db']}] });
  if (!fp) return;
  const r = await BE.settings.restore(fp);
  if (r.ok) beOk(r.data.message||'تمت الاستعادة'); else beErr(r.error);
}

// ═══════════════════════════════════════════════════════════════════════════
// DEVICES — whatsapp-web.js session management
// ═══════════════════════════════════════════════════════════════════════════

let _enginePaused = false;
let _currentQrSession = null;

function promptAddDevice() {
  document.getElementById('new-dev-name').value = '';
  openM('m-add-device');
  setTimeout(() => document.getElementById('new-dev-name').focus(), 100);
}

async function createAndStartDevice() {
  const name = document.getElementById('new-dev-name').value.trim();
  if (!name) { beErr('أدخل اسم الجهاز'); return; }
  closeM('m-add-device');

  if (!IS_ELECTRON) {
    showQrModal('demo', name, 'https://chart.googleapis.com/chart?chs=250x250&cht=qr&chl=demo');
    return;
  }

  showN('جاري التهيئة', 'يتم إنشاء الجهاز...', '⏳');
  const cr = await BE.wa.sessions.create({ name });
  if (!cr.ok) { beErr(cr.error); return; }

  const id = cr.data.id;
  _currentQrSession = id;
  showQrModal(id, name, null);

  const sr = await BE.wa.sessions.start(id);
  if (!sr.ok) { beErr(sr.error); closeM('m-qr'); }
  loadDevices();
}

function showQrModal(sessionId, name, qrDataUrl) {
  _currentQrSession = sessionId;
  document.getElementById('qr-dev-name').textContent = name;
  document.getElementById('qr-hint').textContent = 'جاري تحميل رمز QR...';
  const wrap = document.getElementById('qr-img-wrap');
  const spin = document.getElementById('qr-spinner');
  if (qrDataUrl) {
    document.getElementById('qr-img').src = qrDataUrl;
    wrap.style.display = 'inline-block'; spin.style.display = 'none';
    document.getElementById('qr-hint').textContent = 'امسح الرمز الآن من واتساب';
  } else {
    wrap.style.display = 'none'; spin.style.display = 'block';
  }
  openM('m-qr');
}

async function loadDevices() {
  const grid = document.getElementById('devices-grid');
  if (!grid) return;

  let sessions = [];
  if (IS_ELECTRON) {
    const r = await BE.wa.sessions.list();
    if (r.ok) sessions = r.data;
  }

  // Update stats
  const total   = sessions.length;
  const ready   = sessions.filter(s => s.state === 'ready').length;
  const qrWait  = sessions.filter(s => ['qr','initializing','authenticated'].includes(s.state)).length;
  const offline = sessions.filter(s => ['disconnected','stopped','logged_out','error','auth_failed'].includes(s.state) || (!s.state && !s.active)).length;

  document.getElementById('dev-total').textContent = total;
  document.getElementById('dev-ready').textContent = ready;
  document.getElementById('dev-qr').textContent    = qrWait;
  document.getElementById('dev-off').textContent   = offline;
  document.getElementById('nb-devices').textContent = ready;

  const stateLabel = { ready:'🟢 متصل', qr:'⏳ ينتظر QR', initializing:'⚙️ يتهيأ',
    authenticated:'🔑 جاري التحميل', disconnected:'🔴 غير متصل',
    stopped:'⏹️ موقوف', logged_out:'🚪 تسجيل خروج',
    auth_failed:'⚠️ خطأ في المصادقة', error:'❌ خطأ' };

  const stateBadge = { ready:'bg-g', qr:'bg-y', initializing:'bg-y', authenticated:'bg-y',
    disconnected:'bg-r', stopped:'', logged_out:'', auth_failed:'bg-r', error:'bg-r' };

  const cards = sessions.map(s => {
    const st    = s.state || s.status || 'disconnected';
    const lbl   = stateLabel[st] || st;
    const badge = stateBadge[st] || '';
    const isReady = st === 'ready';
    return `
      <div class="ac" style="flex-direction:column;align-items:flex-start;gap:8px;min-height:150px">
        <div class="flex ic jb wf">
          <div style="font-size:28px">📱</div>
          <span class="bge ${badge} f11">${lbl}</span>
        </div>
        <div class="fw7 f13">${esc(s.name)}</div>
        <div class="f11 ts">${s.phone ? '📞 +'+s.phone : '—'}</div>
        <div class="f11 ts">✉️ ${(s.msg_count||0).toLocaleString()} رسالة</div>
        <div class="flex gap6 mt4 wf" style="flex-wrap:wrap">
          ${isReady ? '' : `<button class="btn bp bsm fi" onclick="startDevice('${s.id}')">▶ تشغيل</button>`}
          ${s.active ? `<button class="btn bo bsm fi" onclick="stopDevice('${s.id}')">⏹️ إيقاف</button>` : ''}
          <button class="btn bo bsm fi" onclick="logoutDevice('${s.id}')">🚪 خروج</button>
          <button class="btn bd bsm" onclick="removeDevice('${s.id}')">🗑️</button>
        </div>
      </div>`;
  }).join('');

  const addCard = `
    <div class="ac" onclick="promptAddDevice()" style="border-style:dashed;flex-direction:column;align-items:center;justify-content:center;gap:10px;min-height:150px;cursor:pointer">
      <div style="font-size:34px;opacity:.2">📱</div>
      <div class="f12 ts">ربط جهاز جديد</div>
      <div class="f11" style="color:var(--tm)">مسح QR من واتساب</div>
    </div>`;

  grid.innerHTML = cards + addCard;

  // Populate session filter selects
  _populateSessionSelects(sessions);
}

function _populateSessionSelects(sessions) {
  const readySessions = sessions.filter(s => s.state === 'ready' || s.active);
  ['eng-session','inbox-filter'].forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const first = sel.options[0];
    sel.innerHTML = '';
    sel.appendChild(first);
    readySessions.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `📱 ${s.name}${s.phone ? ' ('+s.phone+')' : ''}`;
      sel.appendChild(opt);
    });
  });
  // Refresh A/B account checkboxes
  refreshAccCheckList(readySessions);
}

async function startDevice(id) {
  if (!IS_ELECTRON) { beOk('تشغيل (وضع العرض)'); return; }
  showN('تشغيل', 'جاري تشغيل الجلسة...', '⏳');
  _currentQrSession = id;
  const r = await BE.wa.sessions.start(id);
  if (!r.ok) beErr(r.error);
  loadDevices();
}

async function stopDevice(id) {
  if (!IS_ELECTRON) return;
  await BE.wa.sessions.stop(id);
  beOk('تم إيقاف الجلسة'); loadDevices();
}

async function logoutDevice(id) {
  if (!confirm('هل تريد تسجيل الخروج؟ ستحتاج مسح QR مجدداً.')) return;
  if (!IS_ELECTRON) { beOk('تسجيل خروج (وضع العرض)'); return; }
  await BE.wa.sessions.logout(id);
  beOk('تم تسجيل الخروج'); loadDevices();
}

async function removeDevice(id) {
  if (!confirm('حذف الجهاز نهائياً؟')) return;
  if (!IS_ELECTRON) { beOk('تم الحذف (وضع العرض)'); return; }
  await BE.wa.sessions.remove(id);
  beOk('تم حذف الجهاز'); loadDevices();
}

// ── WA IPC events ──────────────────────────────────────────────────────────
if (IS_ELECTRON) {
  BE.on('wa:qr', ({ sessionId, qr }) => {
    const wrap = document.getElementById('qr-img-wrap');
    const spin = document.getElementById('qr-spinner');
    if (document.getElementById('m-qr').classList.contains('open')) {
      document.getElementById('qr-img').src = qr;
      wrap.style.display = 'inline-block'; spin.style.display = 'none';
      document.getElementById('qr-hint').textContent = 'امسح الرمز الآن من واتساب';
    } else if (sessionId === _currentQrSession) {
      openM('m-qr');
      document.getElementById('qr-img').src = qr;
      wrap.style.display = 'inline-block'; spin.style.display = 'none';
    }
    loadDevices();
  });

  BE.on('wa:ready', ({ sessionId, phone, pushname }) => {
    if (document.getElementById('m-qr').classList.contains('open') && sessionId === _currentQrSession) {
      closeM('m-qr');
    }
    showN('تم الاتصال ✅', `${pushname||''} — +${phone}`, '📲');
    loadDevices();
    updateStats();
  });

  BE.on('wa:disconnected', ({ sessionId, reason }) => {
    showN('انقطع الاتصال', `جلسة: ${sessionId}`, '🔴');
    loadDevices();
  });

  BE.on('wa:authFailed', ({ sessionId, message }) => {
    showN('فشل المصادقة', message || 'تحقق من الجلسة', '⚠️');
    loadDevices();
  });

  BE.on('wa:message', ({ from, body, sessionId, isGroup, groupName }) => {
    const sender = isGroup ? (groupName || from) : from;
    showN('رسالة واردة 📩', `من: ${sender}\n${(body||'').slice(0,60)}`, isGroup ? '👥' : '💬');
    // Update unread badge
    BE.wa.inbox.unread('').then(r => {
      if (r.ok) {
        const n = r.data;
        const badge = document.getElementById('nb-inbox');
        if (badge) { badge.textContent = n; badge.style.display = n > 0 ? '' : 'none'; }
        document.getElementById('inbox-unread')?.textContent && (document.getElementById('inbox-unread').textContent = n);
      }
    }).catch(()=>{});
    // Refresh inbox if visible
    if (document.getElementById('p-inbox')) loadInbox();
  });

  BE.on('wa:stateChange', () => loadDevices());
}

// ═══════════════════════════════════════════════════════════════════════════
// SEND ENGINE — anti-ban bulk queue
// ═══════════════════════════════════════════════════════════════════════════

function countEngineTargets() {
  const raw = document.getElementById('eng-recipients').value;
  const nums = raw.split(/[\n,]+/).map(s=>s.trim()).filter(s=> s.includes('@') || /\d{6,}/.test(s));
  document.getElementById('eng-count').textContent = nums.length + ' مستهدف';
}

async function loadEngineStats() {
  if (!IS_ELECTRON) return;
  const r = await BE.wa.send.queueStats();
  if (!r || !r.ok) return;
  const s = r.data;
  document.getElementById('eng-s-pending').textContent   = (s.pending||0).toLocaleString();
  document.getElementById('eng-s-sent').textContent      = (s.sent||0).toLocaleString();
  document.getElementById('eng-s-delivered').textContent = (s.delivered||0).toLocaleString();
  document.getElementById('eng-s-failed').textContent    = (s.failed||0).toLocaleString();

  const total = s.total || 1;
  const done  = (s.sent||0) + (s.delivered||0) + (s.read_count||0) + (s.failed||0);
  const pct   = Math.round(done / total * 100);
  if ((s.pending||0) > 0 || done > 0) {
    document.getElementById('eng-progress-card').style.display = 'block';
    document.getElementById('eng-prog-bar').style.width  = pct + '%';
    document.getElementById('eng-prog-pct').textContent  = pct + '%';
    document.getElementById('eng-prog-sent').textContent = (s.sent||0);
    document.getElementById('eng-prog-fail').textContent = (s.failed||0);
    document.getElementById('eng-prog-left').textContent = (s.pending||0);
  }
}

async function toggleEnginePause() {
  if (!IS_ELECTRON) return;
  const btn = document.getElementById('eng-pause-btn');
  if (_enginePaused) {
    await BE.wa.send.resume();
    _enginePaused = false;
    btn.textContent = '⏸️ إيقاف مؤقت';
    btn.className = 'btn bo bsm';
    beOk('تم استئناف الإرسال');
  } else {
    await BE.wa.send.pause();
    _enginePaused = true;
    btn.textContent = '▶️ استئناف';
    btn.className = 'btn bp bsm';
    beOk('تم إيقاف الإرسال مؤقتاً');
  }
}

async function clearEngineQueue() {
  if (!confirm('مسح جميع الرسائل المكتملة والفاشلة من القائمة؟')) return;
  if (!IS_ELECTRON) { beOk('تم المسح (وضع العرض)'); return; }
  await BE.wa.send.clearDone();
  beOk('تم مسح القائمة'); loadEngineStats();
}

async function pickEngineMedia() {
  if (!IS_ELECTRON) { beOk('اختيار ملف (وضع العرض)'); return; }
  const fp = await BE.openFile({ filters:[
    { name: 'Media', extensions: ['jpg','jpeg','png','gif','mp4','pdf','doc','docx'] }
  ]});
  if (fp) document.getElementById('eng-media-path').value = fp;
}

async function importEngineContacts() {
  if (!IS_ELECTRON) return;
  const r = await BE.contacts.list({});
  if (!r.ok) { beErr(r.error); return; }
  const phones = r.data.filter(c=>c.opt_in&&c.phone).map(c=>c.phone).join('\n');
  document.getElementById('eng-recipients').value = phones;
  countEngineTargets();
  beOk(`تم استيراد ${r.data.length} جهة اتصال`);
}

// ── Send Engine: 6-source import functions ────────────────────────────────

// 1. جهات الاتصال المسحوبة (all scraped contacts)
async function engImportContacts() {
  if (!IS_ELECTRON) return;
  const r = await BE.contacts.list({});
  if (!r.ok) { beErr(r.error); return; }
  const all = r.data.filter(c => c.phone);
  document.getElementById('eng-recipients').value = all.map(c => c.phone).join('\n');
  countEngineTargets();
  beOk(`✅ تم استيراد ${all.length} جهة اتصال`);
}

// 2. الجروبات المسحوبة (send TO group chats — group JIDs)
async function engImportScrapedGroups() {
  if (!IS_ELECTRON) return;
  const r = await BE.groups.list();
  if (!r.ok) { beErr(r.error); return; }
  const jids = (r.data || []).filter(g => g.id).map(g => g.id);
  if (!jids.length) { beErr('لا توجد مجموعات مسحوبة — اسحب المجموعات أولاً'); return; }
  document.getElementById('eng-recipients').value = jids.join('\n');
  countEngineTargets();
  beOk(`✅ تم تحميل ${jids.length} مجموعة — سيتم الإرسال إلى المجموعات مباشرة`);
}

// 3. من جروبات محددة — فتح مودال الاختيار
let _engGrpAll = [];
let _engGrpSel = new Set();

async function engOpenGroupPicker() {
  if (!IS_ELECTRON) return;
  const r = await BE.groups.list();
  if (!r.ok) { beErr(r.error); return; }
  _engGrpAll = (r.data || []).filter(g => g.id && g.name);
  _engGrpSel = new Set();
  _engRenderGroupList(_engGrpAll);
  openM('m-eng-groups');
}

function _engRenderGroupList(list) {
  const el = document.getElementById('eng-grp-list');
  if (!list.length) { el.innerHTML = '<div style="padding:16px;text-align:center;opacity:.5">لا توجد مجموعات</div>'; return; }
  el.innerHTML = list.map(g => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:6px;cursor:pointer;margin:2px 0" onmouseover="this.style.background='rgba(var(--ar),.06)'" onmouseout="this.style.background=''">
      <input type="checkbox" ${_engGrpSel.has(g.id)?'checked':''} onchange="engGrpToggle('${g.id}',this.checked)" style="accent-color:var(--acc)">
      <span class="f12" style="flex:1">${(g.name||'').replace(/</g,'&lt;')}</span>
      <span class="f11 ts">${(g.member_count||0).toLocaleString()} عضو</span>
    </label>`).join('');
  document.getElementById('eng-grp-sel-count').textContent = `${_engGrpSel.size} مجموعة محددة`;
}

function filterEngGroups() {
  const q = document.getElementById('eng-grp-search').value.toLowerCase();
  _engRenderGroupList(_engGrpAll.filter(g => g.name?.toLowerCase().includes(q)));
}

function engGrpToggle(id, checked) {
  if (checked) _engGrpSel.add(id); else _engGrpSel.delete(id);
  document.getElementById('eng-grp-sel-count').textContent = `${_engGrpSel.size} مجموعة محددة`;
}

function engGrpSelAll() {
  _engGrpAll.forEach(g => _engGrpSel.add(g.id));
  _engRenderGroupList(_engGrpAll);
}

function engGrpSelNone() {
  _engGrpSel.clear();
  _engRenderGroupList(_engGrpAll);
}

async function engImportSelectedGroupMembers() {
  if (!_engGrpSel.size) { beErr('اختر مجموعة واحدة على الأقل'); return; }
  const sessionId = document.getElementById('eng-session').value
                  || document.getElementById('groups-session-sel')?.value || '';
  if (!sessionId) { beErr('اختر جهاز Web من قائمة "الجهاز المُرسِل" أولاً'); return; }
  closeM('m-eng-groups');
  const ids = Array.from(_engGrpSel);
  const allPhones = new Set();
  GP.show(`جارٍ جلب أعضاء ${ids.length} مجموعة...`, 0, `0/${ids.length}`);
  for (let i = 0; i < ids.length; i++) {
    try {
      const r = await BE.wa.scraper.getParticipants({ sessionId, groupId: ids[i] });
      if (r.ok && r.data) r.data.forEach(p => { if (p.phone) allPhones.add(p.phone); });
    } catch (_) {}
    GP.step('جلب الأعضاء...', i+1, ids.length, `${i+1}/${ids.length}`);
  }
  GP.done(`تم جلب ${allPhones.size} عضو`);
  if (!allPhones.size) { beErr('لم يتم العثور على أعضاء — تأكد أن الجهاز متصل'); return; }
  document.getElementById('eng-recipients').value = Array.from(allPhones).join('\n');
  countEngineTargets();
  beOk(`✅ ${allPhones.size} عضو من ${ids.length} مجموعة`);
}

// 4. أعضاء كل الجروبات المسحوبة
async function engImportAllGroupMembers() {
  if (!IS_ELECTRON) return;
  const sessionId = document.getElementById('eng-session').value
                  || document.getElementById('groups-session-sel')?.value || '';
  if (!sessionId) { beErr('اختر جهاز Web من قائمة "الجهاز المُرسِل" أولاً'); return; }
  const rg = await BE.groups.list();
  if (!rg.ok || !rg.data?.length) { beErr('لا توجد مجموعات مسحوبة — اسحب المجموعات أولاً'); return; }
  if (!confirm(`سيتم جلب أعضاء ${rg.data.length} مجموعة — قد يستغرق هذا وقتاً طويلاً. هل تريد المتابعة؟`)) return;
  const ids = rg.data.map(g => g.id);
  const allPhones = new Set();
  GP.show(`جارٍ جلب أعضاء ${ids.length} مجموعة...`, 0, `0/${ids.length}`);
  for (let i = 0; i < ids.length; i++) {
    try {
      const r = await BE.wa.scraper.getParticipants({ sessionId, groupId: ids[i] });
      if (r.ok && r.data) r.data.forEach(p => { if (p.phone) allPhones.add(p.phone); });
    } catch (_) {}
    GP.step('جلب الأعضاء...', i+1, ids.length, `${i+1}/${ids.length}`);
  }
  GP.done(`تم جلب ${allPhones.size} عضو من ${ids.length} مجموعة`);
  if (!allPhones.size) { beErr('لم يتم العثور على أعضاء'); return; }
  document.getElementById('eng-recipients').value = Array.from(allPhones).join('\n');
  countEngineTargets();
  beOk(`✅ ${allPhones.size} عضو فريد من ${ids.length} مجموعة`);
}

// 5. Excel / CSV
async function engImportFromFile() {
  if (!IS_ELECTRON) return;
  const fp = await BE.openFile({ filters:[
    { name: 'Excel / CSV', extensions: ['xlsx','xls','csv'] }
  ]});
  if (!fp) return;
  const r = await BE.wa.send.importFromFile(fp);
  if (!Array.isArray(r) || !r.length) { beErr('لم يتم العثور على أرقام في الملف'); return; }
  document.getElementById('eng-recipients').value = r.join('\n');
  countEngineTargets();
  beOk(`✅ تم استيراد ${r.length} رقم من الملف`);
}

// 6. Google Sheets
function engOpenSheetsModal() {
  document.getElementById('eng-sheets-url').value = '';
  openM('m-eng-sheets');
}

async function engDoImportSheets() {
  if (!IS_ELECTRON) return;
  const url = document.getElementById('eng-sheets-url').value.trim();
  if (!url) { beErr('أدخل رابط Google Sheets'); return; }
  closeM('m-eng-sheets');
  GP.show('جارٍ جلب البيانات من Google Sheets...', 50, 'جلب');
  try {
    const phones = await BE.wa.send.importFromSheets(url);
    GP.done(`تم جلب ${phones?.length || 0} رقم`);
    if (!phones?.length) { beErr('لم يتم العثور على أرقام في الجدول'); return; }
    document.getElementById('eng-recipients').value = phones.join('\n');
    countEngineTargets();
    beOk(`✅ تم استيراد ${phones.length} رقم من Google Sheets`);
  } catch (e) {
    GP.hide();
    beErr('فشل جلب البيانات: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// A/B TESTING — DYNAMIC SCRIPT BUILDER
// ═══════════════════════════════════════════════════════════════════════════

let _abSlotCounter = 0;
let _accMode = 'auto';

function _ensureAbInit() {
  const container = document.getElementById('ab-scripts-container');
  if (container && !container.querySelector('.ab-slot')) addAbScript();
}

function addAbScript(text, mediaPath) {
  const container = document.getElementById('ab-scripts-container');
  if (!container) return;
  const slots = container.querySelectorAll('.ab-slot');
  if (slots.length >= 10) { beErr('الحد الأقصى 10 سكريبتات في الحملة الواحدة'); return; }
  const i = _abSlotCounter++;
  const num = slots.length + 1;
  const div = document.createElement('div');
  div.className = 'ab-slot';
  div.id = 'ab-slot-' + i;
  div.style.cssText = 'background:rgba(var(--ar),.04);border:1px solid rgba(var(--ar),.1);border-radius:10px;padding:12px;margin-bottom:10px';
  div.innerHTML = `
    <div class="flex ic jb mb8">
      <span class="ab-label f11 fw6 ta" style="letter-spacing:0.5px">▸ سكريبت ${num}</span>
      ${num > 1 ? `<button class="btn bd bsm" style="padding:3px 9px" onclick="removeAbSlot('ab-slot-${i}')">🗑️</button>` : '<span></span>'}
    </div>
    <textarea class="fc ab-text" style="min-height:60px;margin-bottom:8px;resize:vertical" placeholder="اكتب نص الرسالة هنا...">${text ? String(text).replace(/</g,'&lt;') : ''}</textarea>
    <div class="flex gap6 ic">
      <input class="fc fi f11 ab-media" type="text" placeholder="لا يوجد مرفق لهذا السكريبت" readonly style="direction:ltr;font-size:10px;padding:6px 10px">
      <button class="btn bo bsm" style="padding:5px 8px" onclick="pickAbSlotMedia(this)" title="اختيار ملف">📎</button>
      <button class="btn bd bsm" style="padding:5px 8px" onclick="clearAbSlotMedia(this)" title="مسح المرفق">✕</button>
    </div>`;
  if (mediaPath) div.querySelector('.ab-media').value = mediaPath;
  container.appendChild(div);
}

function removeAbSlot(slotId) {
  const container = document.getElementById('ab-scripts-container');
  if (!container) return;
  if (container.querySelectorAll('.ab-slot').length <= 1) { beErr('يجب أن يكون هناك سكريبت واحد على الأقل'); return; }
  const slot = document.getElementById(slotId);
  if (slot) {
    slot.remove();
    // Renumber labels
    container.querySelectorAll('.ab-slot .ab-label').forEach((lbl, idx) => {
      lbl.textContent = `▸ سكريبت ${idx + 1}`;
    });
  }
}

async function pickAbSlotMedia(btn) {
  if (!IS_ELECTRON) { beOk('اختيار ملف متاح في النسخة الكاملة فقط'); return; }
  const slot  = btn.closest('.ab-slot');
  const input = slot?.querySelector('.ab-media');
  if (!input) return;
  const fp = await BE.openFile({ filters:[{ name: 'Media', extensions: ['jpg','jpeg','png','gif','mp4','pdf','doc','docx'] }] });
  if (fp) input.value = fp;
}

function clearAbSlotMedia(btn) {
  const slot  = btn.closest('.ab-slot');
  const input = slot?.querySelector('.ab-media');
  if (input) input.value = '';
}

function getAbScripts() {
  const scripts = [];
  document.querySelectorAll('#ab-scripts-container .ab-slot').forEach(slot => {
    const text      = (slot.querySelector('.ab-text')?.value  || '').trim();
    const mediaPath = (slot.querySelector('.ab-media')?.value || '').trim();
    if (text) scripts.push({ text, mediaPath: mediaPath || null });
  });
  return scripts;
}

// Account selection
function setAccMode(mode) {
  _accMode = mode;
  document.getElementById('acc-mode-auto')?.classList.toggle('active', mode === 'auto');
  document.getElementById('acc-mode-select')?.classList.toggle('active', mode === 'select');
  const list = document.getElementById('acc-check-list');
  if (list) list.style.display = mode === 'select' ? 'block' : 'none';
}

function refreshAccCheckList(sessions) {
  const list = document.getElementById('acc-check-list');
  if (!list) return;
  if (!sessions || !sessions.length) {
    list.innerHTML = '<div class="f11 ts" style="padding:10px;text-align:center;opacity:.6">لا توجد أجهزة متصلة حالياً</div>';
    return;
  }
  list.innerHTML = sessions.map(s => {
    const isReady = s.state === 'ready';
    const dot = isReady ? 'background:#22c55e' : 'background:#ef4444';
    return `<label class="flex ic gap8 mb6" style="cursor:pointer;padding:3px 0">
      <input type="checkbox" class="acc-check" value="${s.id}" ${isReady ? 'checked' : ''} style="accent-color:var(--acc);width:14px;height:14px;cursor:pointer">
      <span style="width:7px;height:7px;border-radius:50%;flex-shrink:0;${isReady ? 'background:#22c55e' : 'background:#ef4444'}"></span>
      <span class="f12 fi">${s.name}</span>
      <span class="f10 ts">${s.phone ? '+'+s.phone : ''}</span>
    </label>`;
  }).join('');
}

// A/B Results
async function loadAbResults() {
  openM('m-ab-results');
  const content = document.getElementById('ab-results-content');
  if (content) content.innerHTML = '<div style="padding:40px;text-align:center;opacity:.5"><span class="spinner"></span> جارٍ التحميل...</div>';

  if (!IS_ELECTRON) {
    renderAbResults({ campaigns: [] }); return;
  }
  const r = await BE.wa.ab.results();
  if (!r.ok) { if (content) content.innerHTML = `<div class="f12 ts" style="padding:24px">خطأ: ${r.error}</div>`; return; }
  renderAbResults(r.data);
}

function renderAbResults(data) {
  const content = document.getElementById('ab-results-content');
  if (!content) return;
  const campaigns = data.campaigns || [];
  if (!campaigns.length) {
    content.innerHTML = '<div style="padding:40px;text-align:center"><div style="font-size:40px;margin-bottom:12px;opacity:.3">📊</div><div class="f12 ts">لا توجد حملات A/B بعد<br>ابدأ حملة بسكريبتات متعددة لترى النتائج هنا</div></div>';
    return;
  }

  let html = '';
  for (const camp of campaigns) {
    html += `
    <div style="margin-bottom:18px;border:1px solid rgba(var(--ar),.1);border-radius:12px;overflow:hidden">
      <div class="flex ic jb" style="padding:12px 16px;background:rgba(var(--ar),.04);border-bottom:1px solid rgba(var(--ar),.08)">
        <div>
          <div class="fw7 f13">${esc(camp.name)}</div>
          <div class="f10 ts mt4">📤 ${camp.sent||0} مُرسَل  ❌ ${camp.failed||0} فاشل  📅 ${(camp.created_at||'').slice(0,10)}</div>
        </div>
        <button class="btn bo bsm" onclick="loadAbCampaignDetail('${camp.id}',this)">تفاصيل ▾</button>
      </div>
      <div class="ab-camp-detail" id="abd-${camp.id}" style="display:none;padding:14px"></div>
    </div>`;
  }
  content.innerHTML = html;
}

async function loadAbCampaignDetail(campaignId, btn) {
  const detDiv = document.getElementById('abd-' + campaignId);
  if (!detDiv) return;
  if (detDiv.style.display !== 'none') { detDiv.style.display = 'none'; btn.textContent = 'تفاصيل ▾'; return; }
  btn.textContent = '⏳';
  if (!IS_ELECTRON) { detDiv.innerHTML = '<div class="f11 ts" style="padding:12px">متاح في النسخة الكاملة فقط</div>'; detDiv.style.display = ''; btn.textContent = 'إغلاق ▴'; return; }

  const r = await BE.wa.ab.results(campaignId);
  if (!r.ok) { detDiv.innerHTML = `<div class="f11 ts">${r.error}</div>`; detDiv.style.display = ''; btn.textContent = 'إغلاق ▴'; return; }

  const scripts = r.data.scripts || [];
  if (!scripts.length) { detDiv.innerHTML = '<div class="f11 ts" style="padding:8px;text-align:center">لا توجد بيانات سكريبتات لهذه الحملة</div>'; detDiv.style.display = ''; btn.textContent = 'إغلاق ▴'; return; }

  // Find winner (highest reply rate)
  const maxReplied = Math.max(...scripts.map(s => s.replied_count || 0));
  const totalSent  = scripts.reduce((a, s) => a + (s.sent_count || 0), 0) || 1;

  let html = '';
  for (const s of scripts) {
    const sent    = s.sent_count    || 0;
    const failed  = s.failed_count  || 0;
    const replied = s.replied_count || 0;
    const pct     = totalSent > 0 ? Math.round(sent / totalSent * 100) : 0;
    const repRate = sent > 0 ? ((replied / sent) * 100).toFixed(1) : '0.0';
    const isWinner = maxReplied > 0 && replied === maxReplied;
    html += `
    <div style="margin-bottom:14px;padding:12px;background:rgba(var(--ar),.03);border:1px solid rgba(var(--ar),${isWinner ? '.35' : '.07'});border-radius:10px">
      <div class="flex ic jb mb8">
        <span class="fw7 f12 ta" style="font-size:10px">سكريبت ${s.script_index + 1}</span>
        ${isWinner ? '<span class="bge bg-g f10">🏆 الأعلى استجابة</span>' : ''}
      </div>
      <div class="f12 mb10" style="color:var(--tx);line-height:1.6;background:rgba(0,0,0,.2);border-radius:7px;padding:8px 10px;max-height:60px;overflow:hidden">${esc((s.script_text||'').slice(0,120))}${(s.script_text||'').length > 120 ? '...' : ''}</div>
      <div class="pb mb8"><div class="pf" style="width:${pct}%"></div></div>
      <div class="flex gap16 f11" style="color:var(--ts)">
        <span>📤 <b class="ta">${sent}</b> مُرسَل</span>
        <span>❌ <b style="color:#ef4444">${failed}</b> فاشل</span>
        <span>💬 <b class="ta">${replied}</b> ردّ</span>
        <span class="fi"></span>
        <span class="fw7 ta" style="font-size:11px">${repRate}% استجابة</span>
      </div>
    </div>`;
  }
  detDiv.innerHTML = html;
  detDiv.style.display = '';
  btn.textContent = 'إغلاق ▴';
}

async function generateEngineVariants() {
  if (!IS_ELECTRON) {
    const demos = ['أهلاً! عرض حصري لك اليوم 🎉','مرحباً! لا تفوت هذا العرض المميز 🔥','السلام عليكم! فرصة ذهبية بانتظارك ⚡','تسوق الآن واحصل على أفضل الأسعار 🛍️','نحن هنا لخدمتك — عروض لا تُفوَّت ✨'];
    const container = document.getElementById('ab-scripts-container');
    if (!container) return;
    container.querySelectorAll('.ab-slot .ab-text').forEach((ta, i) => { if (demos[i]) ta.value = demos[i]; });
    beOk('تم التوليد (وضع العرض)'); return;
  }
  showN('AI', 'جارٍ توليد 5 نسخ بالذكاء الاصطناعي...', '🤖');
  const firstText = document.querySelector('#ab-scripts-container .ab-text')?.value?.slice(0,100) || 'منتجاتنا';
  const r = await BE.ai.generateVariants({ type:'promotional', product: firstText, audience:'عملاء واتساب', tone:'friendly', language:'ar' });
  if (!r.ok) { beErr(r.error); return; }
  const variants = r.data.variants || [];
  const container = document.getElementById('ab-scripts-container');
  if (!container) return;
  const slots = container.querySelectorAll('.ab-slot');
  variants.forEach((text, i) => {
    if (i < slots.length) {
      slots[i].querySelector('.ab-text').value = text;
    } else if (slots.length + (i - slots.length + 1) <= 10) {
      addAbScript(text);
    }
  });
  beOk(`✅ تم توليد ${variants.length} سكريبت بالـ AI`);
}

async function startBulkSend() {
  const raw = document.getElementById('eng-recipients').value;
  const recipients = raw.split(/[\n,]+/).map(s => {
    s = s.trim();
    if (s.includes('@')) return s;           // group JID or contact JID — keep as-is
    return s.replace(/\D/g, '');             // phone number — strip to digits
  }).filter(s => s.length >= 7);

  if (!recipients.length) { beErr('أدخل أرقام المستهدفين أولاً'); return; }

  // Collect scripts from dynamic A/B slots
  const scripts_data = getAbScripts();
  if (!scripts_data.length || !scripts_data[0].text) {
    beErr('أدخل نص الرسالة الأولى على الأقل'); return;
  }

  // Determine allowed sessions based on account mode
  let allowedSessions = null;
  if (_accMode === 'select') {
    const checked = [...document.querySelectorAll('#acc-check-list input.acc-check:checked')];
    allowedSessions = checked.map(cb => cb.value).filter(Boolean);
    if (!allowedSessions.length) { beErr('اختر حساباً واحداً على الأقل'); return; }
  }

  const delayMin = parseInt(document.getElementById('eng-delay-min').value, 10) * 1000;
  const delayMax = parseInt(document.getElementById('eng-delay-max').value, 10) * 1000;
  const globalMedia = (document.getElementById('eng-media-path')?.value || '').trim();
  const name = document.getElementById('eng-name').value.trim() || 'حملة ' + new Date().toLocaleDateString('ar');

  if (!IS_ELECTRON) {
    beOk(`تم إضافة ${recipients.length} رسالة للقائمة (وضع العرض)`);
    document.getElementById('eng-progress-card').style.display = 'block';
    return;
  }

  const r = await BE.wa.send.bulk({
    recipients,
    scripts_data,
    campaignName: name,
    allowedSessions,
    mediaPath: globalMedia || null,
    delayMin,
    delayMax,
  });

  if (r.ok) {
    beOk(`✅ تم إضافة ${recipients.length} رسالة للقائمة — الإرسال جارٍ`);
    document.getElementById('eng-progress-card').style.display = 'block';
    setTimeout(loadEngineStats, 2000);
  } else {
    beErr(r.error);
  }
}

// Auto-refresh engine stats every 8 seconds when on engine page
setInterval(() => {
  if (document.getElementById('p-engine')) loadEngineStats();
}, 8000);

// ═══════════════════════════════════════════════════════════════════════════
// INBOX — incoming messages
// ═══════════════════════════════════════════════════════════════════════════

let _inboxTab = 'all';

function switchInboxTab(tab) {
  _inboxTab = tab;
  ['all','unreplied','replied'].forEach(t => {
    const btn = document.getElementById('inbox-tab-'+t);
    if (!btn) return;
    const active = t === tab;
    btn.style.borderBottomColor = active ? 'var(--hp)' : 'transparent';
    btn.style.color = active ? 'var(--hp)' : 'var(--ts)';
  });
  loadInbox();
}

function bodyText(m) {
  if (m.body) return m.body;
  const t = m.msg_type || '';
  if (t==='image')              return '[صورة 🖼️]';
  if (t==='audio' || t==='ptt') return '[مقطع صوتي 🎵]';
  if (t==='video')              return '[فيديو 🎥]';
  if (t==='document')           return '[ملف 📎]';
  if (t==='sticker')            return '[ملصق 🎭]';
  if (t==='location')           return '[موقع 📍]';
  return '[رسالة وسائط 📎]';
}

async function loadInbox() {
  const sessionId = document.getElementById('inbox-filter')?.value || '';
  if (!IS_ELECTRON) return;

  const filter = _inboxTab === 'all' ? null : _inboxTab;
  const [msgR, unreadR, unrepliedR] = await Promise.all([
    BE.wa.inbox.list({ sessionId: sessionId || null, filter, limit: 300 }),
    BE.wa.inbox.unread(sessionId || null),
    BE.wa.inbox.unreplied(sessionId || null),
  ]);

  const msgs      = msgR.ok      ? msgR.data      : [];
  const unread    = unreadR.ok   ? unreadR.data   : 0;
  const unreplied = unrepliedR.ok ? unrepliedR.data : 0;

  document.getElementById('inbox-unread').textContent          = unread;
  document.getElementById('inbox-unreplied-count').textContent = unreplied;
  document.getElementById('inbox-total-count').textContent     = msgs.length + ' إجمالي';

  const badge = document.getElementById('nb-inbox');
  if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? '' : 'none'; }

  const tbody = document.getElementById('inbox-tbody');
  if (!tbody) return;

  tbody.innerHTML = msgs.length ? msgs.map(m => {
    const bodySnippet  = esc(bodyText(m).slice(0,100));
    const sessionLabel = esc(m.session_name || m.session_id || '').slice(0,16);
    // جروب → اسم الجروب + badge؛  فردي → اسم جهة الاتصال أو الرقم
    const fromName = m.is_group
      ? `<span class="bge bg-b f11">جروب</span> ${esc(m.group_name || m.from_number || '—')}`
      : esc(m.contact_name ? m.contact_name : ('+' + (m.from_number || '')));
    const statusBadge = m.replied
      ? '<span class="bge bg-g f11">تم الرد</span>'
      : (m.read ? '<span class="bge f11">مقروء</span>' : '<span class="bge bg-y f11">جديد</span>');
    const phone = esc(m.from_number||'');
    const actions = [
      !m.read ? `<button class="btn bo bsm" onclick="markMsgRead('${m.id}',this)" title="تحديد كمقروء">✔</button>` : '',
      `<button class="btn bp bsm" onclick="openReplyModal('${m.id}','${phone}','${bodySnippet.replace(/'/g,'')}','${sessionLabel}')" title="رد">↩️ رد</button>`,
      `<button class="btn bo bsm" onclick="openConversation('${phone}')" title="عرض المحادثة">💬</button>`,
    ].join(' ');
    return `<tr style="${!m.read ? 'background:rgba(var(--ar),.04)' : ''}">
      <td class="f11 ts" style="white-space:nowrap">${sessionLabel}</td>
      <td class="f11">${fromName}</td>
      <td style="max-width:260px;word-break:break-word">${bodySnippet}${bodyText(m).length>100?'…':''}</td>
      <td class="f11 ts" style="white-space:nowrap">${m.received_at ? m.received_at.slice(0,16) : '—'}</td>
      <td>${statusBadge}</td>
      <td style="white-space:nowrap">${actions}</td>
    </tr>`;
  }).join('')
  : '<tr><td colspan="6" style="text-align:center;padding:32px;opacity:.5">لا توجد رسائل</td></tr>';

  // Populate session filter dropdown if empty
  const filterSel = document.getElementById('inbox-filter');
  if (filterSel && filterSel.options.length <= 1) {
    const sessR = await BE.wa.sessions.list();
    if (sessR.ok) {
      sessR.data.forEach(s => {
        if (!filterSel.querySelector(`option[value="${s.id}"]`)) {
          const o = document.createElement('option');
          o.value = s.id; o.textContent = '📱 ' + (s.name || s.id);
          filterSel.appendChild(o);
        }
      });
    }
  }
}

async function markMsgRead(id, btn) {
  if (!IS_ELECTRON) return;
  await BE.wa.inbox.markRead(id);
  if (btn) btn.closest('tr').style.background = '';
  loadInbox();
}

async function markAllRead() {
  if (!IS_ELECTRON) return;
  const r = await BE.wa.inbox.list({ sessionId: null, filter: null, limit: 1000 });
  if (!r.ok) return;
  await Promise.all(r.data.filter(m=>!m.read).map(m => BE.wa.inbox.markRead(m.id)));
  beOk('تم تحديد الكل كمقروء');
  loadInbox();
}

// ── Reply modal ────────────────────────────────────────────────────────────
let _replyMsgId = null;

async function openReplyModal(msgId, fromNumber, origBody, sessionLabel) {
  _replyMsgId = msgId;
  document.getElementById('reply-from-info').textContent = 'من: +' + fromNumber + (sessionLabel ? '  —  جلسة: ' + sessionLabel : '');
  document.getElementById('reply-orig-body').textContent = origBody || '—';
  document.getElementById('reply-body-input').value = '';

  // Populate session selector
  const sel = document.getElementById('reply-session-sel');
  sel.innerHTML = '<option value="">اختر جلسة...</option>';
  if (IS_ELECTRON) {
    const r = await BE.wa.sessions.list();
    if (r.ok) r.data.filter(s=>s.state==='ready').forEach(s => {
      const o = document.createElement('option'); o.value = s.id;
      o.textContent = '📱 ' + (s.name||s.id); sel.appendChild(o);
    });
  }
  openM('m-inbox-reply');
  setTimeout(() => document.getElementById('reply-body-input').focus(), 120);
}

async function sendInboxReply() {
  if (!IS_ELECTRON || !_replyMsgId) return;
  const replyBody = document.getElementById('reply-body-input').value.trim();
  const sessionId = document.getElementById('reply-session-sel').value;
  if (!replyBody) { beErr('اكتب نص الرد'); return; }

  const btn = document.getElementById('btn-send-reply');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإرسال...'; }

  try {
    const r = await BE.wa.inbox.reply({ id: _replyMsgId, replyBody, sessionId: sessionId || undefined });
    if (r && r.ok) {
      beOk('تم إرسال الرد بنجاح');
      closeM('m-inbox-reply');
      _replyMsgId = null;
      loadInbox();
    } else {
      beErr((r && r.error) || 'فشل الإرسال');
    }
  } catch(e) {
    beErr(e.message || 'خطأ في الإرسال');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '↩️ إرسال الرد'; }
  }
}

// ── Utility ────────────────────────────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Page init functions (called by nav() after dynamic load) ─────────────
window._pg_dashboard = () => { loadDashboard(); };
window._pg_accounts  = () => {
  loadAccounts();
  document.querySelector('.md-cl .btn.bp')?.addEventListener('click', saveAccount);
};
window._pg_contacts  = () => { loadContacts(); };
window._pg_groups    = () => { loadGroupsPage(); };
window._pg_campaigns = () => { loadCampaigns(); };
window._pg_scheduler = () => { loadScheduler(); };
window._pg_templates = () => { loadTemplates(); };
window._pg_ai        = () => {
  loadAiSettings();
  document.getElementById('ai-input')?.addEventListener('keypress', e => { if(e.key==='Enter') sendAI(); });
};
window._pg_crm       = () => { loadCRM(); };
window._pg_reports   = () => { loadReportStats(); loadReports(); };
window._pg_settings  = () => { loadSettings(); };
window._pg_devices   = () => { loadDevices(); };
window._pg_engine    = () => { loadDevices(); loadEngineStats(); _ensureAbInit(); };
window._pg_inbox     = () => { loadInbox(); };
window._pg_antiban   = () => { loadAntiBan(); };
window._pg_media     = () => { loadMedia(); };

// ── Boot: load engine status in header immediately ───────────────────────
if (IS_ELECTRON) {
  loadEngineStatus();
  loadDashboard();
}

// ── Groups / Scraper ──────────────────────────────────────────────────────

let _groupsData = []; // cached after scrape

async function loadGroupsPage() {
  // Populate session dropdown with ready sessions
  const sel = document.getElementById('groups-session-sel');
  const prev = sel.value;
  sel.innerHTML = '<option value="">اختر جلسة...</option>';
  if (IS_ELECTRON) {
    const r = await BE.wa.sessions.list();
    if (r.ok) {
      r.data.filter(s => s.state === 'ready' || s.active).forEach(s => {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = s.name || s.id;
        sel.appendChild(o);
      });
      if (prev) sel.value = prev;
    }
  }
  renderGroupsTable(_groupsData);
}

function renderGroupsTable(groups) {
  const tbody = document.getElementById('groups-tbody');
  document.getElementById('groups-count').textContent = groups.length;
  document.getElementById('groups-subtitle').textContent =
    groups.length ? `${groups.length} مجموعة` : 'سحب بيانات المجموعات من WhatsApp';

  if (!groups.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="ta f12 ts" style="padding:32px">لا توجد مجموعات — اختر جلسة واضغط "سحب المجموعات"</td></tr>';
    return;
  }

  tbody.innerHTML = groups.map(g => {
    const gid     = escH(g.id || '');
    const name    = escH(g.name || g.id || '');
    const members = g.member_count || g.participantsCount || 0;
    const synced  = g.synced_at ? new Date(g.synced_at).toLocaleString('ar') : '—';
    const link    = g.invite_link
      ? `<a href="#" onclick="copyText('${escH(g.invite_link)}');return false" class="bge bg-g f11">نسخ الرابط</a>`
      : `<button class="btn bo bsm" onclick="getGroupInviteLink('${gid}')">🔗 جلب</button>`;
    const chk = _groupsSelected.has(g.id) ? 'checked' : '';

    return `<tr>
      <td><input type="checkbox" class="grp-row-chk" ${chk} onchange="toggleGroupSelect('${gid}',this.checked)"></td>
      <td><b>${name}</b></td>
      <td class="fm f11" style="color:var(--tm);max-width:160px;overflow:hidden;text-overflow:ellipsis">${gid}</td>
      <td class="ta fm">${members}</td>
      <td class="f11 ts">${synced}</td>
      <td>${link}</td>
      <td>
        <div class="flex gap6">
          <button class="btn bp bsm" title="إرسال رسالة للمجموعة عبر Web" onclick="openSendToGroup('${gid}','${name}')">📤</button>
          <button class="btn bo bsm" title="سحب الأعضاء وتحميلهم في محرك الإرسال" onclick="loadSingleGroupToEngine('${gid}')">📲</button>
          <button class="btn bo bsm" title="سحب الأعضاء" onclick="getGroupParticipants('${gid}','${name}')">👥</button>
          <button class="btn bo bsm" title="تصدير الأعضاء Excel" onclick="exportParticipantsExcel('${gid}','${name}')">📊</button>
          <button class="btn bp bsm" title="إدارة الأعضاء" onclick="openMembersMgr('${gid}','${name}')">⚙️</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function filterGroupsTable(q) {
  const term = (q || '').trim().toLowerCase();
  const filtered = term
    ? _groupsData.filter(g => (g.name||'').toLowerCase().includes(term) || (g.id||'').toLowerCase().includes(term))
    : _groupsData;
  // Re-render table rows only (don't reset count or subtitle)
  const tbody = document.getElementById('groups-tbody');
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="ta f12 ts" style="padding:24px">لا توجد نتائج للبحث عن "${escH(q)}"</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(g => {
    const gid     = escH(g.id || '');
    const name    = escH(g.name || g.id || '');
    const members = g.member_count || g.participantsCount || 0;
    const synced  = g.synced_at ? new Date(g.synced_at).toLocaleString('ar') : '—';
    const link    = g.invite_link
      ? `<a href="#" onclick="copyText('${escH(g.invite_link)}');return false" class="bge bg-g f11">نسخ الرابط</a>`
      : `<button class="btn bo bsm" onclick="getGroupInviteLink('${gid}')">🔗 جلب</button>`;
    const chk = _groupsSelected.has(g.id) ? 'checked' : '';
    return `<tr>
      <td><input type="checkbox" class="grp-row-chk" ${chk} onchange="toggleGroupSelect('${gid}',this.checked)"></td>
      <td><b>${name}</b></td>
      <td class="fm f11" style="color:var(--tm);max-width:160px;overflow:hidden;text-overflow:ellipsis">${gid}</td>
      <td class="ta fm">${members}</td>
      <td class="f11 ts">${synced}</td>
      <td>${link}</td>
      <td><div class="flex gap6">
        <button class="btn bp bsm" title="إرسال رسالة للمجموعة عبر Web" onclick="openSendToGroup('${gid}','${name}')">📤</button>
        <button class="btn bo bsm" title="سحب الأعضاء وتحميلهم في محرك الإرسال" onclick="loadSingleGroupToEngine('${gid}')">📲</button>
        <button class="btn bo bsm" title="سحب الأعضاء" onclick="getGroupParticipants('${gid}','${name}')">👥</button>
        <button class="btn bo bsm" title="تصدير الأعضاء Excel" onclick="exportParticipantsExcel('${gid}','${name}')">📊</button>
        <button class="btn bp bsm" title="إدارة الأعضاء" onclick="openMembersMgr('${gid}','${name}')">⚙️</button>
      </div></td>
    </tr>`;
  }).join('');
}

function escH(str) {
  return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function copyText(txt) {
  navigator.clipboard.writeText(txt).then(() => showN('تم النسخ', txt, '📋'));
}

async function scrapeGroups() {
  const sessionId = document.getElementById('groups-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة أولاً'); return; }

  const btn = document.getElementById('btn-scrape-groups');
  const prog = document.getElementById('groups-progress');
  const progBar = document.getElementById('groups-progress-bar');
  const progTxt = document.getElementById('groups-progress-text');

  btn.disabled = true;
  btn.textContent = '⏳ جارٍ السحب...';
  prog.style.display = 'block';
  progBar.style.width = '30%';
  progTxt.textContent = 'جارٍ جلب المجموعات من WhatsApp...';
  GP.show('جارٍ سحب المجموعات من WhatsApp...', 20, 'اتصال');

  try {
    GP.update('جارٍ معالجة بيانات المجموعات...', 55, 'معالجة');
    const r = await BE.wa.scraper.getGroups(sessionId);
    if (!r.ok) throw new Error(r.error || 'فشل السحب');

    _groupsData = r.data;
    progBar.style.width = '100%';
    const srch = document.getElementById('grp-search');
    if (srch) srch.value = '';
    renderGroupsTable(r.data);
    if (r.data.length === 0) {
      progTxt.textContent = '⚠️ لم يتم العثور على مجموعات';
      GP.hide();
      beErr('لم يتم العثور على مجموعات — تأكد أن الجلسة نشطة وأن الحساب عضو في مجموعات');
    } else {
      progTxt.textContent = `✅ تم سحب ${r.data.length} مجموعة`;
      GP.done(`تم سحب ${r.data.length} مجموعة بنجاح`);
      beOk(`تم سحب ${r.data.length} مجموعة بنجاح`);
    }
  } catch (e) {
    GP.hide();
    beErr('فشل سحب المجموعات: ' + e.message);
    progTxt.textContent = '❌ ' + e.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔍 سحب المجموعات';
    setTimeout(() => { prog.style.display = 'none'; progBar.style.width = '0%'; }, 4000);
  }
}

// ══ DIAGNOSTIC ══════════════════════════════════════════════════════════════
async function runScrapingDiagnosis() {
  const sessionId = document.getElementById('groups-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة أولاً ثم اضغط تشخيص'); return; }
  if (!IS_ELECTRON) return;

  showN('جارٍ التشخيص...', 'فحص متجر المحادثات في WhatsApp Web', '🩺');

  try {
    const r = await BE.wa.scraper.diagnose(sessionId);
    if (!r.ok) {
      beErr('فشل التشخيص: ' + (r.error || 'خطأ غير معروف'));
      return;
    }

    const d = r.data || r;
    const lines = [
      `📊 إجمالي المحادثات في الذاكرة: ${d.totalInStore}`,
      `📁 مجموعات: ${d.groups}`,
      `👤 محادثات فردية: ${d.contacts}`,
      d.error ? `❌ خطأ: ${d.error}` : '✅ المتجر يعمل بشكل صحيح',
      d.storeKeys ? `🔑 مفاتيح المتجر: ${d.storeKeys}` : '',
      d.sample && d.sample.length ? `عينة مجموعات: ${d.sample.map(g => g.name || g.id).join(' | ')}` : 'لا توجد مجموعات في الذاكرة حالياً',
    ].filter(Boolean).join('\n');

    alert(`🩺 تقرير تشخيص سحب المجموعات\n\n${lines}\n\n${d.totalInStore < 10 ? '⚠️ الذاكرة فارغة تقريباً — جرّب زر "سحب المجموعات" الذي سيفعّل تحميل تلقائي للجروبات عبر واجهة واتساب' : d.groups > 5 ? '✅ المتجر يحتوي بيانات — جرّب السحب الآن' : '⚠️ عدد قليل من المجموعات — قد تحتاج انتظار تزامن أكثر'}`);
  } catch (e) {
    beErr('خطأ في التشخيص: ' + e.message);
  }
}
// ════════════════════════════════════════════════════════════════════════════

async function scrapeContacts() {
  const sessionId = document.getElementById('groups-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة أولاً'); return; }

  const btn = document.getElementById('btn-scrape-contacts');
  btn.disabled = true;
  btn.textContent = '⏳ جارٍ السحب...';
  GP.show('جارٍ سحب جهات الاتصال من WhatsApp...', 20, 'جلب');

  try {
    const r = await BE.wa.scraper.getContacts(sessionId);
    if (!r.ok) throw new Error(r.error || 'فشل السحب');
    const count = r.data?.length || 0;
    GP.done(`تم سحب ${count} جهة اتصال`);
    beOk(`✅ تم سحب ${count} جهة اتصال`);

    // Refresh contacts page data
    const cr = await BE.contacts.list({});
    if (cr.ok) {
      _allContacts = cr.data;
      if (document.getElementById('pg-contacts')?.style.display !== 'none') {
        renderContactsTable(_allContacts);
      }
    }

    // Offer Excel export
    if (count > 0) {
      setTimeout(async () => {
        const ex = await BE.wa.scraper.exportContacts(sessionId);
        if (ex.ok && ex.data?.path) {
          beOk(`📊 تم تصدير ${ex.data.count} جهة اتصال إلى Excel`);
        }
      }, 500);
    }
  } catch (e) {
    GP.hide();
    beErr('فشل سحب جهات الاتصال: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '👤 سحب جهات الاتصال';
  }
}

async function getGroupParticipants(groupId, groupName) {
  const sessionId = document.getElementById('groups-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة أولاً'); return; }

  showN('جارٍ السحب', `جلب أعضاء ${groupName}...`, '👥');
  try {
    const r = await BE.wa.scraper.getParticipants({ sessionId, groupId });
    if (!r.ok) throw new Error(r.error);
    beOk(`تم سحب ${r.data.length} عضو من "${groupName}"`);
    // Update member count in cached data
    const g = _groupsData.find(x => x.id === groupId);
    if (g) { g.member_count = r.data.length; renderGroupsTable(_groupsData); }
  } catch (e) {
    beErr('فشل: ' + e.message);
  }
}

async function getGroupInviteLink(groupId) {
  const sessionId = document.getElementById('groups-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة أولاً'); return; }

  try {
    const r = await BE.wa.scraper.getInviteLink({ sessionId, groupId });
    if (!r.ok) throw new Error(r.error);
    const g = _groupsData.find(x => x.id === groupId);
    if (g) { g.invite_link = r.data; renderGroupsTable(_groupsData); }
    copyText(r.data);
    beOk('تم جلب الرابط ونسخه');
  } catch (e) {
    beErr('فشل جلب الرابط: ' + e.message);
  }
}

async function exportParticipantsExcel(groupId, groupName) {
  const sessionId = document.getElementById('groups-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة أولاً'); return; }

  try {
    const r = await BE.wa.scraper.exportParticipants({ sessionId, groupId, groupName });
    if (!r.ok) throw new Error(r.error);
    beOk(`تم تصدير ${r.data.count} عضو → ${r.data.path}`);
  } catch (e) {
    beErr('فشل التصدير: ' + e.message);
  }
}

async function exportGroupsExcel() {
  const sessionId = document.getElementById('groups-session-sel').value;
  try {
    const r = await BE.wa.scraper.exportGroups(sessionId || null);
    if (!r.ok) throw new Error(r.error);
    beOk(`تم تصدير ${r.data.count} مجموعة → ${r.data.path}`);
  } catch (e) {
    beErr('فشل التصدير: ' + e.message);
  }
}

// ── GROUP SELECTION & BULK ACTIONS ───────────────────────────────────────

let _groupsSelected = new Set();

function toggleGroupSelect(id, checked) {
  if (checked) _groupsSelected.add(id);
  else         _groupsSelected.delete(id);
  updateGroupsBulkBar();
  const all = document.getElementById('grp-chk-all');
  if (all) {
    const total = _groupsData.length;
    all.checked       = _groupsSelected.size === total && total > 0;
    all.indeterminate = _groupsSelected.size > 0 && _groupsSelected.size < total;
  }
}

function toggleAllGroups(cb) {
  _groupsSelected.clear();
  if (cb.checked) _groupsData.forEach(g => _groupsSelected.add(g.id));
  document.querySelectorAll('.grp-row-chk').forEach(c => { c.checked = cb.checked; });
  updateGroupsBulkBar();
}

function updateGroupsBulkBar() {
  const bar = document.getElementById('grp-bulk-bar');
  const cnt = document.getElementById('grp-sel-count');
  const n   = _groupsSelected.size;
  if (bar) bar.style.display = n > 0 ? 'flex' : 'none';
  if (cnt) cnt.textContent   = n;
}

function clearGroupSelection() {
  _groupsSelected.clear();
  document.querySelectorAll('.grp-row-chk').forEach(c => { c.checked = false; });
  const all = document.getElementById('grp-chk-all');
  if (all) { all.checked = false; all.indeterminate = false; }
  updateGroupsBulkBar();
}

async function bulkGetInviteLinks() {
  if (!IS_ELECTRON) return;
  const sessionId = document.getElementById('groups-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة أولاً'); return; }
  const ids = [..._groupsSelected];
  if (!ids.length) return;
  GP.show(`جلب روابط الدعوة...`, 0, `0/${ids.length}`);
  let done = 0;
  for (const id of ids) {
    try {
      const r = await BE.wa.scraper.getInviteLink({ sessionId, groupId: id });
      if (r.ok) { const g = _groupsData.find(x => x.id === id); if (g) { g.invite_link = r.data; done++; } }
    } catch (_) {}
    GP.step(`جلب رابط الدعوة...`, done + 1, ids.length, `${done+1}/${ids.length}`);
  }
  renderGroupsTable(_groupsData);
  GP.done(`تم جلب ${done} رابط دعوة`);
  beOk(`تم جلب ${done} رابط دعوة`);
}

async function bulkExportSelected() {
  const selected = _groupsData.filter(g => _groupsSelected.has(g.id));
  if (!selected.length) { beErr('لم تحدد أي مجموعات'); return; }
  if (!IS_ELECTRON) { beOk(`تصدير ${selected.length} مجموعة (وضع العرض)`); return; }

  // Auto-fetch invite links for groups that don't have them yet
  const sessionId = document.getElementById('groups-session-sel').value;
  const missing   = selected.filter(g => !g.invite_link);
  if (missing.length && sessionId) {
    GP.show(`جلب روابط الدعوة قبل التصدير...`, 5, `0/${missing.length}`);
    let mi = 0;
    for (const g of missing) {
      try {
        const r = await BE.wa.scraper.getInviteLink({ sessionId, groupId: g.id });
        if (r.ok) {
          g.invite_link = r.data;
          const stored = _groupsData.find(x => x.id === g.id);
          if (stored) stored.invite_link = r.data;
        }
      } catch (_) {}
      mi++;
      GP.step('جلب روابط الدعوة...', mi, missing.length, `${mi}/${missing.length}`);
    }
  }

  GP.update('جارٍ إنشاء ملف Excel...', 90, 'تصدير');
  try {
    const r = await BE.wa.groups.exportList(selected);
    if (r.ok) { GP.done(`تم تصدير ${r.data.count} مجموعة`); beOk(`✅ تم تصدير ${r.data.count} مجموعة → ${r.data.path}`); }
    else { GP.hide(); beErr(r.error); }
  } catch (e) { GP.hide(); beErr(e.message); }
}

// ═══════════════════════════════════════════════════════════════════════════
// SEND TO GROUP VIA WEB ENGINE
// ═══════════════════════════════════════════════════════════════════════════

let _sendToGroupTargets = [];

async function _populateSendToGroupSessions() {
  const sel = document.getElementById('stg-session');
  sel.innerHTML = '<option value="">اختر جهاز Web...</option>';
  if (!IS_ELECTRON) return;
  const r = await BE.wa.sessions.list();
  if (r.ok) {
    (r.data || []).filter(s => s.status === 'ready').forEach(s => {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = `📱 ${s.name || s.id}${s.phone ? ' (+' + s.phone + ')' : ''}`;
      sel.appendChild(o);
    });
    // Pre-select the session chosen in the groups page
    const pageSession = document.getElementById('groups-session-sel')?.value;
    if (pageSession) sel.value = pageSession;
  }
}

async function openSendToGroup(groupId, groupName) {
  _sendToGroupTargets = [groupId];
  document.getElementById('stg-target-info').textContent =
    `المجموعة: ${groupName || groupId}`;
  await _populateSendToGroupSessions();
  openM('m-send-to-group');
}

async function openSendToGroupBulk() {
  if (_groupsSelected.size === 0) { beErr('اختر مجموعة واحدة على الأقل'); return; }
  _sendToGroupTargets = Array.from(_groupsSelected);
  document.getElementById('stg-target-info').textContent =
    `${_sendToGroupTargets.length} مجموعة محددة`;
  await _populateSendToGroupSessions();
  openM('m-send-to-group');
}

async function sendToGroupConfirm() {
  const sessionId = document.getElementById('stg-session').value;
  const body      = document.getElementById('stg-body').value.trim();
  const delayMin  = parseInt(document.getElementById('stg-delay-min').value, 10) * 1000;
  const delayMax  = parseInt(document.getElementById('stg-delay-max').value, 10) * 1000;

  if (!sessionId) { beErr('اختر جهاز Web أولاً'); return; }
  if (!body)      { beErr('أدخل نص الرسالة'); return; }
  if (!_sendToGroupTargets.length) { beErr('لا توجد مجموعات محددة'); return; }

  closeM('m-send-to-group');

  const r = await BE.wa.send.bulk({
    recipients:   _sendToGroupTargets,
    scripts:      [body],
    sessionId,
    delayMin,
    delayMax,
    campaignName: `إرسال للمجموعات — ${new Date().toLocaleDateString('ar')}`,
  });

  if (r.ok) {
    beOk(`✅ تم إضافة ${_sendToGroupTargets.length} مجموعة للقائمة — الإرسال جارٍ`);
    nav('engine');
    setTimeout(loadEngineStats, 2000);
  } else {
    beErr('فشل الإرسال: ' + (r.error || 'خطأ غير معروف'));
  }
}

// Load a single group's members into the send engine
async function loadSingleGroupToEngine(groupId) {
  const sessionId = document.getElementById('groups-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة Web في أعلى الصفحة أولاً'); return; }
  if (!IS_ELECTRON) return;

  GP.show('جارٍ جلب أعضاء المجموعة...', 30, 'جلب');
  try {
    const r = await BE.wa.scraper.getParticipants({ sessionId, groupId });
    if (!r.ok) throw new Error(r.error);
    const phones = (r.data || []).map(p => p.phone).filter(Boolean);
    if (!phones.length) { GP.hide(); beErr('لم يتم العثور على أعضاء'); return; }
    document.getElementById('eng-recipients').value = phones.join('\n');
    document.getElementById('eng-session').value    = sessionId;
    countEngineTargets();
    GP.done(`تم تحميل ${phones.length} عضو`);
    nav('engine');
    beOk(`✅ تم تحميل ${phones.length} عضو في محرك الإرسال`);
  } catch (e) {
    GP.hide();
    beErr('فشل جلب الأعضاء: ' + e.message);
  }
}

// Load members from ALL selected groups into the send engine
async function loadGroupMembersToEngine() {
  if (_groupsSelected.size === 0) { beErr('اختر مجموعة على الأقل'); return; }
  const sessionId = document.getElementById('groups-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة Web في أعلى الصفحة أولاً'); return; }
  if (!IS_ELECTRON) return;

  const groupIds  = Array.from(_groupsSelected);
  const allPhones = new Set();

  GP.show(`جارٍ جلب أعضاء ${groupIds.length} مجموعة...`, 0, '0/' + groupIds.length);

  for (let i = 0; i < groupIds.length; i++) {
    try {
      const r = await BE.wa.scraper.getParticipants({ sessionId, groupId: groupIds[i] });
      if (r.ok && r.data) r.data.forEach(p => { if (p.phone) allPhones.add(p.phone); });
    } catch (_) {}
    GP.step('جلب الأعضاء...', i + 1, groupIds.length, `${i + 1}/${groupIds.length}`);
  }

  if (!allPhones.size) {
    GP.hide();
    beErr('لم يتم العثور على أعضاء — تأكد أن الجلسة متصلة وأنك عضو في هذه المجموعات');
    return;
  }

  document.getElementById('eng-recipients').value = Array.from(allPhones).join('\n');
  document.getElementById('eng-session').value    = sessionId;
  countEngineTargets();
  GP.done(`تم تحميل ${allPhones.size} عضو من ${groupIds.length} مجموعة`);
  nav('engine');
  beOk(`✅ ${allPhones.size} عضو فريد من ${groupIds.length} مجموعة — جاهز للإرسال`);
}

// ── MEMBER MANAGEMENT MODAL ───────────────────────────────────────────────

let _mmGroups = [];
let _mmAction = 'add';
let _mmMethod = 'manual';
let _mmExcelPhones = null;

function openMembersMgr(groupId, groupName) {
  _mmGroups = [{ id: groupId, name: groupName }];
  _mmAction = 'add';
  _initMembersModal();
  openM('m-group-members');
}

function openMembersMgrBulk(action) {
  if (!IS_ELECTRON) { beErr('هذه الميزة تتطلب جلسة WhatsApp Web نشطة'); return; }
  _mmGroups = [..._groupsSelected].map(id => {
    const g = _groupsData.find(x => x.id === id);
    return { id, name: g?.name || id };
  });
  if (!_mmGroups.length) { beErr('حدد مجموعات أولاً'); return; }
  _mmAction = action;
  _initMembersModal();
  openM('m-group-members');
}

function _initMembersModal() {
  // Reset UI
  document.getElementById('mm-log').innerHTML = '';
  document.getElementById('mm-progress').style.display = 'none';
  document.getElementById('mm-phones').value = '';
  document.getElementById('mm-excel-info').textContent = '';
  document.getElementById('mm-submit-btn').disabled = false;
  document.getElementById('mm-debug-box').style.display = 'none';
  document.getElementById('mm-debug-msg').textContent = '';
  _mmExcelPhones = null;

  // Show target groups
  const target = _mmGroups.length === 1
    ? escH(_mmGroups[0].name)
    : `${_mmGroups.length} مجموعات محددة`;
  document.getElementById('mm-target').textContent = target;

  // Sync session dropdown from groups page
  const src  = document.getElementById('groups-session-sel');
  const dest = document.getElementById('mm-session-sel');
  dest.innerHTML = src.innerHTML;

  setMembersAction(_mmAction);
  setMembersMethod(_mmMethod);
}

function setMembersAction(action) {
  _mmAction = action;
  const btnAdd  = document.getElementById('mm-btn-add');
  const btnRem  = document.getElementById('mm-btn-remove');
  const testBtn = document.getElementById('mm-test-btn');
  btnAdd.className = `btn bsm ${action === 'add'    ? 'bp' : 'bo'}`;
  btnRem.className = `btn bsm ${action === 'remove' ? 'bd' : 'bo'}`;
  if (testBtn) testBtn.style.display = action === 'remove' ? '' : 'none';
}

function setMembersMethod(method) {
  _mmMethod = method;
  document.getElementById('mm-manual-sec').style.display = method === 'manual' ? '' : 'none';
  document.getElementById('mm-excel-sec').style.display  = method === 'excel'  ? '' : 'none';
  document.getElementById('mm-method-manual').className = `btn bsm ${method === 'manual' ? 'bp' : 'bo'}`;
  document.getElementById('mm-method-excel').className  = `btn bsm ${method === 'excel'  ? 'bp' : 'bo'}`;
}

async function pickMembersExcel() {
  if (!IS_ELECTRON) return;
  const fp = await BE.openFile({ filters: [{ name: 'Excel', extensions: ['xlsx','xls','csv'] }] });
  if (!fp) return;
  const r = await BE.wa.groups.readPhonesFromExcel(fp);
  if (!r.ok) { beErr(r.error); return; }
  _mmExcelPhones = r.data;
  document.getElementById('mm-excel-info').textContent = `✅ ${r.data.length} رقم هاتف من الملف`;
}

async function submitMembersMgr(dryRun = false) {
  if (!IS_ELECTRON) { beOk('تم التنفيذ (وضع العرض)'); return; }
  const sessionId = document.getElementById('mm-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة أولاً'); return; }

  let phones = [];
  if (_mmMethod === 'manual') {
    const raw = document.getElementById('mm-phones').value;
    phones = raw.split(/[\n,;]+/)
      .map(p => p.trim().replace(/[\s\-\+\(\)]/g, ''))
      .filter(p => /^\d{7,15}$/.test(p));
  } else {
    if (!_mmExcelPhones?.length) { beErr('لم يتم تحميل ملف Excel'); return; }
    phones = _mmExcelPhones;
  }
  if (!phones.length) { beErr('لم يتم إدخال أي أرقام هاتف صالحة'); return; }

  const btn     = document.getElementById('mm-submit-btn');
  const testBtn = document.getElementById('mm-test-btn');
  const logEl   = document.getElementById('mm-log');
  const prog    = document.getElementById('mm-progress');
  const bar     = document.getElementById('mm-progress-bar');

  const debugBox = document.getElementById('mm-debug-box');
  const debugMsg = document.getElementById('mm-debug-msg');

  btn.disabled = true;
  if (testBtn) testBtn.disabled = true;
  prog.style.display = 'block';
  debugBox.style.display = 'none';
  debugMsg.textContent = '';
  logEl.innerHTML = '';
  bar.style.width = '0%';

  const ipcFn = _mmAction === 'add' ? 'addMembers' : 'removeMembers';
  const verb   = _mmAction === 'add' ? 'إضافة' : 'حذف';
  const modeLabel = dryRun ? '🔍 اختبار' : '🚀 تنفيذ';
  const debugLines = [];
  let done = 0;
  GP.show(`${modeLabel} — ${verb} أعضاء...`, 0, `0/${_mmGroups.length}`);

  for (const group of _mmGroups) {
    const pct = Math.round((done / _mmGroups.length) * 100);
    bar.style.width = pct + '%';
    GP.step(`${verb} في: ${group.name}`, done, _mmGroups.length, `${done+1}/${_mmGroups.length}`);
    logEl.innerHTML += `<div>⏳ ${escH(group.name)} — ${modeLabel}: ${phones.length} رقم...</div>`;
    logEl.scrollTop = logEl.scrollHeight;
    try {
      const payload = { sessionId, groupId: group.id, phones };
      if (_mmAction === 'remove') payload.dryRun = dryRun;
      const r = await BE.wa.groups[ipcFn](payload);
      if (r.ok) {
        const d = r.data || {};

        if (dryRun && _mmAction === 'remove') {
          const foundList    = (d.found    || []).join(', ') || '—';
          const notFoundList = (d.notFound || []).join(', ') || '—';
          logEl.innerHTML +=
            `<div style="color:var(--acc)">🔍 ${escH(group.name)}: موجود في الجروب (${(d.found||[]).length}): <span style="color:#8ff">${escH(foundList)}</span></div>`;
          if (d.notFound?.length) {
            logEl.innerHTML += `<div style="color:#f93">⚠️ غير موجود (${d.notFound.length}): <span style="color:#fbb">${escH(notFoundList)}</span></div>`;
            if (d.debug) debugLines.push(`[${group.name}] ${d.debug}`);
          }

        } else if (_mmAction === 'remove') {
          const cnt      = d.removed ?? 0;
          const notFound = d.notFound || [];
          logEl.innerHTML += `<div style="color:var(--acc)">✅ ${escH(group.name)}: تم حذف ${cnt} عضو</div>`;
          if (d.warning) {
            logEl.innerHTML += `<div style="color:#f93">⚠️ ${escH(d.warning)}</div>`;
          }
          if (notFound.length) {
            logEl.innerHTML += `<div style="color:#f93">⚠️ لم يُعثر عليهم (${notFound.length}): <span style="color:#fbb">${escH(notFound.join(', '))}</span></div>`;
          }
          if (d.debug) debugLines.push(`[${group.name}] ${d.debug}`);

        } else {
          logEl.innerHTML += `<div style="color:var(--acc)">✅ ${escH(group.name)}: نجح (${d.added ?? phones.length} أرقام)</div>`;
        }
      } else {
        logEl.innerHTML += `<div style="color:#ef4444">❌ ${escH(group.name)}: ${escH(r.error)}</div>`;
        debugLines.push(`[${group.name}] خطأ: ${r.error}`);
      }
    } catch (e) {
      logEl.innerHTML += `<div style="color:#ef4444">❌ ${escH(group.name)}: ${escH(e.message)}</div>`;
      debugLines.push(`[${group.name}] استثناء: ${e.message}`);
    }
    done++;
    logEl.scrollTop = logEl.scrollHeight;
  }

  bar.style.width = '100%';
  const summary = dryRun
    ? `اكتمل الاختبار — ${done}/${_mmGroups.length} مجموعة`
    : `اكتملت العملية — ${done}/${_mmGroups.length} مجموعة`;
  logEl.innerHTML += `<div style="color:var(--acc);margin-top:6px;font-weight:700">✅ ${summary}</div>`;
  logEl.scrollTop = logEl.scrollHeight;
  GP.done(summary);

  // Show debug box if there's diagnostic info
  if (debugLines.length) {
    debugMsg.textContent = debugLines.join('\n');
    debugBox.style.display = 'block';
  }

  btn.disabled = false;
  if (testBtn) testBtn.disabled = false;
}

// ══════════════════════════════════════════════════════════════════════════
// AUTO-UPDATE
// ══════════════════════════════════════════════════════════════════════════

let _updVersion   = '';
let _updDownloaded = false;

function _updBtn()    { return document.getElementById('upd-btn'); }
function _updModal(id){ return document.getElementById(id); }

function _formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB/s';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB/s';
}

function startUpdateDownload() {
  if (!IS_ELECTRON) return;
  if (_updDownloaded) { doUpdateInstall(); return; }
  // Show progress area, hide download button
  _updModal('upd-dl-wrap').style.display  = 'block';
  _updModal('upd-actions').style.display  = 'none';
  _updModal('upd-dl-btn').disabled        = true;
  BE.update.download();
  showN('التحديث', 'جارٍ تحميل التحديث...', '⬇️');
}

function doUpdateInstall() {
  if (!IS_ELECTRON) return;
  showN('التحديث', 'جارٍ إعادة التشغيل وتثبيت التحديث...', '🚀');
  setTimeout(() => BE.update.install(), 1000);
}

if (IS_ELECTRON) {
  // Update available
  BE.on('update:available', ({ version, releaseDate, releaseNotes }) => {
    _updVersion = version || '';
    _updDownloaded = false;

    // Populate modal
    _updModal('upd-ver').textContent  = `v${version}`;
    _updModal('upd-date').textContent = releaseDate
      ? `تاريخ الإصدار: ${new Date(releaseDate).toLocaleDateString('ar')}`
      : '';
    const notes = _updModal('upd-notes');
    if (releaseNotes) {
      notes.innerHTML = String(releaseNotes).replace(/\n/g, '<br>');
      notes.style.display = 'block';
    }
    // Reset state
    _updModal('upd-dl-wrap').style.display        = 'none';
    _updModal('upd-ready-msg').style.display      = 'none';
    _updModal('upd-actions').style.display        = 'flex';
    _updModal('upd-install-actions').style.display= 'none';
    _updModal('upd-dl-fill').style.width          = '0%';

    // Show pulsing button in header
    const btn = _updBtn();
    if (btn) { btn.style.display = 'flex'; btn.title = `تحديث متاح — v${version}`; }

    // Notification
    showN('تحديث متاح 🔄', `الإصدار الجديد v${version} جاهز للتحميل`, '⬆️');
  });

  // Download progress
  BE.on('update:progress', ({ percent, bytesPerSecond }) => {
    const pct = Math.round(percent || 0);
    _updModal('upd-dl-fill').style.width  = pct + '%';
    _updModal('upd-dl-pct').textContent   = pct + '%';
    _updModal('upd-dl-speed').textContent = _formatBytes(bytesPerSecond);
    // Update button tooltip
    const btn = _updBtn();
    if (btn) btn.title = `تحميل التحديث... ${pct}%`;
  });

  // Download complete
  BE.on('update:downloaded', ({ version }) => {
    _updDownloaded = true;
    _updModal('upd-dl-wrap').style.display        = 'none';
    _updModal('upd-ready-msg').style.display      = 'block';
    _updModal('upd-actions').style.display        = 'none';
    _updModal('upd-install-actions').style.display= 'flex';

    // Change button style
    const btn = _updBtn();
    if (btn) {
      btn.classList.add('downloaded');
      btn.innerHTML = '🚀<span id="upd-dot"></span>';
      btn.title     = `التحديث v${version} جاهز — اضغط للتثبيت`;
    }
    openM('m-update');
    showN('التحديث جاهز ✅', `v${version} — اضغط للتثبيت`, '🚀');
  });

  // Update error
  BE.on('update:error', ({ message }) => {
    console.warn('[Update error]', message);
    // Re-show download button so user can retry
    _updModal('upd-dl-wrap').style.display  = 'none';
    _updModal('upd-actions').style.display  = 'flex';
    _updModal('upd-dl-btn').disabled        = false;
    showN('خطأ في التحديث ⚠️', message || 'فشل تحميل التحديث', '❌');
  });
}

// ── Main process push events ──────────────────────────────────────────────
if (IS_ELECTRON) {
  BE.on('navigate', p => nav(p));
  BE.on('notify',  (t,x,i) => showN(t,x,i));
}

// ── Boot ──────────────────────────────────────────────────────────────────
(async () => {
  nav('dashboard');
  await loadDashboard();
})();

// ══════════════════════════════════════════════════════════════════════════
// ANTI-BAN PAGE
// ══════════════════════════════════════════════════════════════════════════

function _abToggle(checkboxId, trackId, thumbId, on) {
  const cb = document.getElementById(checkboxId);
  if (cb) cb.checked = on;
  const tr = document.getElementById(trackId);
  const th = document.getElementById(thumbId);
  if (tr) tr.style.background = on ? 'rgba(var(--ar),.5)' : 'rgba(var(--ar),.15)';
  if (th) { th.style.background = on ? 'var(--acc)' : 'var(--ts)'; th.style.right = on ? 'calc(100% - 19px)' : '3px'; }
}

function toggleABEnabled(cb) { _abToggle('ab-enabled','ab-enabled-track','ab-enabled-thumb', cb.checked); }
function toggleABWindow(cb)  { _abToggle('ab-window-enabled','ab-window-track','ab-window-thumb', cb.checked); }
function toggleABTyping(cb)  { _abToggle('ab-typing-sim','ab-typing-track','ab-typing-thumb', cb.checked); }

async function loadAntiBan() {
  if (!IS_ELECTRON) return;

  // Load settings
  const sr = await BE.antiBan.getSettings();
  const s  = sr?.data || sr || {};
  _abToggle('ab-enabled',      'ab-enabled-track',  'ab-enabled-thumb',  s.enabled !== false);
  _abToggle('ab-window-enabled','ab-window-track',  'ab-window-thumb',   !!s.timeWindowEnabled);
  _abToggle('ab-typing-sim',   'ab-typing-track',   'ab-typing-thumb',   s.typingSimEnabled !== false);
  const profile = document.getElementById('ab-delay-profile');
  if (profile) profile.value = s.delayProfile || 'normal';
  const setV = (id, v) => { const el = document.getElementById(id); if (el && v !== undefined) el.value = v; };
  setV('ab-daily-limit',   s.dailyLimit    ?? 500);
  setV('ab-hourly-limit',  s.hourlyLimit   ?? 60);
  setV('ab-window-start',  s.timeWindowStart ?? 9);
  setV('ab-window-end',    s.timeWindowEnd   ?? 21);
  setV('ab-typing-min',    s.typingMinMs ?? 1000);
  setV('ab-typing-max',    s.typingMaxMs ?? 3000);

  // Load session stats
  const sesr = await BE.antiBan.getSessions();
  const sessions = Array.isArray(sesr) ? sesr : (sesr?.data || []);
  renderABSessions(sessions);

  // Load events
  const evr = await BE.antiBan.getEvents(50);
  const events = Array.isArray(evr) ? evr : (evr?.data || []);
  renderABEvents(events);
}

function renderABSessions(sessions) {
  let healthy = 0, suspended = 0, banned = 0, warmup = 0;
  const tbody = document.getElementById('ab-sessions-list');
  if (!sessions.length) {
    tbody.innerHTML = '<div style="text-align:center;padding:32px;opacity:.5">لا توجد جلسات — أضف جلسة أولاً</div>';
    ['ab-stat-healthy','ab-stat-suspended','ab-stat-banned','ab-stat-warmup'].forEach(id => { const el=document.getElementById(id); if(el) el.textContent='0'; });
    return;
  }

  tbody.innerHTML = sessions.map(s => {
    const h        = s.healthScore ?? 80;
    const hColor   = h >= 70 ? '#22c55e' : h >= 40 ? '#f59e0b' : '#ef4444';
    const hLabel   = h >= 70 ? 'سليمة' : h >= 40 ? 'ضعيفة' : 'خطر';
    const barWidth = h + '%';
    const isBanned = s.banDetected;
    const isSusp   = s.suspended && !isBanned;
    if (isBanned)   banned++;
    else if (isSusp) suspended++;
    else            healthy++;
    if (s.warmupMode) warmup++;

    const dailyPct = s.dailyLimit > 0 ? Math.min(100, Math.round(s.dailyCount / s.dailyLimit * 100)) : 0;
    const dailyColor = dailyPct >= 90 ? '#ef4444' : dailyPct >= 70 ? '#f59e0b' : '#22c55e';

    return `<div style="padding:12px;background:rgba(var(--ar),.04);border-radius:10px;border:1px solid rgba(var(--ar),.1)">
      <div class="flex ic jb mb8">
        <div class="flex ic gap8">
          <span class="f13 fw6">${esc(s.name)}</span>
          ${s.phone ? `<span class="f11 ts">${esc(s.phone)}</span>` : ''}
          ${isBanned  ? `<span class="bge bg-r">🚫 محظور</span>` : ''}
          ${isSusp    ? `<span class="bge bg-y">⏸️ موقوف</span>` : ''}
          ${s.warmupMode ? `<span class="bge bg-b">🔥 إحماء يوم ${s.warmupDay}</span>` : ''}
        </div>
        <div class="flex gap6">
          ${s.warmupMode
            ? `<button class="btn bo bsm" onclick="abDisableWarmup('${s.id}')">إيقاف الإحماء</button>`
            : `<button class="btn bo bsm" onclick="abEnableWarmup('${s.id}')">تفعيل الإحماء</button>`}
          <button class="btn bo bsm" onclick="abResetSession('${s.id}')">🔄 إعادة ضبط</button>
        </div>
      </div>
      <div class="flex gap16 f11" style="flex-wrap:wrap">
        <div style="flex:1;min-width:140px">
          <div class="ts mb4">صحة الجلسة — <span style="color:${hColor}">${hLabel} (${h}%)</span></div>
          <div style="height:6px;background:rgba(var(--ar),.1);border-radius:3px">
            <div style="height:100%;width:${barWidth};background:${hColor};border-radius:3px;transition:width .4s"></div>
          </div>
        </div>
        <div style="flex:1;min-width:140px">
          <div class="ts mb4">اليوم — <span style="color:${dailyColor}">${s.dailyCount} / ${s.dailyLimit}</span></div>
          <div style="height:6px;background:rgba(var(--ar),.1);border-radius:3px">
            <div style="height:100%;width:${dailyPct}%;background:${dailyColor};border-radius:3px;transition:width .4s"></div>
          </div>
        </div>
        <div class="ts">الساعة: <b>${s.hourlyCount}/${s.hourlyLimit}</b></div>
      </div>
    </div>`;
  }).join('');

  const setS = (id, v) => { const el=document.getElementById(id); if(el) el.textContent = v; };
  setS('ab-stat-healthy', healthy);
  setS('ab-stat-suspended', suspended);
  setS('ab-stat-banned', banned);
  setS('ab-stat-warmup', warmup);
}

function renderABEvents(events) {
  const tbody = document.getElementById('ab-events-tbody');
  if (!events.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;opacity:.5">لا توجد أحداث مسجلة</td></tr>';
    return;
  }
  const typeLabel = {
    ban_detected:   '<span class="bge bg-r">🚫 بان</span>',
    auth_failure:   '<span class="bge bg-r">🔐 Auth Fail</span>',
    send_error:     '<span class="bge bg-y">⚠️ خطأ إرسال</span>',
    disconnected:   '<span class="bge bg-y">🔌 قطع اتصال</span>',
    daily_reset:    '<span class="bge bg-b">🔄 تصفير يومي</span>',
    warmup_start:   '<span class="bge bg-b">🔥 بدء إحماء</span>',
    warmup_stop:    '<span class="bge bg-p">✋ إيقاف إحماء</span>',
    warmup_complete:'<span class="bge bg-g">✅ إحماء مكتمل</span>',
    manual_reset:   '<span class="bge bg-p">🔧 إعادة يدوية</span>',
  };
  tbody.innerHTML = events.map(e => `
    <tr>
      <td>${esc(e.session_name || e.session_id || '—')}</td>
      <td>${typeLabel[e.event_type] || `<span class="bge bg-b">${esc(e.event_type)}</span>`}</td>
      <td class="ts f11">${esc(e.detail || '—')}</td>
      <td class="ts f11">${e.created_at ? new Date(e.created_at).toLocaleString('ar') : '—'}</td>
    </tr>`).join('');
}

async function saveAntiBanSettings() {
  if (!IS_ELECTRON) return;
  const g = id => document.getElementById(id);
  const data = {
    enabled:           g('ab-enabled')?.checked,
    delayProfile:      g('ab-delay-profile')?.value,
    dailyLimit:        parseInt(g('ab-daily-limit')?.value  || '500', 10),
    hourlyLimit:       parseInt(g('ab-hourly-limit')?.value || '60',  10),
    timeWindowEnabled: g('ab-window-enabled')?.checked,
    timeWindowStart:   parseInt(g('ab-window-start')?.value || '9',  10),
    timeWindowEnd:     parseInt(g('ab-window-end')?.value   || '21', 10),
    typingSimEnabled:  g('ab-typing-sim')?.checked,
    typingMinMs:       parseInt(g('ab-typing-min')?.value || '1000', 10),
    typingMaxMs:       parseInt(g('ab-typing-max')?.value || '3000', 10),
  };
  const r = await BE.antiBan.setSettings(data);
  if (r?.ok || r?.data?.ok) beOk('✅ تم حفظ إعدادات Anti-Ban');
  else beErr('فشل حفظ الإعدادات');
}

async function abResetSession(id) {
  if (!confirm('إعادة ضبط الجلسة: يُصفَّر health score + العدادات. متأكد؟')) return;
  const r = await BE.antiBan.resetSession(id);
  if (r?.ok || r?.data?.ok) { beOk('✅ تم إعادة ضبط الجلسة'); loadAntiBan(); }
  else beErr('فشل إعادة الضبط');
}

async function abEnableWarmup(id) {
  const r = await BE.antiBan.enableWarmup(id);
  if (r?.ok || r?.data?.ok) { beOk('🔥 تم تفعيل الإحماء'); loadAntiBan(); }
  else beErr('فشل تفعيل الإحماء');
}

async function abDisableWarmup(id) {
  const r = await BE.antiBan.disableWarmup(id);
  if (r?.ok || r?.data?.ok) { beOk('✅ تم إيقاف الإحماء'); loadAntiBan(); }
  else beErr('فشل إيقاف الإحماء');
}

async function clearABEvents() {
  if (!confirm('مسح الأحداث القديمة (أكثر من 30 يوم)؟')) return;
  await BE.antiBan.clearEvents();
  loadAntiBan();
  beOk('🗑️ تم مسح الأحداث القديمة');
}

// Listen for real-time anti-ban push events
if (IS_ELECTRON) {
  BE.on('antiban:banned', ({ sessionId }) => {
    showN('تحذير بان', `🚫 تم حظر الجلسة ${sessionId} — راجع صفحة Anti-Ban`, 'error');
    if (document.getElementById('p-antiban')?.classList.contains('on')) loadAntiBan();
  });
  BE.on('antiban:suspended', ({ sessionId, health }) => {
    showN('جلسة موقوفة', `⏸️ جلسة ${sessionId} موقوفة — health: ${health}`, 'warning');
    if (document.getElementById('p-antiban')?.classList.contains('on')) loadAntiBan();
  });
  BE.on('antiban:warmup:complete', ({ sessionId }) => {
    showN('إحماء مكتمل', `✅ انتهى الإحماء للجلسة ${sessionId}`, 'success');
    if (document.getElementById('p-antiban')?.classList.contains('on')) loadAntiBan();
  });
  // Rate-limit warning at 80%
  BE.on('antiban:rate-limit', ({ sessionId, type, count, limit, pct }) => {
    const label = type === 'daily' ? 'اليومي' : 'الساعي';
    showN('تحذير حد الإرسال', `⚠️ وصلت إلى ${pct}% من الحد ${label} (${count}/${limit}) — جلسة: ${sessionId}`, 'warning');
  });
  // Live campaign progress
  BE.on('campaign:progress', (d) => {
    const wrap = document.getElementById('campaign-progress-bar-wrap');
    const bar  = document.getElementById('camp-prog-bar');
    const txt  = document.getElementById('camp-prog-text');
    const eta  = document.getElementById('camp-prog-eta');
    if (!wrap) return;
    const total = d.total || 1;
    const done  = (d.sent || 0) + (d.failed || 0);
    const pct   = Math.min(100, Math.round(done / total * 100));
    wrap.style.display = 'block';
    bar.style.width    = pct + '%';
    txt.textContent    = `${done} / ${total}`;
    if (d.etaSec > 0) {
      const m = Math.floor(d.etaSec / 60), s = d.etaSec % 60;
      eta.textContent = `ETA: ${m}:${String(s).padStart(2,'0')}`;
    }
    if (pct >= 100) setTimeout(() => { wrap.style.display = 'none'; }, 4000);
  });
}

// ── IPC helper: unwrap {ok,data} and show error on failure ─────────────────
async function safeIpc(fn) {
  try {
    const r = await fn();
    if (r && r.ok === false) { beErr(r.error || 'خطأ غير معروف'); return null; }
    return r?.data !== undefined ? r.data : r;
  } catch(e) { beErr(String(e?.message||e)); return null; }
}

// ══════════════════════════════════════════════════════════════════════════
// MEDIA LIBRARY
// ══════════════════════════════════════════════════════════════════════════
let _mediaList = [];

async function loadMedia() {
  if (!IS_ELECTRON) return;
  const r = await safeIpc(() => BE.media.list());
  if (!r) return;
  _mediaList = r;
  const grid = document.getElementById('media-grid');
  if (!grid) return;

  let img = 0, vid = 0, pdf = 0;
  if (!r.length) {
    grid.innerHTML = '<div style="text-align:center;padding:32px;opacity:.4;grid-column:1/-1" class="f12 ts">لا توجد ملفات — ارفع ملفاً الآن</div>';
  } else {
    grid.innerHTML = r.map(m => {
      const ext   = (m.mime_type || '').split('/')[0];
      const icon  = ext === 'image' ? '🖼️' : ext === 'video' ? '🎬' : ext === 'application' ? '📄' : '📎';
      if (ext === 'image') img++;
      else if (ext === 'video') vid++;
      else pdf++;
      const kb = m.size_bytes ? Math.round(m.size_bytes / 1024) + ' KB' : '';
      return `<div class="card" style="padding:12px;cursor:pointer;text-align:center" title="${escH(m.name)}">
        <div style="font-size:32px;margin-bottom:8px">${icon}</div>
        <div class="f11 fw6" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%">${escH(m.name)}</div>
        <div class="f10 ts mt4">${kb}</div>
        <div class="flex gap6 mt8 ic jc" onclick="event.stopPropagation()">
          <button class="btn bo bsm" style="padding:4px 8px;font-size:10px" onclick="mediaUseInEngine(${JSON.stringify(m.file_path)})">استخدام</button>
          <button class="btn bd bsm" style="padding:4px 8px;font-size:10px" onclick="mediaDelete(${JSON.stringify(m.id)})">🗑️</button>
        </div>
      </div>`;
    }).join('');
  }
  const total = r.length;
  document.getElementById('media-cnt-img').textContent   = img;
  document.getElementById('media-cnt-vid').textContent   = vid;
  document.getElementById('media-cnt-pdf').textContent   = pdf;
  document.getElementById('media-cnt-total').textContent = total;
}

async function mediaUpload() {
  if (!IS_ELECTRON) return;
  const fp = await BE.openFile({ filters:[{ name:'وسائط', extensions:['jpg','jpeg','png','gif','webp','mp4','pdf'] }] });
  if (!fp) return;
  const res = await safeIpc(() => BE.media.add(fp));
  if (res) { beOk('✅ تم رفع الملف'); loadMedia(); }
}

async function mediaDelete(id) {
  if (!confirm('حذف هذا الملف نهائياً؟')) return;
  await safeIpc(() => BE.media.delete(id));
  loadMedia();
}

function mediaUseInEngine(filePath) {
  nav('engine');
  setTimeout(() => {
    const inp = document.getElementById('eng-media-path');
    const lbl = document.getElementById('eng-media-label');
    if (inp) inp.value = filePath;
    if (lbl) lbl.textContent = filePath.split(/[\\/]/).pop();
    beOk('✅ تم تحديد الملف في محرك الإرسال');
  }, 300);
}

// ══════════════════════════════════════════════════════════════════════════
// CONVERSATION VIEW
// ══════════════════════════════════════════════════════════════════════════
let _convPhone = null;

async function openConversation(phone) {
  _convPhone = phone;
  document.getElementById('conv-phone-title').textContent = phone;
  openM('m-conversation');
  // Populate session dropdown
  const sessEl = document.getElementById('conv-reply-session');
  if (IS_ELECTRON) {
    const sr = await safeIpc(() => BE.wa.sessions.list());
    sessEl.innerHTML = '<option value="">— جلسة —</option>' +
      (sr||[]).filter(s=>s.status==='ready').map(s=>`<option value="${s.id}">${escH(s.name)}</option>`).join('');
  }
  await reloadConversation(phone);
}

async function reloadConversation(phone) {
  const thread = document.getElementById('conv-thread');
  if (!IS_ELECTRON) return;
  const r = await safeIpc(() => BE.conversation.get(phone, 100));
  if (!r || !r.length) {
    thread.innerHTML = '<div style="text-align:center;opacity:.4" class="f12 ts">لا توجد رسائل</div>';
    return;
  }
  thread.innerHTML = r.map(m => {
    const out  = m.direction === 'out';
    const time = m.created_at ? new Date(m.created_at).toLocaleString('ar') : '';
    const bg   = out ? 'rgba(99,102,241,.1)' : 'rgba(255,255,255,.04)';
    const align= out ? 'flex-end' : 'flex-start';
    return `<div style="display:flex;justify-content:${align}">
      <div style="max-width:80%;background:${bg};border:1px solid rgba(var(--ar),.12);border-radius:10px;padding:10px 14px">
        <div class="f11 ts mb4">${out ? '📤 أنت' : '📩 ' + escH(phone)} · ${time}</div>
        <div class="f12" style="white-space:pre-wrap">${escH(m.body||'')}</div>
      </div>
    </div>`;
  }).join('');
  thread.scrollTop = thread.scrollHeight;
}

async function sendConvReply() {
  const body    = document.getElementById('conv-reply-input').value.trim();
  const session = document.getElementById('conv-reply-session').value;
  if (!body) return;
  if (!session) { beErr('اختر جلسة للرد'); return; }
  const r = await safeIpc(() => BE.wa.send.text({ sessionId: session, to: _convPhone, body }));
  if (r) {
    document.getElementById('conv-reply-input').value = '';
    await reloadConversation(_convPhone);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// TEMPLATE SEND
// ══════════════════════════════════════════════════════════════════════════
async function openSendTemplate(tplId, tplBody) {
  document.getElementById('send-tpl-id').value      = tplId;
  document.getElementById('send-tpl-preview').textContent = tplBody || '—';
  document.getElementById('send-tpl-recipients').value    = '';
  // Populate session dropdown
  const sel = document.getElementById('send-tpl-session');
  sel.innerHTML = '<option value="">— تلقائي —</option>';
  if (IS_ELECTRON) {
    const sr = await safeIpc(() => BE.wa.sessions.list());
    (sr||[]).filter(s=>s.status==='ready').forEach(s=>{
      sel.innerHTML += `<option value="${s.id}">${escH(s.name)}</option>`;
    });
  }
  openM('m-send-template');
}

async function sendTemplateNow() {
  const templateId = document.getElementById('send-tpl-id').value;
  const raw        = document.getElementById('send-tpl-recipients').value;
  const sessionId  = document.getElementById('send-tpl-session').value || null;
  const delaySec   = parseInt(document.getElementById('send-tpl-delay').value||'15',10);
  const recipients = raw.split(/[\n,;]+/).map(x=>x.trim().replace(/\D/g,'')).filter(x=>x.length>=7);
  if (!templateId) { beErr('لا يوجد قالب'); return; }
  if (!recipients.length) { beErr('أضف أرقاماً'); return; }
  const r = await safeIpc(() => BE.templates.send({ templateId, recipients, sessionId, delaySec }));
  if (r) { beOk(`✅ تم إضافة ${recipients.length} رسالة للقائمة`); closeM('m-send-template'); }
}

// ══════════════════════════════════════════════════════════════════════════
// ENCRYPTED BACKUP
// ══════════════════════════════════════════════════════════════════════════
async function backupEncrypted() {
  const r = await safeIpc(() => BE.settings.backupEncrypted());
  if (r?.path) beOk(`🔐 تم حفظ النسخة المشفرة:\n${r.path}`);
}

// ══════════════════════════════════════════════════════════════════════════
// RETRY FAILED MESSAGES
// ══════════════════════════════════════════════════════════════════════════
async function retryFailedMessages(campaignId) {
  const r = await safeIpc(() => BE.wa.send.retryFailed(campaignId || undefined));
  if (r) { beOk(`🔁 تم إعادة ${r.requeued || 0} رسالة فاشلة للقائمة`); loadCampaigns(); }
}

// ══════════════════════════════════════════════════════════════════════════
// PHONE IMPORT PREVIEW
// ══════════════════════════════════════════════════════════════════════════
let _importFilePath = null;
let _importValidRows = [];

async function openImportPreview(filePath) {
  _importFilePath = filePath;
  openM('m-import-preview');
  const r = await safeIpc(() => BE.contacts.previewImport(filePath));
  if (!r) return;
  _importValidRows = (r.valid || []);
  document.getElementById('imp-cnt-valid').textContent = r.validCount  || r.valid?.length  || 0;
  document.getElementById('imp-cnt-dup').textContent   = r.dupCount    || r.dups?.length   || 0;
  document.getElementById('imp-cnt-inv').textContent   = r.invalidCount|| r.invalid?.length|| 0;
  document.getElementById('imp-confirm-cnt').textContent = _importValidRows.length;
  const tbody = document.getElementById('imp-preview-tbody');
  const rows  = [...(r.valid||[]).map(x=>({...x,st:'صحيح',c:'bg-g'})),
                 ...(r.dups||[]).map(x=>({...x,st:'مكرر',c:'bg-y'})),
                 ...(r.invalid||[]).map(x=>({...x,st:'خطأ',c:'bg-r'}))].slice(0,200);
  tbody.innerHTML = rows.map(x=>`<tr><td>${escH(x.phone||x.raw||'')}</td><td>${escH(x.name||'')}</td><td><span class="bge ${x.c}">${x.st}</span></td></tr>`).join('');
}

async function confirmImport() {
  if (!_importFilePath) return;
  const r = await safeIpc(() => BE.contacts.importExcel(_importFilePath));
  if (r) { beOk(`✅ تم استيراد ${r.imported||_importValidRows.length} جهة اتصال`); closeM('m-import-preview'); }
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD AUTO-REFRESH with live stats
// ══════════════════════════════════════════════════════════════════════════
async function loadDashboardStats() {
  if (!IS_ELECTRON) return;
  const r = await safeIpc(() => BE.dashboard.stats());
  if (!r) return;
  // Update header stat counters
  if (r.sessionsReady  !== undefined) _el('dash-s-accounts',  r.sessionsReady);
  if (r.sentToday      !== undefined) _el('dash-s-sent',      r.sentToday);
  if (r.repliesTotal   !== undefined) _el('dash-s-replies',   r.repliesTotal);
  if (r.unrepliedCount !== undefined) _el('dash-s-unreplied', r.unrepliedCount);
  if (r.scheduledActive!== undefined) _el('dash-s-scheduled', r.scheduledActive);
  if (r.queuePending   !== undefined) _el('dash-q-pending',   r.queuePending);
  if (r.queueSent      !== undefined) _el('dash-q-sent',      r.queueSent);
  if (r.queueFailed    !== undefined) _el('dash-q-failed',    r.queueFailed);
  if (r.sessionsReady  !== undefined) _el('dash-q-devices',   r.sessionsReady);
}

function _el(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

function startDashAutoRefresh() {
  if (_dashRefreshTimer) return;
  _dashRefreshTimer = setInterval(() => { loadDashboardStats(); }, 15000);
}

function stopDashAutoRefresh() {
  if (_dashRefreshTimer) { clearInterval(_dashRefreshTimer); _dashRefreshTimer = null; }
}

// ── Boot ──────────────────────────────────────────────────────────────────
// ── SPARKLINES ────────────────────────────────────────────────────────────
function drawSparkline(svgId, data, color) {
  const svg = document.getElementById(svgId);
  if (!svg || !data || !data.length) return;
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = max - min || 1;
  const w = 100, h = 30;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  svg.innerHTML = `<polyline points="${pts.join(' ')}" fill="none" stroke="${color || 'var(--acc)'}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`;
}
