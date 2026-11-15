/* ==========================================================================
   C9Z Web v2.0 — Storefront Engine, Cart Drawer, Quick View & Express Checkout
   Security: Strict HTML escaping, server-side price & coupon verification
   ========================================================================== */
(function (global) {
  'use strict';

  const STORAGE_KEY = 'c9z_cart_v2';
  const SHIPPING_DEFAULT = 5000;

  const GOVERNORATES = [
    'بغداد', 'البصرة', 'نينوى', 'أربيل', 'النجف', 'كربلاء',
    'السليمانية', 'دهوك', 'كركوك', 'بابل', 'ديالى', 'الأنبار',
    'واسط', 'ذي قار', 'ميسان', 'القادسية', 'المثنى', 'صلاح الدين'
  ];

  const state = {
    products: [],
    categories: [],
    paymentConfig: null,
    cart: loadCartFromStorage(),
    coupon: null, // { code, discountIqd, freeShipping, description }
    loaded: false,
    loadingPromise: null,
    selectedPaymentMethod: 'cod',
    selectedWalletProvider: 'zaincash',
    selectedGatewayProvider: 'stripe'
  };

  function esc(val) {
    return String(val == null ? '' : val)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function formatIQD(num) {
    const n = Math.max(0, Math.round(Number(num) || 0));
    return n.toLocaleString('en-US') + ' د.ع';
  }

  function loadCartFromStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((item) => item && typeof item.id === 'string' && Number(item.qty) > 0)
        .map((item) => ({
          id: item.id,
          qty: Math.min(20, Math.max(1, Math.floor(Number(item.qty) || 1)))
        }));
    } catch (_) {
      return [];
    }
  }

  function saveCartToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cart));
    } catch (_) {}
  }

  function iconHtml(name, cls) {
    if (global.C9ZIcons && typeof global.C9ZIcons.render === 'function') {
      return global.C9ZIcons.render(name, cls || 'icon');
    }
    return '';
  }

  // Generate high-craft technical PCB/RF SVG schematic when a product has no photo
  function getProductVisual(product) {
    if (product && product.image_url && String(product.image_url).trim() !== '') {
      return `<img src="${esc(product.image_url)}" alt="${esc(product.name)}" loading="lazy">`;
    }
    const id = (product && product.id) || 'c9z';
    const cat = (product && product.category_slug) || 'hardware';

    let wavePath = 'M 30 95 Q 55 55, 80 95 T 130 95 T 180 95 T 230 95';
    let chipLabel = id.toUpperCase();
    let subLabel = 'RF / SEC MODULE';

    if (cat === 'wifi-ble') {
      wavePath = 'M 35 100 C 55 50, 75 50, 95 100 C 115 150, 135 150, 155 100 C 175 50, 195 50, 215 100';
      subLabel = 'DUAL-BAND 2.4 / 5GHz';
    } else if (cat === 'nfc-rfid') {
      wavePath = 'M 45 65 H 215 V 125 H 45 Z M 65 80 H 195 V 110 H 65 Z';
      subLabel = '125kHz + 13.56MHz HF/LF';
    } else if (cat === 'bundles') {
      wavePath = 'M 40 95 H 105 M 155 95 H 220';
      subLabel = 'SHIELDED OTG + SMA KIT';
    }

    return `
      <svg class="hardware-svg-placeholder" viewBox="0 0 260 190" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(product ? product.name : 'C9Z Hardware')}">
        <rect width="260" height="190" fill="#08080A"/>
        <g stroke="rgba(255,255,255,0.04)" stroke-width="1">
          <line x1="0" y1="38" x2="260" y2="38"/>
          <line x1="0" y1="76" x2="260" y2="76"/>
          <line x1="0" y1="114" x2="260" y2="114"/>
          <line x1="0" y1="152" x2="260" y2="152"/>
          <line x1="52" y1="0" x2="52" y2="190"/>
          <line x1="104" y1="0" x2="104" y2="190"/>
          <line x1="156" y1="0" x2="156" y2="190"/>
          <line x1="208" y1="0" x2="208" y2="190"/>
        </g>
        <rect x="28" y="28" width="204" height="134" rx="8" fill="#0D0D10" stroke="rgba(255,255,255,0.12)" stroke-width="1.2"/>
        <path d="${wavePath}" stroke="rgba(255,0,34,0.35)" stroke-width="1.75" fill="none"/>
        <rect x="82" y="64" width="96" height="62" rx="6" fill="#131318" stroke="#FF0022" stroke-width="1.4"/>
        <circle cx="44" cy="44" r="3" fill="#FF0022"/>
        <circle cx="216" cy="44" r="3" fill="rgba(255,255,255,0.2)"/>
        <circle cx="44" cy="146" r="3" fill="rgba(255,255,255,0.2)"/>
        <circle cx="216" cy="146" r="3" fill="rgba(255,255,255,0.2)"/>
        <text x="130" y="92" text-anchor="middle" fill="#EDEDED" font-family="monospace" font-weight="700" font-size="14">${esc(chipLabel)}</text>
        <text x="130" y="111" text-anchor="middle" fill="#85858B" font-family="monospace" font-size="8.5">${esc(subLabel)}</text>
      </svg>
    `;
  }

  async function initStore() {
    if (state.loaded) return state;
    if (state.loadingPromise) return state.loadingPromise;

    state.loadingPromise = (async () => {
      try {
        const [prodRes, payRes] = await Promise.all([
          fetch('/api/products', { headers: { Accept: 'application/json' } }),
          fetch('/api/payment-config', { headers: { Accept: 'application/json' } })
        ]);

        if (prodRes.ok) {
          const prodData = await prodRes.json();
          state.products = Array.isArray(prodData.products) ? prodData.products : [];
          state.categories = Array.isArray(prodData.categories) ? prodData.categories : [];
        }
        if (payRes.ok) {
          const payData = await payRes.json();
          state.paymentConfig = payData.config || null;
        }
      } catch (err) {
        console.error('[C9ZStore] Failed loading store data:', err);
      }

      state.loaded = true;
      ensureGlobalModals();
      syncCartBadges();
      renderCartDrawerContents();
      return state;
    })();

    return state.loadingPromise;
  }

  function getProductById(id) {
    return state.products.find((p) => p.id === id) || null;
  }

  function getCartDetailed() {
    const items = [];
    let subtotal = 0;

    for (const entry of state.cart) {
      const product = getProductById(entry.id);
      if (!product) continue;
      const lineTotal = product.price_iqd * entry.qty;
      subtotal += lineTotal;
      items.push({
        id: product.id,
        name: product.name,
        subtitle: product.subtitle,
        price_iqd: product.price_iqd,
        image_url: product.image_url,
        category_slug: product.category_slug,
        qty: entry.qty,
        lineTotal
      });
    }

    const discount = state.coupon ? Math.min(subtotal, Number(state.coupon.discountIqd) || 0) : 0;
    const shipping = items.length === 0
      ? 0
      : (state.coupon && state.coupon.freeShipping ? 0 : SHIPPING_DEFAULT);
    const total = Math.max(0, subtotal - discount + shipping);
    const count = items.reduce((sum, i) => sum + i.qty, 0);

    return { items, subtotal, discount, shipping, total, count };
  }

  function syncCartBadges() {
    const { count } = getCartDetailed();
    document.querySelectorAll('[data-cart-count]').forEach((el) => {
      el.textContent = String(count);
    });
  }

  function addToCart(productId, qty = 1, openDrawer = true) {
    const product = getProductById(productId);
    if (!product) return;

    const addQty = Math.max(1, Math.floor(Number(qty) || 1));
    const existing = state.cart.find((item) => item.id === productId);
    if (existing) {
      existing.qty = Math.min(20, existing.qty + addQty);
    } else {
      state.cart.push({ id: productId, qty: Math.min(20, addQty) });
    }

    saveCartToStorage();
    revalidateCouponSilently();
    syncCartBadges();
    renderCartDrawerContents();

    if (openDrawer) {
      openCartDrawer();
    }
  }

  function updateCartQty(productId, delta) {
    const idx = state.cart.findIndex((item) => item.id === productId);
    if (idx === -1) return;

    const nextQty = state.cart[idx].qty + delta;
    if (nextQty <= 0) {
      state.cart.splice(idx, 1);
    } else {
      state.cart[idx].qty = Math.min(20, nextQty);
    }

    saveCartToStorage();
    revalidateCouponSilently();
    syncCartBadges();
    renderCartDrawerContents();
  }

  function removeFromCart(productId) {
    state.cart = state.cart.filter((item) => item.id !== productId);
    saveCartToStorage();
    revalidateCouponSilently();
    syncCartBadges();
    renderCartDrawerContents();
  }

  function clearCart() {
    state.cart = [];
    state.coupon = null;
    saveCartToStorage();
    syncCartBadges();
    renderCartDrawerContents();
  }

  async function revalidateCouponSilently() {
    if (!state.coupon || !state.coupon.code) return;
    const { subtotal } = getCartDetailed();
    if (subtotal <= 0) {
      state.coupon = null;
      renderCartDrawerContents();
      return;
    }
    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: state.coupon.code, subtotalIqd: subtotal })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        state.coupon = data.coupon;
      } else {
        state.coupon = null;
      }
      renderCartDrawerContents();
    } catch (_) {}
  }

  const PRODUCT_TELEMETRY_FALLBACKS = {
    'c9z-2': { chip: 'ESP32-S3 + CC1101 + PN532', tag: 'الأكثر مبيعاً', firmware: ['Bruce', 'Marauder', 'Launcher'], sales_count: 142 },
    'c9z-3': { chip: 'ESP32-D0WD + CC1101', tag: 'تكتيكي متقدم', firmware: ['Bruce', 'Marauder'], sales_count: 88 },
    'c9z-4': { chip: 'ESP32-S3 + Dual CC1101 + NRF24', tag: 'النخبة // PRO', firmware: ['Bruce', 'Marauder', 'Launcher'], sales_count: 119 },
    'c9z-5': { chip: 'ESP32-WROOM-32U', tag: 'اقتصادي للمبتدئين', firmware: ['Marauder', 'Bruce'], sales_count: 95 },
    'c9z-7': { chip: 'Dual MCU + Multi-RF Array', tag: 'رائد السلسلة // FLAGSHIP', firmware: ['Bruce', 'Marauder', 'Launcher', 'Custom'], sales_count: 64 },
    'c9z-cable-kit': { chip: 'USB-C OTG + SMA High-Gain', tag: 'حزمة ملحقات', firmware: ['All C9Z Models'], sales_count: 210 }
  };

  function enrichProductTelemetry(raw) {
    if (!raw) return raw;
    const fb = PRODUCT_TELEMETRY_FALLBACKS[raw.id] || {};
    const specs = raw.specs || {};
    return {
      ...raw,
      chip: raw.chip || specs['المعالج'] || specs['Chipset'] || fb.chip || 'ESP32',
      tag: raw.tag || raw.badge_text || fb.tag || 'C9Z MODULE',
      firmware: (Array.isArray(raw.firmware) && raw.firmware.length > 0)
        ? raw.firmware
        : (fb.firmware || ['Bruce', 'Marauder']),
      sales_count: raw.sales_count || fb.sales_count || 0
    };
  }

  // Render a Tactical Hardware Spec Card v3.0 (High-Craft HUD + Spec Matrix + Instant Buy CTA)
  function renderProductCard(rawProduct) {
    const product = enrichProductTelemetry(rawProduct);
    const hasDiscount = product.compare_at_iqd && product.compare_at_iqd > product.price_iqd;
    const discountPct = hasDiscount
      ? Math.round(((product.compare_at_iqd - product.price_iqd) / product.compare_at_iqd) * 100)
      : 0;

    const specsEntries = Object.entries(product.specs || {}).slice(0, 3);
    const firmwareList = Array.isArray(product.firmware) && product.firmware.length > 0
      ? product.firmware
      : ['Bruce', 'Marauder'];
    const lowStock = product.stock_qty > 0 && product.stock_qty <= 7;
    const outOfStock = product.stock_status === 'out_of_stock' || product.stock_qty <= 0;
    const stockPct = outOfStock ? 0 : Math.min(100, Math.max(18, Math.round((Number(product.stock_qty || 15) / 28) * 100)));
    const chipModel = product.chip || 'ESP32';
    const tagCode = product.tag || product.badge_text || 'C9Z MODULE';

    return `
      <article class="product-card c9z-hw-card" data-product-id="${esc(product.id)}" data-flip-id="${esc(product.id)}" data-category="${esc(product.category_slug)}">
        <!-- Top Tactical Telemetry Header -->
        <div class="hw-card-topbar">
          <div class="hw-card-sku">
            <span class="hw-status-dot ${outOfStock ? 'is-off' : (lowStock ? 'is-warn' : 'is-on')}"></span>
            <span class="mono">${esc(product.id.toUpperCase())}</span>
            <span class="hw-sku-sep">//</span>
            <span class="hw-cat-label">${esc(product.category_name || product.category_slug)}</span>
          </div>
          <span class="hw-mcu-pill mono">${iconHtml('cpu', 'icon icon-sm')} ${esc(chipModel)}</span>
        </div>

        <!-- Media Stage with Floating Badges & Quick-Inspect Lens -->
        <div class="product-card-media hw-card-media" data-action="quick-view" data-id="${esc(product.id)}" style="cursor:pointer">
          <div class="product-card-badges">
            ${product.is_bestseller ? `<span class="badge badge-accent">${iconHtml('flame', 'icon icon-sm')} الأكثر طلباً</span>` : ''}
            ${hasDiscount ? `<span class="badge badge-positive">وفّر ${discountPct}%</span>` : ''}
          </div>
          <button type="button" class="hw-inspect-btn" data-action="quick-view" data-id="${esc(product.id)}" aria-label="معاينة تفاصيل ${esc(product.name)}" title="معاينة المواصفات الكاملة">
            ${iconHtml('eye', 'icon icon-sm')}
            <span>فحص العتاد</span>
          </button>
          ${getProductVisual(product)}
          <div class="hw-media-telemetry">
            <span class="mono">${esc(tagCode)}</span>
            <div class="hw-fw-pills">
              ${firmwareList.slice(0, 3).map((fw) => `<span class="hw-fw-tag mono">${esc(fw)}</span>`).join('')}
            </div>
          </div>
        </div>

        <!-- Card Body: Title, Lead & Structured Technical Spec Matrix -->
        <div class="product-card-body hw-card-body">
          <div class="hw-title-row">
            <h3 class="product-card-title hw-card-title" data-action="quick-view" data-id="${esc(product.id)}" style="cursor:pointer">
              ${esc(product.name)}
            </h3>
            ${product.sales_count ? `<span class="hw-sales-pill" title="عدد القطع المباعة">${iconHtml('shield-check', 'icon icon-sm')} +${Number(product.sales_count)} باحث</span>` : ''}
          </div>

          <p class="product-card-desc hw-card-desc">${esc(product.short_desc || product.subtitle || '')}</p>

          ${specsEntries.length > 0 ? `
            <div class="hw-spec-matrix" role="list" aria-label="المواصفات الفنية">
              ${specsEntries.map(([k, v]) => `
                <div class="hw-spec-row" role="listitem">
                  <span class="hw-spec-key">${esc(k)}</span>
                  <span class="hw-spec-val mono">${esc(v)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}

          <!-- Inventory Meter & Price Dock -->
          <div class="hw-card-dock">
            <div class="hw-price-stock-row">
              <div class="price-block">
                <div class="hw-price-line">
                  <span class="price-current">${formatIQD(product.price_iqd)}</span>
                  ${hasDiscount ? `<span class="price-compare">${formatIQD(product.compare_at_iqd)}</span>` : ''}
                </div>
                <span class="stock-indicator ${lowStock ? 'low' : ''}">
                  ${outOfStock ? 'نفد المخزون حالياً' : (lowStock ? `متبقي ${product.stock_qty} قطع في المختبر` : `متوفر للشحن الفوري (${product.stock_qty} قطعة)`)}
                </span>
              </div>
              <div class="hw-stock-gauge" title="حالة التوفر في المستودع">
                <div class="hw-stock-bar ${lowStock ? 'is-low' : ''}" style="width:${stockPct}%"></div>
              </div>
            </div>

            <!-- Dual Tactical Action Deck: Instant Order + Add to Cart -->
            <div class="hw-action-deck">
              <button type="button" class="btn btn-primary hw-btn-buy-now" data-action="buy-now" data-id="${esc(product.id)}" ${outOfStock ? 'disabled' : ''}>
                ${iconHtml('zap', 'icon icon-sm')}
                <span>اطلب فوراً الآن</span>
              </button>
              <button type="button" class="btn btn-secondary hw-btn-cart" data-action="add-to-cart" data-id="${esc(product.id)}" ${outOfStock ? 'disabled' : ''} title="إضافة إلى سلة المشتريات">
                ${iconHtml('shopping-bag', 'icon icon-sm')}
                <span>للسلة</span>
              </button>
              <button type="button" class="btn btn-ghost hw-btn-qv" data-action="quick-view" data-id="${esc(product.id)}" title="المواصفات الكاملة">
                ${iconHtml('terminal', 'icon icon-sm')}
              </button>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function ensureGlobalModals() {
    if (document.getElementById('c9z-cart-backdrop')) return;

    const wrapper = document.createElement('div');
    wrapper.id = 'c9z-global-shells';
    wrapper.innerHTML = `
      <!-- Slide-over Cart Drawer -->
      <div class="drawer-backdrop" id="c9z-cart-backdrop" aria-hidden="true">
        <aside class="cart-drawer" role="dialog" aria-modal="true" aria-label="سلة المشتريات" tabindex="-1">
          <div class="drawer-header">
            <div class="drawer-title">
              ${iconHtml('shopping-bag', 'icon text-accent')}
              <span>سلة المشتريات</span>
              <span class="cart-count-pill" data-cart-count>0</span>
            </div>
            <button type="button" class="btn btn-ghost btn-icon" id="c9z-close-drawer" aria-label="إغلاق السلة">
              ${iconHtml('x', 'icon')}
            </button>
          </div>
          <div class="drawer-body" id="c9z-drawer-body"></div>
          <div class="drawer-footer" id="c9z-drawer-footer"></div>
        </aside>
      </div>

      <!-- Product Quick-View Modal -->
      <div class="modal-backdrop" id="c9z-product-modal" aria-hidden="true">
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="تفاصيل المنتج" tabindex="-1">
          <div class="modal-header">
            <div class="drawer-title" id="c9z-qv-header-title">تفاصيل الجهاز</div>
            <button type="button" class="btn btn-ghost btn-icon" id="c9z-close-qv" aria-label="إغلاق">
              ${iconHtml('x', 'icon')}
            </button>
          </div>
          <div class="modal-body" id="c9z-qv-body"></div>
        </div>
      </div>

      <!-- 2-Step Express Checkout Modal -->
      <div class="modal-backdrop" id="c9z-checkout-modal" aria-hidden="true">
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="إتمام الطلب السريع" tabindex="-1">
          <div class="modal-header">
            <div class="drawer-title">
              ${iconHtml('shield-check', 'icon text-accent')}
              <span>إتمام الطلب الآمن — C9Z Express Checkout</span>
            </div>
            <button type="button" class="btn btn-ghost btn-icon" id="c9z-close-checkout" aria-label="إغلاق">
              ${iconHtml('x', 'icon')}
            </button>
          </div>
          <div class="modal-body" id="c9z-checkout-body"></div>
        </div>
      </div>
    `;
    document.body.appendChild(wrapper);

    // Event bindings for global shells
    document.getElementById('c9z-close-drawer').addEventListener('click', closeCartDrawer);
    document.getElementById('c9z-cart-backdrop').addEventListener('click', (e) => {
      if (e.target.id === 'c9z-cart-backdrop') closeCartDrawer();
    });

    document.getElementById('c9z-close-qv').addEventListener('click', closeQuickView);
    document.getElementById('c9z-product-modal').addEventListener('click', (e) => {
      if (e.target.id === 'c9z-product-modal') closeQuickView();
    });

    document.getElementById('c9z-close-checkout').addEventListener('click', closeCheckoutModal);
    document.getElementById('c9z-checkout-modal').addEventListener('click', (e) => {
      if (e.target.id === 'c9z-checkout-modal') closeCheckoutModal();
    });

    // Delegate clicks across document for data-action buttons
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-action]');
      if (!trigger) return;

      const action = trigger.getAttribute('data-action');
      const id = trigger.getAttribute('data-id');

      if (action === 'open-cart') {
        e.preventDefault();
        openCartDrawer();
      } else if (action === 'add-to-cart' && id) {
        e.preventDefault();
        if (trigger.closest('#c9z-product-modal')) {
          closeQuickView();
        }
        addToCart(id, 1, true);
      } else if (action === 'buy-now' && id) {
        e.preventDefault();
        addToCart(id, 1, false);
        closeQuickView();
        openCheckoutModal();
      } else if (action === 'quick-view' && id) {
        e.preventDefault();
        openQuickView(id);
      } else if (action === 'cart-inc' && id) {
        updateCartQty(id, 1);
      } else if (action === 'cart-dec' && id) {
        updateCartQty(id, -1);
      } else if (action === 'cart-remove' && id) {
        removeFromCart(id);
      } else if (action === 'add-bump' && id) {
        addToCart(id, 1, false);
      } else if (action === 'open-checkout') {
        e.preventDefault();
        closeCartDrawer();
        openCheckoutModal();
      }
    });

    // Escape key closes active modal/drawer & Tab/Shift+Tab stays trapped inside open dialog
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        closeQuickView();
        closeCheckoutModal();
        closeCartDrawer();
        return;
      }

      if (e.key === 'Tab') {
        const activeBackdrop = getActiveDialogBackdrop();
        if (!activeBackdrop) return;
        trapFocusInDialog(e, activeBackdrop);
      }
    });
  }

  const dialogReturnFocus = new WeakMap();

  function isElementFocusable(el) {
    if (!el || !document.contains(el) || typeof el.focus !== 'function') return false;
    if (el.disabled || (typeof el.matches === 'function' && el.matches(':disabled'))) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const style = global.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.offsetParent === null && style.position !== 'fixed') return false;
    return true;
  }

  function getActiveDialogBackdrop() {
    const ids = ['c9z-product-modal', 'c9z-checkout-modal', 'c9z-cart-backdrop'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el && el.classList.contains('open')) return el;
    }
    return null;
  }

  function getFocusableElements(container) {
    if (!container) return [];
    const selector =
      'a[href], button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(selector)).filter((el) => isElementFocusable(el));
  }

  function trapFocusInDialog(e, backdropEl) {
    const dialog = backdropEl.querySelector('[role="dialog"]') || backdropEl;
    const focusables = getFocusableElements(dialog);
    if (focusables.length === 0) {
      e.preventDefault();
      if (dialog && typeof dialog.focus === 'function') {
        try {
          dialog.focus({ preventScroll: true });
        } catch (_) {
          dialog.focus();
        }
      }
      return;
    }

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;

    if (!dialog.contains(active) || active === dialog) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
      return;
    }

    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function openDialogOverlay(backdropEl) {
    if (!backdropEl) return;
    const opener = document.activeElement;
    if (
      opener &&
      opener !== document.body &&
      opener !== document.documentElement &&
      !backdropEl.contains(opener)
    ) {
      dialogReturnFocus.set(backdropEl, opener);
    }
    backdropEl.classList.add('open');
    backdropEl.setAttribute('aria-hidden', 'false');
    const dialog = backdropEl.querySelector('[role="dialog"]') || backdropEl;
    if (dialog && typeof dialog.focus === 'function') {
      try {
        dialog.focus({ preventScroll: true });
      } catch (_) {
        dialog.focus();
      }
    }
  }

  function closeDialogOverlay(backdropEl) {
    if (!backdropEl) return;
    const wasOpen = backdropEl.classList.contains('open');
    if (
      wasOpen &&
      backdropEl.id === 'c9z-checkout-modal' &&
      global.C9ZTacticalUI &&
      typeof global.C9ZTacticalUI.closeActiveSelect === 'function'
    ) {
      global.C9ZTacticalUI.closeActiveSelect();
    }

    const active = document.activeElement;
    if (active && backdropEl.contains(active)) {
      const prev = dialogReturnFocus.get(backdropEl);
      if (isElementFocusable(prev) && !backdropEl.contains(prev)) {
        try {
          prev.focus({ preventScroll: true });
        } catch (_) {
          prev.focus();
        }
      }
      if (backdropEl.contains(document.activeElement) && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
    }

    if (wasOpen) {
      dialogReturnFocus.delete(backdropEl);
    }
    backdropEl.classList.remove('open');
    backdropEl.setAttribute('aria-hidden', 'true');
  }

  function openCartDrawer() {
    ensureGlobalModals();
    closeQuickView();
    closeCheckoutModal();
    renderCartDrawerContents();
    const el = document.getElementById('c9z-cart-backdrop');
    openDialogOverlay(el);
  }

  function closeCartDrawer() {
    const el = document.getElementById('c9z-cart-backdrop');
    closeDialogOverlay(el);
  }

  function renderCartDrawerContents() {
    const bodyEl = document.getElementById('c9z-drawer-body');
    const footerEl = document.getElementById('c9z-drawer-footer');
    if (!bodyEl || !footerEl) return;

    const { items, subtotal, discount, shipping, total } = getCartDetailed();

    if (items.length === 0) {
      bodyEl.innerHTML = `
        <div class="cart-empty">
          <div style="margin-bottom:12px;color:var(--text-muted)">
            ${iconHtml('shopping-bag', 'icon')}
          </div>
          <p style="margin:0 0 6px;font-weight:700;color:var(--text)">سلة المشتريات فارغة</p>
          <p style="margin:0 0 16px;font-size:0.84rem">اختر أحد أجهزة الاختبار السيبراني للبدء بالطلب السريع.</p>
          <a href="/pages/shop.html" class="btn btn-secondary btn-sm">تصفح المتجر</a>
        </div>
      `;
      footerEl.innerHTML = '';
      return;
    }

    // Check if Order Bump product (c9z-cable-kit) is available and not in cart
    const bumpProduct = getProductById('c9z-cable-kit');
    const hasBumpInCart = items.some((i) => i.id === 'c9z-cable-kit');

    bodyEl.innerHTML = `
      <div class="cart-items-list">
        ${items.map((item) => `
          <div class="cart-item">
            <div class="cart-item-thumb">
              ${getProductVisual(item)}
            </div>
            <div class="cart-item-info">
              <h4 class="cart-item-title">${esc(item.name)}</h4>
              <div class="cart-item-price">${formatIQD(item.price_iqd)} للقطعة — الإجمالي: <strong class="text-primary">${formatIQD(item.lineTotal)}</strong></div>
              <div class="cart-item-controls">
                <div class="qty-stepper">
                  <button type="button" class="qty-btn" data-action="cart-dec" data-id="${esc(item.id)}" aria-label="إنقاص">-</button>
                  <span class="qty-val">${item.qty}</span>
                  <button type="button" class="qty-btn" data-action="cart-inc" data-id="${esc(item.id)}" aria-label="زيادة">+</button>
                </div>
                <button type="button" class="btn btn-ghost btn-sm text-danger" data-action="cart-remove" data-id="${esc(item.id)}">
                  ${iconHtml('trash', 'icon icon-sm')}
                  <span>حذف</span>
                </button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      ${bumpProduct && !hasBumpInCart ? `
        <div class="order-bump">
          <div class="order-bump-info">
            <div class="order-bump-tag">
              ${iconHtml('zap', 'icon icon-sm')}
              <span>إضافة مقترحة للباحثين (Order Bump)</span>
            </div>
            <div class="order-bump-title">${esc(bumpProduct.name)}</div>
            <div class="order-bump-price">بسعر مخفض ${formatIQD(bumpProduct.price_iqd)} بدلاً من ${formatIQD(bumpProduct.compare_at_iqd || 15000)}</div>
          </div>
          <button type="button" class="btn btn-secondary btn-sm" data-action="add-bump" data-id="${esc(bumpProduct.id)}">
            ${iconHtml('plus', 'icon icon-sm')}
            <span>إضافة</span>
          </button>
        </div>
      ` : ''}

      <div style="margin-top:16px">
        <label class="field-label" for="c9z-coupon-input">كود الخصم الترويجي (جرب: <span class="mono text-accent">C9Z10</span>)</label>
        <div class="coupon-row">
          <input type="text" id="c9z-coupon-input" class="input mono" placeholder="أدخل الكود مثل C9Z10" value="${esc(state.coupon ? state.coupon.code : '')}">
          <button type="button" class="btn btn-secondary btn-sm" id="c9z-apply-coupon">تطبيق</button>
        </div>
        <div id="c9z-coupon-feedback" style="font-size:0.78rem;margin-top:6px;color:${state.coupon ? 'var(--positive)' : 'var(--text-muted)'}">
          ${state.coupon ? `تم تفعيل الكود (${esc(state.coupon.code)}): ${esc(state.coupon.description || '')}` : ''}
        </div>
      </div>
    `;

    footerEl.innerHTML = `
      <div class="summary-rows">
        <div class="summary-row">
          <span>المجموع الفرعي</span>
          <span class="num">${formatIQD(subtotal)}</span>
        </div>
        ${discount > 0 ? `
          <div class="summary-row discount">
            <span>الخصم (${esc(state.coupon.code)})</span>
            <span class="num">- ${formatIQD(discount)}</span>
          </div>
        ` : ''}
        <div class="summary-row">
          <span>التوصيل لجميع محافظات العراق</span>
          <span class="num">${shipping === 0 ? 'مجاني' : formatIQD(shipping)}</span>
        </div>
        <div class="summary-row total">
          <span>الإجمالي النهائي</span>
          <span class="num text-accent">${formatIQD(total)}</span>
        </div>
      </div>
      <button type="button" class="btn btn-primary btn-lg" style="width:100%" data-action="open-checkout">
        ${iconHtml('check-circle', 'icon')}
        <span>إتمام الطلب السريع (${formatIQD(total)})</span>
      </button>
    `;

    const applyBtn = document.getElementById('c9z-apply-coupon');
    if (applyBtn) {
      applyBtn.addEventListener('click', handleApplyCoupon);
    }
  }

  async function handleApplyCoupon() {
    const input = document.getElementById('c9z-coupon-input');
    const feedback = document.getElementById('c9z-coupon-feedback');
    if (!input || !feedback) return;

    const code = input.value.trim().toUpperCase();
    if (!code) {
      state.coupon = null;
      renderCartDrawerContents();
      return;
    }

    const { subtotal } = getCartDetailed();
    feedback.style.color = 'var(--text-secondary)';
    feedback.textContent = 'جارٍ التحقق من الكود...';

    try {
      const res = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, subtotalIqd: subtotal })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        state.coupon = data.coupon;
        renderCartDrawerContents();
      } else {
        state.coupon = null;
        feedback.style.color = 'var(--negative)';
        feedback.textContent = data.error || 'كود الخصم غير صالح.';
      }
    } catch (_) {
      feedback.style.color = 'var(--negative)';
      feedback.textContent = 'تعذر الاتصال بالخادم للتحقق من الكود.';
    }
  }

  // Quick-View Modal
  function openQuickView(productId) {
    ensureGlobalModals();
    const product = getProductById(productId);
    if (!product) return;

    closeCartDrawer();
    closeCheckoutModal();
    const modal = document.getElementById('c9z-product-modal');
    const titleEl = document.getElementById('c9z-qv-header-title');
    const bodyEl = document.getElementById('c9z-qv-body');

    titleEl.innerHTML = `
      ${iconHtml('cpu', 'icon text-accent')}
      <span>${esc(product.name)}</span>
      <span class="badge badge-neutral mono">${esc(product.id.toUpperCase())}</span>
    `;

    const specsEntries = Object.entries(product.specs || {});
    const hasDiscount = product.compare_at_iqd && product.compare_at_iqd > product.price_iqd;

    bodyEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr));gap:24px;align-items:start">
        <div class="product-card-media qv-media" style="background:#08080a;border:1px solid var(--line);border-radius:var(--r-lg);overflow:hidden;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center">
          ${getProductVisual(product)}
        </div>
        <div>
          <div class="flex items-center gap-2" style="margin-bottom:8px;flex-wrap:wrap">
            <span class="badge badge-neutral">${esc(product.category_name || product.category_slug)}</span>
            ${product.is_bestseller ? `<span class="badge badge-accent">${iconHtml('flame', 'icon icon-sm')} الأكثر طلباً</span>` : ''}
            <span class="badge badge-positive">ضمان فحص وتشغيل</span>
          </div>
          <h2 style="margin:0 0 6px;font-size:1.35rem;font-weight:800">${esc(product.name)}</h2>
          <p style="margin:0 0 12px;color:var(--text-secondary);font-size:0.9rem">${esc(product.subtitle || '')}</p>
          <p style="margin:0 0 16px;color:var(--text);font-size:0.92rem;line-height:1.7">${esc(product.description || product.short_desc || '')}</p>

          <div style="padding:14px;background:var(--surface-raised);border:1px solid var(--line);border-radius:var(--r-md);margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
            <div>
              <div style="font-size:0.76rem;color:var(--text-muted)">السعر الرسمي</div>
              <div class="price-current" style="font-size:1.4rem">${formatIQD(product.price_iqd)}</div>
              ${hasDiscount ? `<div class="price-compare">${formatIQD(product.compare_at_iqd)}</div>` : ''}
            </div>
            <div class="flex gap-2" style="flex-wrap:wrap">
              <button type="button" class="btn btn-secondary" data-action="add-to-cart" data-id="${esc(product.id)}">
                ${iconHtml('shopping-bag', 'icon')}
                <span>أضف للسلة</span>
              </button>
              <button type="button" class="btn btn-primary" data-action="buy-now" data-id="${esc(product.id)}">
                ${iconHtml('zap', 'icon')}
                <span>شراء فوري</span>
              </button>
            </div>
          </div>

          ${specsEntries.length > 0 ? `
            <div style="border:1px solid var(--line);border-radius:var(--r-md);overflow:hidden">
              <div style="padding:8px 12px;background:var(--surface-raised);border-bottom:1px solid var(--line);font-size:0.8rem;font-weight:700;color:var(--text-secondary)">
                المواصفات التقنية الكاملة
              </div>
              ${specsEntries.map(([k, v]) => `
                <div style="display:flex;justify-content:space-between;padding:8px 12px;border-bottom:1px solid var(--line);font-size:0.84rem">
                  <span style="color:var(--text-secondary)">${esc(k)}</span>
                  <span class="mono" style="font-weight:600;color:var(--text)">${esc(v)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;

    openDialogOverlay(modal);
  }

  function closeQuickView() {
    const modal = document.getElementById('c9z-product-modal');
    closeDialogOverlay(modal);
  }

  // 2-Step Express Checkout Modal
  function openCheckoutModal() {
    ensureGlobalModals();
    const { items } = getCartDetailed();
    if (items.length === 0) {
      openCartDrawer();
      return;
    }

    closeCartDrawer();
    closeQuickView();
    renderCheckoutForm();
    const modal = document.getElementById('c9z-checkout-modal');
    openDialogOverlay(modal);
  }

  function closeCheckoutModal() {
    const modal = document.getElementById('c9z-checkout-modal');
    closeDialogOverlay(modal);
  }

  function fallbackCopyText(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  function copyTextWithFeedback(text, btn, successLabel) {
    if (!btn) return;
    if (!btn.dataset.defaultHtml) {
      btn.dataset.defaultHtml = btn.innerHTML;
    }
    const applySuccess = () => {
      btn.innerHTML = `${iconHtml('check', 'icon icon-sm')} <span>${esc(successLabel)}</span>`;
      if (btn._copyResetTimer) clearTimeout(btn._copyResetTimer);
      btn._copyResetTimer = setTimeout(() => {
        if (document.body.contains(btn) && btn.dataset.defaultHtml) {
          btn.innerHTML = btn.dataset.defaultHtml;
        }
      }, 2200);
    };
    const applyFailure = () => {
      btn.innerHTML = `${iconHtml('alert-triangle', 'icon icon-sm')} <span>انسخ يدوياً</span>`;
      if (btn._copyResetTimer) clearTimeout(btn._copyResetTimer);
      btn._copyResetTimer = setTimeout(() => {
        if (document.body.contains(btn) && btn.dataset.defaultHtml) {
          btn.innerHTML = btn.dataset.defaultHtml;
        }
      }, 2200);
    };

    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      Promise.resolve()
        .then(() => navigator.clipboard.writeText(text))
        .then(applySuccess)
        .catch(() => {
          if (fallbackCopyText(text)) applySuccess();
          else applyFailure();
        });
    } else if (fallbackCopyText(text)) {
      applySuccess();
    } else {
      applyFailure();
    }
  }

  function getWalletNumberByProvider(provider) {
    const wallets = (state.paymentConfig && state.paymentConfig.manualWallets) || {};
    if (provider === 'asiahawala') return wallets.asiaHawalaNumber || '07700000000';
    if (provider === 'qicard') return wallets.qiCardNumber || '6037-XXXX-XXXX-XXXX';
    return wallets.zainCashNumber || '07800000000';
  }

  function renderCheckoutForm() {
    const bodyEl = document.getElementById('c9z-checkout-body');
    if (!bodyEl) return;

    const { items, subtotal, discount, shipping, total } = getCartDetailed();

    bodyEl.innerHTML = `
      <form id="c9z-checkout-form" novalidate>
        <div class="checkout-steps">
          <div class="checkout-step active">
            <span class="num">1</span>
            <span>بيانات المستلم والعنوان</span>
          </div>
          <div class="checkout-step active">
            <span class="num">2</span>
            <span>نظام الدفع والتأكيد الفوري</span>
          </div>
        </div>

        <div class="form-grid" style="margin-bottom:20px">
          <div class="field-group">
            <label class="field-label" for="co-name">الاسم الكامل للمستلم *</label>
            <input type="text" id="co-name" class="input" required maxlength="80" placeholder="مثال: الاسم الثلاثي أو المستعار للباحث">
          </div>
          <div class="field-group">
            <label class="field-label" for="co-phone">رقم الهاتف العراقي (واتساب / اتصال) *</label>
            <input type="tel" id="co-phone" class="input mono" required placeholder="077XXXXXXXX / 078XXXXXXXX">
          </div>
          <div class="field-group">
            <label class="field-label" for="co-gov">المحافظة *</label>
            <select id="co-gov" class="select" required>
              <option value="">اختر المحافظة...</option>
              ${GOVERNORATES.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('')}
            </select>
          </div>
          <div class="field-group">
            <label class="field-label" for="co-city">القضاء / الحي السكني *</label>
            <input type="text" id="co-city" class="input" required maxlength="80" placeholder="مثال: المنصور / حي الجامعة">
          </div>
          <div class="field-group full">
            <label class="field-label" for="co-landmark">أقرب نقطة دالة وتفاصيل العنوان *</label>
            <input type="text" id="co-landmark" class="input" required maxlength="160" placeholder="الشارع، رقم الزقاق، أو أقرب معلم معروف للمندوب">
          </div>
        </div>

        <div style="margin-bottom:20px">
          <label class="field-label" style="margin-bottom:10px;display:block">اختر طريقة الدفع المناسبة *</label>
          <div class="payment-methods-grid" id="co-payment-methods">
            <!-- Method 1: COD -->
            <div class="payment-method-card ${state.selectedPaymentMethod === 'cod' ? 'selected' : ''}" data-pay-method="cod">
              <div class="payment-radio"></div>
              <div style="flex:1">
                <div class="payment-method-title">
                  ${iconHtml('truck', 'icon icon-sm text-accent')}
                  <span>الدفع عند الاستلام (Cash on Delivery)</span>
                  <span class="badge badge-positive">الأكثر شيوعاً</span>
                </div>
                <div class="payment-method-sub">ادفع نقداً بالدينار العراقي لمندوب التوصيل عند استلام الجهاز والتأكد منه.</div>
              </div>
            </div>

            <!-- Method 2: Manual E-Wallet Transfer -->
            <div class="payment-method-card ${state.selectedPaymentMethod === 'wallet_manual' ? 'selected' : ''}" data-pay-method="wallet_manual">
              <div class="payment-radio"></div>
              <div style="flex:1">
                <div class="payment-method-title">
                  ${iconHtml('wallet', 'icon icon-sm text-accent')}
                  <span>تحويل محفظة إلكترونية (زين كاش / آسيا حوالة / كي كارد)</span>
                </div>
                <div class="payment-method-sub">تحويل مباشر مع إدخال رقم العملية (Reference ID) للتوثيق الفوري في الداشبورد وتليجرام.</div>

                <div class="wallet-transfer-box" id="co-wallet-box" style="display:${state.selectedPaymentMethod === 'wallet_manual' ? 'block' : 'none'}">
                  <div class="flex gap-2" style="margin-bottom:10px;flex-wrap:wrap">
                    <button type="button" class="btn btn-sm ${state.selectedWalletProvider === 'zaincash' ? 'btn-primary' : 'btn-secondary'}" data-wallet-prov="zaincash">ZainCash زين كاش</button>
                    <button type="button" class="btn btn-sm ${state.selectedWalletProvider === 'asiahawala' ? 'btn-primary' : 'btn-secondary'}" data-wallet-prov="asiahawala">AsiaHawala آسيا حوالة</button>
                    <button type="button" class="btn btn-sm ${state.selectedWalletProvider === 'qicard' ? 'btn-primary' : 'btn-secondary'}" data-wallet-prov="qicard">QiCard كي كارد</button>
                  </div>
                  <div style="font-size:0.8rem;color:var(--text-secondary)">حول المبلغ الإجمالي (${formatIQD(total)}) إلى الرقم التالي:</div>
                  <div class="wallet-number-copy">
                    <span class="mono" id="co-wallet-target" style="font-weight:700;font-size:0.95rem;color:var(--text)">${esc(getWalletNumberByProvider(state.selectedWalletProvider))}</span>
                    <button type="button" class="btn btn-secondary btn-sm" id="co-copy-wallet">
                      ${iconHtml('copy', 'icon icon-sm')}
                      <span>نسخ الرقم</span>
                    </button>
                  </div>
                  <div class="form-grid" style="margin-top:10px">
                    <div class="field-group">
                      <label class="field-label" for="co-sender-phone">رقم محفظتك المرسِلة *</label>
                      <input type="tel" id="co-sender-phone" class="input mono" placeholder="078XXXXXXXX">
                    </div>
                    <div class="field-group">
                      <label class="field-label" for="co-tx-ref">رقم عملية التحويل (Reference ID) *</label>
                      <input type="text" id="co-tx-ref" class="input mono" placeholder="مثال: TX9845120">
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Method 3: Online Payment Gateway Adapter -->
            <div class="payment-method-card ${state.selectedPaymentMethod === 'gateway_online' ? 'selected' : ''}" data-pay-method="gateway_online">
              <div class="payment-radio"></div>
              <div style="flex:1">
                <div class="payment-method-title">
                  ${iconHtml('credit-card', 'icon icon-sm text-accent')}
                  <span>بوابة الدفع الإلكتروني المباشر (Visa / Mastercard / Gateway)</span>
                  <span class="badge badge-positive">مفعل ومؤمن</span>
                </div>
                <div class="payment-method-sub">الدفع عبر البطاقات المصرفية أو البوابات الرقمية مع توثيق رمز التفويض المرجعي الفوري.</div>

                <div class="wallet-transfer-box" id="co-gateway-box" style="display:${state.selectedPaymentMethod === 'gateway_online' ? 'block' : 'none'}">
                  <div class="form-grid">
                    <div class="field-group">
                      <label class="field-label" for="co-gw-provider">اختر مزود البوابة</label>
                      <select id="co-gw-provider" class="select">
                        <option value="stripe" ${state.selectedGatewayProvider === 'stripe' ? 'selected' : ''}>البطاقات العالمية (Visa / Mastercard / Stripe)</option>
                        <option value="zaincash_api" ${state.selectedGatewayProvider === 'zaincash_api' ? 'selected' : ''}>بوابة زين كاش المباشرة (ZainCash API)</option>
                        <option value="qicard_api" ${state.selectedGatewayProvider === 'qicard_api' ? 'selected' : ''}>بوابة كي كارد (QiCard Payment Gateway)</option>
                      </select>
                    </div>
                    <div class="field-group">
                      <label class="field-label" for="co-gw-ref">رقم التفويض أو آخر 4-8 أرقام من إشعار الدفع *</label>
                      <input type="text" id="co-gw-ref" class="input mono" placeholder="مثال: AUTH-948210" maxlength="32">
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="field-group" style="margin-bottom:16px">
          <label class="field-label" for="co-notes">ملاحظات إضافية للطلب (اختياري)</label>
          <input type="text" id="co-notes" class="input" maxlength="250" placeholder="وقت التوصيل المفضل أو أي تعليمات للمندوب">
        </div>

        <div style="padding:14px;background:var(--surface-raised);border:1px solid var(--line);border-radius:var(--r-md);margin-bottom:16px">
          <div style="font-size:0.82rem;font-weight:700;margin-bottom:8px;color:var(--text-secondary)">ملخص الأجهزة المطلوبة (${items.length})</div>
          ${items.map((item) => `
            <div style="display:flex;justify-content:space-between;font-size:0.84rem;padding:4px 0">
              <span>${esc(item.name)} × <strong class="mono">${item.qty}</strong></span>
              <span class="num">${formatIQD(item.lineTotal)}</span>
            </div>
          `).join('')}
          <div style="border-top:1px solid var(--line);margin-top:8px;padding-top:8px;display:flex;justify-content:space-between;font-weight:800;font-size:1rem">
            <span>المبلغ الإجمالي شامل التوصيل</span>
            <span class="num text-accent">${formatIQD(total)}</span>
          </div>
        </div>

        <div id="co-error-box" style="display:none;padding:10px 14px;border-radius:var(--r-md);background:var(--negative-subtle);border:1px solid rgba(229,72,77,0.3);color:var(--negative);font-size:0.85rem;margin-bottom:14px"></div>

        <button type="submit" class="btn btn-primary btn-lg" id="co-submit-btn" style="width:100%">
          ${iconHtml('shield-check', 'icon')}
          <span>تأكيد الطلب وإصدار الفاتورة الآن (${formatIQD(total)})</span>
        </button>
      </form>
    `;

    // Bind payment method switching
    bodyEl.querySelectorAll('[data-pay-method]').forEach((card) => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('input, select, button, .c9z-select-wrap, .c9z-select-portal')) return;
        state.selectedPaymentMethod = card.getAttribute('data-pay-method');
        updateCheckoutPaymentUI();
      });
    });

    const gwSelect = document.getElementById('co-gw-provider');
    if (gwSelect) {
      gwSelect.addEventListener('change', () => {
        state.selectedGatewayProvider = gwSelect.value || 'stripe';
      });
    }

    if (global.C9ZTacticalUI && typeof global.C9ZTacticalUI.enhanceSelects === 'function') {
      global.C9ZTacticalUI.enhanceSelects(bodyEl);
    }

    // Bind wallet provider buttons
    bodyEl.querySelectorAll('[data-wallet-prov]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        state.selectedWalletProvider = btn.getAttribute('data-wallet-prov');
        state.selectedPaymentMethod = 'wallet_manual';
        updateCheckoutPaymentUI();
      });
    });

    const copyBtn = document.getElementById('co-copy-wallet');
    if (copyBtn) {
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const targetNum = getWalletNumberByProvider(state.selectedWalletProvider);
        copyTextWithFeedback(targetNum, copyBtn, 'تم النسخ');
      });
    }

    const form = document.getElementById('c9z-checkout-form');
    if (form) {
      form.addEventListener('submit', submitCheckoutOrder);
    }
  }

  function updateCheckoutPaymentUI() {
    const bodyEl = document.getElementById('c9z-checkout-body');
    if (!bodyEl) return;

    bodyEl.querySelectorAll('[data-pay-method]').forEach((card) => {
      const m = card.getAttribute('data-pay-method');
      card.classList.toggle('selected', m === state.selectedPaymentMethod);
    });

    const walletBox = document.getElementById('co-wallet-box');
    const gwBox = document.getElementById('co-gateway-box');
    if (walletBox) walletBox.style.display = state.selectedPaymentMethod === 'wallet_manual' ? 'block' : 'none';
    if (gwBox) gwBox.style.display = state.selectedPaymentMethod === 'gateway_online' ? 'block' : 'none';

    bodyEl.querySelectorAll('[data-wallet-prov]').forEach((btn) => {
      const p = btn.getAttribute('data-wallet-prov');
      btn.className = `btn btn-sm ${p === state.selectedWalletProvider ? 'btn-primary' : 'btn-secondary'}`;
    });

    const targetSpan = document.getElementById('co-wallet-target');
    if (targetSpan) {
      targetSpan.textContent = getWalletNumberByProvider(state.selectedWalletProvider);
    }
  }

  async function submitCheckoutOrder(e) {
    e.preventDefault();
    const errBox = document.getElementById('co-error-box');
    const submitBtn = document.getElementById('co-submit-btn');

    const showErr = (msg) => {
      errBox.style.display = 'block';
      errBox.textContent = msg;
    };

    errBox.style.display = 'none';

    const name = (document.getElementById('co-name')?.value || '').trim();
    const phone = (document.getElementById('co-phone')?.value || '').trim();
    const governorate = (document.getElementById('co-gov')?.value || '').trim();
    const city = (document.getElementById('co-city')?.value || '').trim();
    const landmark = (document.getElementById('co-landmark')?.value || '').trim();
    const notes = (document.getElementById('co-notes')?.value || '').trim();

    if (name.length < 2) return showErr('يرجى إدخال الاسم الكامل للمستلم.');
    if (!/^07[3-9]\d{8}$/.test(phone)) return showErr('يرجى إدخال رقم هاتف عراقي صحيح مكون من 11 رقماً يبدأ بـ 07.');
    if (!governorate) return showErr('يرجى اختيار المحافظة.');
    if (city.length < 2) return showErr('يرجى إدخال اسم القضاء أو الحي السكني.');
    if (landmark.length < 3) return showErr('يرجى كتابة أقرب نقطة دالة للعنوان.');

    let paymentProvider = 'cod';
    let senderPhone = '';
    let transactionRef = '';

    if (state.selectedPaymentMethod === 'wallet_manual') {
      paymentProvider = state.selectedWalletProvider;
      senderPhone = (document.getElementById('co-sender-phone')?.value || '').trim();
      transactionRef = (document.getElementById('co-tx-ref')?.value || '').trim();
      if (!/^07[3-9]\d{8}$/.test(senderPhone)) {
        return showErr('يرجى إدخال رقم هاتف المحفظة المرسِلة بصيغة صحيحة (07XXXXXXXXX).');
      }
      if (transactionRef.length < 4) {
        return showErr('يرجى إدخال رقم عملية التحويل (Reference ID) لتوثيق الدفع.');
      }
    } else if (state.selectedPaymentMethod === 'gateway_online') {
      paymentProvider = document.getElementById('co-gw-provider')?.value || 'stripe';
      transactionRef = (document.getElementById('co-gw-ref')?.value || '').trim();
      if (transactionRef.length < 4) {
        return showErr('يرجى إدخال رمز التفويض الإلكتروني أو آخر 4-8 أرقام من إشعار الدفع.');
      }
    }

    const payload = {
      name,
      phone,
      governorate,
      city,
      landmark,
      notes,
      paymentMethod: state.selectedPaymentMethod,
      paymentProvider,
      senderPhone,
      transactionRef,
      couponCode: state.coupon ? state.coupon.code : '',
      items: state.cart.map((i) => ({ id: i.id, qty: i.qty }))
    };

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span>جارٍ معالجة الطلب وتوثيق الفاتورة...</span>`;

    // Unlock Web Audio inside user submit gesture so cyber chime can play seamlessly
    if (global.C9ZOrderCeremony && typeof global.C9ZOrderCeremony.unlockAudio === 'function') {
      global.C9ZOrderCeremony.unlockAudio();
    }

    try {
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `${iconHtml('shield-check', 'icon')} <span>تأكيد الطلب وإصدار الفاتورة الآن</span>`;
        return showErr(data.error || 'تعذر إتمام الطلب، يرجى التحقق من البيانات.');
      }

      clearCart();

      const revealInvoice = () => {
        renderInvoiceScreen(data.invoice, payload, { animated: true });
      };

      if (global.C9ZOrderCeremony && typeof global.C9ZOrderCeremony.play === 'function') {
        global.C9ZOrderCeremony.play(data.invoice, { onComplete: revealInvoice });
      } else {
        revealInvoice();
      }
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `${iconHtml('shield-check', 'icon')} <span>تأكيد الطلب وإصدار الفاتورة الآن</span>`;
      showErr('حدث خطأ في الاتصال بالخادم. يرجى المحاولة مرة أخرى.');
    }
  }

  function renderInvoiceScreen(invoice, customer, opts = {}) {
    const bodyEl = document.getElementById('c9z-checkout-body');
    if (!bodyEl) return;

    const paymentBadge = (invoice.paymentStatus === 'verified_paid' || invoice.paymentStatus === 'paid')
      ? '<span class="badge badge-positive">مدفوع وموثق إلكترونياً</span>'
      : invoice.paymentStatus === 'verification_pending'
        ? '<span class="badge badge-warning">قيد المطابقة والتسوية المصرفية الفورية</span>'
        : '<span class="badge badge-neutral">الدفع نقداً عند الاستلام (COD)</span>';

    const logoMarkup = (global.C9ZOrderCeremony && typeof global.C9ZOrderCeremony.getLogoSvgMarkup === 'function')
      ? global.C9ZOrderCeremony.getLogoSvgMarkup('c9z-wolf-vector')
      : iconHtml('check-circle', 'icon');

    bodyEl.innerHTML = `
      <div class="invoice-box${opts.animated ? ' ceremony-reveal' : ''}">
        <div class="invoice-wolf-crest">
          ${logoMarkup}
          <span class="invoice-crest-check">${iconHtml('check', 'icon icon-sm')}</span>
        </div>
        <h3 style="margin:0 0 4px;font-size:1.25rem;font-weight:800">تم تسجيل طلبك بنجاح</h3>
        <p style="margin:0 0 12px;color:var(--text-secondary);font-size:0.88rem">${esc(invoice.instructions || '')}</p>
        <div class="invoice-code">${esc(invoice.orderCode)}</div>
        <div style="margin-top:8px">${paymentBadge}</div>

        <div style="text-align:right;margin-top:20px;padding-top:16px;border-top:1px solid var(--line);font-size:0.85rem">
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span style="color:var(--text-secondary)">المستلم:</span>
            <strong>${esc(customer.name)} (${esc(customer.phone)})</strong>
          </div>
          <div style="display:flex;justify-content:space-between;margin-bottom:6px">
            <span style="color:var(--text-secondary)">العنوان:</span>
            <span>${esc(customer.governorate)} — ${esc(customer.city)}</span>
          </div>
          ${invoice.transactionRef ? `
            <div style="display:flex;justify-content:space-between;margin-bottom:6px">
              <span style="color:var(--text-secondary)">مرجع العملية:</span>
              <span class="mono">${esc(invoice.transactionRef)}</span>
            </div>
          ` : ''}
          <div style="display:flex;justify-content:space-between;margin-top:10px;padding-top:10px;border-top:1px solid var(--line);font-size:1rem;font-weight:800">
            <span>المبلغ الإجمالي:</span>
            <span class="num text-accent">${formatIQD(invoice.totalIqd)}</span>
          </div>
        </div>

        <div class="flex justify-between gap-2" style="margin-top:20px;flex-wrap:wrap">
          <button type="button" class="btn btn-secondary" id="c9z-copy-invoice" style="flex:1">
            ${iconHtml('copy', 'icon icon-sm')}
            <span>نسخ رقم الطلب</span>
          </button>
          <button type="button" class="btn btn-secondary" id="c9z-replay-ceremony" style="flex:1">
            ${iconHtml('refresh-cw', 'icon icon-sm')}
            <span>إعادة تشغيل العرض 3D</span>
          </button>
          <button type="button" class="btn btn-primary" id="c9z-done-invoice" style="flex:1;min-width:160px">
            ${iconHtml('check', 'icon icon-sm')}
            <span>تم، العودة للمتجر</span>
          </button>
        </div>
      </div>
    `;

    const copyBtn = document.getElementById('c9z-copy-invoice');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        copyTextWithFeedback(invoice.orderCode, copyBtn, `تم نسخ ${invoice.orderCode}`);
      });
    }

    const replayBtn = document.getElementById('c9z-replay-ceremony');
    if (replayBtn) {
      replayBtn.addEventListener('click', () => {
        if (global.C9ZOrderCeremony && typeof global.C9ZOrderCeremony.play === 'function') {
          global.C9ZOrderCeremony.unlockAudio();
          global.C9ZOrderCeremony.play(invoice, { isReplay: true });
        }
      });
    }

    const doneBtn = document.getElementById('c9z-done-invoice');
    if (doneBtn) {
      doneBtn.addEventListener('click', closeCheckoutModal);
    }
  }

  global.C9ZStore = {
    init: initStore,
    getState: () => state,
    getProductById,
    getProductVisual,
    renderProductCard,
    addToCart,
    updateCartQty,
    removeFromCart,
    openCartDrawer,
    closeCartDrawer,
    openQuickView,
    openCheckoutModal,
    playLogoPurchaseCeremony: (order, opts) => {
      if (global.C9ZOrderCeremony && typeof global.C9ZOrderCeremony.play === 'function') {
        return global.C9ZOrderCeremony.play(order, opts);
      }
      return undefined;
    },
    formatIQD,
    esc
  };
})(window);
