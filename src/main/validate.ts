'use strict';

import type { ValidationResult } from './types';

const ok = (): ValidationResult => ({ ok: true });
const fail = (error: string): ValidationResult => ({ ok: false, error });

const V = {
  phone(raw: any): ValidationResult {
    if (!raw) return fail('رقم الهاتف مطلوب');
    const s = String(raw).trim();
    if (/@(c\.us|g\.us|s\.whatsapp\.net)$/.test(s)) return ok();
    const digits = s.replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 15) return fail(`رقم هاتف غير صحيح: ${s}`);
    return ok();
  },

  sessionId(id: any): ValidationResult {
    if (!id) return fail('معرّف الجلسة مطلوب');
    const s = String(id).trim();
    if (s.length > 100)    return fail('معرّف الجلسة طويل جداً');
    if (/[/\\<>]/.test(s)) return fail('معرّف الجلسة يحتوي على رموز غير مسموحة');
    return ok();
  },

  str(val: any, max: number = 2000, label: string = 'القيمة'): ValidationResult {
    if (val === undefined || val === null || String(val).trim() === '')
      return fail(`${label} مطلوبة`);
    if (String(val).length > max)
      return fail(`${label} تتجاوز الحد الأقصى (${max} حرف)`);
    return ok();
  },

  optStr(val: any, max: number = 2000, label: string = 'القيمة'): ValidationResult {
    if (!val) return ok();
    return V.str(val, max, label);
  },

  posInt(val: any, max: number = 100_000, label: string = 'العدد'): ValidationResult {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 1) return fail(`${label} يجب أن يكون عدداً موجباً`);
    if (n > max)                       return fail(`${label} يتجاوز الحد الأقصى (${max})`);
    return ok();
  },

  nonNegInt(val: any, max: number = 100_000, label: string = 'العدد'): ValidationResult {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 0) return fail(`${label} يجب أن يكون صفراً أو أكثر`);
    if (n > max)                       return fail(`${label} يتجاوز الحد الأقصى (${max})`);
    return ok();
  },

  url(val: any, label: string = 'الرابط'): ValidationResult {
    if (!val) return fail(`${label} مطلوب`);
    try {
      const u = new URL(String(val));
      if (!['http:', 'https:'].includes(u.protocol))
        return fail(`${label} يجب أن يبدأ بـ http أو https`);
      return ok();
    } catch {
      return fail(`${label} غير صحيح`);
    }
  },

  optUrl(val: any, label: string = 'الرابط'): ValidationResult {
    if (!val) return ok();
    return V.url(val, label);
  },

  enum(val: any, allowed: string[], label: string = 'الخيار'): ValidationResult {
    if (!allowed.includes(val))
      return fail(`${label} غير مدعوم. المسموح: ${allowed.join(', ')}`);
    return ok();
  },

  apiKey(val: any, label: string = 'مفتاح API'): ValidationResult {
    if (!val) return fail(`${label} مطلوب`);
    const s = String(val).trim();
    if (/\s/.test(s))   return fail(`${label} لا يجب أن يحتوي على مسافات`);
    if (s.length > 500) return fail(`${label} طويل جداً`);
    return ok();
  },

  port(val: any, label: string = 'المنفذ'): ValidationResult {
    const n = parseInt(val, 10);
    if (!Number.isFinite(n) || n < 1 || n > 65535)
      return fail(`${label} يجب أن يكون بين 1 و 65535`);
    return ok();
  },

  all(...results: ValidationResult[]): ValidationResult {
    for (const r of results) if (!r.ok) return r;
    return ok();
  },
};

export default V;
module.exports = V;
