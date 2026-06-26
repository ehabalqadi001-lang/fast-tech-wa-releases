'use strict';
const https = require('https');
const fs    = require('fs');
const path  = require('path');

const TOKEN  = process.argv[2];
const OWNER  = 'ehabalqadi001-lang';
const REPO   = 'fast-tech-wa-releases';
const TAG    = 'v6.3.0';
const NAME   = 'v6.3.0 — E-Commerce + WhatsApp Order Bot';
const BODY   = `## 🛒 وحدة التجارة الإلكترونية الكاملة + بوت تأكيد الطلبات

### ميزات جديدة:
- **لوحة المبيعات**: KPIs، مخطط الإيرادات 30 يوم، أفضل المنتجات، تنبيهات مخزون منخفض
- **إدارة الطلبات**: تحديث الحالة، رقم التتبع، إرسال تأكيد واتساب للعميل
- **إدارة المنتجات**: إضافة/تعديل/حذف مع الفئات والمخزون والصور
- **إدارة العملاء**: قاعدة بيانات كاملة مع برنامج الولاء والنقاط
- **الكوبونات**: نسبة مئوية أو مبلغ ثابت مع تحديد المدة والحد الأقصى للاستخدام
- **مناطق الشحن**: تعريف التكاليف لكل منطقة مع شحن مجاني عند حد معين
- **المتجر (Storefront)**: كتالوج منتجات، سلة تسوق، إتمام طلب كامل مع فاتورة
- **بوت تأكيد الطلبات**: آلية 4 خطوات عبر واتساب تلقائياً`;

const DIST  = path.join(__dirname, '..', 'dist-new');
const FILES = [
  `FAST TECH WhatsApp Cyber Nexus Setup ${TAG.slice(1)}.exe`,
  `FAST TECH WhatsApp Cyber Nexus ${TAG.slice(1)}.exe`,
];

function api(method, urlPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req  = https.request({
      hostname: 'api.github.com',
      path:     urlPath,
      method,
      headers: {
        Authorization:  `token ${TOKEN}`,
        'User-Agent':   'release-upload',
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...extraHeaders,
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function upload(uploadUrl, filePath, mime) {
  return new Promise((resolve, reject) => {
    const buf  = fs.readFileSync(filePath);
    const name = encodeURIComponent(path.basename(filePath));
    const base = uploadUrl.replace(/\{.*\}/, '');
    const url  = new URL(`${base}?name=${name}`);
    const req  = https.request({
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'POST',
      headers: {
        Authorization:   `token ${TOKEN}`,
        'User-Agent':    'release-upload',
        'Content-Type':  mime,
        'Content-Length': buf.length,
      },
    }, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw || '{}') }));
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

(async () => {
  // Delete existing release + tag if any
  const list = await api('GET', `/repos/${OWNER}/${REPO}/releases`);
  const existing = list.body.find && list.body.find(r => r.tag_name === TAG);
  if (existing) {
    console.log('Deleting existing release', existing.id);
    await api('DELETE', `/repos/${OWNER}/${REPO}/releases/${existing.id}`);
  }
  // Delete tag
  await api('DELETE', `/repos/${OWNER}/${REPO}/git/refs/tags/${TAG}`).catch(() => {});

  // Create release
  const rel = await api('POST', `/repos/${OWNER}/${REPO}/releases`, {
    tag_name: TAG, name: NAME, body: BODY, draft: false, prerelease: false,
  });
  if (!rel.body.upload_url) { console.error('Create release failed', rel); process.exit(1); }
  console.log('Release created:', rel.body.html_url);

  // Upload files
  for (const f of FILES) {
    const fp = path.join(DIST, f);
    if (!fs.existsSync(fp)) { console.warn('SKIP (not found):', f); continue; }
    const size = (fs.statSync(fp).size / 1024 / 1024).toFixed(1);
    console.log(`Uploading ${f} (${size} MB)...`);
    const up = await upload(rel.body.upload_url, fp, 'application/octet-stream');
    console.log(up.status === 201 ? `  ✓ ${f}` : `  ✗ ${f} — status ${up.status}`);
  }
  console.log('Done.');
})();
