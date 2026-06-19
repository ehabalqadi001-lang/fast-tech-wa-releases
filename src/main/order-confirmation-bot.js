'use strict';

/**
 * WhatsApp Order Confirmation Bot
 * Handles multi-step conversation to confirm e-commerce orders.
 * Integrates with whatsapp-web-service.js (existing) via event listener.
 */

const EventEmitter = require('events');

const FLOW = [
  {
    step: 0,
    type: 'confirm',
    choices_yes: ['نعم', 'yes', 'أيوه', 'ايوه', 'اه', 'ok', 'أكيد', 'اكيد', 'موافق', 'يا'],
    choices_no:  ['لا', 'no', 'لأ', 'la', 'نه', 'بطل'],
  },
  { step: 1, type: 'location',     field: 'delivery_location' },
  { step: 2, type: 'text',         field: 'recipient_name',   prompt: 'من فضلك اكتب *اسم المستلم* كاملاً:' },
  { step: 3, type: 'text_optional',field: 'delivery_notes',   prompt: 'هل فيه أي تعليمات للتوصيل؟ (أو اكتب *لا* للتخطي)' },
];

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

class OrderConfirmationBot extends EventEmitter {
  /**
   * @param {import('./database')} db
   * @param {import('./whatsapp-web-service')} waSvc
   */
  constructor(db, waSvc) {
    super();
    this._db   = db;
    this._wa   = waSvc;
    this._timer = null;
  }

  start() {
    if (!this._wa) return;
    // Listen for incoming messages from whatsapp-web-service
    this._wa.on('message', ({ sessionId, from, body, type, location }) => {
      const phone = from.replace('@c.us', '').replace('@g.us', '');
      this._handleIncoming(sessionId, phone, body || '', type, location).catch(e =>
        console.error('[WaBot] handler error:', e.message)
      );
    });

    // Expire old conversations every 5 minutes
    this._timer = setInterval(() => {
      try {
        this._db.waBotConfirmationExpireOld();
      } catch (e) {
        console.warn('[WaBot] expire error:', e.message);
      }
    }, 5 * 60 * 1000);

    console.log('[WaBot] Order confirmation bot started');
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  async _handleIncoming(sessionId, phone, body, type, location) {
    const conf = this._db.waBotConfirmationGetActive(phone);
    if (!conf) return; // no active conversation for this phone
    if (conf.session_id && conf.session_id !== sessionId) return; // wrong session

    const step    = conf.current_step || 0;
    const flowStep = FLOW[step];
    if (!flowStep) return;

    const collected = JSON.parse(conf.collected_data || '{}');
    const order = this._db.ecOrderGet(conf.ec_order_id);
    if (!order) {
      await this._deactivate(conf.id, phone, sessionId, '❌ الطلب غير موجود، يرجى التواصل مع خدمة العملاء.');
      return;
    }

    const snap = JSON.parse(order.customer_snapshot || '{}');

    if (flowStep.type === 'confirm') {
      const text = (body || '').trim().toLowerCase();
      const isYes = FLOW[0].choices_yes.some(c => text.includes(c));
      const isNo  = FLOW[0].choices_no.some(c => text === c || text.startsWith(c));

      if (isNo) {
        await this._cancel(conf, order, phone, sessionId);
        return;
      }

      if (!isYes) {
        await this._send(sessionId, phone, `من فضلك أرسل *نعم* للتأكيد أو *لا* للإلغاء`);
        return;
      }

      // Move to step 1 (location)
      await this._updateStep(conf.id, 1, collected);
      await this._send(sessionId, phone, `ممتاز! 📍 من فضلك أرسل *موقعك الجغرافي* عشان نحدد عنوان التسليم بدقة\n\nإذا لم تتمكن من إرسال الموقع، اكتب اسم المنطقة مباشرة`);
      return;
    }

    if (flowStep.type === 'location') {
      let lat = null, lng = null, address = null;

      if (type === 'location' && location) {
        lat     = location.latitude;
        lng     = location.longitude;
        address = location.description || await this._reverseGeocode(lat, lng);
        collected.delivery_location = { lat, lng, address };
      } else if (body?.trim()) {
        // Text fallback — treat as address
        address = body.trim();
        collected.delivery_location = { address };
      } else {
        await this._send(sessionId, phone, `من فضلك أرسل الموقع الجغرافي أو اكتب اسم منطقتك`);
        return;
      }

      this._db.waBotConfirmationUpdate(conf.id, {
        location_lat: lat, location_lng: lng, location_address: address,
        collected_data: JSON.stringify(collected),
      });

      await this._updateStep(conf.id, 2, collected);
      await this._send(sessionId, phone, `تم استلام الموقع ✅\nمن فضلك اكتب *اسم المستلم* كاملاً:`);
      return;
    }

    if (flowStep.type === 'text') {
      if (!body?.trim()) { await this._send(sessionId, phone, flowStep.prompt); return; }
      collected[flowStep.field] = body.trim();
      await this._updateStep(conf.id, 3, collected);
      await this._send(sessionId, phone, `ممتاز! هل فيه أي تعليمات للتوصيل؟ (مثال: الدور الثالث، بجانب المسجد)\nأو اكتب *لا* للتخطي`);
      return;
    }

    if (flowStep.type === 'text_optional') {
      const isSkip = ['لا', 'no', 'skip', 'لأ'].some(s => (body||'').trim().toLowerCase() === s);
      collected[flowStep.field] = isSkip ? '' : (body||'').trim();

      // All steps complete — finalize order
      await this._finalize(conf, order, snap, collected, phone, sessionId);
      return;
    }
  }

  async _finalize(conf, order, snap, collected, phone, sessionId) {
    const loc = collected.delivery_location || {};
    const recipientName   = collected.recipient_name || snap.name;
    const deliveryNotes   = collected.delivery_notes || '';
    const locationAddress = loc.address || conf.location_address || '';

    // Update ec_order
    const shippingAddr = JSON.parse(order.shipping_address || '{}');
    shippingAddr.recipient_name = recipientName;
    shippingAddr.delivery_notes = deliveryNotes;
    if (loc.lat) { shippingAddr.lat = loc.lat; shippingAddr.lng = loc.lng; }
    if (locationAddress) shippingAddr.address_detail = locationAddress;

    this._db._db.prepare(`UPDATE ec_orders SET shipping_address=?, delivery_notes=?, wa_confirmation_status='data_complete', status='confirmed', updated_at=datetime('now') WHERE id=?`)
      .run(JSON.stringify(shippingAddr), deliveryNotes, order.id);

    // Add order history
    const { v4: uuidv4 } = require('uuid');
    this._db._db.prepare(`INSERT INTO ec_order_history (id,order_id,status,note,created_by) VALUES (?,?,?,?,?)`)
      .run(uuidv4(), order.id, 'confirmed', 'تأكيد العميل عبر واتساب', 'wa_bot');

    // Deactivate conversation
    this._db.waBotConfirmationUpdate(conf.id, {
      status: 'data_complete', is_active: 0,
      collected_data: JSON.stringify(collected),
    });

    const msg = `✅ *تم تأكيد طلبك بنجاح!*\n\nرقم الطلب: *${order.order_number}*\nالمبلغ: *${order.total_amount} ج.م*\nالمستلم: *${recipientName}*${locationAddress ? `\nالموقع: ${locationAddress}` : ''}\n\nسيتم التواصل معك قريباً لتحديد موعد التسليم 🚚`;
    await this._send(sessionId, phone, msg);

    this.emit('order:confirmed', { order_id: order.id, order_number: order.order_number, phone });
    console.log(`[WaBot] Order ${order.order_number} confirmed by ${phone}`);
  }

  async _cancel(conf, order, phone, sessionId) {
    this._db.waBotConfirmationUpdate(conf.id, { status: 'cancelled', is_active: 0 });
    this._db.ecOrderUpdateStatus(order.id, 'cancelled', { note: 'إلغاء من العميل عبر واتساب', created_by: 'wa_bot' });
    this._db.ecOrderUpdateWaStatus(order.id, 'cancelled');
    await this._send(sessionId, phone, `تم إلغاء تأكيد الطلب.\nللتواصل معنا أرسل أي رسالة أو اتصل بنا مباشرة.`);
    this.emit('order:cancelled', { order_id: order.id, phone });
  }

  async _deactivate(confId, phone, sessionId, msg) {
    this._db.waBotConfirmationUpdate(confId, { status: 'error', is_active: 0 });
    await this._send(sessionId, phone, msg);
  }

  async _updateStep(confId, step, collected) {
    this._db.waBotConfirmationUpdate(confId, { current_step: step, collected_data: JSON.stringify(collected) });
  }

  async _send(sessionId, phone, text) {
    if (!this._wa || !sessionId) return;
    try { await this._wa.sendText(sessionId, phone, text); } catch (e) { console.warn('[WaBot] send error:', e.message); }
  }

  async _reverseGeocode(lat, lng) {
    try {
      const https = require('https');
      return await new Promise((resolve) => {
        const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
        https.get(url, { headers: { 'User-Agent': 'FastTechWA/1.0' } }, (res) => {
          let raw = '';
          res.on('data', c => raw += c);
          res.on('end', () => {
            try { resolve(JSON.parse(raw).display_name || `${lat},${lng}`); } catch { resolve(`${lat},${lng}`); }
          });
        }).on('error', () => resolve(`${lat},${lng}`));
      });
    } catch { return `${lat},${lng}`; }
  }
}

module.exports = OrderConfirmationBot;
