/**
 * C9Z Web v2.0 — SQLite Database Engine (Node 24 built-in node:sqlite)
 * -------------------------------------------------------------------
 * Provides ACID-compliant local persistence for:
 * - Categories & Product Catalog (with Bestseller flags, stock, specs, images)
 * - Orders & Payment Verification Tracking
 * - Promo Coupons & Order Bumps
 * - Developer Roadmap & Firmware Changelog
 */

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'c9z.db');
const db = new DatabaseSync(dbPath);

// Configure WAL mode and foreign keys for concurrency & durability
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
`);

// Create schema tables
db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name_ar TEXT NOT NULL,
    description_ar TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category_slug TEXT NOT NULL,
    price INTEGER NOT NULL,
    compare_at_price INTEGER DEFAULT 0,
    stock INTEGER DEFAULT 15,
    is_bestseller INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    is_order_bump INTEGER DEFAULT 0,
    img TEXT DEFAULT '',
    tag TEXT DEFAULT 'C9Z DEVICE',
    chip TEXT DEFAULT 'ESP32',
    short_desc TEXT NOT NULL,
    full_desc TEXT DEFAULT '',
    specs_json TEXT DEFAULT '[]',
    firmware_json TEXT DEFAULT '[]',
    sales_count INTEGER DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_code TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    customer_city TEXT DEFAULT '',
    customer_address TEXT NOT NULL,
    customer_notes TEXT DEFAULT '',
    items_json TEXT NOT NULL,
    subtotal INTEGER NOT NULL,
    discount_amount INTEGER DEFAULT 0,
    coupon_code TEXT DEFAULT '',
    shipping_fee INTEGER DEFAULT 0,
    total INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    payment_provider TEXT NOT NULL,
    payment_status TEXT DEFAULT 'pending',
    payment_ref TEXT DEFAULT '',
    sender_wallet TEXT DEFAULT '',
    order_status TEXT DEFAULT 'new',
    client_ip TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS coupons (
    code TEXT PRIMARY KEY,
    title_ar TEXT NOT NULL,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value INTEGER NOT NULL,
    min_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    uses_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS changelog (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    version TEXT NOT NULL,
    title TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'firmware',
    model_target TEXT DEFAULT 'ALL',
    status TEXT NOT NULL DEFAULT 'released',
    summary TEXT NOT NULL,
    sha256_hash TEXT DEFAULT '',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// Seed initial categories if empty
const catCount = db.prepare('SELECT COUNT(*) AS cnt FROM categories').get().cnt;
if (catCount === 0) {
  const insertCat = db.prepare(
    'INSERT INTO categories (slug, name_ar, description_ar, sort_order) VALUES (?, ?, ?, ?)'
  );
  const initialCategories = [
    ['wifi-ble', 'أجهزة Wi-Fi & BLE', 'وحدات اختبار وتحليل الشبكات اللاسلكية والبلوتوث في البيئات المصرح بها', 1],
    ['rf-subghz', 'الراديو و Sub-GHz', 'أجهزة تحليل الترددات الراديوية ووحدات CC1101 و NRF24L01', 2],
    ['nfc-rfid', 'بطاقات NFC & RFID', 'أجهزة فحص وتقييم أنظمة الدخول والبطاقات الذكية', 3],
    ['bundles', 'الحزم والملحقات', 'حزم متكاملة وهوائيات ومستلزمات مختبرات الأمن السيبراني', 4]
  ];
  for (const c of initialCategories) {
    insertCat.run(...c);
  }
}

// Seed initial products if empty
const prodCount = db.prepare('SELECT COUNT(*) AS cnt FROM products').get().cnt;
if (prodCount === 0) {
  const insertProd = db.prepare(`
    INSERT INTO products (
      id, name, category_slug, price, compare_at_price, stock,
      is_bestseller, is_active, is_order_bump, img, tag, chip,
      short_desc, full_desc, specs_json, firmware_json, sales_count, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const initialProducts = [
    [
      'c9z-2',
      'C9Z-2',
      'nfc-rfid',
      90000,
      105000,
      12,
      1, // Bestseller
      1,
      0,
      '',
      'NFC • RF • WIFI',
      'ESP32',
      'جهاز محمول لاختبار أمان الشبكات اللاسلكية والترددات وقراءة بطاقات NFC / RFID.',
      'يجمع جهاز C9Z-2 بين تحليل شبكات Wi-Fi و Bluetooth مع وحدة ترددات راديوية RF وقارئ NFC/RFID مدمج، مما يجعله أداة ميدانية شاملة للباحثين وفرق الفحص الأمني.',
      JSON.stringify([
        ['المعالج', 'ESP32 Dual-Core'],
        ['الشبكات اللاسلكية', 'Wi-Fi 2.4GHz + BLE'],
        ['الوحدات المدمجة', 'RF Sub-GHz + NFC / RFID'],
        ['الأنظمة المتوافقة', 'Bruce / Marauder'],
        ['منفذ التوصيل', 'USB Type-C (Data + Flash)']
      ]),
      JSON.stringify(['Bruce', 'Marauder']),
      48,
      1
    ],
    [
      'c9z-3',
      'C9Z-3',
      'wifi-ble',
      50000,
      60000,
      25,
      1, // Bestseller
      1,
      0,
      '/images/c9z-3.jpg',
      'WIFI • BLE CORE',
      'ESP32',
      'جهاز محمول للمشاريع والتجارب التقنية وتقييم أمان شبكات Wi-Fi و Bluetooth.',
      'الخيار العملي الأول للبدء في أبحاث الأمن اللاسلكي؛ يأتي مهيأً بنظام تشغيل C9Z مع استهلاك منخفض للطاقة وتصميم مدمج جاهز للعمل الميداني.',
      JSON.stringify([
        ['المعالج', 'ESP32-WROOM-32'],
        ['الشبكات اللاسلكية', 'Wi-Fi 802.11 b/g/n 2.4GHz'],
        ['البلوتوث', 'Bluetooth 4.2 BR/EDR & BLE'],
        ['الأنظمة المتوافقة', 'Bruce / Marauder'],
        ['البطارية والشحن', 'مدمجة قابلة للشحن عبر USB']
      ]),
      JSON.stringify(['Bruce', 'Marauder']),
      64,
      2
    ],
    [
      'c9z-4',
      'C9Z-4',
      'rf-subghz',
      60000,
      70000,
      18,
      0,
      1,
      0,
      '/images/c9z-4.jpg',
      'NRF • 2.4GHZ LAB',
      'ESP32',
      'جهاز C9Z محمول مزود بوحدة NRF24L01 لاختبارات الترددات ومختبرات الأمان.',
      'مصمم خصيصاً لبيئات المختبرات المصرح بها لفحص بروتوكولات 2.4GHz والـ BLE واختبار مناعة الإشارات اللاسلكية بدقة عالية.',
      JSON.stringify([
        ['المعالج', 'ESP32'],
        ['النطاق اللاسلكي', '2.4GHz ISM Band'],
        ['الوحدات', 'Wi-Fi + BLE + NRF24L01'],
        ['الأنظمة المتوافقة', 'Bruce / Marauder']
      ]),
      JSON.stringify(['Bruce', 'Marauder']),
      31,
      3
    ],
    [
      'c9z-5',
      'C9Z-5',
      'rf-subghz',
      50000,
      65000,
      20,
      1, // Bestseller
      1,
      0,
      '/images/c9z-5.jpg',
      'RF • NRF • DUAL',
      'ESP32',
      'جهاز C9Z محمول يجمع بين وحدتي RF و NRF مع دعم كامل لـ Wi-Fi و Bluetooth.',
      'يمنحك C9Z-5 مرونة عالية في التبديل بين تحليل شبكات Wi-Fi وفحص إشارات RF و NRF في جهاز واحد مدمج وعالي الاعتمادية.',
      JSON.stringify([
        ['المعالج', 'ESP32'],
        ['الشبكات', 'Wi-Fi 2.4GHz + BLE'],
        ['وحدات الراديو', 'RF CC1101 + NRF24L01'],
        ['الأنظمة المتوافقة', 'Bruce / Marauder']
      ]),
      JSON.stringify(['Bruce', 'Marauder']),
      53,
      4
    ],
    [
      'c9z-7',
      'C9Z-7',
      'bundles',
      120000,
      140000,
      8,
      1, // Bestseller
      1,
      0,
      '',
      'FLAGSHIP • GPS • RF',
      'ESP32-S3',
      'الإصدار الاحترافي الأعلى بمدى أوسع ودعم GPS و RF و NRF مع أنظمة متقدمة.',
      'أقوى أجهزة سلسلة C9Z المخصصة للباحثين المتقدمين؛ يضم وحدة تحديد المواقع GPS لتحليل التغطية اللاسلكية الميدانية (Wardriving) إلى جانب وحدات الراديو المتعددة ودعم نظام Valhalla.',
      JSON.stringify([
        ['المعالج', 'ESP32-S3 High Performance'],
        ['الشبكات اللاسلكية', 'Wi-Fi 2.4GHz + BLE 5.0'],
        ['الوحدات المدمجة', 'RF + NRF + GPS NEO-6M'],
        ['الأنظمة المتوافقة', 'Bruce / Marauder / Valhalla'],
        ['الفئة', 'إصدار الباحثين المحترفين']
      ]),
      JSON.stringify(['Bruce', 'Marauder', 'Valhalla']),
      39,
      5
    ],
    [
      'c9z-cable-kit',
      'حزمة كابل البيانات والهوائي الميداني',
      'bundles',
      15000,
      25000,
      50,
      0,
      1,
      1, // Order Bump item inside cart/checkout
      '',
      'ADD-ON KIT',
      'ACCESSORY',
      'كابل USB مخصص لنقل البيانات والتفليش الآمن + هوائي SMA عالي الكسب لتقوية الإشارة.',
      'ملحق أساسي يضمن استقرار تفليش الأنظمة عبر Web Flasher دون انقطاع مع تحسين مدى التقاط الترددات في الفحص الميداني.',
      JSON.stringify([
        ['الكابل', 'USB Data & Power Shielded (1m)'],
        ['الهوائي', 'SMA Dual-Band High Gain'],
        ['التوافق', 'جميع أجهزة C9Z ولوحات ESP32']
      ]),
      JSON.stringify(['All']),
      72,
      6
    ]
  ];

  for (const p of initialProducts) {
    insertProd.run(...p);
  }
}

// Seed initial coupons if empty
const couponCount = db.prepare('SELECT COUNT(*) AS cnt FROM coupons').get().cnt;
if (couponCount === 0) {
  const insertCoupon = db.prepare(
    'INSERT INTO coupons (code, title_ar, discount_type, discount_value, min_order, is_active) VALUES (?, ?, ?, ?, ?, ?)'
  );
  insertCoupon.run('C9Z10', 'خصم مجتمع C9Z الترحيبي (10%)', 'percent', 10, 40000, 1);
  insertCoupon.run('RESEARCH15', 'خصم الباحثين والحزم (15,000 د.ع)', 'fixed', 15000, 100000, 1);
}

// Seed initial changelog & dev roadmap if empty
const logCount = db.prepare('SELECT COUNT(*) AS cnt FROM changelog').get().cnt;
if (logCount === 0) {
  const insertLog = db.prepare(
    'INSERT INTO changelog (version, title, category, model_target, status, summary, sha256_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const initialLogs = [
    [
      'v2.0.0',
      'إطلاق المتجر الإلكتروني المؤمّن وبوابة الفلاش الموحدة',
      'platform',
      'WEB-STORE',
      'released',
      'تأمين شامل للخادم، إضافة نظام الدفع متعدد البوابات، وتفعيل لوحة تحكم المطور.',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    ],
    [
      'v1.0.4',
      'C9Z Pro Firmware — دعم شرائح ESP32-S3 ووحدات GPS',
      'firmware',
      'C9Z-5 / C9Z-7',
      'released',
      'تحسين استقرار التقاط الإشارات، خفض استهلاك البطارية بنسبة 18%، ودعم كامل للوحات M5StickS3.',
      'a8f5f167f44f4964e6c998dee827110c9c23f61b4d8e9f0c1122334455667788'
    ],
    [
      'v1.0.2',
      'C9Z Core Firmware — تحديث واجهة CYD 2.8 و C9Z-3',
      'firmware',
      'C9Z-2 / C9Z-3',
      'released',
      'تحديث قوائم الفحص اللاسلكي ودعم قراءة بطاقات NFC بتوقيت استجابة أسرع.',
      'b7e23e544f4964e6c998dee827110c9c23f61b4d8e9f0c998877665544332211'
    ],
    [
      'v1.1.0-rc1',
      'تطوير الجيل الجديد C9Z-8 و C9Z-9 بدعم نطاقات مزدوجة',
      'hardware',
      'C9Z-8 / C9Z-9',
      'in_progress',
      'مرحلة اختبار الدوائر المطبوعة (PCB) وتكامل هوائيات Sub-GHz المدمجة قبل الإطلاق التجاري.',
      ''
    ]
  ];
  for (const l of initialLogs) {
    insertLog.run(...l);
  }
}

module.exports = { db, dataDir };
