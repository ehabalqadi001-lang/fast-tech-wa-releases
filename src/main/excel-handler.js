'use strict';

/**
 * Fast Tech WA Manager — Excel / CSV Handler
 * Import contacts from Excel/CSV; export reports and templates.
 */

const XLSX = require('xlsx');
const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const libphonenumber = require('libphonenumber-js');

// Country dial-code map for Arab region
const COUNTRY_DIALCODES = {
  SA: '966',  AE: '971',  KW: '965',  QA: '974',
  BH: '973',  OM: '968',  JO: '962',  EG: '20',
  IQ: '964',  YE: '967',  LY: '218',  SY: '963',
  LB: '961',  MA: '212',  TN: '216',  DZ: '213',
  SD: '249',  PS: '970',
};

class ExcelHandler {
  // ─── Import contacts from Excel / CSV ────────────────────────────────────
  /**
   * @param {string} filePath  – absolute path to .xlsx / .xls / .csv
   * @param {Object} opts
   * @param {string} [opts.defaultCountry]  – ISO2 code (SA, AE …) for country correction
   * @param {string} [opts.defaultLabel]
   * @returns {{ contacts: Array, skipped: number, duplicates: number }}
   */
  importContacts(filePath, opts = {}) {
    if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

    const wb   = XLSX.readFile(filePath, { cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const contacts = [];
    let skipped    = 0;

    for (const row of rows) {
      // Flexible column detection (case-insensitive, Arabic/English)
      const phone = this._extractField(row, ['phone','mobile','tel','هاتف','جوال','رقم','موبايل']);
      const name  = this._extractField(row, ['name','fullname','اسم','الاسم','full name']);
      const country = this._extractField(row, ['country','دولة','البلد','كود البلد']) || opts.defaultCountry || '';
      const label   = this._extractField(row, ['label','tag','تصنيف','مجموعة']) || opts.defaultLabel || '';

      if (!phone) { skipped++; continue; }

      const normalizedPhone = this._normalizePhone(String(phone), country || opts.defaultCountry);
      if (!normalizedPhone) { skipped++; continue; }

      contacts.push({
        id:        uuidv4(),
        name:      (name || '').trim(),
        phone:     normalizedPhone,
        country:   country || opts.defaultCountry || '',
        group_tag: '',
        label:     label,
        notes:     '',
        opt_in:    1,
      });
    }

    return { contacts, skipped };
  }

  // ─── Export contacts to Excel ─────────────────────────────────────────────
  exportContacts(contacts, outPath) {
    const rows = contacts.map(c => ({
      'الاسم':    c.name    || '',
      'الهاتف':   c.phone   || '',
      'الدولة':   c.country || '',
      'التصنيف':  c.label   || '',
      'ملاحظات':  c.notes   || '',
      'مفعّل':    c.opt_in  ? 'نعم' : 'لا',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Contacts');
    XLSX.writeFile(wb, outPath);
    return outPath;
  }

  // ─── Export report to Excel ───────────────────────────────────────────────
  exportReport(data, outPath) {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Daily summary
    if (data.summary?.length) {
      const rows = data.summary.map(r => ({
        'التاريخ':          r.day,
        'إجمالي الرسائل':   r.total,
        'ناجحة':            r.success,
        'فاشلة':            r.failed,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'ملخص يومي');
    }

    // Sheet 2: Sent messages detail (phone + name + body per message)
    if (data.sentDetail?.length) {
      const rows = data.sentDetail.map(r => ({
        'رقم الهاتف':    r.recipient          || '',
        'الاسم':         r.contact_name        || '',
        'الرسالة':       r.body                || '',
        'الحملة':        r.campaign_name       || '',
        'الجهاز':        r.session_name        || r.session_id || '',
        'الحالة':        this._statusAr(r.status),
        'سبب الفشل':     r.error_msg           || '',
        'وقت الإرسال':   r.processed_at        || r.created_at || '',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'الرسائل المرسلة');
    }

    // Sheet 3: Campaign performance
    if (data.campaigns?.length) {
      const rows = data.campaigns.map(c => ({
        'الحملة':          c.name,
        'النوع':           c.type,
        'الإجمالي':        c.total,
        'أُرسل':           c.sent,
        'فشل':             c.failed,
        'نسبة النجاح %':   c.success_pct,
        'الحالة':          c.status,
        'تاريخ الإنشاء':   c.created_at,
        'تاريخ الانتهاء':  c.finished_at || '',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'الحملات');
    }

    // Sheet 4: Incoming replies (with correct field names)
    if (data.replies?.length) {
      const rows = data.replies.map(r => ({
        'رقم الهاتف':   r.from_number         || '',
        'الاسم':        r.from_name            || '',
        'الجروب':       r.is_group ? (r.group_name || 'جروب') : '',
        'الجهاز':       r.session_name         || r.session_id || '',
        'الرسالة':      r.body                 || '',
        'وقت الاستلام': r.received_at          || '',
        'حالة الرد':    r.replied ? 'تم الرد' : 'لم يُرد',
        'نص الرد':      r.reply_body           || '',
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'الردود الواردة');
    }

    XLSX.writeFile(wb, outPath);
    return outPath;
  }

  _statusAr(status) {
    const map = { sent:'مُرسل', delivered:'مُستلم', read:'مقروء', failed:'فشل', pending:'انتظار' };
    return map[status] || status || '';
  }

  // ─── Generate contacts template ───────────────────────────────────────────
  generateContactsTemplate(outPath) {
    const sample = [
      { 'الاسم': 'أحمد محمد', 'الهاتف': '966501234567', 'الدولة': 'SA', 'التصنيف': 'عملاء', 'ملاحظات': '' },
      { 'الاسم': 'فاطمة علي', 'الهاتف': '971501234567', 'الدولة': 'AE', 'التصنيف': 'عملاء محتملون', 'ملاحظات': '' },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sample), 'جهات الاتصال');
    XLSX.writeFile(wb, outPath);
    return outPath;
  }

  // ─── Country code correction ──────────────────────────────────────────────
  /**
   * Fix/normalize a list of raw phone strings for a given country.
   * @param {string[]} phones
   * @param {string} countryCode  ISO2 (SA, AE …)
   * @returns {{ fixed: string[], invalid: string[] }}
   */
  fixCountryCodes(phones, countryCode) {
    const fixed   = [];
    const invalid = [];
    for (const raw of phones) {
      const n = this._normalizePhone(raw, countryCode);
      if (n) fixed.push(n);
      else   invalid.push(raw);
    }
    return { fixed, invalid };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────
  _extractField(row, aliases) {
    for (const key of Object.keys(row)) {
      if (aliases.some(a => key.toLowerCase().replace(/\s/g,'').includes(a.toLowerCase().replace(/\s/g,'')))) {
        const v = row[key];
        if (v !== null && v !== undefined && String(v).trim()) return String(v).trim();
      }
    }
    return '';
  }

  _normalizePhone(raw, countryCode) {
    let cleaned = raw.replace(/[\s\-().+]/g, '');

    // Try libphonenumber first
    try {
      const parsed = libphonenumber.parsePhoneNumber(
        raw.startsWith('+') ? raw : `+${cleaned}`,
        countryCode || undefined
      );
      if (parsed && parsed.isValid()) {
        return parsed.nationalNumber
          ? (COUNTRY_DIALCODES[parsed.country] || '') + parsed.nationalNumber
          : cleaned;
      }
    } catch (_) { /* fall through */ }

    // Fallback: strip leading zeros and prepend dial code
    if (countryCode && COUNTRY_DIALCODES[countryCode]) {
      const dial = COUNTRY_DIALCODES[countryCode];
      if (cleaned.startsWith(dial)) return cleaned;
      if (cleaned.startsWith('0'))   return dial + cleaned.slice(1);
      if (cleaned.length >= 8)       return dial + cleaned;
    }

    // Just digits
    if (/^\d{7,15}$/.test(cleaned)) return cleaned;
    return '';
  }
}

module.exports = ExcelHandler;
