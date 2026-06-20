'use strict';

const path = require('path');
const fs   = require('fs');

/** @param {import('../types').HandlerContext} ctx */
function register(ctx) {
  const { handle, db, waSvc, V, uuidv4 } = ctx;

  // ── helpers ────────────────────────────────────────────────────────────────
  const j = (v) => (v === null || v === undefined) ? '[]' : (typeof v === 'string' ? v : JSON.stringify(v));
  const jObj = (v) => (typeof v === 'string' ? v : JSON.stringify(v || {}));
  const slugify = (s) => String(s).toLowerCase().replace(/[^a-z0-9؀-ۿ]+/g, '-').replace(/^-|-$/g, '');

  // ── CATEGORIES ─────────────────────────────────────────────────────────────
  handle('ec:categories:list', () => db.ecCategoryList());

  handle('ec:categories:save', (data) => {
    if (!data.name?.trim()) throw new Error('اسم الفئة مطلوب');
    const slug = data.slug || slugify(data.name);
    if (data.id) {
      db.ecCategoryUpdate(data.id, { name: data.name, name_ar: data.name_ar||null, slug, description: data.description||null, image_url: data.image_url||null, parent_id: data.parent_id||null, sort_order: data.sort_order||0, is_active: data.is_active!==false ? 1 : 0 });
      return db.ecCategoryGet(data.id);
    }
    const id = uuidv4();
    db.ecCategoryCreate({ id, name: data.name, name_ar: data.name_ar||null, slug, description: data.description||null, image_url: data.image_url||null, parent_id: data.parent_id||null, sort_order: data.sort_order||0 });
    return db.ecCategoryGet(id);
  });

  handle('ec:categories:delete', (id) => { db.ecCategoryDelete(id); return { ok: true }; });

  // ── PRODUCTS ───────────────────────────────────────────────────────────────
  handle('ec:products:list', (opts) => db.ecProductList(opts || {}));

  handle('ec:products:get', (id) => db.ecProductGet(id));

  handle('ec:products:featured', () => db.ecProductList({ is_featured: true, limit: 12 }));

  handle('ec:products:lowStock', () => db.ecProductLowStock());

  handle('ec:products:save', (data) => {
    if (!data.name?.trim()) throw new Error('اسم المنتج مطلوب');
    if (!data.price)        throw new Error('سعر المنتج مطلوب');

    const slug     = data.slug || slugify(data.name + '-' + Date.now());
    const imgJson  = j(data.images);
    const tagsJson = j(data.tags);
    const row = {
      category_id: data.category_id || null,
      name: data.name, name_ar: data.name_ar||null, slug,
      description: data.description||null, description_ar: data.description_ar||null,
      product_type: data.product_type||'physical',
      price: parseFloat(data.price), compare_price: data.compare_price ? parseFloat(data.compare_price) : null,
      cost_price: data.cost_price ? parseFloat(data.cost_price) : null,
      sku: data.sku||null, barcode: data.barcode||null,
      stock_quantity: parseInt(data.stock_quantity)||0,
      low_stock_threshold: parseInt(data.low_stock_threshold)||5,
      track_inventory: data.track_inventory !== false ? 1 : 0,
      weight_grams: data.weight_grams ? parseInt(data.weight_grams) : null,
      images: imgJson, tags: tagsJson,
      meta_title: data.meta_title||null, meta_description: data.meta_description||null,
      is_active: data.is_active !== false ? 1 : 0,
      is_featured: data.is_featured ? 1 : 0,
    };

    if (data.id) {
      db.ecProductUpdate(data.id, row);
      return db.ecProductGet(data.id);
    }
    const id = uuidv4();
    db.ecProductCreate({ ...row, id });
    return db.ecProductGet(id);
  });

  handle('ec:products:delete', (id) => { db.ecProductDelete(id); return { ok: true }; });

  handle('ec:products:adjustStock', ({ id, delta }) => { db.ecProductAdjustStock(id, delta); return db.ecProductGet(id); });

  handle('ec:products:uploadImage', async ({ productId, filePath }) => {
    if (!fs.existsSync(filePath)) throw new Error('الملف غير موجود');
    const ext  = path.extname(filePath).toLowerCase();
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    if (!allowed.includes(ext)) throw new Error('نوع الملف غير مدعوم');
    const dataDir = await ctx.ipcMain.listenerCount ? null : null;
    const { app } = require('electron');
    const dest = path.join(app.getPath('userData'), 'ec-images');
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    const name = `${uuidv4()}${ext}`;
    fs.copyFileSync(filePath, path.join(dest, name));
    return { url: `ec-images/${name}`, fileName: name };
  });

  // ── VARIANTS ───────────────────────────────────────────────────────────────
  handle('ec:variants:list', (productId) => {
    const rows = db._db.prepare('SELECT * FROM ec_product_variants WHERE product_id=? AND is_active=1 ORDER BY rowid').all(productId);
    return { ok: true, data: rows };
  });

  handle('ec:variants:save', (data) => {
    const row = { product_id: data.product_id, name: data.name, options: jObj(data.options), price: data.price ? parseFloat(data.price) : null, stock_quantity: parseInt(data.stock_quantity)||0, sku: data.sku||null, image_url: data.image_url||null, is_active: 1 };
    if (data.id) { db.ecVariantUpdate(data.id, row); return { id: data.id }; }
    const id = uuidv4();
    db.ecVariantCreate({ ...row, id });
    return { id };
  });
  handle('ec:variants:delete', (id) => { db.ecVariantDelete(id); return { ok: true }; });

  // ── CUSTOMERS ──────────────────────────────────────────────────────────────
  handle('ec:customers:list', (opts) => db.ecCustomerList(opts || {}));

  handle('ec:customers:get', (id) => {
    const c = db.ecCustomerGet(id);
    if (c) c.orders = db.ecOrderList({ customer_id: id, limit: 20 });
    return c;
  });

  handle('ec:customers:save', (data) => {
    if (!data.name?.trim()) throw new Error('اسم العميل مطلوب');
    if (!data.phone?.trim()) throw new Error('رقم الهاتف مطلوب');
    const row = { name: data.name, email: data.email||null, phone: data.phone.trim(), addresses: j(data.addresses), notes: data.notes||null, tags: j(data.tags), source: data.source||'manual', loyalty_points: data.loyalty_points || 0 };
    if (data.id) {
      db.ecCustomerUpdate(data.id, row);
      return db.ecCustomerGet(data.id);
    }
    const existing = db.ecCustomerGetByPhone(row.phone);
    if (existing) throw new Error('رقم الهاتف مسجل مسبقاً');
    const id = uuidv4();
    db.ecCustomerCreate({ ...row, id });
    return db.ecCustomerGet(id);
  });

  handle('ec:customers:loyaltyAdjust', ({ customerId, points, description }) => {
    const c = db.ecCustomerGet(customerId);
    if (!c) throw new Error('العميل غير موجود');
    db.ecCustomerAddPoints(customerId, points);
    const updated = db.ecCustomerGet(customerId);
    db.ecLoyaltyTransactionCreate({ id: uuidv4(), customer_id: customerId, order_id: null, type: points > 0 ? 'adjusted' : 'redeemed', points, balance_after: updated.loyalty_points, description: description||'تسوية يدوية' });
    return updated;
  });

  // ── CART ───────────────────────────────────────────────────────────────────
  handle('ec:cart:get', ({ token }) => {
    if (!token) return { items: [], coupon_code: null };
    const cart = db.ecCartGet(token);
    return cart || { items: [], coupon_code: null };
  });

  handle('ec:cart:upsert', ({ token, items, coupon_code, loyalty_points_used }) => {
    const existing = db.ecCartGet(token);
    const itemsJson = j(items);
    if (existing) {
      db.ecCartUpdate(token, itemsJson, coupon_code, loyalty_points_used);
    } else {
      db.ecCartCreate({ id: uuidv4(), session_token: token, customer_id: null, items: itemsJson });
    }
    return { ok: true };
  });

  handle('ec:cart:clear', ({ token }) => { db.ecCartDelete(token); return { ok: true }; });

  handle('ec:coupon:validate', ({ code, subtotal }) => {
    const coupon = db.ecCouponGetByCode(code);
    if (!coupon) return { valid: false, error: 'كود الخصم غير صحيح أو منتهي' };
    const now = new Date().toISOString();
    if (coupon.expires_at && coupon.expires_at < now) return { valid: false, error: 'كود الخصم منتهي الصلاحية' };
    if (coupon.starts_at  && coupon.starts_at > now)  return { valid: false, error: 'كود الخصم لم يبدأ بعد' };
    if (coupon.max_uses   && coupon.used_count >= coupon.max_uses) return { valid: false, error: 'تم استنفاد الحد الأقصى لاستخدام هذا الكود' };
    if (subtotal < coupon.min_order_amount) return { valid: false, error: `الحد الأدنى للطلب ${coupon.min_order_amount} ج.م` };
    const discount = coupon.type === 'percentage' ? (subtotal * coupon.value / 100) : coupon.value;
    return { valid: true, coupon, discount: Math.min(discount, subtotal) };
  });

  // ── CHECKOUT ───────────────────────────────────────────────────────────────
  handle('ec:checkout', async ({ customer_data, shipping_address, delivery_notes, coupon_code, use_loyalty_points, items, wa_session_id, payment_method }) => {
    if (!items?.length) throw new Error('السلة فارغة');
    if (!customer_data?.name || !customer_data?.phone) throw new Error('بيانات العميل مطلوبة');

    // Resolve or create customer
    let customer = db.ecCustomerGetByPhone(customer_data.phone);
    if (!customer) {
      const cId = uuidv4();
      db.ecCustomerCreate({ id: cId, name: customer_data.name, email: customer_data.email||null, phone: customer_data.phone, addresses: '[]', notes: null, tags: '[]', source: customer_data.source||'whatsapp' });
      customer = db.ecCustomerGet(cId);
    }

    // Calculate totals
    let subtotal = 0;
    const orderItems = [];
    for (const item of items) {
      const product = db.ecProductGet(item.product_id);
      if (!product) throw new Error(`منتج غير موجود: ${item.product_id}`);
      const effectivePrice = item.variant_price || product.price;
      const lineTotal = effectivePrice * item.quantity;
      subtotal += lineTotal;
      orderItems.push({ product_id: product.id, variant_id: item.variant_id||null, name: product.name, sku: product.sku||null, price: effectivePrice, quantity: item.quantity, total: lineTotal, image_url: (JSON.parse(product.images||'[]')[0]||{}).url || null });
    }

    // Apply coupon
    let discountAmount = 0;
    if (coupon_code) {
      const couponRow = db.ecCouponGetByCode(coupon_code);
      if (couponRow) {
        discountAmount = couponRow.type === 'percentage' ? Math.min(subtotal * couponRow.value / 100, subtotal) : Math.min(couponRow.value, subtotal);
        db.ecCouponIncrUsed(couponRow.id);
      }
    }

    // Loyalty points
    let loyaltyDiscount = 0;
    if (use_loyalty_points && customer.loyalty_points > 0) {
      const cfg = db.ecLoyaltyConfig();
      const maxRedeemPoints = Math.min(customer.loyalty_points, Math.floor((subtotal - discountAmount) * (cfg.max_redeem_percent / 100) / cfg.egp_per_point));
      if (maxRedeemPoints >= cfg.min_redeem_points) {
        loyaltyDiscount = maxRedeemPoints * cfg.egp_per_point;
        db.ecCustomerAddPoints(customer.id, -maxRedeemPoints);
        db.ecLoyaltyTransactionCreate({ id: uuidv4(), customer_id: customer.id, order_id: null, type: 'redeemed', points: -maxRedeemPoints, balance_after: customer.loyalty_points - maxRedeemPoints, description: 'استرداد نقاط عند الشراء' });
      }
    }

    // Shipping fee (find matching zone or flat 0)
    let shippingFee = 0;
    const zones = db.ecShippingZoneList();
    const gov = (shipping_address?.governorate || '').toLowerCase();
    const zone = zones.find(z => {
      const govs = JSON.parse(z.governorates||'[]').map(g => g.toLowerCase());
      return govs.includes(gov) || govs.length === 0;
    });
    if (zone) {
      const afterDiscount = subtotal - discountAmount - loyaltyDiscount;
      shippingFee = (zone.free_shipping_above && afterDiscount >= zone.free_shipping_above) ? 0 : zone.base_fee;
    }

    const totalAmount = Math.max(0, subtotal - discountAmount - loyaltyDiscount + shippingFee);
    const orderId     = uuidv4();
    const orderNumber = db.ecOrderNextNumber();

    db.ecOrderCreate({
      id: orderId, order_number: orderNumber,
      customer_id: customer.id,
      customer_snapshot: JSON.stringify({ id: customer.id, name: customer.name, phone: customer.phone, email: customer.email }),
      status: 'pending', payment_method: payment_method||'cash_on_delivery', payment_status: 'pending',
      items: JSON.stringify(orderItems),
      subtotal, discount_amount: discountAmount + loyaltyDiscount,
      coupon_code: coupon_code||null, shipping_fee: shippingFee, total_amount: totalAmount,
      shipping_address: shipping_address ? JSON.stringify(shipping_address) : null,
      delivery_notes: delivery_notes||null,
      wa_session_id: wa_session_id||null,
    });

    // Add to order history
    const { v4: uuid2 } = require('uuid');
    db.ecOrderUpdateStatus(orderId, 'pending', { note: 'طلب جديد', created_by: 'system' });

    // Update customer stats + earn loyalty points
    db.ecCustomerIncrStats(customer.id, totalAmount);
    const cfg = db.ecLoyaltyConfig();
    if (cfg?.is_active) {
      const earned = Math.floor(totalAmount * cfg.points_per_egp);
      if (earned > 0) {
        db.ecCustomerAddPoints(customer.id, earned);
        db.ecLoyaltyTransactionCreate({ id: uuidv4(), customer_id: customer.id, order_id: orderId, type: 'earned', points: earned, balance_after: (db.ecCustomerGet(customer.id)).loyalty_points, description: `نقاط طلب ${orderNumber}` });
      }
    }

    // Deduct stock
    for (const item of orderItems) {
      if (item.product_id) db.ecProductAdjustStock(item.product_id, -item.quantity);
    }

    return { ok: true, data: { order_id: orderId, order_number: orderNumber, total_amount: totalAmount, customer_id: customer.id } };
  });

  // ── ORDERS (admin) ─────────────────────────────────────────────────────────
  handle('ec:orders:list',   (opts) => db.ecOrderList(opts || {}));
  handle('ec:orders:get',    (id)   => db.ecOrderGet(id));

  handle('ec:orders:updateStatus', ({ id, status, note, created_by }) => {
    db.ecOrderUpdateStatus(id, status, { note, created_by: created_by||'admin' });
    return db.ecOrderGet(id);
  });

  handle('ec:orders:updateTracking', ({ id, tracking_number, shipping_provider }) => {
    db.ecOrderUpdateTracking(id, tracking_number, shipping_provider);
    return db.ecOrderGet(id);
  });

  handle('ec:orders:triggerWaConfirmation', async ({ orderId, sessionId }) => {
    const order = db.ecOrderGet(orderId);
    if (!order) throw new Error('الطلب غير موجود');
    const snap = JSON.parse(order.customer_snapshot || '{}');
    const phone = snap.phone;
    if (!phone) throw new Error('رقم هاتف العميل غير متوفر');

    // Deactivate old confirmations for this phone
    const old = db.waBotConfirmationGetActive(phone);
    if (old) db.waBotConfirmationUpdate(old.id, { is_active: 0, status: 'superseded' });

    // Create new confirmation
    const confId = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.waBotConfirmationCreate({
      id: confId, session_id: sessionId || order.wa_session_id || null,
      ec_order_id: orderId, customer_phone: phone, customer_name: snap.name,
      status: 'pending_confirmation', expires_at: expiresAt,
    });

    db.ecOrderUpdateWaStatus(orderId, 'sent');

    // Send first message
    if (waSvc && (sessionId || order.wa_session_id)) {
      const sid = sessionId || order.wa_session_id;
      const msg = `مرحباً ${snap.name} 😊\nلديك طلب رقم *${order.order_number}* بقيمة *${order.total_amount} ج.م*\nهل تريد تأكيد الطلب؟\n\nأرسل: *نعم* للتأكيد أو *لا* للإلغاء`;
      try { await waSvc.sendText(sid, phone, msg); } catch (e) { console.warn('[WaBot] send failed:', e.message); }
    }

    return { ok: true, data: { confirmation_id: confId } };
  });

  // ── COUPONS ────────────────────────────────────────────────────────────────
  handle('ec:coupons:list',   ()     => db.ecCouponList());
  handle('ec:coupons:get',    (id)   => db.ecCouponGet(id));
  handle('ec:coupons:save',   (data) => {
    if (!data.code?.trim()) throw new Error('كود الخصم مطلوب');
    const row = { code: data.code.toUpperCase().trim(), type: data.type||'percentage', value: parseFloat(data.value)||0, min_order_amount: parseFloat(data.min_order_amount)||0, max_uses: data.max_uses ? parseInt(data.max_uses) : null, applicable_products: j(data.applicable_products), applicable_categories: j(data.applicable_categories), starts_at: data.starts_at||null, expires_at: data.expires_at||null };
    if (data.id) { db.ecCouponUpdate(data.id, { ...row, is_active: data.is_active!==false?1:0 }); return db.ecCouponGet(data.id); }
    const id = uuidv4();
    db.ecCouponCreate({ ...row, id });
    return db.ecCouponGet(id);
  });
  handle('ec:coupons:delete', (id)   => { db.ecCouponDelete(id); return { ok: true }; });

  // ── LOYALTY CONFIG ─────────────────────────────────────────────────────────
  handle('ec:loyalty:config',    ()    => db.ecLoyaltyConfig());
  handle('ec:loyalty:saveConfig',(cfg) => { db.ecLoyaltyConfigSave(cfg); return db.ecLoyaltyConfig(); });
  handle('ec:loyalty:history',   (id)  => db.ecLoyaltyTransactionList(id));

  // ── SHIPPING ZONES ─────────────────────────────────────────────────────────
  // Admin list returns ALL zones (including inactive); shop uses ecShippingZoneList (active only)
  handle('ec:shipping:list',   ()     => db._db.prepare('SELECT * FROM ec_shipping_zones ORDER BY name').all());
  handle('ec:shipping:save',   (data) => {
    const row = { name: data.name, governorates: j(data.governorates), base_fee: parseFloat(data.base_fee)||0, free_shipping_above: data.free_shipping_above ? parseFloat(data.free_shipping_above) : null, estimated_days_min: parseInt(data.estimated_days_min)||1, estimated_days_max: parseInt(data.estimated_days_max)||3 };
    if (data.id) { db.ecShippingZoneUpdate(data.id, { ...row, is_active: data.is_active!==false?1:0 }); return { ok: true }; }
    db.ecShippingZoneCreate({ ...row, id: uuidv4() }); return { ok: true };
  });
  handle('ec:shipping:delete',  (id)  => { db.ecShippingZoneDelete(id); return { ok: true }; });

  handle('ec:shipping:calculate', ({ governorate, subtotal }) => {
    const zones = db.ecShippingZoneList();
    const gov = (governorate||'').toLowerCase();
    const zone = zones.find(z => {
      const govs = JSON.parse(z.governorates||'[]').map(g => g.toLowerCase());
      return govs.includes(gov) || govs.length === 0;
    });
    if (!zone) return { fee: 0, zone: null };
    const fee = (zone.free_shipping_above && subtotal >= zone.free_shipping_above) ? 0 : zone.base_fee;
    return { fee, zone };
  });

  // ── REVIEWS ────────────────────────────────────────────────────────────────
  handle('ec:reviews:list',    (productId) => db.ecReviewList(productId));
  handle('ec:reviews:pending', ()          => db.ecReviewAllPending());
  handle('ec:reviews:save',    (data)      => { db.ecReviewCreate({ id: uuidv4(), product_id: data.product_id, customer_id: data.customer_id||null, order_id: data.order_id||null, rating: data.rating, comment: data.comment||null }); return { ok: true }; });
  handle('ec:reviews:approve', (id)        => { db.ecReviewApprove(id); return { ok: true }; });

  // ── ANALYTICS ──────────────────────────────────────────────────────────────
  handle('ec:analytics:overview',    ()      => db.ecAnalyticsOverview());
  handle('ec:analytics:salesByDay',  (days)  => db.ecAnalyticsSalesByDay(days || 30));
  handle('ec:analytics:topProducts', (limit) => db.ecAnalyticsTopProducts(limit || 10));

  // ── WA BOT CONFIRMATIONS (admin view) ─────────────────────────────────────
  handle('ec:bot:list',        ()     => db.waBotConfirmationList());
  handle('ec:bot:getByOrder',  (id)   => db.waBotConfirmationGetByOrderId(id));
}

module.exports = { register };
