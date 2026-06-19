'use strict';
// validate.js — IPC input validation helpers
// Each validator returns { ok: true } or { ok: false, error: string }
// Use at top of IPC handlers before any DB/service calls.

const V = {
  // Phone number: digits only 6-15, or WhatsApp JID (ends @c.us / @g.us / @s.whatsapp.net)
  phone(raw) {
    if (!raw) return { ok: false, error: 'رقم الهاتف مطلوب' };
    const s = String(raw).trim();
    if (/@(c\.us|g\.us|s\.whatsapp\.net)$/.test(s)) return { ok: true };
    const digits = s.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) return { ok: false, error: `رقم هاتف غير صحيح: ${s}` };
    return { ok: true };
  },

  // Session/account ID: non-empty string, max 100 chars, no path traversal
  sessionId(id) {
    if (!id) return { ok: false, error: 'معرّف الجلسة مطلوب' };
    const s = String(id).trim();
    if (s.length > 100)  return { ok: false, error: 'معرّف الجلسة طويل جداً' };
    if (/[/\\<>]/.test(s)) return { ok: false, error: 'معرّف الجلسة يحتوي على رموز غير مسموحة' };
    return { ok: true };
  },

  // Generic non-empty string with max length
  str(val, max = 2000, label = 'القيمة') {
    if (val === undefined || val === null || String(val).trim() === '')
      return { ok: false, error: `${label} مطلوبة` };
    if (String(val).length > max)
      return { ok: false, error: `${label} تتجاوز الحد الأقصى (${max} حرف)` };
    return { ok: true };
  },

  // Optional string — only validates length if value is provided
  optStr(val, max = 2000, label = 'القيمة') {
    if (!val) return { ok: true };
    return V.str(val, max, label);
  },

  // Positive integer with optional max
  posInt(val, max = 100_000, label = 'العدد') {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 1)  return { ok: false, error: `${label} يجب أن يكون عدداً موجباً` };
    if (n > max) return { ok: false, error: `${label} يتجاوز الحد الأقصى (${max})` };
    return { ok: true };
  },

  // Non-negative integer (0 allowed)
  nonNegInt(val, max = 100_000, label = 'العدد') {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 0)  return { ok: false, error: `${label} يجب أن يكون صفراً أو أكثر` };
    if (n > max) return { ok: false, error: `${label} يتجاوز الحد الأقصى (${max})` };
    return { ok: true };
  },

  // HTTP/HTTPS URL
  url(val, label = 'الرابط') {
    if (!val) return { ok: false, error: `${label} مطلوب` };
    try {
      const u = new URL(String(val));
      if (!['http:', 'https:'].includes(u.protocol))
        return { ok: false, error: `${label} يجب أن يبدأ بـ http أو https` };
      return { ok: true };
    } catch {
      return { ok: false, error: `${label} غير صحيح` };
    }
  },

  // Optional URL
  optUrl(val, label = 'الرابط') {
    if (!val) return { ok: true };
    return V.url(val, label);
  },

  // Enum — value must be one of the allowed set
  enum(val, allowed, label = 'الخيار') {
    if (!allowed.includes(val))
      return { ok: false, error: `${label} غير مدعوم. المسموح: ${allowed.join(', ')}` };
    return { ok: true };
  },

  // API key: non-empty, no whitespace, reasonable length
  apiKey(val, label = 'مفتاح API') {
    if (!val) return { ok: false, error: `${label} مطلوب` };
    const s = String(val).trim();
    if (/\s/.test(s)) return { ok: false, error: `${label} لا يجب أن يحتوي على مسافات` };
    if (s.length > 500) return { ok: false, error: `${label} طويل جداً` };
    return { ok: true };
  },

  // Port number 1-65535
  port(val, label = 'المنفذ') {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 1 || n > 65535)
      return { ok: false, error: `${label} يجب أن يكون بين 1 و 65535` };
    return { ok: true };
  },

  // Combine multiple validators — returns first failure
  all(...results) {
    for (const r of results) if (!r.ok) return r;
    return { ok: true };
  },
};

module.exports = V;
