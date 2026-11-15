/**
 * C9Z Web v2.0 — Hardened E-Commerce & Developer Dashboard Server
 * ----------------------------------------------------------------
 * Architecture:
 * - Express + SQLite (node:sqlite WAL mode)
 * - Server-side Telegram Bot API proxy (zero client-side token exposure)
 * - Multi-provider Payment Engine (COD + Manual Wallet Reference + Online Gateway Adapter)
 * - Scrypt + HMAC HttpOnly Cookie Authentication for Developer Dashboard
 * - Magic-byte verified image upload for product catalog management
 * - Strict CSP, security headers, and rate-limiting
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

try {
  require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (e) {}

const { db, dataDir } = require('./db/database');
const {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  DEV_GATE_COOKIE_NAME,
  DEV_GATE_TTL_MS,
  verifyCredentials,
  createSessionToken,
  verifySessionToken,
  verifyDevAccessKey,
  createDevGateToken,
  hasDeveloperGateAccess,
  parseCookies,
  checkLoginRateLimit,
  recordFailedLogin,
  clearLoginAttempts,
  requireAdmin,
  isUsingDefaultDevPassword
} = require('./services/auth');
const { getPaymentConfigStatus, processOrderPayment } = require('./services/payment');
const { saveBase64ProductImage } = require('./services/upload');

const app = express();
const PORT = process.env.PORT || 3000;

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'serial=(self), camera=(), microphone=(), geolocation=()');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' https://unpkg.com; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com data:; " +
      "img-src 'self' data: blob:; " +
      "connect-src 'self' blob:; " +
      "object-src 'none'; " +
      "base-uri 'self';"
  );
  next();
});

// Higher payload limit ONLY for admin image uploads, strict 32kb for everything else
app.use('/api/admin/upload', express.json({ limit: '6mb' }));
app.use(express.json({ limit: '32kb' }));

// Rate limiter for public order submissions
const orderAttempts = new Map();
const RATE_LIMIT_WINDOW = (parseInt(process.env.RATE_LIMIT_WINDOW_MINUTES, 10) || 10) * 60 * 1000;
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 30;

function rateLimitCheck(ip) {
  const now = Date.now();
  const entry = orderAttempts.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
  if (now > entry.resetAt) {
    entry.count = 1;
    entry.resetAt = now + RATE_LIMIT_WINDOW;
  } else {
    entry.count++;
  }
  orderAttempts.set(ip, entry);
  return entry.count <= RATE_LIMIT_MAX;
}

function sanitize(input, maxLen = 250) {
  if (typeof input !== 'string') return '';
  return input
    .trim()
    .slice(0, maxLen)
    .replace(/[<>'"&]/g, (c) => ({
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;',
      '&': '&amp;'
    }[c]));
}

const CATEGORY_NAMES = {
  'wifi-ble': 'أجهزة الشبكات اللاسلكية (Wi-Fi & BLE)',
  'rf-subghz': 'أجهزة الترددات والراديو (RF & Sub-GHz)',
  'nfc-rfid': 'أجهزة البطاقات الذكية (NFC & RFID)',
  bundles: 'الحزم والملحقات الاحترافية'
};

function normalizeSpecsObject(rawSpecsJson) {
  try {
    const parsed = JSON.parse(rawSpecsJson || '{}');
    if (Array.isArray(parsed)) {
      const obj = {};
      for (const pair of parsed) {
        if (Array.isArray(pair) && pair.length >= 2) {
          obj[String(pair[0])] = String(pair[1]);
        }
      }
      return obj;
    }
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch (_) {}
  return {};
}

function formatProductRow(row) {
  if (!row) return null;
  const specsObj = normalizeSpecsObject(row.specs_json);
  let firmware = [];
  try {
    firmware = JSON.parse(row.firmware_json || '[]');
  } catch (_) {}

  const price = Number(row.price || row.price_iqd || 0);
  const compareAt = Number(row.compare_at_price || row.compare_at_iqd || 0);
  const stock = Number(row.stock ?? row.stock_qty ?? 0);
  const img = row.img || row.image_url || '';

  return {
    id: row.id,
    name: row.name,
    category_slug: row.category_slug,
    category_name: CATEGORY_NAMES[row.category_slug] || row.category_slug,
    price,
    price_iqd: price,
    compare_at_price: compareAt,
    compare_at_iqd: compareAt > 0 ? compareAt : null,
    stock,
    stock_qty: stock,
    stock_status: stock > 0 ? 'in_stock' : 'out_of_stock',
    is_bestseller: Boolean(row.is_bestseller),
    is_featured: Boolean(row.is_bestseller),
    is_active: Boolean(row.is_active),
    is_order_bump: Boolean(row.is_order_bump),
    img,
    image_url: img,
    tag: row.tag || 'C9Z DEVICE',
    badge_text: row.tag || 'C9Z DEVICE',
    chip: row.chip || 'ESP32',
    subtitle: `${row.chip || 'ESP32'} — ${row.tag || 'C9Z Hardware'}`,
    desc: row.short_desc || '',
    short_desc: row.short_desc || '',
    full_desc: row.full_desc || row.short_desc || '',
    description: row.full_desc || row.short_desc || '',
    specs: specsObj,
    firmware,
    sales_count: Number(row.sales_count || 0),
    sort_order: Number(row.sort_order || 0),
    updated_at: row.updated_at
  };
}

// ============================================================================
// PUBLIC STOREFRONT API
// ============================================================================

app.get('/api/categories', (req, res) => {
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, id ASC').all();
  res.json({ ok: true, success: true, categories });
});

app.get('/api/products', (req, res) => {
  const { category, bestseller, q, sort } = req.query;
  const rows = db
    .prepare('SELECT * FROM products WHERE is_active = 1 ORDER BY sort_order ASC, id ASC')
    .all();

  let products = rows.map(formatProductRow);

  if (category && category !== 'all') {
    products = products.filter((p) => p.category_slug === category);
  }
  if (bestseller === '1' || bestseller === 'true') {
    products = products.filter((p) => p.is_bestseller);
  }
  if (q && typeof q === 'string' && q.trim()) {
    const query = q.trim().toLowerCase();
    products = products.filter(
      (p) =>
        p.id.toLowerCase().includes(query) ||
        p.name.toLowerCase().includes(query) ||
        p.short_desc.toLowerCase().includes(query) ||
        p.tag.toLowerCase().includes(query) ||
        p.chip.toLowerCase().includes(query)
    );
  }

  if (sort === 'lo' || sort === 'price-asc') {
    products.sort((a, b) => a.price_iqd - b.price_iqd);
  } else if (sort === 'hi' || sort === 'price-desc') {
    products.sort((a, b) => b.price_iqd - a.price_iqd);
  } else if (sort === 'popular' || sort === 'bestseller') {
    products.sort((a, b) => b.sales_count - a.sales_count);
  }

  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, id ASC').all();
  res.json({ ok: true, success: true, products, categories });
});

app.get('/api/changelog', (req, res) => {
  const rows = db.prepare('SELECT * FROM changelog ORDER BY id DESC').all();
  const items = rows.map((r) => ({
    ...r,
    release_date: (r.created_at || '').slice(0, 10)
  }));
  res.json({ ok: true, success: true, items, changelog: items });
});

app.get('/api/payment-config', (req, res) => {
  const status = getPaymentConfigStatus();
  res.json({
    ok: true,
    success: true,
    mode: status.mode,
    wallets: status.wallets,
    gateways: status.gateways,
    config: {
      gatewayMode: status.mode,
      manualWallets: {
        zainCashNumber: status.wallets.zaincash,
        asiaHawalaNumber: status.wallets.asiahawala,
        qiCardNumber: status.wallets.qicard
      }
    }
  });
});

app.post('/api/coupons/validate', (req, res) => {
  const rawCode = String(req.body.code || '').trim().toUpperCase();
  const subtotal = Math.max(0, Number(req.body.subtotalIqd ?? req.body.subtotal) || 0);

  if (!rawCode) {
    return res.status(400).json({ ok: false, success: false, error: 'أدخل رمز الكوبون أولاً.' });
  }

  const coupon = db
    .prepare('SELECT * FROM coupons WHERE UPPER(code) = ? AND is_active = 1')
    .get(rawCode);

  if (!coupon) {
    return res.status(404).json({ ok: false, success: false, error: 'رمز الكوبون غير صالح أو منتهي الصلاحية.' });
  }

  if (subtotal < coupon.min_order) {
    return res.status(400).json({
      ok: false,
      success: false,
      error: `الحد الأدنى لتفعيل هذا الكوبون هو ${Number(coupon.min_order).toLocaleString('en-US')} د.ع.`
    });
  }

  let discountIqd = 0;
  if (coupon.discount_type === 'percent') {
    discountIqd = Math.round((subtotal * coupon.discount_value) / 100);
  } else {
    discountIqd = Math.min(subtotal, coupon.discount_value);
  }

  res.json({
    ok: true,
    success: true,
    coupon: {
      code: coupon.code,
      title_ar: coupon.title_ar,
      description: coupon.title_ar,
      discount_type: coupon.discount_type,
      discount_value: coupon.discount_value,
      discountAmount: discountIqd,
      discountIqd,
      freeShipping: false
    }
  });
});

async function handleCreateOrder(req, res) {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';

  if (!rateLimitCheck(clientIp)) {
    return res.status(429).json({
      ok: false,
      success: false,
      error: 'لقد تجاوزت الحد المسموح من الطلبات، يرجى الانتظار قليلاً.'
    });
  }

  try {
    const body = req.body || {};
    const customerObj = body.customer && typeof body.customer === 'object' ? body.customer : body;
    const items = body.items;
    const couponCode = body.couponCode || '';
    const paymentMethod = body.paymentMethod || 'cod';
    const paymentProvider = body.paymentProvider || 'cod';
    const paymentRef = body.transactionRef || body.paymentRef || '';
    const senderWallet = body.senderPhone || body.senderWallet || '';
    const website = body.website || '';

    // Honeypot anti-bot check
    if (website && String(website).trim() !== '') {
      return res.json({
        ok: true,
        success: true,
        orderId: 'C9-SIMULATED',
        invoice: { orderCode: 'C9-SIMULATED', totalIqd: 0 }
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ ok: false, success: false, error: 'بيانات الطلب أو السلة غير مكتملة.' });
    }

    const name = sanitize(customerObj.name || '', 80);
    const rawPhone = String(customerObj.phone || '').replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 1632);
    const phone = sanitize(rawPhone.replace(/[\s-]/g, ''), 20);
    const governorate = sanitize(customerObj.governorate || customerObj.city || 'بغداد', 60);
    const city = sanitize(customerObj.city || governorate, 80);
    const landmark = sanitize(customerObj.landmark || customerObj.address || city, 220);
    const notes = sanitize(customerObj.notes || '', 500);

    if (name.length < 2) {
      return res.status(400).json({ ok: false, success: false, error: 'الاسم قصير جداً (أقل من حرفين).' });
    }
    if (!/^\+?[0-9]{8,15}$/.test(phone)) {
      return res.status(400).json({ ok: false, success: false, error: 'يرجى إدخال رقم هاتف صحيح.' });
    }
    if (landmark.length < 3) {
      return res.status(400).json({ ok: false, success: false, error: 'يرجى إدخال العنوان أو أقرب نقطة دالة.' });
    }

    // Server-side catalog lookup & price calculation (ignores any client-submitted price)
    const getProductStmt = db.prepare('SELECT * FROM products WHERE id = ? AND is_active = 1');
    const verifiedItems = [];
    let subtotal = 0;

    for (const item of items) {
      const prod = getProductStmt.get(String(item.id || ''));
      if (!prod) {
        return res.status(400).json({
          ok: false,
          success: false,
          error: `المنتج (${sanitize(String(item.id || ''), 30)}) غير متوفر حالياً.`
        });
      }
      const qty = Math.max(1, Math.min(20, Math.floor(Number(item.q || item.qty)) || 1));
      const unitPrice = Number(prod.price);
      const lineTotal = qty * unitPrice;
      subtotal += lineTotal;
      verifiedItems.push({
        id: prod.id,
        name: prod.name,
        price: unitPrice,
        unitPriceIqd: unitPrice,
        qty,
        lineTotal
      });
    }

    // Server-side coupon verification
    let discountAmount = 0;
    let appliedCoupon = '';
    if (couponCode && typeof couponCode === 'string' && couponCode.trim()) {
      const cleanCoupon = couponCode.trim().toUpperCase();
      const coupon = db
        .prepare('SELECT * FROM coupons WHERE UPPER(code) = ? AND is_active = 1')
        .get(cleanCoupon);
      if (coupon && subtotal >= coupon.min_order) {
        appliedCoupon = coupon.code;
        if (coupon.discount_type === 'percent') {
          discountAmount = Math.round((subtotal * coupon.discount_value) / 100);
        } else {
          discountAmount = Math.min(subtotal, coupon.discount_value);
        }
        db.prepare('UPDATE coupons SET uses_count = uses_count + 1 WHERE code = ?').run(coupon.code);
      }
    }

    const shippingFee = 5000;
    const total = Math.max(0, subtotal - discountAmount + shippingFee);
    const orderCode = 'C9Z-' + Date.now().toString(36).toUpperCase();

    // Process payment via Unified Payment Service
    const payResult = await processOrderPayment({
      orderCode,
      total,
      paymentMethod,
      paymentProvider,
      paymentRef: sanitize(paymentRef, 80),
      senderWallet: sanitize(senderWallet, 30)
    });

    if (!payResult.success) {
      return res.status(400).json({ ok: false, success: false, error: payResult.error });
    }

    const normalizedPayStatus =
      payResult.paymentStatus === 'awaiting_verification' || payResult.paymentStatus === 'verification_pending'
        ? 'verification_pending'
        : payResult.paymentStatus === 'paid'
          ? 'verified_paid'
          : payResult.paymentStatus;

    const nowIso = new Date().toISOString();

    // Save order in SQLite
    db.prepare(`
      INSERT INTO orders (
        order_code, customer_name, customer_phone, customer_city, customer_address,
        customer_notes, items_json, subtotal, discount_amount, coupon_code,
        shipping_fee, total, payment_method, payment_provider, payment_status,
        payment_ref, sender_wallet, order_status, client_ip, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderCode,
      name,
      phone,
      `${governorate} — ${city}`,
      landmark,
      notes,
      JSON.stringify(verifiedItems),
      subtotal,
      discountAmount,
      appliedCoupon,
      shippingFee,
      total,
      payResult.paymentMethod,
      payResult.paymentProvider,
      normalizedPayStatus,
      payResult.paymentRef,
      payResult.senderWallet || '',
      'pending',
      clientIp,
      nowIso,
      nowIso
    );

    // Increment product sales_count & adjust stock
    const updateProdSales = db.prepare(
      'UPDATE products SET sales_count = sales_count + ?, stock = MAX(0, stock - ?) WHERE id = ?'
    );
    for (const vi of verifiedItems) {
      updateProdSales.run(vi.qty, vi.qty, vi.id);
    }

    // Append backup JSONL log
    const logRecord = {
      orderCode,
      timestamp: nowIso,
      clientIp,
      customer: { name, phone, governorate, city, landmark, notes },
      items: verifiedItems,
      subtotalIqd: subtotal,
      discountIqd: discountAmount,
      shippingIqd: shippingFee,
      totalIqd: total,
      payment: payResult
    };
    fs.appendFileSync(path.join(dataDir, 'orders.log'), JSON.stringify(logRecord) + '\n', 'utf8');

    // Secure Server-side Telegram Dispatch
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    let tgSent = false;

    if (botToken && chatId && botToken !== 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
      const lines = [
        `*طلب جديد* \`${orderCode}\``,
        `*الدفع:* ${payResult.paymentMethod} (${payResult.paymentProvider}) — \`${normalizedPayStatus}\``,
        payResult.paymentRef ? `*المرجع:* \`${payResult.paymentRef}\`` : '',
        '',
        `*الاسم:* ${name}`,
        `*الهاتف:* ${phone}`,
        `*العنوان:* ${governorate} — ${city} — ${landmark}`,
        notes ? `*ملاحظات:* ${notes}` : '',
        '',
        '*المنتجات:*',
        ...verifiedItems.map(
          (x) => `• ${x.name} (${x.id}) × ${x.qty} — ${Number(x.lineTotal).toLocaleString('en-US')} د.ع`
        ),
        discountAmount > 0
          ? `*الخصم (${appliedCoupon}):* -${Number(discountAmount).toLocaleString('en-US')} د.ع`
          : '',
        `*التوصيل:* ${Number(shippingFee).toLocaleString('en-US')} د.ع`,
        `*الإجمالي النهائي:* *${Number(total).toLocaleString('en-US')} د.ع*`
      ]
        .filter(Boolean)
        .join('\n');

      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: lines,
            parse_mode: 'Markdown'
          })
        });
        tgSent = tgRes.ok;
      } catch (e) {
        console.error('Telegram send error:', e.message);
      }
    }

    const invoice = {
      orderCode,
      items: verifiedItems,
      subtotalIqd: subtotal,
      discountIqd: discountAmount,
      shippingIqd: shippingFee,
      totalIqd: total,
      paymentMethod: payResult.paymentMethod,
      paymentProvider: payResult.paymentProvider,
      paymentStatus: normalizedPayStatus,
      transactionRef: payResult.paymentRef,
      instructions: payResult.instructions,
      createdAt: nowIso
    };

    return res.json({
      ok: true,
      success: true,
      orderId: orderCode,
      total,
      mode: tgSent ? 'telegram' : 'local_db',
      invoice,
      order: invoice
    });
  } catch (err) {
    console.error('Order processing error:', err);
    return res.status(500).json({
      ok: false,
      success: false,
      error: 'حدث خطأ غير متوقع أثناء معالجة الطلب.'
    });
  }
}

app.post('/api/order', handleCreateOrder);
app.post('/api/orders', handleCreateOrder);

// ============================================================================
// DEVELOPER DASHBOARD AUTHENTICATION & ADMIN API
// ============================================================================

app.post('/api/auth/login', (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const limitStatus = checkLoginRateLimit(clientIp);
  if (!limitStatus.allowed) {
    return res.status(429).json({
      ok: false,
      success: false,
      error: `تم حظر المحاولات مؤقتاً لحماية الحساب. حاول بعد ${limitStatus.waitSec} ثانية.`
    });
  }

  const { username, password } = req.body || {};
  if (!verifyCredentials(username, password)) {
    recordFailedLogin(clientIp);
    return res.status(401).json({
      ok: false,
      success: false,
      error: 'اسم المستخدم أو كلمة المرور غير صحيحة.'
    });
  }

  clearLoginAttempts(clientIp);
  const token = createSessionToken(username.trim());
  const maxAgeSec = Math.floor(SESSION_TTL_MS / 1000);

  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`
  );

  res.json({
    ok: true,
    success: true,
    username: username.trim(),
    user: {
      username: username.trim(),
      usingDefaultPassword: isUsingDefaultDevPassword()
    }
  });
});

app.post('/api/auth/dev-gate', (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const limitStatus = checkLoginRateLimit(clientIp);
  if (!limitStatus.allowed) {
    return res.status(429).json({
      ok: false,
      success: false,
      error: `تم حظر المحاولات مؤقتاً لحماية البوابة. حاول بعد ${limitStatus.waitSec} ثانية.`
    });
  }

  const key = String(req.body?.key || '').trim();
  if (!verifyDevAccessKey(key)) {
    recordFailedLogin(clientIp);
    return res.status(403).json({
      ok: false,
      success: false,
      error: 'مفتاح وصول المطور غير صالح.'
    });
  }

  clearLoginAttempts(clientIp);
  const gateToken = createDevGateToken();
  const maxAgeSec = Math.floor(DEV_GATE_TTL_MS / 1000);

  res.setHeader(
    'Set-Cookie',
    `${DEV_GATE_COOKIE_NAME}=${encodeURIComponent(gateToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`
  );

  res.json({
    ok: true,
    success: true,
    redirect: '/__c9z-ops'
  });
});

app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', [
    `${SESSION_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
    `${DEV_GATE_COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
  ]);
  res.json({ ok: true, success: true });
});

app.get('/api/auth/me', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const session = verifySessionToken(cookies[SESSION_COOKIE_NAME]);
  if (!session) {
    return res.json({ authenticated: false });
  }
  res.json({
    authenticated: true,
    username: session.sub,
    user: {
      username: session.sub,
      usingDefaultPassword: isUsingDefaultDevPassword()
    }
  });
});

// Admin Overview & Analytics
app.get('/api/admin/overview', requireAdmin, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders ORDER BY id DESC').all();
  const products = db.prepare('SELECT * FROM products ORDER BY sort_order ASC').all().map(formatProductRow);
  const coupons = db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
  const changelog = db.prepare('SELECT * FROM changelog ORDER BY id DESC').all();

  const validOrders = orders.filter((o) => o.order_status !== 'cancelled');
  const totalRevenueIqd = validOrders.reduce((sum, o) => sum + Number(o.total || 0), 0);
  const paidRevenueIqd = validOrders
    .filter((o) => o.payment_status === 'verified_paid' || o.payment_status === 'paid_sandbox')
    .reduce((sum, o) => sum + Number(o.total || 0), 0);
  const pendingOrders = orders.filter(
    (o) => o.order_status === 'pending' || o.order_status === 'new' || o.payment_status === 'verification_pending'
  ).length;
  const lowStockProducts = products.filter((p) => p.stock_qty <= 5).length;

  const arDays = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const today = new Date();
  const dailyBuckets = [];
  const bucketMap = new Map();

  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date(today.getTime() - offset * 86400000);
    const isoDate = d.toISOString().slice(0, 10);
    const label = offset === 0 ? 'اليوم' : arDays[d.getDay()];
    const bucket = { date: isoDate, day: label, revenue: 0, orders: 0 };
    dailyBuckets.push(bucket);
    bucketMap.set(isoDate, bucket);
  }

  for (const order of validOrders) {
    const orderDay = String(order.created_at || '').slice(0, 10);
    const target = bucketMap.get(orderDay);
    if (target) {
      target.revenue += Number(order.total || 0);
      target.orders += 1;
    }
  }

  const dailyChart = dailyBuckets.map(({ day, revenue, orders: ordCount }) => ({
    day,
    revenue,
    orders: ordCount
  }));

  const payCfg = getPaymentConfigStatus();

  res.json({
    ok: true,
    success: true,
    kpis: {
      totalRevenueIqd,
      paidRevenueIqd,
      totalOrders: orders.length,
      pendingOrders,
      activeProducts: products.filter((p) => p.is_active).length,
      totalProducts: products.length,
      lowStockProducts
    },
    dailyChart,
    gateways: {
      telegramConfigured: payCfg.telegramReady,
      zainCashLive: payCfg.gateways.zaincash_api.ready,
      qiCardLive: payCfg.gateways.qicard_api.ready,
      stripeLive: payCfg.gateways.stripe_api.ready
    },
    couponsCount: coupons.length,
    changelogCount: changelog.length
  });
});

// Admin Products CRUD (Upsert support)
app.get('/api/admin/products', requireAdmin, (req, res) => {
  const products = db.prepare('SELECT * FROM products ORDER BY sort_order ASC, id ASC').all().map(formatProductRow);
  const categories = db.prepare('SELECT * FROM categories ORDER BY sort_order ASC').all();
  res.json({ ok: true, success: true, products, categories });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  try {
    const b = req.body || {};
    const id = String(b.id || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '');

    if (!id || id.length < 2) {
      return res.status(400).json({ ok: false, success: false, error: 'معرّف المنتج (ID) مطلوب بالأحرف الإنجليزية والأرقام.' });
    }

    const name = sanitize(b.name || id.toUpperCase(), 80);
    const category_slug = sanitize(b.category_slug || 'wifi-ble', 40);
    const price = Math.max(0, Math.floor(Number(b.price_iqd ?? b.price) || 0));
    const compare_at_price = Math.max(0, Math.floor(Number(b.compare_at_iqd ?? b.compare_at_price) || 0));
    const stock = Math.max(0, Math.floor(Number(b.stock_qty ?? b.stock ?? 10)));
    const is_bestseller = b.is_bestseller ? 1 : 0;
    const is_active = b.is_active === false ? 0 : 1;
    const is_order_bump = b.is_order_bump ? 1 : 0;
    const img = String(b.image_url ?? b.img ?? '').trim();
    const tag = sanitize(b.badge_text || b.tag || 'C9Z DEVICE', 40);
    const chip = sanitize(b.subtitle || b.chip || 'ESP32', 60);
    const short_desc = sanitize(b.short_desc || b.desc || '', 300);
    const full_desc = sanitize(b.description || b.full_desc || short_desc, 1200);
    const specs_json = JSON.stringify(b.specs && typeof b.specs === 'object' ? b.specs : {});
    const nowIso = new Date().toISOString();

    const exists = db.prepare('SELECT id FROM products WHERE id = ?').get(id);
    if (exists) {
      db.prepare(`
        UPDATE products SET
          name = ?, category_slug = ?, price = ?, compare_at_price = ?, stock = ?,
          is_bestseller = ?, is_active = ?, is_order_bump = ?, img = ?, tag = ?,
          chip = ?, short_desc = ?, full_desc = ?, specs_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        name, category_slug, price, compare_at_price, stock,
        is_bestseller, is_active, is_order_bump, img, tag,
        chip, short_desc, full_desc, specs_json, nowIso, id
      );
    } else {
      db.prepare(`
        INSERT INTO products (
          id, name, category_slug, price, compare_at_price, stock,
          is_bestseller, is_active, is_order_bump, img, tag, chip,
          short_desc, full_desc, specs_json, firmware_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '["Bruce","Marauder"]', ?)
      `).run(
        id, name, category_slug, price, compare_at_price, stock,
        is_bestseller, is_active, is_order_bump, img, tag,
        chip, short_desc, full_desc, specs_json, nowIso
      );
    }

    const saved = formatProductRow(db.prepare('SELECT * FROM products WHERE id = ?').get(id));
    res.json({ ok: true, success: true, product: saved });
  } catch (err) {
    res.status(500).json({ ok: false, success: false, error: err.message });
  }
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true, success: true });
});

// Admin Secure Image Upload (Magic-Byte Verified)
app.post('/api/admin/upload', requireAdmin, (req, res) => {
  try {
    const rawDataUrl = req.body?.dataUrl || req.body?.imageBase64 || '';
    const imagesDir = path.join(__dirname, 'public', 'images');
    const imageUrl = saveBase64ProductImage(rawDataUrl, imagesDir);
    const commaIdx = rawDataUrl.indexOf(',');
    const approxBytes = commaIdx > -1 ? Buffer.from(rawDataUrl.slice(commaIdx + 1), 'base64').length : 0;
    res.json({
      ok: true,
      success: true,
      url: imageUrl,
      imageUrl,
      mime: 'image/verified',
      size: approxBytes
    });
  } catch (err) {
    res.status(400).json({ ok: false, success: false, error: err.message });
  }
});

// Admin Orders Management & Payment Verification
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const statusFilter = (req.query.status || '').trim();
  const rows = statusFilter
    ? db.prepare('SELECT * FROM orders WHERE order_status = ? ORDER BY id DESC').all(statusFilter)
    : db.prepare('SELECT * FROM orders ORDER BY id DESC').all();

  const orders = rows.map((o) => {
    const parts = String(o.customer_city || '').split('—');
    return {
      ...o,
      governorate: (parts[0] || o.customer_city || 'بغداد').trim(),
      city: (parts[1] || parts[0] || '').trim(),
      landmark: o.customer_address,
      total_iqd: Number(o.total || 0),
      transaction_ref: o.payment_ref || '',
      sender_phone: o.sender_wallet || '',
      items: JSON.parse(o.items_json || '[]')
    };
  });
  res.json({ ok: true, success: true, orders });
});

app.patch('/api/admin/orders/:orderCode', requireAdmin, (req, res) => {
  const { orderCode } = req.params;
  const existing = db.prepare('SELECT * FROM orders WHERE order_code = ?').get(orderCode);
  if (!existing) {
    return res.status(404).json({ ok: false, success: false, error: 'الطلب غير موجود.' });
  }

  const { order_status, payment_status } = req.body || {};
  const nextOrderStatus = order_status ? sanitize(order_status, 40) : existing.order_status;
  const nextPaymentStatus = payment_status ? sanitize(payment_status, 40) : existing.payment_status;

  db.prepare(`
    UPDATE orders SET order_status = ?, payment_status = ?, updated_at = ? WHERE order_code = ?
  `).run(nextOrderStatus, nextPaymentStatus, new Date().toISOString(), orderCode);

  res.json({ ok: true, success: true });
});

// Admin Coupons Management
app.get('/api/admin/coupons', requireAdmin, (req, res) => {
  const rows = db.prepare('SELECT * FROM coupons ORDER BY created_at DESC').all();
  const coupons = rows.map((c) => ({
    ...c,
    description: c.title_ar,
    min_order_iqd: Number(c.min_order || 0),
    used_count: Number(c.uses_count || 0),
    max_uses: 100
  }));
  res.json({ ok: true, success: true, coupons });
});

app.post('/api/admin/coupons', requireAdmin, (req, res) => {
  const { code, title_ar, description, discount_type, discount_value, min_order, min_order_iqd } = req.body || {};
  const cleanCode = String(code || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
  if (!cleanCode || cleanCode.length < 3) {
    return res.status(400).json({ ok: false, success: false, error: 'رمز الكوبون غير صالح.' });
  }
  const type = discount_type === 'fixed' ? 'fixed' : 'percent';
  const val = Math.max(1, Math.floor(Number(discount_value) || 10));
  const min = Math.max(0, Math.floor(Number(min_order_iqd ?? min_order) || 0));
  const title = sanitize(description || title_ar || `كوبون ${cleanCode}`, 100);

  db.prepare(`
    INSERT OR REPLACE INTO coupons (code, title_ar, discount_type, discount_value, min_order, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(cleanCode, title, type, val, min);

  res.json({ ok: true, success: true });
});

app.delete('/api/admin/coupons/:code', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM coupons WHERE code = ?').run(req.params.code);
  res.json({ ok: true, success: true });
});

// Admin Changelog & Dev Roadmap Management
app.post('/api/admin/changelog', requireAdmin, (req, res) => {
  const { version, title, category, model_target, status, summary, sha256_hash } = req.body || {};
  if (!version || !title || !summary) {
    return res.status(400).json({ ok: false, success: false, error: 'رقم الإصدار والعنوان والوصف حقول مطلوبة.' });
  }
  db.prepare(`
    INSERT INTO changelog (version, title, category, model_target, status, summary, sha256_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    sanitize(version, 30),
    sanitize(title, 120),
    sanitize(category || 'firmware', 30),
    sanitize(model_target || 'ALL', 40),
    sanitize(status || 'released', 30),
    sanitize(summary, 500),
    sanitize(sha256_hash || '', 80)
  );
  res.json({ ok: true, success: true });
});

app.delete('/api/admin/changelog/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM changelog WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true, success: true });
});

// Stealth Developer Route & Direct Path Block (MUST run before express.static)
app.get('/__c9z-ops', (req, res) => {
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
  const providedKey = typeof req.query.key === 'string' ? req.query.key.trim() : '';

  if (providedKey) {
    const limitStatus = checkLoginRateLimit(clientIp);
    if (!limitStatus.allowed || !verifyDevAccessKey(providedKey)) {
      recordFailedLogin(clientIp);
      return res
        .status(404)
        .set('Cache-Control', 'no-store')
        .set('X-Robots-Tag', 'noindex, nofollow')
        .sendFile(path.join(__dirname, 'public', 'pages', 'c9z-unavailable.html'));
    }

    clearLoginAttempts(clientIp);
    const gateToken = createDevGateToken();
    const maxAgeSec = Math.floor(DEV_GATE_TTL_MS / 1000);
    res.setHeader(
      'Set-Cookie',
      `${DEV_GATE_COOKIE_NAME}=${encodeURIComponent(gateToken)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}`
    );
    return res.redirect(302, '/__c9z-ops');
  }

  if (!hasDeveloperGateAccess(req)) {
    return res
      .status(404)
      .set('Cache-Control', 'no-store')
      .set('X-Robots-Tag', 'noindex, nofollow')
      .sendFile(path.join(__dirname, 'public', 'pages', 'c9z-unavailable.html'));
  }

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  return res.sendFile(path.join(__dirname, 'public', 'pages', 'dashboard.html'));
});

app.get(['/pages/dashboard.html', '/pages/dashboard', '/dashboard.html', '/dashboard', '/admin', '/admin.html'], (req, res) => {
  if (hasDeveloperGateAccess(req)) {
    return res.redirect(302, '/__c9z-ops');
  }
  return res
    .status(404)
    .set('Cache-Control', 'no-store')
    .set('X-Robots-Tag', 'noindex, nofollow')
    .sendFile(path.join(__dirname, 'public', 'pages', 'c9z-unavailable.html'));
});

// Static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// 404 fallback
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'public', 'pages', 'c9z-unavailable.html'));
});

if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log('====================================================');
    console.log(` C9Z Web v2.2 Secure Production Server running!`);
    console.log(` Storefront URL: http://localhost:${PORT}`);
    console.log(` Stealth Developer Ops: /__c9z-ops (Locked 404 until unlocked)`);
    console.log(` Database: SQLite WAL (data/c9z.db)`);
    console.log(` Payment Engine: ${getPaymentConfigStatus().mode.toUpperCase()} MODE`);
    console.log('====================================================');
  });
}

module.exports = app;
module.exports.app = app;
