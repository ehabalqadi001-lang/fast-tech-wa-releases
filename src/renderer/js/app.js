const BE = window.ftwa || null;
const IS_ELECTRON = !!BE;

function beErr(msg) { showN('خطأ', msg, '❌'); }
function beOk(msg)  { showN('نجاح', msg, '✅'); }

// ── Shared media picker utilities ──────────────────────────────────────────
const _mediaIcons = { image: '🖼️', video: '🎬', document: '📎' };

async function _pickMediaFile(filterType = 'all') {
  if (!IS_ELECTRON) return null;
  const filterMap = {
    all:      [{ name: 'وسائط', extensions: ['jpg','jpeg','png','gif','webp','mp4','mov','avi','pdf','docx','xlsx','pptx','zip','rar'] }],
    image:    [{ name: 'صور',   extensions: ['jpg','jpeg','png','gif','webp'] }],
    video:    [{ name: 'فيديو', extensions: ['mp4','avi','mov','mkv','3gp'] }],
    document: [{ name: 'مستندات', extensions: ['pdf','docx','xlsx','pptx','txt','zip','rar'] }],
  };
  return await BE.openFile({ filters: filterMap[filterType] || filterMap.all });
}

function _mediaTypeFromPath(fp) {
  const ext = fp.split('.').pop().toLowerCase();
  if (['jpg','jpeg','png','gif','webp'].includes(ext)) return 'image';
  if (['mp4','mov','avi','mkv','3gp'].includes(ext)) return 'video';
  return 'document';
}

// ── Shared session select helper ───────────────────────────────────────────
function _fillSessionSelect(selId, sessions, placeholder = 'اختر جلسة...') {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  sessions.forEach(s => {
    const o = document.createElement('option');
    o.value = s.id;
    o.textContent = `📱 ${s.name || s.id}${s.phone ? ' (+' + s.phone + ')' : ''}`;
    sel.appendChild(o);
  });
}

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

  // Use streaming for Claude, regular invoke for Gemini
  const pref = document.getElementById('ai-model-pref')?.value || 'gemini';
  if (pref === 'claude') {
    // Streaming path
    const bub = document.getElementById(typId)?.querySelector('.ai-bub');
    let streamed = '';
    BE.on('ai:stream:event', function handler(ev) {
      if (ev.type === 'chunk') {
        streamed += ev.text;
        if (bub) bub.innerHTML = streamed.replace(/</g,'&lt;').replace(/\n/g,'<br>');
        chat.scrollTop = chat.scrollHeight;
      } else if (ev.type === 'done') {
        BE.off('ai:stream:event', handler);
        _aiMsgs.push({ role:'assistant', content: streamed });
      } else if (ev.type === 'error') {
        BE.off('ai:stream:event', handler);
        _aiMsgs.pop();
        if (bub) {
          const needsSettings = (ev.text||'').includes('الإعدادات') || (ev.text||'').includes('غير محدد') || (ev.text||'').includes('غير صالح');
          bub.innerHTML = `<span style="color:#f87171">⚠️ ${(ev.text||'خطأ').replace(/</g,'&lt;')}</span>${needsSettings ? `<br><button class="btn bo bsm mt8" style="font-size:10px" onclick="nav('settings')">⚙️ فتح الإعدادات</button>` : ''}`;
        }
      }
    });
    BE.ai.streamChat({ messages: _aiMsgs });
  } else {
    try {
      const r = await BE.ai.chat({ messages: _aiMsgs });
      const bub = document.getElementById(typId)?.querySelector('.ai-bub');
      if (r.ok) {
        _aiMsgs.push({ role:'assistant', content:r.data.content });
        if (bub) bub.innerHTML = r.data.content.replace(/</g,'&lt;').replace(/\n/g,'<br>');
      } else {
        _aiMsgs.pop();
        if (bub) {
          const errMsg = r.error || 'خطأ غير معروف';
          const needsSettings = errMsg.includes('الإعدادات') || errMsg.includes('غير محدد') || errMsg.includes('غير صالح');
          bub.innerHTML = `<span style="color:#f87171">⚠️ ${errMsg.replace(/</g,'&lt;')}</span>${needsSettings ? `<br><button class="btn bo bsm mt8" style="font-size:10px" onclick="nav('settings')">⚙️ فتح الإعدادات</button>` : ''}`;
        }
      }
    } catch(e) {
      _aiMsgs.pop();
      const bub = document.getElementById(typId)?.querySelector('.ai-bub');
      if (bub) bub.innerHTML = `<span style="color:#f87171">⚠️ ${(e.message||'خطأ').replace(/</g,'&lt;')}</span>`;
    }
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
  // New design: inline sections, toggle visibility
  ['manual','excel'].forEach(m => {
    const sec = document.getElementById(`groups-${m}-section`);
    if (sec) sec.style.display = m === method ? '' : 'none';
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
  const el = document.getElementById('campaigns-list');
  if (!el) return;

  const [statsR, listR] = await Promise.all([BE.messages.getStats(), BE.campaigns.list()]);
  const s = statsR.ok ? statsR.data : {};
  const campaigns = Array.isArray(listR) ? listR : [];

  const sub = document.getElementById('campaigns-subtitle');
  if (sub) sub.textContent = `إجمالي المُرسَل: ${(s.sent||0).toLocaleString()} رسالة — ${campaigns.length} حملة`;

  const statsHtml = `
    <div class="flex gap20 mb14" style="padding:12px 0;border-bottom:1px solid rgba(var(--ar),.08)">
      <div><div class="ta fm f13">${(s.sent||0).toLocaleString()}</div><div class="f11 ts">إجمالي مُرسَل</div></div>
      <div><div class="fm f13" style="color:#3b82f6">${(s.read_count||0).toLocaleString()}</div><div class="f11 ts">مقروء</div></div>
      <div><div class="fm f13" style="color:#bf00ff">${(s.replies||0).toLocaleString()}</div><div class="f11 ts">ردود</div></div>
      <div><div class="fm f13" style="color:#ef4444">${(s.failed||0).toLocaleString()}</div><div class="f11 ts">فاشل</div></div>
    </div>`;

  if (!campaigns.length) {
    el.innerHTML = statsHtml + '<div class="f12 ts" style="padding:18px;text-align:center;opacity:.6">لا توجد حملات — ابدأ إرسالاً جماعياً من محرك الإرسال</div>';
    return;
  }

  const statusMap = { pending:'⏳ انتظار', running:'⚡ جارٍ', done:'✅ مكتمل', failed:'❌ فاشل', paused:'⏸️ متوقف' };
  const statusColor = { pending:'#f59e0b', running:'var(--acc)', done:'#22c55e', failed:'#ef4444', paused:'#94a3b8' };
  const rows = campaigns.slice(0, 50).map(c => {
    const pct   = c.total > 0 ? Math.round((c.sent || 0) / c.total * 100) : 0;
    const color = statusColor[c.status] || '#94a3b8';
    const dt    = c.created_at ? new Date(c.created_at).toLocaleString('ar') : '';
    return `<div style="padding:10px 0;border-bottom:1px solid rgba(var(--ar),.06)">
      <div class="flex ic jb mb4">
        <span class="f12 fw7">${c.name || 'حملة'}</span>
        <span class="f11" style="color:${color}">${statusMap[c.status] || c.status}</span>
      </div>
      <div style="background:rgba(var(--ar),.08);border-radius:4px;height:6px;overflow:hidden;margin-bottom:4px">
        <div style="height:100%;background:${color};width:${pct}%;transition:width .4s"></div>
      </div>
      <div class="flex ic jb f11 ts">
        <span>${(c.sent||0).toLocaleString()} / ${(c.total||0).toLocaleString()} رسالة (${pct}%)</span>
        <span>${dt}</span>
      </div>
    </div>`;
  }).join('');

  el.innerHTML = statsHtml + rows;
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
  const fp = await _pickMediaFile();
  if (!fp) return;
  const type = _mediaTypeFromPath(fp);
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

  // Fetch health scores + adaptive status in parallel
  let _healthMap = {}, _adaptiveMap = {};
  if (IS_ELECTRON) {
    await Promise.all([
      BE.antiBan.getSessions().then(hr => {
        const hs = Array.isArray(hr) ? hr : (hr?.data || []);
        hs.forEach(h => { _healthMap[h.id] = h; });
      }).catch(() => {}),
      BE.antiBan.adaptiveStatus().then(am => { _adaptiveMap = am || {}; }).catch(() => {}),
    ]);
  }

  const cards = sessions.map(s => {
    const st      = s.state || s.status || 'disconnected';
    const lbl     = stateLabel[st] || st;
    const badge   = stateBadge[st] || '';
    const isReady = st === 'ready';
    const hd      = _healthMap[s.id];
    const health  = hd?.healthScore ?? null;
    const hColor  = health === null ? 'var(--ts)' : health >= 70 ? '#22c55e' : health >= 40 ? '#f59e0b' : '#ef4444';
    const hLabel  = health === null ? '' : health >= 70 ? '✅' : health >= 40 ? '⚠️' : '🚫';
    const isBanned   = hd?.banDetected;
    const inCooldown = hd?.suspended && !isBanned;
    const adp        = _adaptiveMap[s.id];
    const isAdapted  = adp?.override;
    return `
      <div class="ac" style="flex-direction:column;align-items:flex-start;gap:8px;min-height:160px">
        <div class="flex ic jb wf">
          <div style="font-size:28px">📱</div>
          <div class="flex gap4 ic">
            ${isBanned   ? `<span class="bge bg-r f10">🚫 محظور</span>` : ''}
            ${inCooldown ? `<span class="bge bg-y f10">⏸️ موقوف</span>` : ''}
            ${isAdapted  ? `<span class="bge bg-y f10" title="تم تعديل التأخير تلقائياً — معدل الخطأ ${adp.errRate}%">🛡️ ${adp.override}</span>` : ''}
            <span class="bge ${badge} f11">${lbl}</span>
          </div>
        </div>
        <div class="fw7 f13">${esc(s.name)}</div>
        <div class="f11 ts">${s.phone ? '📞 +'+s.phone : '—'}</div>
        <div class="f11 ts">✉️ ${(s.msg_count||0).toLocaleString()} رسالة</div>
        ${health !== null ? `
        <div style="width:100%">
          <div class="f10 ts mb2">صحة الجلسة ${hLabel} <span style="color:${hColor}">${health}%</span></div>
          <div style="height:4px;background:rgba(var(--ar),.1);border-radius:2px">
            <div style="height:100%;width:${health}%;background:${hColor};border-radius:2px;transition:width .4s"></div>
          </div>
        </div>` : ''}
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
  _fillSessionSelect('eng-session',   readySessions, 'كل الجلسات');
  _fillSessionSelect('inbox-filter',  readySessions, 'كل الجلسات');
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

  BE.on('wa:qrExpired', ({ sessionId }) => {
    if (document.getElementById('m-qr')?.classList.contains('open') && sessionId === _currentQrSession) {
      closeM('m-qr');
      beErr('⏰ انتهت صلاحية رمز QR — اضغط "تشغيل" مرة أخرى لتوليد رمز جديد');
    }
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

  BE.on('antiban:adaptive', (d) => {
    const dir = d.direction === 'up' ? '⬆️ تصعيد' : '⬇️ استعادة';
    showN(`🛡️ Anti-Ban تكيّفي`, `${dir} للجلسة — بروفايل: ${d.profile} (خطأ ${d.errRate}%)`, 'warn');
    if (document.getElementById('p-devices')?.classList.contains('on')) loadDevices();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// SEND ENGINE — anti-ban bulk queue
// ═══════════════════════════════════════════════════════════════════════════

function countEngineTargets() {
  const raw  = document.getElementById('eng-recipients')?.value || '';
  const nums = raw.split(/[\n,]+/).map(s=>s.trim()).filter(s=> s.includes('@') || /\d{6,}/.test(s));
  const n = nums.length;
  const el = document.getElementById('eng-count');
  if (el) el.textContent = n + ' مستهدف';
  const badge = document.getElementById('eng-count-badge');
  if (badge) badge.textContent = n.toLocaleString() + ' مستهدف';
  // Estimated time
  const minDelay = parseInt(document.getElementById('eng-delay-min')?.value || 15, 10);
  const maxDelay = parseInt(document.getElementById('eng-delay-max')?.value || 45, 10);
  const avgDelay = (minDelay + maxDelay) / 2;
  const estSec   = Math.round(n * avgDelay);
  const etaEl    = document.getElementById('eng-est-time');
  if (etaEl && n > 0) {
    const mins = Math.floor(estSec / 60), secs = estSec % 60;
    etaEl.textContent = `⏱ ~${mins ? mins + 'د ' : ''}${secs}ث`;
  } else if (etaEl) { etaEl.textContent = ''; }
}

function setDelayPreset(min, max) {
  if (min === 0 && max === 0) { countEngineTargets(); return; }
  const minEl = document.getElementById('eng-delay-min');
  const maxEl = document.getElementById('eng-delay-max');
  if (minEl) minEl.value = min;
  if (maxEl) maxEl.value = max;
  _updateRiskBadge(min, max);
  countEngineTargets();
  // Highlight active preset
  document.querySelectorAll('#delay-presets .src-btn').forEach(b => b.classList.remove('active'));
  event?.target?.closest('.src-btn')?.classList.add('active');
}

function _updateRiskBadge(min, max) {
  const badge = document.getElementById('eng-risk-badge');
  if (!badge) return;
  const avg = (min + max) / 2;
  if (avg >= 25)      { badge.textContent = '🛡️ آمن جداً'; badge.className = 'bge bg-g f11'; }
  else if (avg >= 12) { badge.textContent = '✅ آمن';      badge.className = 'bge bg-g f11'; }
  else if (avg >= 6)  { badge.textContent = '⚠️ متوسط';   badge.className = 'bge bg-y f11'; }
  else                { badge.textContent = '🔴 خطر';      badge.className = 'bge f11'; badge.style.background='rgba(239,68,68,.15)'; badge.style.color='#ef4444'; }
}

function _engUpdateLiveBadge(pending) {
  const badge = document.getElementById('eng-live-badge');
  if (badge) badge.style.display = pending > 0 ? 'flex' : 'none';
}

async function loadEngineStats() {
  if (!IS_ELECTRON) return;
  const r = await BE.wa.send.queueStats();
  if (!r || !r.ok) return;
  const s = r.data;

  // Update stat cards
  const _set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  _set('eng-s-pending',   (s.pending||0).toLocaleString());
  _set('eng-s-sent',      (s.sent||0).toLocaleString());
  _set('eng-s-delivered', (s.delivered||0).toLocaleString());
  _set('eng-s-failed',    (s.failed||0).toLocaleString());

  // Live badge
  _engUpdateLiveBadge(s.pending||0);

  // Progress card — show when there's an active campaign
  const total   = s.total || 1;
  const done    = (s.sent||0) + (s.delivered||0) + (s.read_count||0) + (s.failed||0);
  const pct     = Math.min(100, Math.round(done / total * 100));
  const pending = s.pending || 0;

  const card = document.getElementById('eng-progress-card');
  if (card) {
    card.style.display = (pending > 0 || done > 0) ? 'block' : 'none';
    const barEl  = document.getElementById('eng-prog-bar');  if (barEl)  barEl.style.width      = pct + '%';
    const pctEl  = document.getElementById('eng-prog-pct');  if (pctEl)  pctEl.textContent      = pct + '%';
    const sentEl = document.getElementById('eng-prog-sent'); if (sentEl) sentEl.textContent     = (s.sent||0).toLocaleString();
    const failE2 = document.getElementById('eng-prog-fail'); if (failE2) failE2.textContent     = (s.failed||0).toLocaleString();
    const leftEl = document.getElementById('eng-prog-left'); if (leftEl) leftEl.textContent     = pending.toLocaleString();
    // ETA estimate
    const minD = parseInt(document.getElementById('eng-delay-min')?.value || 15, 10);
    const maxD = parseInt(document.getElementById('eng-delay-max')?.value || 45, 10);
    const avgD = (minD + maxD) / 2;
    const etaSec = Math.round(pending * avgD);
    const etaEl  = document.getElementById('eng-prog-eta');
    if (etaEl && pending > 0) {
      const m = Math.floor(etaSec / 60), sec = etaSec % 60;
      etaEl.textContent = `⏱ متبقي ~${m ? m + ' د ' : ''}${sec} ث`;
    } else if (etaEl) { etaEl.textContent = ''; }
  }

  // Update risk badge based on current delay values
  const minD = parseInt(document.getElementById('eng-delay-min')?.value || 15, 10);
  const maxD = parseInt(document.getElementById('eng-delay-max')?.value || 45, 10);
  _updateRiskBadge(minD, maxD);
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
  const fp = await _pickMediaFile();
  if (!fp) return;
  document.getElementById('eng-media-path').value = fp;
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
  const slot  = btn.closest('.ab-slot');
  const input = slot?.querySelector('.ab-media');
  if (!input) return;
  const fp = await _pickMediaFile();
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
      `<button class="btn bo bsm" onclick="openAssignModal('${phone}')" title="تعيين لعضو فريق">👤</button>`,
      `<button class="btn bo bsm" onclick="openEnrollFromInbox('${phone}')" title="تسجيل في تسلسل">🔄</button>`,
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
  if (document.getElementById('inbox-filter')?.options.length <= 1) {
    const sessR = await BE.wa.sessions.list();
    if (sessR.ok) _fillSessionSelect('inbox-filter', sessR.data.filter(s=>s.state==='ready'), 'كل الأجهزة');
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

// ── Enroll contact from inbox into a sequence ────────────────────────────
let _enrollInboxPhone = '';
async function openEnrollFromInbox(phone) {
  _enrollInboxPhone = phone;
  const sel = document.getElementById('enroll-seq-sel');
  if (!sel) { beErr('عنصر القائمة غير موجود — أعد تحميل الصفحة'); return; }
  sel.innerHTML = '<option value="">جاري التحميل...</option>';
  if (IS_ELECTRON) {
    const r = await BE.sequences.list();
    const seqs = r.ok ? (r.data||[]).filter(s=>s.active) : [];
    sel.innerHTML = seqs.length
      ? '<option value="">اختر تسلسلاً...</option>' + seqs.map(s=>`<option value="${s.id}">${s.name}</option>`).join('')
      : '<option value="">لا توجد تسلسلات نشطة</option>';
  }
  document.getElementById('enroll-phone-display').textContent = '+' + phone;
  openM('m-enroll-inbox');
}
async function confirmEnrollFromInbox() {
  const seqId = document.getElementById('enroll-seq-sel').value;
  if (!seqId) { beErr('اختر تسلسلاً'); return; }
  const r = await BE.sequences.enroll({ sequenceId: seqId, phone: _enrollInboxPhone, sessionId: '' });
  if (r.ok) { beOk('تم تسجيل الرقم في التسلسل'); closeM('m-enroll-inbox'); }
  else beErr(r.error || 'فشل التسجيل');
}

// ── Utility ────────────────────────────────────────────────────────────────
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Page init functions (called by nav() after dynamic load) ─────────────
window._pg_dashboard = () => { loadDashboard(); };
window._pg_accounts  = () => {
  loadAccounts();
  document.querySelector('.md-cl .btn.bp')?.addEventListener('click', saveAccount);
};
window._pg_contacts  = () => { loadContacts(); renderAudienceConditions(); };
window._pg_groups    = () => { loadGroupsPage(); };
window._pg_campaigns = () => { loadCampaigns(); };
window._pg_scheduler = () => { loadScheduler(); };
window._pg_templates = () => { loadTemplates(); };
window._pg_ai        = () => {
  loadAiSettings();
  document.getElementById('ai-input')?.addEventListener('keypress', e => { if(e.key==='Enter') sendAI(); });
};
window._pg_crm       = () => { loadCRM(); };
window._pg_reports   = () => { loadReportStats(); loadReports(); loadAuditLog(); loadUsageChart(); calcCost(); loadAnalyticsFunnel(); loadHeatmap(); };
window._pg_settings  = () => { loadSettings(); loadDevApiSettings(); };
window._pg_chatbot   = () => { loadChatbotFlows(); };
window._pg_devices   = () => { loadDevices(); };
window._pg_engine    = () => {
  loadDevices();
  loadEngineStats();
  _ensureAbInit();
  loadCampaigns();
  _updateRiskBadge(15, 45);
  countEngineTargets();
};
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
  const total = groups.length;
  document.getElementById('groups-count').textContent = total;
  document.getElementById('groups-subtitle').textContent =
    total ? `${total} مجموعة` : 'سحب بيانات المجموعات من WhatsApp';

  // Update quick stats
  const _si = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  const synced  = groups.filter(g => g.synced_at).length;
  const members = groups.reduce((s, g) => s + (g.member_count || 0), 0);
  const links   = groups.filter(g => g.invite_link).length;
  _si('grp-stat-total',   total.toLocaleString());
  _si('grp-stat-members', members.toLocaleString());
  _si('grp-stat-synced',  synced.toLocaleString());
  _si('grp-stat-links',   links.toLocaleString());

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

  // Pre-check: verify the session is connected before starting
  try {
    const sessR = await BE.wa.sessions.list();
    if (sessR.ok) {
      const sess = (sessR.data || []).find(s => s.id === sessionId);
      if (sess && sess.status !== 'ready') {
        beErr('الجلسة غير متصلة — اذهب إلى صفحة الأجهزة (Web QR) وابدأ الجلسة أولاً');
        return;
      }
    }
  } catch (_) { /* proceed — let the main call surface any error */ }

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
    let errMsg = e.message;
    if (/Session not active|Session not ready/i.test(errMsg)) {
      errMsg = 'الجلسة غير متصلة — اذهب إلى صفحة الأجهزة (Web QR) وتأكد من اتصال الجلسة أولاً';
    }
    beErr('فشل سحب المجموعات: ' + errMsg);
    progTxt.textContent = '❌ ' + errMsg;
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
  if (!IS_ELECTRON) { _fillSessionSelect('stg-session', [], 'اختر جهاز Web...'); return; }
  const r = await BE.wa.sessions.list();
  const ready = r.ok ? (r.data || []).filter(s => s.status === 'ready') : [];
  _fillSessionSelect('stg-session', ready, 'اختر جهاز Web...');
  const pageSession = document.getElementById('groups-session-sel')?.value;
  if (pageSession) document.getElementById('stg-session').value = pageSession;
}

function _stgResetMedia() {
  document.getElementById('stg-media-path').value = '';
  document.getElementById('stg-media-preview').style.display = 'none';
  document.getElementById('stg-clear-media').style.display  = 'none';
  document.getElementById('stg-body-label').textContent      = 'نص الرسالة';
  document.getElementById('stg-body').placeholder            = 'أهلاً! لدينا عرض مميز اليوم... 🎉';
}

async function pickStgMedia(type) {
  const fp = await _pickMediaFile(type);
  if (!fp) return;
  const fileName = fp.split(/[\\/]/).pop();
  const fileExt  = fileName.split('.').pop().toLowerCase();
  document.getElementById('stg-media-path').value        = fp;
  document.getElementById('stg-media-name').textContent  = fileName;
  document.getElementById('stg-media-size').textContent  = '.' + fileExt.toUpperCase();
  document.getElementById('stg-media-icon').textContent  = _mediaIcons[type] || '📄';
  document.getElementById('stg-media-preview').style.display = 'flex';
  document.getElementById('stg-clear-media').style.display   = 'inline-flex';
  document.getElementById('stg-body-label').textContent  = 'التعليق (Caption) — اختياري';
  document.getElementById('stg-body').placeholder        = 'أضف تعليقاً للمرفق... (اختياري)';
}

function clearStgMedia() {
  _stgResetMedia();
}

async function openSendToGroup(groupId, groupName) {
  _sendToGroupTargets = [groupId];
  document.getElementById('stg-target-info').textContent =
    `المجموعة: ${groupName || groupId}`;
  _stgResetMedia();
  await _populateSendToGroupSessions();
  openM('m-send-to-group');
}

async function openSendToGroupBulk() {
  if (_groupsSelected.size === 0) { beErr('اختر مجموعة واحدة على الأقل'); return; }
  _sendToGroupTargets = Array.from(_groupsSelected);
  document.getElementById('stg-target-info').textContent =
    `${_sendToGroupTargets.length} مجموعة محددة`;
  _stgResetMedia();
  await _populateSendToGroupSessions();
  openM('m-send-to-group');
}

async function sendToGroupConfirm() {
  const sessionId = document.getElementById('stg-session').value;
  const body      = document.getElementById('stg-body').value.trim();
  const mediaPath = document.getElementById('stg-media-path').value.trim();
  const delayMin  = parseInt(document.getElementById('stg-delay-min').value, 10) * 1000;
  const delayMax  = parseInt(document.getElementById('stg-delay-max').value, 10) * 1000;

  if (!sessionId) { beErr('اختر جهاز Web أولاً'); return; }
  if (!body && !mediaPath) { beErr('أدخل نص الرسالة أو أرفق ملفاً'); return; }
  if (!_sendToGroupTargets.length) { beErr('لا توجد مجموعات محددة'); return; }

  closeM('m-send-to-group');

  const targets = [..._sendToGroupTargets];
  const total   = targets.length;
  let sent = 0, failed = 0;

  GP.show(`جارٍ الإرسال إلى ${total} مجموعة...`, 0, `0/${total}`);

  for (let i = 0; i < targets.length; i++) {
    const groupId   = targets[i];
    const groupName = _groupsData.find(g => g.id === groupId)?.name || groupId;

    GP.update(`إرسال إلى: ${groupName}`, Math.round(((i) / total) * 100), `${i + 1}/${total}`);

    try {
      let r;
      if (mediaPath) {
        r = await BE.wa.send.media({ sessionId, to: groupId, filePath: mediaPath, caption: body || '' });
      } else {
        r = await BE.wa.send.text({ sessionId, to: groupId, body });
      }
      if (!r.ok) throw new Error(r.error || 'فشل الإرسال');
      sent++;
    } catch (e) {
      failed++;
      console.warn(`[Groups] Failed → ${groupId}: ${e.message}`);
    }

    // Inter-group delay (skip after last)
    if (i < targets.length - 1) {
      const wait = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
      await new Promise(res => setTimeout(res, wait));
    }
  }

  // Final status
  if (failed === 0) {
    GP.done(`✅ تم الإرسال إلى ${sent} مجموعة`);
    beOk(`✅ تم الإرسال بنجاح إلى ${sent} مجموعة${mediaPath ? ' مع مرفق' : ''}`);
  } else if (sent === 0) {
    GP.hide();
    beErr(`❌ فشل الإرسال إلى جميع المجموعات (${failed})`);
  } else {
    GP.done(`اكتمل: ${sent} نجح، ${failed} فشل`);
    showN('اكتمل الإرسال', `${sent} نجح — ${failed} فشل`, '⚠️');
  }

  // Clear group selection
  _groupsSelected.clear();
  document.querySelectorAll('.grp-row-chk').forEach(cb => cb.checked = false);
  const chkAll   = document.getElementById('grp-chk-all');
  if (chkAll) chkAll.checked = false;
  const bulkBar  = document.getElementById('grp-bulk-bar');
  if (bulkBar) bulkBar.style.display = 'none';
  const selCount = document.getElementById('grp-sel-count');
  if (selCount) selCount.textContent = '0';
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

// ══════════════════════════════════════════════════════════════════════════
// MEMBER MANAGEMENT MODAL v2
// ══════════════════════════════════════════════════════════════════════════

let _mmGroups          = [];      // [{id, name}] target groups
let _mmLoadedMembers   = [];      // [{phone, id, isAdmin, isSuperAdmin}]
let _mmFiltered        = [];      // filtered view of _mmLoadedMembers
let _mmSelected        = new Set(); // member IDs selected for removal
let _mmExcelAdd        = null;    // phones from excel (add tab)
let _mmExcelRem        = null;    // phones from excel (remove tab)
let _mmMethodAdd       = 'manual';
let _mmMethodRem       = 'manual';

function openMembersMgr(groupId, groupName) {
  _mmGroups = [{ id: groupId, name: groupName }];
  _mmInitModal('view');
  openM('m-group-members');
}

function openMembersMgrBulk(action) {
  if (!IS_ELECTRON) { beErr('هذه الميزة تتطلب جلسة WhatsApp Web نشطة'); return; }
  _mmGroups = [..._groupsSelected].map(id => {
    const g = _groupsData.find(x => x.id === id);
    return { id, name: g?.name || id };
  });
  if (!_mmGroups.length) { beErr('حدد مجموعات أولاً'); return; }
  _mmInitModal(action === 'add' ? 'add' : 'remove');
  openM('m-group-members');
}

function _mmInitModal(tab) {
  _mmLoadedMembers = [];
  _mmFiltered      = [];
  _mmSelected      = new Set();
  _mmExcelAdd      = null;
  _mmExcelRem      = null;
  _mmMethodAdd     = 'manual';
  _mmMethodRem     = 'manual';

  // Set target display
  const tgt = document.getElementById('mm-target');
  if (tgt) tgt.textContent = _mmGroups.length === 1 ? _mmGroups[0].name : `${_mmGroups.length} مجموعة`;

  // Sync session dropdown from groups page
  const src  = document.getElementById('groups-session-sel');
  const dest = document.getElementById('mm-session-sel');
  if (src && dest) { dest.innerHTML = src.innerHTML; if (src.value) dest.value = src.value; }

  // Reset member list
  const listEl = document.getElementById('mm-members-list');
  if (listEl) listEl.innerHTML = '<div class="f12 ts" style="padding:30px;text-align:center;opacity:.5">اضغط "تحميل الأعضاء" لعرض القائمة الكاملة</div>';

  const cntEl = document.getElementById('mm-member-count');
  if (cntEl) cntEl.textContent = '—';

  const bulkBar = document.getElementById('mm-bulk-actions');
  if (bulkBar) bulkBar.style.display = 'none';

  // Reset progress/log
  const prog = document.getElementById('mm-progress');
  if (prog) prog.style.display = 'none';
  const log = document.getElementById('mm-log');
  if (log) log.innerHTML = '';
  const bar = document.getElementById('mm-progress-bar');
  if (bar) bar.style.width = '0%';

  const loadBtn = document.getElementById('mm-load-btn');
  if (loadBtn) { loadBtn.disabled = false; loadBtn.textContent = '📥 تحميل الأعضاء'; }

  mmSetTab(tab);
}

function mmSetTab(tab) {
  ['view', 'add', 'remove'].forEach(t => {
    const btn  = document.getElementById('mm-tab-' + t);
    const cont = document.getElementById('mm-tab-' + t + '-content');
    if (btn)  btn.className  = `btn bsm ${t === tab ? 'bp' : 'bo'}`;
    if (cont) cont.style.display = t === tab ? '' : 'none';
  });
}

// ── Member list loader ────────────────────────────────────────────────────

async function mmLoadMembers() {
  const sessionId = document.getElementById('mm-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة أولاً'); return; }
  if (!_mmGroups.length) return;

  const btn = document.getElementById('mm-load-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جارٍ التحميل...'; }

  try {
    const r = await BE.wa.scraper.getParticipants({ sessionId, groupId: _mmGroups[0].id });
    if (!r.ok) throw new Error(r.error);

    _mmLoadedMembers = r.data || [];
    _mmFiltered      = [..._mmLoadedMembers];
    _mmSelected      = new Set();

    const cntEl = document.getElementById('mm-member-count');
    if (cntEl) cntEl.textContent = `${_mmLoadedMembers.length} عضو`;

    const bulkBar = document.getElementById('mm-bulk-actions');
    if (bulkBar) bulkBar.style.display = 'flex';

    _mmRenderList(_mmFiltered);
  } catch (e) {
    beErr('فشل تحميل الأعضاء: ' + e.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 تحديث'; }
  }
}

function _mmRenderList(members) {
  const listEl = document.getElementById('mm-members-list');
  if (!listEl) return;

  if (!members.length) {
    listEl.innerHTML = '<div class="f12 ts" style="padding:24px;text-align:center;opacity:.5">لا توجد نتائج</div>';
    _mmUpdateSelCount();
    return;
  }

  listEl.innerHTML = members.map(m => {
    const key   = m.id || m.phone || '';
    const phone = m.phone || key.split('@')[0] || '—';
    const chk   = _mmSelected.has(key) ? 'checked' : '';
    const isAdm = m.isAdmin || m.isSuperAdmin;
    const badge = isAdm
      ? `<span class="bge bg-y f10" style="padding:1px 6px">${m.isSuperAdmin ? 'سوبر أدمن' : 'أدمن'}</span>`
      : '';
    const lidMark = key.includes('@lid') ? ' <span class="f10 ts">🔐</span>' : '';
    return `<div class="flex ic gap10" style="padding:7px 12px;border-bottom:1px solid rgba(var(--ar),.06);cursor:pointer"
              onclick="mmToggle(${JSON.stringify(key)},this)">
      <input type="checkbox" ${chk} onclick="event.stopPropagation();mmToggle(${JSON.stringify(key)},this.parentElement)"
             style="flex-shrink:0;cursor:pointer;width:15px;height:15px">
      <div class="fi">
        <span class="f12 fw6" style="direction:ltr;font-family:monospace">${escH(phone)}</span>
        ${badge}${lidMark}
      </div>
    </div>`;
  }).join('');

  _mmUpdateSelCount();
}

function mmToggle(key, rowEl) {
  if (_mmSelected.has(key)) _mmSelected.delete(key); else _mmSelected.add(key);
  const cb = rowEl.querySelector('input[type="checkbox"]');
  if (cb) cb.checked = _mmSelected.has(key);
  _mmUpdateSelCount();
}

function _mmUpdateSelCount() {
  const el = document.getElementById('mm-sel-count');
  if (el) el.textContent = `${_mmSelected.size} محدد`;
}

function mmSelectAll()       { _mmFiltered.forEach(m => _mmSelected.add(m.id||m.phone||'')); _mmRenderList(_mmFiltered); }
function mmSelectNone()      { _mmSelected.clear(); _mmRenderList(_mmFiltered); }
function mmSelectNonAdmins() {
  _mmSelected.clear();
  _mmFiltered.filter(m => !m.isAdmin && !m.isSuperAdmin).forEach(m => _mmSelected.add(m.id||m.phone||''));
  _mmRenderList(_mmFiltered);
}

function mmFilterMembers(q) {
  const t = (q || '').trim().toLowerCase();
  _mmFiltered = t ? _mmLoadedMembers.filter(m => (m.phone||'').includes(t)||(m.id||'').includes(t)) : [..._mmLoadedMembers];
  _mmRenderList(_mmFiltered);
}

async function mmRemoveSelected() {
  if (!_mmSelected.size) { beErr('حدد أعضاء للحذف أولاً'); return; }
  const sessionId = document.getElementById('mm-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة أولاً'); return; }
  if (!_mmGroups.length) return;

  if (!confirm(`هل تريد حذف ${_mmSelected.size} عضو من "${_mmGroups[0].name}"؟`)) return;

  const memberIds = [..._mmSelected];
  const logEl     = document.getElementById('mm-log');
  const prog      = document.getElementById('mm-progress');
  if (prog)  prog.style.display = 'block';
  if (logEl) logEl.innerHTML = `<div>⏳ جارٍ حذف ${memberIds.length} عضو...</div>`;

  try {
    const r = await BE.wa.groups.removeMembersByIds({ sessionId, groupId: _mmGroups[0].id, memberIds });
    if (r.ok) {
      const d = r.data || {};
      logEl.innerHTML += `<div style="color:var(--acc)">✅ تم حذف ${d.removed || 0} عضو بنجاح</div>`;
      if (d.errors?.length) logEl.innerHTML += `<div style="color:#f93">⚠️ أخطاء: ${escH(d.errors.join(', '))}</div>`;
      _mmSelected.clear();
      await mmLoadMembers();
    } else {
      logEl.innerHTML += `<div style="color:#ef4444">❌ ${escH(r.error)}</div>`;
    }
  } catch (e) {
    logEl.innerHTML += `<div style="color:#ef4444">❌ ${escH(e.message)}</div>`;
  }
  logEl.scrollTop = logEl.scrollHeight;
}

// ── Add / Remove by phones ────────────────────────────────────────────────

function setMembersMethodFor(tab, method) {
  if (tab === 'add') {
    _mmMethodAdd = method;
    document.getElementById('mm-add-manual-sec').style.display = method === 'manual' ? '' : 'none';
    document.getElementById('mm-add-excel-sec').style.display  = method === 'excel'  ? '' : 'none';
    document.getElementById('mm-method-add-manual').className  = `btn bsm ${method === 'manual' ? 'bp' : 'bo'}`;
    document.getElementById('mm-method-add-excel').className   = `btn bsm ${method === 'excel'  ? 'bp' : 'bo'}`;
  } else {
    _mmMethodRem = method;
    document.getElementById('mm-rem-manual-sec').style.display = method === 'manual' ? '' : 'none';
    document.getElementById('mm-rem-excel-sec').style.display  = method === 'excel'  ? '' : 'none';
    document.getElementById('mm-method-rem-manual').className  = `btn bsm ${method === 'manual' ? 'bp' : 'bo'}`;
    document.getElementById('mm-method-rem-excel').className   = `btn bsm ${method === 'excel'  ? 'bp' : 'bo'}`;
  }
}

async function pickMembersExcelFor(tab) {
  if (!IS_ELECTRON) return;
  const fp = await BE.openFile({ filters: [{ name: 'Excel', extensions: ['xlsx','xls','csv'] }] });
  if (!fp) return;
  const r = await BE.wa.groups.readPhonesFromExcel(fp);
  if (!r.ok) { beErr(r.error); return; }
  if (tab === 'add') {
    _mmExcelAdd = r.data;
    document.getElementById('mm-add-excel-info').textContent = `✅ ${r.data.length} رقم`;
  } else {
    _mmExcelRem = r.data;
    document.getElementById('mm-rem-excel-info').textContent = `✅ ${r.data.length} رقم`;
  }
}

function _mmGetPhones(tab) {
  if (tab === 'add') {
    if (_mmMethodAdd === 'excel') return _mmExcelAdd || [];
    const raw = document.getElementById('mm-add-phones')?.value || '';
    return raw.split(/[\n,;]+/).map(p => p.trim().replace(/[\s\-\+\(\)]/g,'')).filter(p => /^\d{7,15}$/.test(p));
  } else {
    if (_mmMethodRem === 'excel') return _mmExcelRem || [];
    const raw = document.getElementById('mm-rem-phones')?.value || '';
    return raw.split(/[\n,;]+/).map(p => p.trim().replace(/[\s\-\+\(\)]/g,'')).filter(p => /^\d{7,15}$/.test(p));
  }
}

async function submitMembersAdd(dryRun = false) {
  const sessionId = document.getElementById('mm-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة أولاً'); return; }
  const phones = _mmGetPhones('add');
  if (!phones.length) { beErr('لم يتم إدخال أرقام صالحة'); return; }

  const btn   = document.getElementById(dryRun ? 'mm-add-test-btn' : 'mm-add-btn');
  const logEl = document.getElementById('mm-log');
  const prog  = document.getElementById('mm-progress');
  const bar   = document.getElementById('mm-progress-bar');
  if (btn)  btn.disabled = true;
  if (prog) prog.style.display = 'block';
  if (logEl) logEl.innerHTML = '';
  if (bar)  bar.style.width = '0%';

  for (const [i, group] of _mmGroups.entries()) {
    if (bar) bar.style.width = Math.round(i / _mmGroups.length * 100) + '%';
    if (dryRun) {
      logEl.innerHTML += `<div style="color:#8b5cf6">🔍 اختبار: ${phones.length} رقم ← "${escH(group.name)}"</div>`;
    } else {
      logEl.innerHTML += `<div>⏳ إضافة ${phones.length} رقم إلى "${escH(group.name)}"...</div>`;
      try {
        const r = await BE.wa.groups.addMembers({ sessionId, groupId: group.id, phones });
        if (r.ok) logEl.innerHTML += `<div style="color:var(--acc)">✅ ${escH(group.name)}: تم إضافة ${r.data?.added ?? phones.length} عضو</div>`;
        else      logEl.innerHTML += `<div style="color:#ef4444">❌ ${escH(group.name)}: ${escH(r.error)}</div>`;
      } catch (e) {
        logEl.innerHTML += `<div style="color:#ef4444">❌ ${escH(group.name)}: ${escH(e.message)}</div>`;
      }
    }
    logEl.scrollTop = logEl.scrollHeight;
  }
  if (bar) bar.style.width = '100%';
  if (btn) btn.disabled = false;
}

async function submitMembersRemove(dryRun = false) {
  const sessionId = document.getElementById('mm-session-sel').value;
  if (!sessionId) { beErr('اختر جلسة أولاً'); return; }
  const phones = _mmGetPhones('remove');
  if (!phones.length) { beErr('لم يتم إدخال أرقام صالحة'); return; }

  const btn   = document.getElementById(dryRun ? 'mm-rem-test-btn' : 'mm-rem-btn');
  const logEl = document.getElementById('mm-log');
  const prog  = document.getElementById('mm-progress');
  const bar   = document.getElementById('mm-progress-bar');
  if (btn)  btn.disabled = true;
  if (prog) prog.style.display = 'block';
  if (logEl) logEl.innerHTML = '';
  if (bar)  bar.style.width = '0%';

  for (const [i, group] of _mmGroups.entries()) {
    if (bar) bar.style.width = Math.round(i / _mmGroups.length * 100) + '%';
    logEl.innerHTML += `<div>⏳ ${dryRun ? '🔍 اختبار' : 'حذف'} في "${escH(group.name)}" (${phones.length} رقم)...</div>`;
    try {
      const payload = { sessionId, groupId: group.id, phones };
      if (dryRun) payload.dryRun = true;
      const r = await BE.wa.groups.removeMembers(payload);
      if (r.ok) {
        const d = r.data || {};
        if (dryRun) {
          const fmt = d.sampleFormat ? ` ← مثال من المجموعة: ${d.sampleFormat}` : '';
          logEl.innerHTML += `<div style="color:#8b5cf6">🔍 موجود (${(d.found||[]).length}): ${escH((d.found||[]).join(', ')||'—')}</div>`;
          if (d.notFound?.length) {
            logEl.innerHTML += `<div style="color:#f93">⚠️ غير موجود (${d.notFound.length}): ${escH(d.notFound.slice(0,5).join(', '))}${escH(fmt)}</div>`;
          }
        } else {
          logEl.innerHTML += `<div style="color:var(--acc)">✅ ${escH(group.name)}: تم حذف ${d.removed ?? 0} عضو</div>`;
          if (d.hint)              logEl.innerHTML += `<div style="color:#94a3b8">💡 ${escH(d.hint)}</div>`;
          if (d.notFound?.length)  logEl.innerHTML += `<div style="color:#f93">⚠️ لم يُعثر على ${d.notFound.length}: ${escH(d.notFound.slice(0,5).join(', '))}</div>`;
        }
      } else {
        logEl.innerHTML += `<div style="color:#ef4444">❌ ${escH(group.name)}: ${escH(r.error)}</div>`;
      }
    } catch (e) {
      logEl.innerHTML += `<div style="color:#ef4444">❌ ${escH(group.name)}: ${escH(e.message)}</div>`;
    }
    logEl.scrollTop = logEl.scrollHeight;
  }
  if (bar) bar.style.width = '100%';
  if (btn) btn.disabled = false;
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
let _mediaFilter = 'all';
let _mediaSearch = '';

function _toFileUrl(p) {
  if (!p) return '';
  return 'file:///' + p.replace(/\\/g, '/');
}

function _mediaCategory(mimeType) {
  const t = (mimeType || '').split('/')[0];
  if (t === 'image') return 'image';
  if (t === 'video') return 'video';
  return 'doc';
}

async function loadMedia() {
  if (!IS_ELECTRON) return;
  const r = await safeIpc(() => BE.media.list());
  if (!r) return;
  _mediaList = r;
  _renderMediaGrid();
}

function _renderMediaGrid() {
  const grid = document.getElementById('media-grid');
  if (!grid) return;

  let img = 0, vid = 0, doc = 0;
  const query = _mediaSearch.toLowerCase();

  const filtered = _mediaList.filter(m => {
    const cat = _mediaCategory(m.mime_type);
    if (_mediaFilter !== 'all' && cat !== _mediaFilter) return false;
    if (query && !m.name.toLowerCase().includes(query)) return false;
    if (cat === 'image') img++;
    else if (cat === 'video') vid++;
    else doc++;
    return true;
  });

  // Recount totals from full list
  let ti = 0, tv = 0, td = 0;
  _mediaList.forEach(m => {
    const c = _mediaCategory(m.mime_type);
    if (c === 'image') ti++; else if (c === 'video') tv++; else td++;
  });
  const el = id => document.getElementById(id);
  if (el('media-cnt-img'))   el('media-cnt-img').textContent   = ti;
  if (el('media-cnt-vid'))   el('media-cnt-vid').textContent   = tv;
  if (el('media-cnt-pdf'))   el('media-cnt-pdf').textContent   = td;
  if (el('media-cnt-total')) el('media-cnt-total').textContent = _mediaList.length;

  // Update active filter button
  ['all','image','video','doc'].forEach(f => {
    const btn = document.getElementById('mf-' + f);
    if (btn) btn.className = 'btn bsm ' + (_mediaFilter === f ? 'bp' : 'bo');
  });

  if (!filtered.length) {
    grid.innerHTML = '<div style="text-align:center;padding:32px;opacity:.4;grid-column:1/-1" class="f12 ts">لا توجد ملفات</div>';
    return;
  }

  grid.innerHTML = filtered.map(m => {
    const cat  = _mediaCategory(m.mime_type);
    const kb   = m.size_bytes ? (m.size_bytes < 1048576
      ? Math.round(m.size_bytes / 1024) + ' KB'
      : (m.size_bytes / 1048576).toFixed(1) + ' MB') : '';
    const furl = _toFileUrl(m.file_path);
    let thumb;
    if (cat === 'image') {
      thumb = `<img src="${escH(furl)}" alt="" style="width:100%;height:110px;object-fit:cover;border-radius:6px;display:block"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
               <div style="display:none;font-size:36px;padding:20px 0">🖼️</div>`;
    } else if (cat === 'video') {
      thumb = `<div style="font-size:36px;padding:20px 0;background:#111;border-radius:6px">🎬</div>`;
    } else {
      thumb = `<div style="font-size:36px;padding:20px 0;background:#1a1a2e;border-radius:6px">📄</div>`;
    }
    return `<div class="card" style="padding:10px;cursor:pointer;text-align:center;transition:transform .15s"
                 onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform=''"
                 onclick="mediaPreview(${m.id})" title="${escH(m.name)}">
      ${thumb}
      <div class="f11 fw6 mt6" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escH(m.name)}</div>
      <div class="f10 ts">${kb}</div>
      <div class="flex gap6 mt6 ic jc" onclick="event.stopPropagation()">
        <button class="btn bo bsm" style="padding:3px 7px;font-size:10px" onclick="mediaUseInEngine(${JSON.stringify(m.file_path)})">📤</button>
        <button class="btn bd bsm" style="padding:3px 7px;font-size:10px" onclick="mediaDelete(${JSON.stringify(m.id)})">🗑️</button>
      </div>
    </div>`;
  }).join('');
}

function filterMedia(type) {
  _mediaFilter = type;
  _renderMediaGrid();
}

function filterMediaSearch(q) {
  _mediaSearch = q;
  _renderMediaGrid();
}

function mediaPreview(id) {
  const m = _mediaList.find(x => x.id === id);
  if (!m) return;
  const cat  = _mediaCategory(m.mime_type);
  const furl = _toFileUrl(m.file_path);

  const title   = document.getElementById('mp-title');
  const content = document.getElementById('mp-content');
  const useBtn  = document.getElementById('mp-use-btn');
  const delBtn  = document.getElementById('mp-del-btn');
  if (!content) return;

  if (title) title.textContent = m.name;

  if (cat === 'image') {
    content.innerHTML = `<img src="${escH(furl)}" alt="" style="max-width:100%;max-height:420px;border-radius:8px;box-shadow:0 4px 20px #0006">`;
  } else if (cat === 'video') {
    content.innerHTML = `<video src="${escH(furl)}" controls style="max-width:100%;max-height:420px;border-radius:8px"></video>`;
  } else {
    content.innerHTML = `<div style="padding:40px">
      <div style="font-size:64px">📄</div>
      <div class="fw6 mt12">${escH(m.name)}</div>
      <div class="ts mt4 f12">${m.size_bytes ? Math.round(m.size_bytes/1024) + ' KB' : ''}</div>
    </div>`;
  }

  if (useBtn) useBtn.onclick = () => { closeM('m-media-preview'); mediaUseInEngine(m.file_path); };
  if (delBtn) delBtn.onclick = () => { closeM('m-media-preview'); mediaDelete(m.id); };

  openM('m-media-preview');
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
    const dir  = out ? 'out' : 'in';
    const body = (m.body||'').slice(0, 300);
    return `<div style="display:flex;justify-content:${align}" data-dir="${dir}" data-body="${escH(body)}">
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
    _hideSmartSuggestions();
    await reloadConversation(_convPhone);
  }
}

function _hideSmartSuggestions() {
  const el = document.getElementById('conv-smart-suggestions');
  if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}

async function getSmartReplies() {
  if (!IS_ELECTRON) return;
  const btn  = document.getElementById('conv-smart-btn');
  const sugEl= document.getElementById('conv-smart-suggestions');
  if (!btn || !sugEl) return;

  btn.disabled  = true;
  btn.textContent = '⏳';
  sugEl.style.display = 'flex';
  sugEl.innerHTML = '<span class="f11 ts" style="padding:4px">جارٍ التفكير...</span>';

  // Build conversation array from rendered thread
  const thread = document.getElementById('conv-thread');
  const conversation = [];
  if (thread) {
    thread.querySelectorAll('[data-dir]').forEach(el => {
      conversation.push({ dir: el.dataset.dir, body: el.dataset.body || '' });
    });
  }

  const res = await safeIpc(() => BE.ai.smartReplies({ conversation, contactName: _convPhone }));
  btn.disabled  = false;
  btn.textContent = '🤖';

  const suggestions = res?.suggestions || [];
  if (!suggestions.length) {
    sugEl.innerHTML = '<span class="f11 ts" style="padding:4px">لا توجد اقتراحات</span>';
    return;
  }
  sugEl.innerHTML = suggestions.map(s =>
    `<button class="btn bo bsm" style="font-size:11px;padding:4px 10px;white-space:nowrap"
             onclick="document.getElementById('conv-reply-input').value=${JSON.stringify(s)};_hideSmartSuggestions()">${escH(s)}</button>`
  ).join('');
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

// ══════════════════════════════════════════════════════════════════════════
// PHASE 4 — AI INTELLIGENCE FEATURES
// ══════════════════════════════════════════════════════════════════════════

// Smart Reply Suggestions
async function loadSmartReplies(phone, contactName) {
  if (!IS_ELECTRON) return;
  const panel    = document.getElementById('ai-smart-panel');
  const repliesEl= document.getElementById('ai-smart-replies');
  const summaryEl= document.getElementById('ai-conv-summary');
  if (!panel) return;
  panel.style.display = '';
  if (repliesEl) repliesEl.innerHTML = '<span class="f11 ts">جارٍ إنشاء الردود...</span>';
  if (summaryEl) summaryEl.textContent = '';

  const convR = await BE.wa.inbox.conversation
    ? BE.wa.inbox.conversation(phone, 10)
    : { ok: false };

  const [repliesR, summaryR] = await Promise.all([
    BE.ai.smartReplies({ conversation: convR.ok ? convR.data : [], contactName, businessContext: '' }),
    convR.ok && convR.data?.length > 2
      ? BE.ai.summarize({ messages: convR.data, contactName })
      : Promise.resolve(null),
  ]);

  if (repliesEl) {
    const sugs = repliesR?.suggestions || [];
    repliesEl.innerHTML = sugs.length
      ? sugs.map(s => `<button class="btn bo bsm" onclick="document.getElementById('reply-body-input').value='${esc(s)}';openReplyModal('','${esc(phone)}','','');document.getElementById('ai-smart-panel').style.display='none'">${esc(s)}</button>`).join('')
      : '<span class="f11 ts">لا توجد اقتراحات</span>';
  }
  if (summaryEl && summaryR?.content) {
    summaryEl.textContent = '📋 ملخص: ' + summaryR.content;
  }
}

// AI Campaign Optimizer
async function runAICampaignOptimizer() {
  if (!IS_ELECTRON) return;
  const el = document.getElementById('ai-campaign-analysis');
  if (el) { el.style.display = ''; el.innerHTML = '<span class="f12 ts">جارٍ التحليل...</span>'; }

  const r = await BE.messages.getStats();
  if (!r.ok) { if(el) el.innerHTML = '<span class="f12 ts">تعذر تحميل إحصائيات الحملة</span>'; return; }

  const res = await BE.ai.optimizeCampaign({ ...r.data });
  if (!res || el === null) return;
  if (el) el.innerHTML = `
    <div class="f12 mb8">${esc(res.analysis||'')}</div>
    <ul style="margin:0;padding-right:16px">
      ${(res.suggestions||[]).map(s=>`<li class="f12 mb4">${esc(s)}</li>`).join('')}
    </ul>`;
  BE.audit.log({ event_type: 'ai_campaign_optimizer', description: 'تشغيل محسّن الحملة AI' });
}

async function showAICampaignOptimizer() {
  const panel = document.getElementById('ai-optimizer-panel');
  if (!panel) return;
  if (panel.style.display !== 'none') { panel.style.display = 'none'; return; }
  panel.style.display = '';
  const content = document.getElementById('ai-optimizer-content');
  if (content) content.textContent = 'جارٍ التحليل...';
  if (!IS_ELECTRON) { if(content) content.textContent = 'AI غير متاح في وضع العرض'; return; }
  const r = await BE.messages.getStats();
  if (r.ok) {
    const res = await BE.ai.optimizeCampaign({ ...r.data });
    if (content) content.innerHTML = `<b>${esc(res.analysis||'')}</b><ul style="margin:6px 0 0;padding-right:16px">${(res.suggestions||[]).map(s=>`<li>${esc(s)}</li>`).join('')}</ul>`;
  }
}

// Reply Classification (runs after inbox load, classifies top unreplied)
async function classifyInboxMessages(msgs) {
  if (!IS_ELECTRON || !msgs?.length) return;
  const unreplied = msgs.filter(m => !m.replied && m.body).slice(0, 5);
  for (const m of unreplied) {
    const result = await BE.ai.classify(m.body || '');
    if (!result) continue;
    const intentColors = {
      interested:     '#22c55e',
      not_interested: '#ef4444',
      question:       '#3b82f6',
      complaint:      '#f59e0b',
      request:        '#8b5cf6',
    };
    const badgeEl = document.querySelector(`[data-intent-msg="${m.id}"]`);
    if (badgeEl) {
      badgeEl.textContent = result.intent;
      badgeEl.style.background = intentColors[result.intent] || '#64748b';
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 3 — AUDIENCE BUILDER
// ══════════════════════════════════════════════════════════════════════════
let _audienceConditions = [];
const AUD_FIELDS = [
  {v:'name',l:'الاسم'},{v:'phone',l:'الهاتف'},{v:'country',l:'الدولة'},
  {v:'group_tag',l:'المجموعة'},{v:'label',l:'التصنيف'},{v:'opt_in',l:'موافقة التسويق'},
];
const AUD_OPS = [
  {v:'contains',l:'يحتوي'},{v:'eq',l:'يساوي'},{v:'starts',l:'يبدأ بـ'},
  {v:'neq',l:'لا يساوي'},{v:'empty',l:'فارغ'},
];

function addAudienceCondition() {
  _audienceConditions.push({ field: 'name', op: 'contains', value: '' });
  renderAudienceConditions();
}

function removeAudienceCondition(i) {
  _audienceConditions.splice(i, 1);
  renderAudienceConditions();
}

function renderAudienceConditions() {
  const el = document.getElementById('audience-conditions');
  if (!el) return;
  el.innerHTML = _audienceConditions.map((c, i) => `
    <div class="flex ic gap8" style="background:rgba(var(--ar),.04);padding:8px;border-radius:8px">
      <select class="fc bsm" style="width:130px" onchange="_audienceConditions[${i}].field=this.value">
        ${AUD_FIELDS.map(f=>`<option value="${f.v}"${c.field===f.v?' selected':''}>${f.l}</option>`).join('')}
      </select>
      <select class="fc bsm" style="width:110px" onchange="_audienceConditions[${i}].op=this.value">
        ${AUD_OPS.map(o=>`<option value="${o.v}"${c.op===o.v?' selected':''}>${o.l}</option>`).join('')}
      </select>
      <input class="fc fi bsm" type="text" placeholder="القيمة..." value="${esc(c.value)}" oninput="_audienceConditions[${i}].value=this.value">
      <button class="btn bd bsm" onclick="removeAudienceCondition(${i})">✕</button>
    </div>`).join('');
  if (!_audienceConditions.length) el.innerHTML = '<div class="f11 ts" style="padding:6px">لا توجد شروط — اضغط ➕ شرط لإضافة فلتر</div>';
}

async function applyAudienceFilter() {
  if (!IS_ELECTRON) return;
  const r = await BE.audience.filter(_audienceConditions);
  if (!r.ok) { beErr('خطأ في الفلترة'); return; }
  _allContacts = r.data;
  renderContactsTable(_allContacts);
  const el = document.getElementById('audience-result-count');
  if (el) el.textContent = `✅ ${r.data.length.toLocaleString()} جهة اتصال مطابقة`;
  BE.audit.log({ event_type: 'audience_filter', description: `فلترة الجمهور: ${r.data.length} نتيجة` });
}

async function saveAudience() {
  if (!IS_ELECTRON || !_audienceConditions.length) { beErr('أضف شروطاً أولاً'); return; }
  const name = prompt('اسم الجمهور:');
  if (!name) return;
  const r = await BE.audience.save({ name, conditions: _audienceConditions, count: _allContacts.length });
  if (r.ok) beOk('تم حفظ الجمهور');
}

async function loadSavedAudiences() {
  if (!IS_ELECTRON) return;
  const r = await BE.audience.list();
  if (!r.ok) return;
  const list = r.data;
  if (!list.length) { beErr('لا توجد جماهير محفوظة'); return; }
  const opts = list.map((a,i)=>`${i+1}. ${a.name} (${a.count})`).join('\n');
  const idx = prompt('اختر رقم الجمهور:\n'+opts);
  if (!idx) return;
  const aud = list[parseInt(idx,10)-1];
  if (!aud) return;
  try { _audienceConditions = JSON.parse(aud.conditions); renderAudienceConditions(); applyAudienceFilter(); }
  catch(_) { beErr('خطأ في تحميل الجمهور'); }
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 3 — CONVERSATION SEARCH (FTS5)
// ══════════════════════════════════════════════════════════════════════════
let _searchDebounce = null;
async function searchConversations(query) {
  clearTimeout(_searchDebounce);
  const resEl = document.getElementById('inbox-search-results');
  const cntEl = document.getElementById('inbox-search-count');
  if (!query || query.length < 2) {
    if (resEl) resEl.style.display = 'none';
    if (cntEl) cntEl.textContent = '';
    return;
  }
  _searchDebounce = setTimeout(async () => {
    if (!IS_ELECTRON) return;
    // Search inbox (incoming_messages FTS) — much more relevant than outgoing messages
    const r = await BE.messages.inboxSearch(query, 50);
    if (!resEl) return;
    const hits = Array.isArray(r) ? r : (r?.data || []);
    if (cntEl) cntEl.textContent = hits.length ? `${hits.length} نتيجة` : '';
    resEl.style.display = hits.length ? '' : 'none';
    resEl.innerHTML = hits.length
      ? `<table class="dt"><thead><tr><th>المُرسِل</th><th>النص</th><th>الجلسة</th><th>التاريخ</th></tr></thead><tbody>${
          hits.map(h => {
            const bodyHtml = (h.highlight || esc(h.body || '')).replace(/<mark>/g, '<mark style="background:rgba(var(--ar),.25);border-radius:2px">');
            return `<tr>
              <td class="f11 fm">${esc(h.from_number || h.recipient || '')}</td>
              <td class="f12" style="max-width:300px">${bodyHtml}</td>
              <td class="f11 ts">${esc(h.session_id || '')}</td>
              <td class="f11 ts">${(h.timestamp || h.received_at || h.sent_at || '').slice(0, 16)}</td>
            </tr>`;
          }).join('')
        }</tbody></table>`
      : '<div class="f12 ts" style="padding:10px">لا توجد نتائج</div>';
  }, 350);
}

function clearConversationSearch() {
  const inp = document.getElementById('inbox-search-input');
  if (inp) inp.value = '';
  const resEl = document.getElementById('inbox-search-results');
  const cntEl = document.getElementById('inbox-search-count');
  if (resEl) resEl.style.display = 'none';
  if (cntEl) cntEl.textContent = '';
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 3 — AUDIT LOG
// ══════════════════════════════════════════════════════════════════════════
async function loadAuditLog() {
  if (!IS_ELECTRON) return;
  const r = await BE.audit.list(200);
  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;
  if (!r.ok) { tbody.innerHTML = '<tr><td colspan="4" class="ta f12 ts" style="padding:18px">تعذر تحميل السجل</td></tr>'; return; }
  const rows = r.data;
  tbody.innerHTML = rows.length
    ? rows.map(a=>`<tr>
        <td class="f11 ts" style="white-space:nowrap">${(a.created_at||'').slice(0,16)}</td>
        <td><span class="bge bg-b f11">${esc(a.event_type)}</span></td>
        <td class="f12">${esc(a.description)}</td>
        <td class="f11 ts">${esc(a.session_id||'—')}</td>
      </tr>`).join('')
    : '<tr><td colspan="4" class="ta f12 ts" style="padding:24px">لا توجد سجلات تدقيق حتى الآن</td></tr>';
}

async function exportAuditLog() {
  if (!IS_ELECTRON) return;
  const r = await BE.audit.export();
  if (!r.ok) { beErr('تعذر تصدير السجل'); return; }
  const rows = r.data;
  const header = 'created_at,event_type,description,session_id,meta\n';
  const csv = header + rows.map(a =>
    [a.created_at, a.event_type, `"${(a.description||'').replace(/"/g,'""')}"`, a.session_id||'', a.meta||''].join(',')
  ).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
  beOk('تم تصدير سجل التدقيق');
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 3 — USAGE ALERTS + CHART
// ══════════════════════════════════════════════════════════════════════════
async function loadUsageChart() {
  if (!IS_ELECTRON) return;
  const r = await BE.stats.dailySent(7);
  if (!r.ok) return;
  const data = r.data;
  const barsEl   = document.getElementById('usage-bars');
  const labelsEl = document.getElementById('usage-labels');
  if (!barsEl) return;
  const maxVal = Math.max(...data.map(d=>d.count), 1);
  const limit  = parseInt(localStorage.getItem('usage_daily_limit') || '0', 10);
  barsEl.innerHTML = data.map(d => {
    const pct    = Math.round(d.count / maxVal * 100);
    const isHigh = limit && d.count >= limit * 0.9;
    const isMed  = limit && d.count >= limit * 0.7;
    const color  = isHigh ? '#ef4444' : isMed ? '#f59e0b' : 'var(--acc)';
    return `<div title="${d.date}: ${d.count} رسالة" style="flex:1;height:${pct||2}%;background:${color};border-radius:4px 4px 0 0;min-height:3px;transition:height .3s"></div>`;
  }).join('');
  if (labelsEl) labelsEl.innerHTML = data.map(d => `<span>${d.date.slice(5)}</span>`).join('');
  if (limit) {
    const todayData = data[data.length-1];
    const todayPct  = todayData ? Math.round(todayData.count / limit * 100) : 0;
    const pctEl = document.getElementById('usage-pct-label');
    if (pctEl) { pctEl.textContent = `${todayPct}% من الحد اليومي`; pctEl.style.color = todayPct>=90?'#ef4444':todayPct>=70?'#f59e0b':'var(--ts)'; }
    if (todayPct >= 90) showN('⚠️ تحذير الاستخدام', `وصلت إلى ${todayPct}% من الحد اليومي (${todayData.count}/${limit})`, '⚠️');
    else if (todayPct >= 70) showN('💡 إشعار الاستخدام', `استخدمت ${todayPct}% من الحد اليومي`, '💡');
  }
  const limitEl = document.getElementById('usage-daily-limit-label');
  if (limitEl) limitEl.textContent = limit ? `الحد: ${limit.toLocaleString()} رسالة/يوم` : '';
  const limitInput = document.getElementById('usage-limit-input');
  if (limitInput && limit) limitInput.value = limit;
}

function saveUsageLimit(val) {
  const n = parseInt(val, 10);
  if (n > 0) localStorage.setItem('usage_daily_limit', n);
  else localStorage.removeItem('usage_daily_limit');
  loadUsageChart();
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 3 — COST ESTIMATOR
// ══════════════════════════════════════════════════════════════════════════
const COST_PER_MSG = { utility: 0.005, marketing: 0.02, service: 0.001 };
function calcCost() {
  const msgs    = parseInt(document.getElementById('cost-msgs')?.value || '0', 10);
  const type    = document.getElementById('cost-type')?.value || 'marketing';
  const cost    = (msgs * (COST_PER_MSG[type] || 0.02)).toFixed(2);
  const el      = document.getElementById('cost-result');
  if (el) el.textContent = `${parseFloat(cost).toLocaleString()} $`;
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 5 — ADVANCED ANALYTICS (FUNNEL + HEATMAP)
// ══════════════════════════════════════════════════════════════════════════
async function loadAnalyticsFunnel() {
  if (!IS_ELECTRON) return;
  const r = await BE.analytics.funnel(30);
  const el = document.getElementById('funnel-chart');
  if (!r.ok || !el) return;
  const d = r.data;
  const steps = [
    { label:'📤 مُرسَل', n:d.sent, color:'var(--acc)' },
    { label:'📬 مُستلَم', n:d.delivered, color:'#3b82f6' },
    { label:'👁️ مقروء', n:d.read, color:'#8b5cf6' },
    { label:'💬 ردود', n:d.replied, color:'#22c55e' },
  ];
  const maxVal = Math.max(d.sent, 1);
  el.innerHTML = steps.map(s => {
    const pct = Math.round(s.n / maxVal * 100);
    return `<div>
      <div class="flex ic jb f12 mb4"><span>${s.label}</span><span class="fm" style="color:${s.color}">${s.n.toLocaleString()} (${pct}%)</span></div>
      <div style="background:rgba(var(--ar),.08);border-radius:4px;height:20px;overflow:hidden">
        <div style="width:${pct}%;height:100%;background:${s.color};transition:width .4s ease;border-radius:4px"></div>
      </div>
    </div>`;
  }).join('');
}

async function loadHeatmap() {
  if (!IS_ELECTRON) return;
  const r = await BE.analytics.heatmap(30);
  const el = document.getElementById('heatmap-chart');
  if (!r.ok || !el) return;
  const data = r.data;
  const hours = Array.from({length:24}, (_,i)=>i);
  const days  = ['أحد','إثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
  const lookup = {};
  data.forEach(row => { lookup[`${row.dow}-${row.hour}`] = row.count; });
  const maxCount = Math.max(...data.map(d=>d.count), 1);
  let html = '<table style="border-collapse:collapse;font-size:10px">';
  html += '<tr><th style="padding:2px 6px"></th>' + hours.map(h=>`<th style="padding:2px 4px;text-align:center;color:var(--ts)">${h}:00</th>`).join('') + '</tr>';
  for (let dow = 0; dow <= 6; dow++) {
    html += `<tr><td style="padding:2px 8px;white-space:nowrap;color:var(--ts)">${days[dow]}</td>`;
    for (const h of hours) {
      const key = `${dow}-${h.toString().padStart(2,'0')}`;
      const cnt = lookup[key] || 0;
      const alpha = cnt ? (0.15 + (cnt/maxCount) * 0.85).toFixed(2) : '0.03';
      html += `<td title="${days[dow]} ${h}:00 — ${cnt} رسالة" style="width:18px;height:18px;background:rgba(var(--ar),${alpha});border-radius:3px;margin:1px"></td>`;
    }
    html += '</tr>';
  }
  html += '</table>';
  el.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 5 — CHATBOT BUILDER
// ══════════════════════════════════════════════════════════════════════════
let _editingFlowId = null;
let _chatbotNodes  = [];

async function loadChatbotFlows() {
  if (!IS_ELECTRON) return;
  const r = await BE.chatbot.list();
  const el = document.getElementById('chatbot-flows-list');
  const cnt = document.getElementById('chatbot-count');
  if (!el) return;
  if (!r.ok) { el.innerHTML = '<div class="f12 ts" style="padding:20px;text-align:center">تعذر التحميل</div>'; return; }
  const flows = r.data;
  if (cnt) cnt.textContent = `${flows.length} تدفق`;
  el.innerHTML = flows.length ? flows.map(f => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:12px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;background:${f.active?'rgba(var(--ar),.02)':'rgba(var(--ar),.005)'}">
      <div>
        <div class="fw6 f13">${esc(f.name)}</div>
        <div class="f11 ts mt2">كلمات مفتاحية: ${esc(f.trigger_keywords||'—')}</div>
      </div>
      <div class="flex gap8 ic">
        <span class="bge ${f.active?'bg-g':'bg-r'} f11">${f.active?'نشط':'موقوف'}</span>
        <button class="btn bo bsm" onclick="editChatbotFlow('${f.id}')">✏️ تعديل</button>
        <button class="btn bd bsm" onclick="deleteChatbotFlow('${f.id}')">🗑️</button>
      </div>
    </div>`).join('')
    : '<div class="f12 ts" style="padding:32px;text-align:center">لا توجد تدفقات — اضغط ➕ تدفق جديد</div>';
}

function newChatbotFlow() {
  _editingFlowId = null;
  _chatbotNodes  = [{ id: '1', type: 'message', content: '' }];
  document.getElementById('chatbot-flow-name').value     = '';
  document.getElementById('chatbot-flow-keywords').value = '';
  document.getElementById('chatbot-editor').style.display = '';
  renderChatbotNodes();
}

async function editChatbotFlow(id) {
  if (!IS_ELECTRON) return;
  const r = await BE.chatbot.get(id);
  if (!r.ok || !r.data) return;
  const flow = r.data;
  _editingFlowId = id;
  _chatbotNodes  = JSON.parse(flow.nodes_json || '[]');
  document.getElementById('chatbot-flow-name').value     = flow.name || '';
  document.getElementById('chatbot-flow-keywords').value = flow.trigger_keywords || '';
  document.getElementById('chatbot-editor').style.display = '';
  renderChatbotNodes();
}

async function deleteChatbotFlow(id) {
  if (!confirm('حذف هذا التدفق نهائياً؟')) return;
  if (!IS_ELECTRON) return;
  await BE.chatbot.delete(id);
  loadChatbotFlows();
  beOk('تم حذف التدفق');
}

function closeChatbotEditor() {
  document.getElementById('chatbot-editor').style.display = 'none';
  _editingFlowId = null;
  _chatbotNodes  = [];
}

function addChatbotNode() {
  const id = String(Date.now());
  _chatbotNodes.push({ id, type: 'message', content: '' });
  renderChatbotNodes();
}

function removeChatbotNode(id) {
  _chatbotNodes = _chatbotNodes.filter(n => n.id !== id);
  renderChatbotNodes();
}

function renderChatbotNodes() {
  const el = document.getElementById('chatbot-nodes-container');
  if (!el) return;
  el.innerHTML = _chatbotNodes.map((node, i) => `
    <div style="border:1px solid var(--border);border-radius:10px;padding:14px;position:relative">
      <div class="flex ic jb mb10">
        <span class="bge bg-b f11">خطوة ${i+1}</span>
        <button class="btn bd bsm" onclick="removeChatbotNode('${node.id}')">✕</button>
      </div>
      <div class="g2">
        <div class="fg">
          <label class="fl">نوع الخطوة</label>
          <select class="fc" onchange="_chatbotNodes[${i}].type=this.value;renderChatbotNodes()">
            <option value="message" ${node.type==='message'?'selected':''}>📨 رسالة نصية</option>
            <option value="condition" ${node.type==='condition'?'selected':''}>❓ شرط (إذا تضمّن)</option>
            <option value="delay" ${node.type==='delay'?'selected':''}>⏱️ تأخير</option>
            <option value="template" ${node.type==='template'?'selected':''}>📋 قالب محفوظ</option>
          </select>
        </div>
        <div class="fg">
          <label class="fl">${node.type==='delay'?'التأخير (ثانية)':node.type==='condition'?'الكلمة أو العبارة':'نص الرسالة'}</label>
          ${node.type==='message'||node.type==='template'
            ? `<textarea class="fc" rows="3" oninput="_chatbotNodes[${i}].content=this.value">${esc(node.content||'')}</textarea>`
            : `<input class="fc" value="${esc(node.content||'')}" oninput="_chatbotNodes[${i}].content=this.value">`}
        </div>
      </div>
    </div>`).join('');
}

async function saveChatbotFlow() {
  const name     = document.getElementById('chatbot-flow-name')?.value.trim();
  const keywords = document.getElementById('chatbot-flow-keywords')?.value.trim();
  if (!name) { beErr('أدخل اسم التدفق'); return; }
  if (!IS_ELECTRON) { beOk('حفظ (وضع العرض)'); return; }
  const payload = {
    id:               _editingFlowId || undefined,
    name,
    nodes_json:       JSON.stringify(_chatbotNodes),
    trigger_keywords: keywords,
    active:           1,
  };
  const r = await BE.chatbot.save(payload);
  if (r.ok) {
    beOk('تم حفظ التدفق');
    closeChatbotEditor();
    loadChatbotFlows();
    BE.audit.log({ event_type: 'chatbot_save', description: `حفظ تدفق: ${name}` });
  } else {
    beErr('تعذر الحفظ');
  }
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 5 — PDF EXPORT
// ══════════════════════════════════════════════════════════════════════════
async function exportReportPDF() {
  if (!IS_ELECTRON) { beErr('تصدير PDF يتطلب تطبيق سطح المكتب'); return; }
  beOk('جارٍ تصدير التقرير كـ PDF...');
  const r = await BE.reports.exportPDF();
  if (r.ok) { beOk(`تم التصدير: ${r.data}`); }
  else { beErr('تعذر تصدير PDF: ' + (r.error || 'خطأ')); }
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 5 — DEVELOPER API MODE
// ══════════════════════════════════════════════════════════════════════════
async function loadDevApiSettings() {
  if (!IS_ELECTRON) return;
  const r = await BE.devApi.getKey();
  if (r.ok && r.data) {
    const el = document.getElementById('dev-api-key');
    if (el) el.value = r.data;
    updateApiDocsUrl(r.data);
  }
}

function updateApiDocsUrl(key) {
  const el = document.getElementById('dev-api-docs-url');
  if (!el) return;
  el.textContent = key ? `Docs: http://localhost:3001/api/docs  |  Authorization: Bearer ${key.slice(0,8)}...` : '';
}

function generateApiKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const key   = Array.from({ length: 32 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const el    = document.getElementById('dev-api-key');
  if (el) el.value = key;
  updateApiDocsUrl(key);
}

async function saveApiKey() {
  const key = document.getElementById('dev-api-key')?.value.trim();
  if (!key) { beErr('أدخل مفتاح API أولاً'); return; }
  if (!IS_ELECTRON) { beOk('حفظ (وضع العرض)'); return; }
  const r = await BE.devApi.setKey(key);
  if (r.ok) { beOk('تم حفظ مفتاح API'); updateApiDocsUrl(key); BE.audit.log({ event_type: 'api_key_update', description: 'تحديث مفتاح API المطوّر' }); }
}

function copyApiKey() {
  const val = document.getElementById('dev-api-key')?.value;
  if (val) { navigator.clipboard.writeText(val).then(() => beOk('تم نسخ المفتاح')).catch(() => beErr('تعذر النسخ')); }
}

// ── Engine: Interactive Messages Toggle ──────────────────────────────────
function toggleInteractiveMode() {
  const tg    = document.getElementById('eng-interactive-toggle');
  const panel = document.getElementById('eng-interactive-panel');
  if (!tg || !panel) return;
  tg.classList.toggle('on');
  panel.style.display = tg.classList.contains('on') ? '' : 'none';
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 6 — TEAM MANAGEMENT PAGE
// ══════════════════════════════════════════════════════════════════════════
let _teamList = [];

window._pg_team = () => { loadTeamPage(); };

async function loadTeamPage() {
  if (!IS_ELECTRON) return;
  const [teamR, statsR, assignR] = await Promise.all([
    BE.team.list(), BE.assign.stats(), BE.assign.list({})
  ]);

  if (teamR.ok) {
    _teamList = teamR.data || [];
    const badge = document.getElementById('nb-team');
    if (badge) { badge.textContent = _teamList.length; badge.style.display = _teamList.length ? '' : 'none'; }

    const total  = _teamList.length;
    const agents = _teamList.filter(t => t.role === 'agent').length;
    document.getElementById('tm-stat-total').textContent = total;
    document.getElementById('tm-stat-agents').textContent = agents;

    const list = document.getElementById('team-members-list');
    if (list) list.innerHTML = _teamList.length ? _teamList.map(m => `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:rgba(var(--ar),.05);border-radius:10px;border:1px solid rgba(var(--ar),.1)">
        <div style="width:40px;height:40px;border-radius:50%;background:${m.color||'#6366f1'};display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">
          ${m.role==='admin'?'🔑':m.role==='agent'?'🎧':'👁️'}
        </div>
        <div style="flex:1">
          <div class="fw7 f13">${m.name}</div>
          <div class="f11 ts">${m.email||'—'} · ${m.role==='admin'?'Admin':m.role==='agent'?'Agent':'Viewer'}</div>
        </div>
        <div class="flex gap8">
          <span class="bge ${m.active?'bg-g':'bg-r'} f10">${m.active?'نشط':'موقوف'}</span>
          <button class="btn bo bsm" onclick="editTeamMember(${JSON.stringify(m).replace(/"/g,'&quot;')})">✏️</button>
          <button class="btn bd bsm" onclick="delTeamMember('${m.id}','${m.name}')">🗑️</button>
        </div>
      </div>`).join('') : '<div class="ts f12 ct">لا يوجد أعضاء — أضف عضواً جديداً</div>';
  }

  if (statsR.ok) {
    const stats = statsR.data || [];
    const openCount = stats.reduce((s,r) => s + (r.open_count||0), 0);
    document.getElementById('tm-stat-open').textContent = openCount;

    const perf = document.getElementById('team-perf-list');
    if (perf) perf.innerHTML = stats.length ? stats.map(s => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:rgba(var(--ar),.04);border-radius:8px">
        <div class="fw7 f12">${s.agent_name||'غير معين'}</div>
        <div class="flex gap10">
          <span class="f11 ts">${s.open_count||0} مفتوح</span>
          <span class="f11" style="color:#22c55e">${s.resolved||0} محلول</span>
          <span class="f11 ts">${s.total||0} إجمالي</span>
        </div>
      </div>`).join('') : '<div class="ts f12 ct">لا توجد بيانات</div>';
  }

  if (assignR.ok) renderAssignTable(assignR.data || []);
}

function renderAssignTable(rows) {
  const tbody = document.getElementById('assign-tbody');
  if (!tbody) return;
  const priorityLabel = { low:'🔽 منخفض', normal:'▶️ عادي', high:'🔼 عالي', urgent:'🚨 عاجل' };
  const statusLabel   = { open:'🔵 مفتوح', in_progress:'🟡 جارٍ', resolved:'🟢 محلول', closed:'⚫ مغلق' };
  tbody.innerHTML = rows.length ? rows.map(a => `
    <tr>
      <td class="fm f11">${a.phone}</td>
      <td>${a.agent_name ? `<span style="color:${a.agent_color||'#6366f1'}">${a.agent_name}</span>` : '<span class="ts">—</span>'}</td>
      <td><span class="bge f10">${statusLabel[a.status]||a.status}</span></td>
      <td><span class="f11">${priorityLabel[a.priority]||a.priority}</span></td>
      <td class="f11 ts">${a.last_message ? a.last_message.slice(0,40)+'…' : '—'}</td>
      <td>
        <button class="btn bo bsm" onclick="openAssignModal('${a.phone}')">تعيين</button>
        <button class="btn bsm" style="background:#22c55e;color:#fff" onclick="resolveAssignment('${a.phone}')">✓ حل</button>
      </td>
    </tr>`).join('') : '<tr><td colspan="6" style="text-align:center;padding:20px;opacity:.5">لا توجد محادثات معينة</td></tr>';
}

async function loadAssignments() {
  if (!IS_ELECTRON) return;
  const status = document.getElementById('assign-filter-status')?.value || '';
  const r = await BE.assign.list(status ? { status } : {});
  if (r.ok) renderAssignTable(r.data || []);
}

function openAddTeamMember() {
  document.getElementById('tm-id').value = '';
  document.getElementById('tm-name').value = '';
  document.getElementById('tm-role').value = 'agent';
  document.getElementById('tm-email').value = '';
  document.getElementById('tm-pin').value = '';
  document.getElementById('tm-color').value = '#6366f1';
  openM('m-team-member');
}

function editTeamMember(m) {
  document.getElementById('tm-id').value    = m.id;
  document.getElementById('tm-name').value  = m.name;
  document.getElementById('tm-role').value  = m.role;
  document.getElementById('tm-email').value = m.email || '';
  document.getElementById('tm-pin').value   = '';
  document.getElementById('tm-color').value = m.color || '#6366f1';
  openM('m-team-member');
}

async function saveTeamMember() {
  const id    = document.getElementById('tm-id').value;
  const name  = document.getElementById('tm-name').value.trim();
  const role  = document.getElementById('tm-role').value;
  const email = document.getElementById('tm-email').value.trim();
  const pin   = document.getElementById('tm-pin').value.trim();
  const color = document.getElementById('tm-color').value;
  if (!name) { beErr('أدخل اسم العضو'); return; }
  if (!IS_ELECTRON) { beOk('تم الحفظ (وضع العرض)'); closeM('m-team-member'); return; }
  const r = await BE.team.save({ id: id||undefined, name, role, email, pin: pin||undefined, color, active: 1 });
  if (r.ok) { beOk('تم حفظ العضو'); closeM('m-team-member'); loadTeamPage(); }
  else beErr(r.error);
}

async function delTeamMember(id, name) {
  if (!confirm(`حذف "${name}"؟`)) return;
  if (!IS_ELECTRON) { beOk('تم الحذف (وضع العرض)'); return; }
  const r = await BE.team.delete(id);
  if (r.ok) { beOk('تم الحذف'); loadTeamPage(); }
  else beErr(r.error);
}

async function openAssignModal(phone) {
  document.getElementById('ac-phone').value = phone;
  document.getElementById('ac-phone-display').textContent = phone;
  const agentSel = document.getElementById('ac-agent');
  agentSel.innerHTML = '<option value="">— بدون تعيين —</option>' +
    _teamList.filter(m => m.active && (m.role==='admin'||m.role==='agent')).map(m =>
      `<option value="${m.id}">${m.name} (${m.role})</option>`
    ).join('');
  openM('m-assign-conv');
}

async function saveAssignment() {
  const phone    = document.getElementById('ac-phone').value;
  const agentId  = document.getElementById('ac-agent').value;
  const status   = document.getElementById('ac-status').value;
  const priority = document.getElementById('ac-priority').value;
  const tags     = document.getElementById('ac-tags').value.trim();
  const notes    = document.getElementById('ac-notes').value.trim();
  if (!IS_ELECTRON) { beOk('تم الحفظ (وضع العرض)'); closeM('m-assign-conv'); return; }
  const r = await BE.assign.upsert({ phone, agent_id:agentId||null, status, priority, tags, notes });
  if (r.ok) { beOk('تم تعيين المحادثة'); closeM('m-assign-conv'); loadAssignments(); }
  else beErr(r.error);
}

async function resolveAssignment(phone) {
  if (!IS_ELECTRON) { beOk('تم الحل (وضع العرض)'); return; }
  const r = await BE.assign.resolve(phone);
  if (r.ok) { beOk('تم تمييز المحادثة كمحلولة'); loadAssignments(); }
  else beErr(r.error);
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 7 — AUTOMATION SEQUENCES PAGE
// ══════════════════════════════════════════════════════════════════════════
let _seqEditSteps = [];

window._pg_sequences = () => { loadSequencesPage(); };

async function loadSequencesPage() {
  if (!IS_ELECTRON) return;
  const r = await BE.sequences.list();
  if (!r.ok) return;
  const seqs = r.data || [];

  const badge = document.getElementById('nb-sequences');
  if (badge) { badge.textContent = seqs.filter(s=>s.active).length; badge.style.display = seqs.length?'':'none'; }

  document.getElementById('seq-stat-total').textContent  = seqs.length;
  document.getElementById('seq-stat-active').textContent  = seqs.filter(s=>s.active).length;
  document.getElementById('seq-stat-enrolled').textContent = seqs.reduce((s,q)=>s+(q.enrolled||0),0);

  const container = document.getElementById('seq-list');
  if (!container) return;

  const triggerLabel = { keyword:'🔑 كلمة مفتاحية', opt_in:'✅ انضمام جديد', campaign_complete:'📢 انتهاء حملة', manual:'🤚 يدوي' };

  container.innerHTML = seqs.length ? seqs.map(s => `
    <div class="cd" style="border-left:3px solid ${s.active?'var(--acc)':'#64748b'}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px">
        <div style="flex:1">
          <div class="flex ic gap10 mb4">
            <div class="fw7 f14">${s.name}</div>
            <span class="bge f10 ${s.active?'bg-g':'bg-r'}">${s.active?'نشط':'موقوف'}</span>
          </div>
          <div class="flex gap10 f11 ts">
            <span>${triggerLabel[s.trigger_type]||s.trigger_type}</span>
            ${s.trigger_value ? `<span>· ${s.trigger_value}</span>` : ''}
            <span>· ${s.steps?.length||0} خطوة</span>
            <span>· ${s.enrolled||0} مشترك نشط</span>
          </div>
        </div>
        <div class="flex gap8">
          <button class="btn bo bsm" onclick="viewSeqEnrollments('${s.id}','${s.name.replace(/'/g,"\\'")}')">👥 المشتركون</button>
          <button class="btn bo bsm" onclick="editSequence('${s.id}')">✏️ تعديل</button>
          <button class="btn bsm ${s.active?'bo':'bp'}" onclick="toggleSeq('${s.id}',this)">
            ${s.active?'⏸️ إيقاف':'▶️ تفعيل'}
          </button>
          <button class="btn bd bsm" onclick="deleteSeq('${s.id}','${s.name.replace(/'/g,"\\'")}')">🗑️</button>
        </div>
      </div>

      ${s.steps && s.steps.length ? `
      <div style="margin-top:14px;display:flex;gap:8px;overflow-x:auto;padding-bottom:6px">
        ${s.steps.map((st,i) => `
          <div style="flex-shrink:0;background:rgba(var(--ar),.06);border:1px solid rgba(var(--ar),.12);border-radius:8px;padding:8px 12px;min-width:160px">
            <div class="fw7 f11 mb2">الخطوة ${i+1}</div>
            <div class="f11 ts">⏱️ بعد ${st.delay_hours<24?st.delay_hours+'س':(st.delay_hours/24).toFixed(0)+' يوم'}</div>
            <div class="f11 mt4" style="max-width:150px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${st.message_body||'—'}</div>
          </div>
        `).join('<div style="display:flex;align-items:center;font-size:18px;opacity:.4">→</div>')}
      </div>` : ''}
    </div>`).join('') : '<div class="cd ts f12 ct">لا توجد تسلسلات — أنشئ تسلسلاً جديداً</div>';
}

function openSeqBuilder() {
  _seqEditSteps = [];
  document.getElementById('seq-edit-id').value = '';
  document.getElementById('seq-name').value = '';
  document.getElementById('seq-trigger').value = 'manual';
  document.getElementById('seq-trigger-val').value = '';
  toggleSeqTrigger();
  renderSeqSteps();
  // Load sessions
  if (IS_ELECTRON) {
    BE.wa.sessions.list().then(r => {
      const sel = document.getElementById('seq-session');
      if (!sel) return;
      sel.innerHTML = '<option value="">— تلقائي —</option>' +
        (r.data||[]).filter(s=>s.status==='ready').map(s =>
          `<option value="${s.id}">${s.name}</option>`
        ).join('');
    }).catch(()=>{});
  }
  openM('m-seq-builder');
}

async function editSequence(id) {
  if (!IS_ELECTRON) return;
  const r = await BE.sequences.get(id);
  if (!r.ok) { beErr('تعذر تحميل التسلسل'); return; }
  const s = r.data;
  _seqEditSteps = (s.steps||[]).map(st => ({ ...st }));
  document.getElementById('seq-edit-id').value = s.id;
  document.getElementById('seq-name').value = s.name;
  document.getElementById('seq-trigger').value = s.trigger_type;
  document.getElementById('seq-trigger-val').value = s.trigger_value || '';
  toggleSeqTrigger();
  // Load sessions
  BE.wa.sessions.list().then(r2 => {
    const sel = document.getElementById('seq-session');
    if (!sel) return;
    sel.innerHTML = '<option value="">— تلقائي —</option>' +
      (r2.data||[]).filter(ss=>ss.status==='ready').map(ss =>
        `<option value="${ss.id}" ${ss.id===s.session_id?'selected':''}>${ss.name}</option>`
      ).join('');
  }).catch(()=>{});
  renderSeqSteps();
  openM('m-seq-builder');
}

function toggleSeqTrigger() {
  const val = document.getElementById('seq-trigger')?.value;
  const wrap = document.getElementById('seq-trigger-val-wrap');
  if (wrap) wrap.style.display = (val === 'keyword') ? '' : 'none';
}

function addSeqStep() {
  _seqEditSteps.push({ delay_hours: 24, message_body: '', media_path: '' });
  renderSeqSteps();
}

function removeSeqStep(i) {
  _seqEditSteps.splice(i, 1);
  renderSeqSteps();
}

function renderSeqSteps() {
  const container = document.getElementById('seq-steps-list');
  if (!container) return;
  container.innerHTML = _seqEditSteps.length ? _seqEditSteps.map((st, i) => `
    <div style="background:rgba(var(--ar),.06);border:1px solid rgba(var(--ar),.12);border-radius:10px;padding:12px 14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <div class="fw7 f12">الخطوة ${i+1}</div>
        <button class="btn bd bsm" onclick="removeSeqStep(${i})">🗑️</button>
      </div>
      <div class="g2 mb8">
        <div class="fg">
          <label class="fl">التأخير قبل الإرسال</label>
          <div class="flex gap8 ic">
            <input class="fc" type="number" min="1" value="${st.delay_hours}" style="width:70px;text-align:center"
              oninput="_seqEditSteps[${i}].delay_hours=+this.value">
            <span class="f11 ts">ساعة</span>
          </div>
        </div>
        <div class="fg">
          <label class="fl">ملف الوسائط (اختياري)</label>
          <input class="fc" value="${st.media_path||''}" placeholder="مسار الملف..." style="direction:ltr"
            oninput="_seqEditSteps[${i}].media_path=this.value">
        </div>
      </div>
      <div class="fg">
        <label class="fl">نص الرسالة</label>
        <textarea class="fc" rows="3" placeholder="اكتب الرسالة... يمكن استخدام {الاسم}"
          oninput="_seqEditSteps[${i}].message_body=this.value">${st.message_body||''}</textarea>
      </div>
    </div>`).join('') : '<div class="ts f12 ct" style="padding:20px">لم تُضف أي خطوات بعد — اضغط ➕ لإضافة خطوة</div>';
}

async function saveSequence() {
  const id           = document.getElementById('seq-edit-id').value;
  const name         = document.getElementById('seq-name').value.trim();
  const trigger_type = document.getElementById('seq-trigger').value;
  const trigger_value= document.getElementById('seq-trigger-val').value.trim();
  const session_id   = document.getElementById('seq-session')?.value || '';
  if (!name) { beErr('أدخل اسم التسلسل'); return; }
  if (!_seqEditSteps.length) { beErr('أضف خطوة واحدة على الأقل'); return; }
  if (!IS_ELECTRON) { beOk('تم الحفظ (وضع العرض)'); closeM('m-seq-builder'); return; }
  const r = await BE.sequences.save({
    id: id||undefined, name, trigger_type, trigger_value, session_id, active: 1,
    steps: _seqEditSteps,
  });
  if (r.ok) { beOk('تم حفظ التسلسل'); closeM('m-seq-builder'); loadSequencesPage(); }
  else beErr(r.error);
}

async function toggleSeq(id, btn) {
  if (!IS_ELECTRON) return;
  const r = await BE.sequences.toggle(id);
  if (r.ok) { beOk(r.data?.active ? 'تم تفعيل التسلسل' : 'تم إيقاف التسلسل'); loadSequencesPage(); }
  else beErr(r.error);
}

async function deleteSeq(id, name) {
  if (!confirm(`حذف التسلسل "${name}"؟`)) return;
  if (!IS_ELECTRON) { beOk('تم الحذف (وضع العرض)'); return; }
  const r = await BE.sequences.delete(id);
  if (r.ok) { beOk('تم الحذف'); loadSequencesPage(); }
  else beErr(r.error);
}

let _currentSeqId = '';

async function viewSeqEnrollments(id, name) {
  _currentSeqId = id;
  document.getElementById('enr-seq-name').textContent = name;
  document.getElementById('enr-phone-input').value = '';
  if (IS_ELECTRON) await loadEnrollments();
  openM('m-seq-enrollments');
}

async function loadEnrollments() {
  const r = await BE.sequences.enrollments(_currentSeqId);
  const list = document.getElementById('enr-list');
  if (!list || !r.ok) return;
  const rows = r.data || [];
  list.innerHTML = rows.length ? rows.map(e => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;border-radius:8px;background:rgba(var(--ar),.04);margin-bottom:6px">
      <div>
        <div class="fw7 f12 fm">${e.phone}</div>
        <div class="f11 ts">خطوة ${e.current_step+1} · ${e.completed?'مكتمل ✅':'⏳ '+new Date(e.next_send_at).toLocaleString('ar')}</div>
      </div>
      <button class="btn bd bsm" onclick="unenrollPhone('${e.phone}')">إلغاء</button>
    </div>`).join('') : '<div class="ts f12 ct" style="padding:24px">لا يوجد مشتركون</div>';
}

async function addEnrollment() {
  const phone = document.getElementById('enr-phone-input').value.trim().replace(/\D/g,'');
  if (!phone) { beErr('أدخل رقم الهاتف'); return; }
  if (!IS_ELECTRON) { beOk('تم الاشتراك (وضع العرض)'); return; }
  const r = await BE.sequences.enroll({ sequenceId: _currentSeqId, phone, sessionId: '' });
  if (r.ok) { beOk('تم تسجيل الرقم في التسلسل'); document.getElementById('enr-phone-input').value=''; loadEnrollments(); }
  else beErr(r.error);
}

async function unenrollPhone(phone) {
  if (!IS_ELECTRON) return;
  const r = await BE.sequences.unenroll({ sequenceId: _currentSeqId, phone });
  if (r.ok) { beOk('تم إلغاء الاشتراك'); loadEnrollments(); }
  else beErr(r.error);
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 8 — RESELLER PANEL PAGE
// ══════════════════════════════════════════════════════════════════════════
window._pg_reseller = () => { loadResellerPage(); };

async function loadResellerPage() {
  if (!IS_ELECTRON) return;
  const [listR, statsR] = await Promise.all([BE.reseller.list(), BE.reseller.stats()]);

  if (statsR.ok) {
    const s = statsR.data;
    document.getElementById('rs-stat-total').textContent  = s.total || 0;
    document.getElementById('rs-stat-active').textContent = s.active || 0;
    document.getElementById('rs-stat-msgs').textContent   = (s.messages_today||0).toLocaleString();
    const badge = document.getElementById('nb-reseller');
    if (badge) { badge.textContent = s.total; badge.style.display = s.total?'':'none'; }
  }

  if (listR.ok) {
    const clients = listR.data || [];
    const planLabel = { basic:'🥉 Basic', pro:'🥈 Pro', enterprise:'🥇 Enterprise' };
    const tbody = document.getElementById('reseller-tbody');
    if (!tbody) return;
    tbody.innerHTML = clients.length ? clients.map(c => `
      <tr>
        <td>
          <div class="fw7 f12">${c.name}</div>
          <div class="f11 ts">${c.email||'—'}</div>
        </td>
        <td><span class="bge f10">${planLabel[c.plan]||c.plan}</span></td>
        <td class="fm f10" style="letter-spacing:.5px">${c.license_key||'—'}</td>
        <td class="f11">${c.max_msg_per_day?.toLocaleString()||'—'} / ${c.today_messages?.toLocaleString()||0} اليوم</td>
        <td class="f11">${c.max_sessions||'—'}</td>
        <td class="f11">${c.expires_at ? c.expires_at.slice(0,10) : '—'}</td>
        <td><span class="bge f10 ${c.active?'bg-g':'bg-r'}">${c.active?'نشط':'موقوف'}</span></td>
        <td>
          <button class="btn bo bsm" onclick="editResellerClient(${JSON.stringify(c).replace(/"/g,'&quot;')})">✏️</button>
          <button class="btn bd bsm" onclick="deleteResellerClient('${c.id}','${c.name.replace(/'/g,"\\'")}')">🗑️</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="8" style="text-align:center;padding:24px;opacity:.5">لا يوجد عملاء — أضف عميلاً جديداً</td></tr>';
  }
}

function openAddResellerClient() {
  document.getElementById('rc-id').value = '';
  document.getElementById('rc-name').value = '';
  document.getElementById('rc-email').value = '';
  document.getElementById('rc-plan').value = 'basic';
  document.getElementById('rc-msg-limit').value = '500';
  document.getElementById('rc-max-sess').value = '2';
  document.getElementById('rc-license-key').value = '';
  document.getElementById('rc-expires').value = '';
  document.getElementById('rc-notes').value = '';
  openM('m-reseller-client');
}

function editResellerClient(c) {
  document.getElementById('rc-id').value          = c.id;
  document.getElementById('rc-name').value        = c.name;
  document.getElementById('rc-email').value       = c.email||'';
  document.getElementById('rc-plan').value        = c.plan||'basic';
  document.getElementById('rc-msg-limit').value   = c.max_msg_per_day||500;
  document.getElementById('rc-max-sess').value    = c.max_sessions||2;
  document.getElementById('rc-license-key').value = c.license_key||'';
  document.getElementById('rc-expires').value     = c.expires_at ? c.expires_at.slice(0,10) : '';
  document.getElementById('rc-notes').value       = c.notes||'';
  openM('m-reseller-client');
}

async function genResellerKey() {
  if (!IS_ELECTRON) { document.getElementById('rc-license-key').value='FT-XXXX-XXXX-XXXX-XXXX'; return; }
  const r = await BE.reseller.genKey();
  if (r.ok) document.getElementById('rc-license-key').value = r.data.key;
}

async function saveResellerClient() {
  const id          = document.getElementById('rc-id').value;
  const name        = document.getElementById('rc-name').value.trim();
  const email       = document.getElementById('rc-email').value.trim();
  const plan        = document.getElementById('rc-plan').value;
  const msg_limit   = +document.getElementById('rc-msg-limit').value || 500;
  const max_sess    = +document.getElementById('rc-max-sess').value  || 2;
  const license_key = document.getElementById('rc-license-key').value.trim();
  const expires_at  = document.getElementById('rc-expires').value || null;
  const notes       = document.getElementById('rc-notes').value.trim();
  if (!name) { beErr('أدخل اسم العميل'); return; }
  if (!IS_ELECTRON) { beOk('تم الحفظ (وضع العرض)'); closeM('m-reseller-client'); return; }
  const r = await BE.reseller.save({
    id: id||undefined, name, email, plan, license_key: license_key||undefined,
    max_msg_per_day: msg_limit, max_sessions: max_sess,
    expires_at, notes, active: 1,
  });
  if (r.ok) { beOk('تم حفظ العميل'); closeM('m-reseller-client'); loadResellerPage(); }
  else beErr(r.error);
}

async function deleteResellerClient(id, name) {
  if (!confirm(`حذف عميل "${name}"؟`)) return;
  if (!IS_ELECTRON) { beOk('تم الحذف (وضع العرض)'); return; }
  const r = await BE.reseller.delete(id);
  if (r.ok) { beOk('تم الحذف'); loadResellerPage(); }
  else beErr(r.error);
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 8 — WHITE-LABEL SETTINGS PAGE
// ══════════════════════════════════════════════════════════════════════════
window._pg_whitelabel = () => { loadWhitelabelPage(); };


async function loadWhitelabelPage() {
  if (!IS_ELECTRON) return;
  const r = await BE.branding.get();
  if (!r.ok) return;
  const b = r.data;
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  set('wl-app-name', b.app_name || 'Fast Tech');
  set('wl-footer',   b.footer_text || 'Powered by Fast Tech');
  set('wl-color',    b.primary_color || '#6366f1');
  set('wl-color-hex',b.primary_color || '#6366f1');
  set('wl-logo',     b.logo_path || '');
  const chk = document.getElementById('wl-show-powered');
  if (chk) chk.checked = b.show_powered !== false;
  updateBrandingPreview(b);
}

function updateBrandingPreview(b) {
  const name  = document.getElementById('wl-app-name')?.value || b?.app_name || 'Fast Tech';
  const color = document.getElementById('wl-color')?.value    || b?.primary_color || '#6366f1';
  const footer= document.getElementById('wl-footer')?.value   || b?.footer_text || '';
  const pName  = document.getElementById('wl-prev-name');
  const pColor = document.getElementById('wl-prev-color');
  const pFoot  = document.getElementById('wl-prev-footer');
  if (pName)  pName.textContent  = name;
  if (pColor) pColor.style.background = color;
  if (pFoot)  pFoot.textContent  = footer;
}

async function pickWlLogo() {
  if (!IS_ELECTRON) return;
  const path = await BE.openFile({ filters: [{ name: 'Images', extensions: ['png','svg','jpg','ico'] }] });
  if (path) document.getElementById('wl-logo').value = path;
}

async function saveBranding() {
  const app_name     = document.getElementById('wl-app-name').value.trim();
  const footer_text  = document.getElementById('wl-footer').value.trim();
  const primary_color= document.getElementById('wl-color').value;
  const logo_path    = document.getElementById('wl-logo').value.trim();
  const show_powered = document.getElementById('wl-show-powered').checked;
  if (!IS_ELECTRON) { beOk('تم الحفظ (وضع العرض)'); return; }
  const r = await BE.branding.save({ app_name, footer_text, primary_color, logo_path, show_powered });
  if (r.ok) { beOk('تم حفظ إعدادات البراندينج'); updateBrandingPreview(r.data); }
  else beErr(r.error);
}

// ── Boot ─────────────────────────────────────────────────────────────────
// ── SPARKLINES ───────────────────────────────────────────────────────────
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

// ══════════════════════════════════════════════════════════════════════════
// E-COMMERCE — Page init hooks (called by nav() after dynamic load)
// ══════════════════════════════════════════════════════════════════════════
window['_pg_ec-dashboard'] = () => { if (typeof ecDashLoad === 'function') ecDashLoad(); };
window['_pg_ec-orders']    = () => { if (typeof ecOrdLoad  === 'function') ecOrdLoad();  };
window['_pg_ec-products']  = () => {
  if (typeof ecProdLoadCats === 'function') ecProdLoadCats();
  if (typeof ecProdLoad     === 'function') ecProdLoad();
};
window['_pg_ec-customers'] = () => { if (typeof ecCustLoad === 'function') ecCustLoad(); };
window['_pg_ec-coupons']   = () => { if (typeof ecCoupLoad === 'function') ecCoupLoad(); };
window['_pg_ec-shipping']  = () => { if (typeof ecShipLoad === 'function') ecShipLoad(); };
window['_pg_ec-shop']      = () => {
  if (typeof ecShopLoadCats === 'function') ecShopLoadCats();
  if (typeof ecShopLoad     === 'function') ecShopLoad();
  if (typeof ecCartUpdate   === 'function') ecCartUpdate();
};

// ── E-Commerce push notifications ─────────────────────────────────────────
if (IS_ELECTRON) {
  BE.on('ec:order:confirmed', (d) => {
    showN('✅ تم تأكيد الطلب', `الطلب ${d?.order_number || ''} تم تأكيده عبر واتساب`, '📦');
    const badge = document.getElementById('nb-ec-orders');
    if (badge) badge.style.display = 'none';
  });
  BE.on('ec:order:cancelled', (d) => {
    showN('❌ تم إلغاء الطلب', `الطلب ${d?.order_number || ''} تم إلغاؤه من قبل العميل`, '📦');
  });
  BE.on('ec:order:new', (d) => {
    const badge = document.getElementById('nb-ec-orders');
    if (badge) {
      const n = parseInt(badge.textContent || '0') + 1;
      badge.textContent = n;
      badge.style.display = 'inline-flex';
    }
    showN('📦 طلب جديد', `طلب جديد: ${d?.order_number || ''}`, '🛍️');
  });
}
