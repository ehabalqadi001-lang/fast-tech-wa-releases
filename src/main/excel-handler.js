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

    // Summary sheet
    if (data.summary?.length) {
      const summaryRows = data.summary.map(r => ({
        'التاريخ':         r.day,
        'إجمالي الرسائل': r.total,
        'ناجحة':          r.success,
        'فاشلة':          r.failed,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'ملخص');
    }

    // Campaigns sheet
    if (data.campaigns?.length) {
      const campRows = data.campaigns.map(c => ({
        'الحملة':        c.name,
        'النوع':         c.type,
        'الإجمالي':      c.total,
        'أُرسل':         c.sent,
        'فشل':           c.failed,
        'نسبة النجاح %': c.success_pct,
        'الحالة':        c.status,
        'التاريخ':       c.created_at,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(campRows), 'الحملات');
    }

    // Replies sheet
    if (data.replies?.length) {
      const replyRows = data.replies.map(r => ({
        'الاسم':   r.contact_name || '',
        'الهاتف':  r.recipient,
        'الرسالة': r.body,
        'التاريخ': r.sent_at,
      }));
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(replyRows), 'الردود');
    }

    XLSX.writeFile(wb, outPath);
    return outPath;
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
