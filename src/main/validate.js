'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const ok = () => ({ ok: true });
const fail = (error) => ({ ok: false, error });
const V = {
    phone(raw) {
        if (!raw)
            return fail('رقم الهاتف مطلوب');
        const s = String(raw).trim();
        if (/@(c\.us|g\.us|s\.whatsapp\.net)$/.test(s))
            return ok();
        const digits = s.replace(/\D/g, '');
        if (digits.length < 6 || digits.length > 15)
            return fail(`رقم هاتف غير صحيح: ${s}`);
        return ok();
    },
    sessionId(id) {
        if (!id)
            return fail('معرّف الجلسة مطلوب');
        const s = String(id).trim();
        if (s.length > 100)
            return fail('معرّف الجلسة طويل جداً');
        if (/[/\\<>]/.test(s))
            return fail('معرّف الجلسة يحتوي على رموز غير مسموحة');
        return ok();
    },
    str(val, max = 2000, label = 'القيمة') {
        if (val === undefined || val === null || String(val).trim() === '')
            return fail(`${label} مطلوبة`);
        if (String(val).length > max)
            return fail(`${label} تتجاوز الحد الأقصى (${max} حرف)`);
        return ok();
    },
    optStr(val, max = 2000, label = 'القيمة') {
        if (!val)
            return ok();
        return V.str(val, max, label);
    },
    posInt(val, max = 100000, label = 'العدد') {
        const n = parseInt(val, 10);
        if (!Number.isFinite(n) || n < 1)
            return fail(`${label} يجب أن يكون عدداً موجباً`);
        if (n > max)
            return fail(`${label} يتجاوز الحد الأقصى (${max})`);
        return ok();
    },
    nonNegInt(val, max = 100000, label = 'العدد') {
        const n = parseInt(val, 10);
        if (!Number.isFinite(n) || n < 0)
            return fail(`${label} يجب أن يكون صفراً أو أكثر`);
        if (n > max)
            return fail(`${label} يتجاوز الحد الأقصى (${max})`);
        return ok();
    },
    url(val, label = 'الرابط') {
        if (!val)
            return fail(`${label} مطلوب`);
        try {
            const u = new URL(String(val));
            if (!['http:', 'https:'].includes(u.protocol))
                return fail(`${label} يجب أن يبدأ بـ http أو https`);
            return ok();
        }
        catch {
            return fail(`${label} غير صحيح`);
        }
    },
    optUrl(val, label = 'الرابط') {
        if (!val)
            return ok();
        return V.url(val, label);
    },
    enum(val, allowed, label = 'الخيار') {
        if (!allowed.includes(val))
            return fail(`${label} غير مدعوم. المسموح: ${allowed.join(', ')}`);
        return ok();
    },
    apiKey(val, label = 'مفتاح API') {
        if (!val)
            return fail(`${label} مطلوب`);
        const s = String(val).trim();
        if (/\s/.test(s))
            return fail(`${label} لا يجب أن يحتوي على مسافات`);
        if (s.length > 500)
            return fail(`${label} طويل جداً`);
        return ok();
    },
    port(val, label = 'المنفذ') {
        const n = parseInt(val, 10);
        if (!Number.isFinite(n) || n < 1 || n > 65535)
            return fail(`${label} يجب أن يكون بين 1 و 65535`);
        return ok();
    },
    all(...results) {
        for (const r of results)
            if (!r.ok)
                return r;
        return ok();
    },
};
exports.default = V;
module.exports = V;
