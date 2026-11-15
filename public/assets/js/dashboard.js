/* ==========================================================================
   C9Z Web v2.0 — Developer Dashboard Client Controller
   Security: HttpOnly SameSite=Strict session cookie, strict HTML escaping
   ========================================================================== */
(function () {
  'use strict';

  let hasAnimatedEntrance = false;
  let productModalOpener = null;

  function isElementFocusable(el) {
    if (!el || !document.contains(el) || typeof el.focus !== 'function') return false;
    if (el.disabled || (typeof el.matches === 'function' && el.matches(':disabled'))) return false;
    if (el.closest('[aria-hidden="true"]')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (el.offsetParent === null && style.position !== 'fixed') return false;
    return true;
  }

  function getFocusableElements(container) {
    if (!container) return [];
    const selector =
      'a[href], button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled):not([tabindex="-1"]), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(selector)).filter((el) => isElementFocusable(el));
  }

  function trapFocusInModal(e, modalEl) {
    const dialog = modalEl.querySelector('[role="dialog"]') || modalEl;
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

  const state = {
    activeTab: 'overview',
    overview: null,
    products: [],
    categories: [],
    orders: [],
    orderStatusFilter: '',
    coupons: [],
    changelog: []
  };

  const TAB_META = {
    overview: {
      title: 'نظرة عامة والإحصائيات',
      subtitle: 'متابعة حية للمبيعات، حالة المخزون، وجاهزية أنظمة الدفع.'
    },
    products: {
      title: 'إدارة المنتجات والتصنيفات',
      subtitle: 'إضافة وتعديل أجهزة المتجر، الأسعار، المخزون، ورفع الصور المفحوصة أمنياً.'
    },
    orders: {
      title: 'إدارة الطلبات وتوثيق الدفع',
      subtitle: 'مراجعة طلبات العملاء، مطابقة أرقام عمليات التحويل (Reference ID)، وتحديث حالة الشحن.'
    },
    coupons: {
      title: 'الكوبونات وبوابات الدفع',
      subtitle: 'إدارة أكواد الخصم الترويجية وفحص حالة الربط مع تيليجرام وبوابات الدفع.'
    },
    changelog: {
      title: 'سجل التطورات والإصدارات (Roadmap)',
      subtitle: 'نشر تحديثات الفيرموير والعتاد لتظهر فوراً في الصفحة الرئيسية وصفحة الأنظمة.'
    }
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

  function icon(name, cls) {
    if (window.C9ZIcons && typeof window.C9ZIcons.render === 'function') {
      return window.C9ZIcons.render(name, cls || 'icon icon-sm');
    }
    return '';
  }

  async function checkSession() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'same-origin' });
      const data = await res.json();
      if (res.ok && data.authenticated) {
        showDashboard(data.username || 'c9zadmin', Boolean(data.user && data.user.usingDefaultPassword));
        await loadAllDashboardData();
      } else {
        showLoginGate();
      }
    } catch (_) {
      showLoginGate();
    }
  }

  function showLoginGate() {
    hasAnimatedEntrance = false;
    closeProductModal();
    document.getElementById('admin-login-gate').style.display = 'flex';
    document.getElementById('admin-dashboard-shell').style.display = 'none';
  }

  function showDashboard(username, isDefaultPassword = false) {
    document.getElementById('admin-login-gate').style.display = 'none';
    document.getElementById('admin-dashboard-shell').style.display = 'grid';
    const userEl = document.getElementById('admin-active-user');
    if (userEl) userEl.textContent = username;

    const secBadge = document.getElementById('admin-security-badge');
    if (secBadge) {
      secBadge.style.display = isDefaultPassword ? 'inline-flex' : 'none';
      if (isDefaultPassword && window.C9ZIcons && typeof window.C9ZIcons.hydrate === 'function') {
        window.C9ZIcons.hydrate(secBadge);
      }
    }
  }

  async function loadAllDashboardData() {
    await Promise.all([
      loadOverview(),
      loadProducts(),
      loadOrders(),
      loadCoupons(),
      loadChangelog()
    ]);

    const shell = document.getElementById('admin-dashboard-shell');
    if (window.C9ZTacticalUI && typeof window.C9ZTacticalUI.enhanceSelects === 'function' && shell) {
      window.C9ZTacticalUI.enhanceSelects(shell);
    }
    if (!hasAnimatedEntrance && shell && shell.style.display !== 'none') {
      hasAnimatedEntrance = true;
      if (window.C9ZMotion && typeof window.C9ZMotion.animateDashboardEntrance === 'function') {
        window.C9ZMotion.animateDashboardEntrance(shell);
      }
    }
  }

  // 1. Overview & Primary SVG Chart
  async function loadOverview() {
    try {
      const res = await fetch('/api/admin/overview', { credentials: 'same-origin' });
      if (res.status === 401) return showLoginGate();
      const data = await res.json();
      if (!res.ok || !data.ok) return;

      state.overview = data;
      const k = data.kpis || {};

      document.getElementById('kpi-revenue').textContent = formatIQD(k.totalRevenueIqd || 0);
      document.getElementById('kpi-paid-revenue').textContent = `المؤكد منها: ${formatIQD(k.paidRevenueIqd || 0)}`;
      document.getElementById('kpi-orders-total').textContent = String(k.totalOrders || 0);
      document.getElementById('kpi-orders-pending').textContent = `${k.pendingOrders || 0} طلب بانتظار المراجعة`;
      document.getElementById('kpi-products-active').textContent = `${k.activeProducts || 0} / ${k.totalProducts || 0}`;
      document.getElementById('kpi-products-low').textContent = `${k.lowStockProducts || 0} منتجات منخفضة المخزون`;

      renderPrimarySvgChart(data.dailyChart || []);
      renderGatewayReadiness(data.gateways || {});
    } catch (err) {
      console.error('[Dashboard] Overview error:', err);
    }
  }

  function renderPrimarySvgChart(dailySeries) {
    const container = document.getElementById('overview-svg-chart');
    if (!container) return;

    // Build 7-day series (zero-initialized baseline if no historical orders)
    const arDays = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
    const today = new Date();
    const fallbackSeries = [];
    for (let offset = 6; offset >= 0; offset -= 1) {
      const d = new Date(today.getTime() - offset * 86400000);
      fallbackSeries.push({
        day: offset === 0 ? 'اليوم' : arDays[d.getDay()],
        revenue: 0,
        orders: 0
      });
    }
    const points = dailySeries.length > 0 ? dailySeries : fallbackSeries;

    const width = 760;
    const height = 224;
    const padX = 48;
    const padY = 32;
    const innerW = width - padX * 2;
    const innerH = height - padY * 2;

    const maxRev = Math.max(100000, ...points.map((p) => Number(p.revenue) || 0));
    const stepX = points.length > 1 ? innerW / (points.length - 1) : innerW;

    const coords = points.map((p, idx) => {
      const x = padX + idx * stepX;
      const y = padY + innerH - ((Number(p.revenue) || 0) / maxRev) * innerH;
      return { x, y, day: p.day, revenue: Number(p.revenue) || 0, orders: Number(p.orders) || 0 };
    });

    const polylinePoints = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
    const areaPoints = `${coords[0].x.toFixed(1)},${(padY + innerH).toFixed(1)} ${polylinePoints} ${coords[coords.length - 1].x.toFixed(1)},${(padY + innerH).toFixed(1)}`;

    const hitColumns = coords.map((c, idx) => {
      const prevX = idx === 0 ? 0 : (coords[idx - 1].x + c.x) / 2;
      const nextX = idx === coords.length - 1 ? width : (c.x + coords[idx + 1].x) / 2;
      return `
        <rect
          class="c9z-chart-hit"
          x="${prevX.toFixed(1)}"
          y="0"
          width="${Math.max(24, nextX - prevX).toFixed(1)}"
          height="${height}"
          fill="transparent"
          tabindex="0"
          role="button"
          aria-label="${esc(c.day)}: ${esc(formatIQD(c.revenue))}"
          data-chart-idx="${idx}"
        />
      `;
    }).join('');

    container.innerHTML = `
      <div class="c9z-chart-wrap" dir="rtl">
        <div class="c9z-chart-telemetry-lane" id="c9z-chart-telemetry-lane">
          <div class="c9z-chart-idle-hint">مرّر المؤشر أو اختر يوماً لعرض تفاصيل الإيراد والطلبات</div>
          <div class="c9z-chart-tooltip" id="c9z-chart-tooltip" aria-live="polite"></div>
        </div>
        <div class="c9z-chart-scroll">
          <svg viewBox="0 0 ${width} ${height}" style="width:100%;height:auto;min-width:520px;display:block">
            <defs>
              <linearGradient id="c9zChartGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stop-color="#FF0022" stop-opacity="0.28"/>
                <stop offset="100%" stop-color="#FF0022" stop-opacity="0.0"/>
              </linearGradient>
            </defs>
            <g stroke="rgba(255,255,255,0.06)" stroke-width="1">
              <line x1="${padX}" y1="${padY}" x2="${width - padX}" y2="${padY}"/>
              <line x1="${padX}" y1="${padY + innerH * 0.5}" x2="${width - padX}" y2="${padY + innerH * 0.5}"/>
              <line x1="${padX}" y1="${padY + innerH}" x2="${width - padX}" y2="${padY + innerH}"/>
            </g>
            <polygon class="c9z-chart-area" points="${areaPoints}" fill="url(#c9zChartGrad)"/>
            <polyline class="c9z-chart-line" points="${polylinePoints}" fill="none" stroke="#FF0022" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
            <line id="c9z-chart-crosshair" x1="0" y1="${padY}" x2="0" y2="${padY + innerH}" stroke="rgba(255,0,34,0.55)" stroke-width="1" stroke-dasharray="3 3" style="opacity:0;pointer-events:none"/>
            <circle id="c9z-chart-halo" cx="0" cy="0" r="10" fill="rgba(255,0,34,0.16)" stroke="rgba(255,0,34,0.75)" stroke-width="1" style="opacity:0;pointer-events:none"/>
            ${coords.map((c, idx) => `
              <g>
                <circle class="c9z-chart-node" data-chart-node="${idx}" cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="4.5" fill="#0D0D0F" stroke="#FF0022" stroke-width="2"/>
                <text x="${c.x.toFixed(1)}" y="${(c.y - 13).toFixed(1)}" text-anchor="middle" fill="#EDEDED" font-family="JetBrains Mono, monospace" font-size="10">${Math.round(c.revenue / 1000)}k</text>
                <text x="${c.x.toFixed(1)}" y="${height - 8}" text-anchor="middle" fill="#85858B" font-family="Cairo, system-ui, sans-serif" font-size="10">${esc(c.day)}</text>
              </g>
            `).join('')}
            ${hitColumns}
          </svg>
        </div>
      </div>
    `;

    const wrap = container.querySelector('.c9z-chart-wrap');
    const lane = container.querySelector('#c9z-chart-telemetry-lane');
    const scroller = container.querySelector('.c9z-chart-scroll');
    const svgEl = container.querySelector('svg');
    const tooltip = container.querySelector('#c9z-chart-tooltip');
    const crosshair = container.querySelector('#c9z-chart-crosshair');
    const halo = container.querySelector('#c9z-chart-halo');
    const nodes = Array.from(container.querySelectorAll('[data-chart-node]'));

    let activeIdx = -1;
    let lastActivateAt = 0;
    let lastTouchAt = 0;
    let lastPointerType = 'mouse';
    let reservedLaneH = (lane && lane.clientWidth > 0 && lane.clientWidth <= 420) ? 56 : 0;
    if (lane && reservedLaneH > 0) {
      lane.style.minHeight = `${reservedLaneH}px`;
    }

    function positionTooltip(c) {
      if (!c || !wrap || !svgEl || !tooltip) return;
      const laneRect = (lane || wrap).getBoundingClientRect();
      const svgRect = svgEl.getBoundingClientRect();
      const scaleX = svgRect.width / width;
      const pointClientX = svgRect.left + c.x * scaleX;
      const tooltipW = tooltip.offsetWidth || 210;
      let relLeft = pointClientX - laneRect.left - tooltipW / 2;
      relLeft = Math.max(4, Math.min(relLeft, Math.max(4, laneRect.width - tooltipW - 4)));
      tooltip.style.left = `${Math.round(relLeft)}px`;
    }

    function hideChartHover() {
      activeIdx = -1;
      if (crosshair) crosshair.style.opacity = '0';
      if (halo) halo.style.opacity = '0';
      nodes.forEach((n) => {
        n.setAttribute('r', '4.5');
        n.setAttribute('fill', '#0D0D0F');
      });
      if (tooltip) tooltip.classList.remove('visible');
      if (lane) {
        lane.classList.remove('has-tooltip');
      }
    }

    function activatePoint(idx) {
      const c = coords[idx];
      if (!c || !wrap || !svgEl || !tooltip) return;
      activeIdx = idx;
      lastActivateAt = performance.now();

      const prev = idx > 0 ? coords[idx - 1] : null;
      let deltaHtml = '<span class="mono" style="color:var(--text-muted)">نقطة الأساس</span>';
      if (prev) {
        const diff = c.revenue - prev.revenue;
        if (prev.revenue === 0 && c.revenue > 0) {
          deltaHtml = `<span class="mono" style="color:var(--positive)">+${formatIQD(c.revenue)}</span>`;
        } else if (prev.revenue === 0 && c.revenue === 0) {
          deltaHtml = `<span class="mono" style="color:var(--text-muted)">0%</span>`;
        } else {
          const pct = Math.round((diff / prev.revenue) * 100);
          const color = diff > 0 ? 'var(--positive)' : diff < 0 ? 'var(--negative)' : 'var(--text-muted)';
          const prefix = diff > 0 ? '+' : '';
          deltaHtml = `<span class="mono" style="color:${color}" dir="ltr">${prefix}${pct}%</span>`;
        }
      }

      if (crosshair) {
        crosshair.setAttribute('x1', c.x.toFixed(1));
        crosshair.setAttribute('x2', c.x.toFixed(1));
        crosshair.style.opacity = '1';
      }
      if (halo) {
        halo.setAttribute('cx', c.x.toFixed(1));
        halo.setAttribute('cy', c.y.toFixed(1));
        halo.style.opacity = '1';
      }
      nodes.forEach((n, i) => {
        if (i === idx) {
          n.setAttribute('r', '6');
          n.setAttribute('fill', '#FF0022');
        } else {
          n.setAttribute('r', '4.5');
          n.setAttribute('fill', '#0D0D0F');
        }
      });

      tooltip.style.left = '8px';
      tooltip.innerHTML = `
        <strong class="c9z-tt-day">${esc(c.day)}</strong>
        <span class="c9z-tt-sep" aria-hidden="true">•</span>
        <span class="num c9z-tt-rev">${esc(formatIQD(c.revenue))}</span>
        <span class="c9z-tt-sep" aria-hidden="true">•</span>
        <span class="c9z-tt-orders">الطلبات: <span class="mono" style="color:var(--text)">${c.orders}</span></span>
        <span class="c9z-tt-delta">${deltaHtml}</span>
      `;

      positionTooltip(c);

      if (lane) {
        const neededH = Math.max(42, tooltip.offsetHeight + 4);
        const currentH = Math.max(reservedLaneH, lane.offsetHeight || 0);
        if (neededH > currentH) {
          reservedLaneH = neededH;
          lane.style.minHeight = `${reservedLaneH}px`;
        }
        lane.classList.add('has-tooltip');
      }
      tooltip.classList.add('visible');
    }

    container.querySelectorAll('.c9z-chart-hit').forEach((hit) => {
      const idx = Number(hit.getAttribute('data-chart-idx'));
      hit.addEventListener('mouseenter', () => activatePoint(idx));
      hit.addEventListener('focus', () => activatePoint(idx));
      hit.addEventListener('click', () => activatePoint(idx));
    });

    if (wrap) {
      wrap.addEventListener(
        'pointerdown',
        (e) => {
          lastPointerType = e.pointerType || 'mouse';
          if (lastPointerType !== 'mouse') lastTouchAt = performance.now();
        },
        { passive: true }
      );
      wrap.addEventListener(
        'pointermove',
        (e) => {
          if (e.pointerType) lastPointerType = e.pointerType;
        },
        { passive: true }
      );
      wrap.addEventListener('mouseleave', () => {
        if (lastPointerType !== 'mouse' || performance.now() - lastTouchAt < 500) return;
        hideChartHover();
      });
      wrap.addEventListener('focusout', (e) => {
        if (!wrap.contains(e.relatedTarget) && performance.now() - lastTouchAt > 300) {
          hideChartHover();
        }
      });
    }
    if (scroller) {
      scroller.addEventListener(
        'scroll',
        () => {
          if (activeIdx < 0) return;
          if (performance.now() - lastActivateAt < 400) {
            positionTooltip(coords[activeIdx]);
          } else {
            hideChartHover();
          }
        },
        { passive: true }
      );
    }

    if (container._chartOutsideAbort) {
      container._chartOutsideAbort.abort();
    }
    const outsideAbort = new AbortController();
    container._chartOutsideAbort = outsideAbort;
    document.addEventListener(
      'pointerdown',
      (e) => {
        if (wrap && !wrap.contains(e.target)) {
          hideChartHover();
        }
      },
      { signal: outsideAbort.signal }
    );
  }

  function renderGatewayReadiness(gateways) {
    const list = document.getElementById('gateway-readiness-list');
    if (!list) return;

    const items = [
      {
        name: 'بوت إشعارات الطلبات (Telegram Bot API)',
        envKey: 'TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID',
        live: Boolean(gateways.telegramConfigured)
      },
      {
        name: 'بوابة زين كاش العراق (ZainCash Merchant API)',
        envKey: 'ZAINCASH_MERCHANT_ID + ZAINCASH_SECRET',
        live: Boolean(gateways.zainCashLive)
      },
      {
        name: 'بوابة كي كارد العراق (QiCard Gateway)',
        envKey: 'QICARD_MERCHANT_ID + QICARD_API_KEY',
        live: Boolean(gateways.qiCardLive)
      },
      {
        name: 'بوابة البطاقات العالمية (Stripe Webhook/API)',
        envKey: 'STRIPE_SECRET_KEY',
        live: Boolean(gateways.stripeLive)
      }
    ];

    list.innerHTML = items.map((item) => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;background:var(--surface-raised);border:1px solid var(--line);border-radius:var(--r-md)">
        <div>
          <div style="font-weight:700;font-size:0.86rem">${esc(item.name)}</div>
          <div class="mono" style="font-size:0.74rem;color:var(--text-muted)">${esc(item.envKey)}</div>
        </div>
        <span class="badge ${item.live ? 'badge-positive' : 'badge-neutral'}">
          ${item.live ? 'متصل مباشر (LIVE API)' : 'بوابة التحقق المرجعي المفعلة (DIRECT)'}
        </span>
      </div>
    `).join('');
  }

  // 2. Products CRUD
  async function loadProducts() {
    try {
      const res = await fetch('/api/admin/products', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      state.products = Array.isArray(data.products) ? data.products : [];
      state.categories = Array.isArray(data.categories) ? data.categories : [];
      renderProductsTable();
    } catch (_) {}
  }

  function renderProductsTable() {
    const tbody = document.getElementById('admin-products-tbody');
    if (!tbody) return;

    tbody.innerHTML = state.products.map((p) => `
      <tr>
        <td class="mono" style="font-weight:700;color:var(--accent)">${esc(p.id)}</td>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:42px;height:42px;border-radius:var(--r-sm);background:#070709;border:1px solid var(--line);overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              ${p.image_url ? `<img src="${esc(p.image_url)}" alt="" style="width:100%;height:100%;object-fit:cover">` : `<span class="mono" style="font-size:0.65rem;color:var(--text-muted)">SVG</span>`}
            </div>
            <div>
              <div style="font-weight:700">${esc(p.name)}</div>
              <div style="font-size:0.76rem;color:var(--text-muted)">${esc(p.subtitle || '')}</div>
            </div>
          </div>
        </td>
        <td><span class="badge badge-neutral">${esc(p.category_slug)}</span></td>
        <td class="num" style="font-weight:700">${formatIQD(p.price_iqd)}</td>
        <td class="num">
          <span class="badge ${p.stock_qty <= 5 ? 'badge-warning' : 'badge-positive'}">${p.stock_qty} قطعة</span>
        </td>
        <td>
          ${p.is_bestseller ? `<span class="badge badge-accent">الأكثر طلباً</span>` : `<span style="color:var(--text-muted);font-size:0.78rem">عادي</span>`}
        </td>
        <td>
          ${p.is_active ? `<span class="badge badge-positive">نشط</span>` : `<span class="badge badge-negative">مخفي</span>`}
        </td>
        <td>
          <div class="flex gap-2">
            <button type="button" class="btn btn-secondary btn-sm" data-edit-prod="${esc(p.id)}">
              ${icon('edit')}
              <span>تعديل</span>
            </button>
            <button type="button" class="btn btn-ghost btn-sm text-danger" data-del-prod="${esc(p.id)}" title="حذف" aria-label="حذف المنتج ${esc(p.name)}">
              ${icon('trash')}
            </button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  function openProductModal(product) {
    const modal = document.getElementById('admin-product-modal');
    if (!modal) return;
    const opener = document.activeElement;
    if (
      opener &&
      opener !== document.body &&
      opener !== document.documentElement &&
      !modal.contains(opener)
    ) {
      productModalOpener = opener;
    }

    const titleEl = document.getElementById('admin-prod-modal-title');
    const errBox = document.getElementById('pm-error-box');
    const uploadStatus = document.getElementById('pm-upload-status');
    errBox.style.display = 'none';
    uploadStatus.textContent = '';
    const fileInput = document.getElementById('pm-image-file');
    if (fileInput) fileInput.value = '';

    if (product) {
      titleEl.textContent = `تعديل الجهاز: ${product.name} (${product.id})`;
      document.getElementById('pm-id').value = product.id;
      document.getElementById('pm-id').readOnly = true;
      const pmCat = document.getElementById('pm-cat');
      pmCat.value = product.category_slug || 'wifi-ble';
      if (!pmCat.value) pmCat.value = 'wifi-ble';
      document.getElementById('pm-name').value = product.name || '';
      document.getElementById('pm-subtitle').value = product.subtitle || '';
      document.getElementById('pm-price').value = product.price_iqd || 50000;
      document.getElementById('pm-compare').value = product.compare_at_iqd || '';
      document.getElementById('pm-stock').value = product.stock_qty ?? 10;
      document.getElementById('pm-badge').value = product.badge_text || '';
      document.getElementById('pm-short').value = product.short_desc || '';
      document.getElementById('pm-desc').value = product.description || '';
      document.getElementById('pm-specs').value = JSON.stringify(product.specs || {}, null, 2);
      document.getElementById('pm-image-url').value = product.image_url || '';
      document.getElementById('pm-bestseller').checked = Boolean(product.is_bestseller);
      document.getElementById('pm-active').checked = product.is_active !== false && product.is_active !== 0;
    } else {
      titleEl.textContent = 'إضافة جهاز / منتج جديد إلى المتجر';
      document.getElementById('admin-product-form').reset();
      document.getElementById('pm-cat').value = 'wifi-ble';
      document.getElementById('pm-id').readOnly = false;
      document.getElementById('pm-specs').value = '{\n  "المعالج": "ESP32-S3",\n  "المنفذ": "USB-C"\n}';
      document.getElementById('pm-active').checked = true;
    }

    if (window.C9ZTacticalUI && typeof window.C9ZTacticalUI.closeActiveSelect === 'function') {
      window.C9ZTacticalUI.closeActiveSelect();
    }
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    const dialog = modal.querySelector('[role="dialog"]') || modal;
    if (dialog && typeof dialog.focus === 'function') {
      try {
        dialog.focus({ preventScroll: true });
      } catch (_) {
        dialog.focus();
      }
    }
  }

  function closeProductModal() {
    const modal = document.getElementById('admin-product-modal');
    if (!modal) return;
    if (window.C9ZTacticalUI && typeof window.C9ZTacticalUI.closeActiveSelect === 'function') {
      window.C9ZTacticalUI.closeActiveSelect();
    }

    const active = document.activeElement;
    if (active && modal.contains(active)) {
      if (isElementFocusable(productModalOpener) && !modal.contains(productModalOpener)) {
        try {
          productModalOpener.focus({ preventScroll: true });
        } catch (_) {
          productModalOpener.focus();
        }
      }
      if (modal.contains(document.activeElement) && typeof document.activeElement.blur === 'function') {
        document.activeElement.blur();
      }
    }

    if (modal.classList.contains('open')) {
      productModalOpener = null;
    }
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }

  function parseSpecsInput(rawText) {
    const trimmed = String(rawText || '').trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (_) {
      // Fallback: parse line by line Key: Value
      const out = {};
      trimmed.split('\n').forEach((line) => {
        const idx = line.indexOf(':');
        if (idx > 0) {
          const k = line.slice(0, idx).trim();
          const v = line.slice(idx + 1).trim();
          if (k) out[k] = v;
        }
      });
      return out;
    }
    return {};
  }

  async function handleProductSave(e) {
    e.preventDefault();
    const errBox = document.getElementById('pm-error-box');
    errBox.style.display = 'none';

    const payload = {
      id: document.getElementById('pm-id').value.trim().toLowerCase(),
      category_slug: document.getElementById('pm-cat').value,
      name: document.getElementById('pm-name').value.trim(),
      subtitle: document.getElementById('pm-subtitle').value.trim(),
      price_iqd: Number(document.getElementById('pm-price').value) || 0,
      compare_at_iqd: document.getElementById('pm-compare').value ? Number(document.getElementById('pm-compare').value) : null,
      stock_qty: Number(document.getElementById('pm-stock').value) || 0,
      badge_text: document.getElementById('pm-badge').value.trim(),
      short_desc: document.getElementById('pm-short').value.trim(),
      description: document.getElementById('pm-desc').value.trim(),
      specs: parseSpecsInput(document.getElementById('pm-specs').value),
      image_url: document.getElementById('pm-image-url').value.trim(),
      is_bestseller: document.getElementById('pm-bestseller').checked,
      is_featured: true,
      is_active: document.getElementById('pm-active').checked
    };

    try {
      const res = await fetch('/api/admin/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        errBox.style.display = 'block';
        errBox.textContent = data.error || 'تعذر حفظ المنتج.';
        return;
      }
      closeProductModal();
      await loadProducts();
      await loadOverview();
    } catch (_) {
      errBox.style.display = 'block';
      errBox.textContent = 'خطأ في الاتصال بالخادم.';
    }
  }

  async function handleImageFileUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const statusEl = document.getElementById('pm-upload-status');
    statusEl.style.color = 'var(--text-secondary)';
    statusEl.textContent = 'جارٍ فحص التوقيع الرقمي للصورة ورفعها...';

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/admin/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            filename: file.name,
            dataUrl: reader.result
          })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          document.getElementById('pm-image-url').value = data.url;
          statusEl.style.color = 'var(--positive)';
          statusEl.textContent = `تم الرفع بنجاح (${data.mime} — ${Math.round(data.size / 1024)} KB): ${data.url}`;
        } else {
          statusEl.style.color = 'var(--negative)';
          statusEl.textContent = data.error || 'فشل رفع الصورة.';
        }
      } catch (_) {
        statusEl.style.color = 'var(--negative)';
        statusEl.textContent = 'تعذر رفع الصورة للخادم.';
      } finally {
        e.target.value = '';
      }
    };
    reader.onerror = () => {
      statusEl.style.color = 'var(--negative)';
      statusEl.textContent = 'تعذر قراءة الملف المحدد.';
      e.target.value = '';
    };
    reader.readAsDataURL(file);
  }

  // 3. Orders & Payment Verification
  async function loadOrders() {
    try {
      const q = state.orderStatusFilter ? `?status=${encodeURIComponent(state.orderStatusFilter)}` : '';
      const res = await fetch(`/api/admin/orders${q}`, { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      state.orders = Array.isArray(data.orders) ? data.orders : [];
      renderOrdersTables();
    } catch (_) {}
  }

  function renderOrdersTables() {
    // Overview recent orders (top 5)
    const recentTbody = document.getElementById('overview-recent-orders');
    if (recentTbody) {
      if (state.orders.length === 0) {
        recentTbody.innerHTML = `
          <tr>
            <td colspan="6" style="padding:48px 20px;text-align:center">
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;max-width:440px;margin:0 auto">
                <div style="width:48px;height:48px;border-radius:var(--r-md);background:var(--bg-card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--text-muted)">
                  ${icon('shopping-cart', 'icon icon-md')}
                </div>
                <div>
                  <div style="font-weight:700;font-size:0.95rem;color:var(--text);margin-bottom:4px">لا توجد طلبات مسجلة في النظام حتى الآن.</div>
                  <div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.5">النظام في وضع الاستعداد الفوري — ستنعكس الطلبات الواردة من المتجر لحظياً في هذا الجدول.</div>
                </div>
                <span class="badge badge-neutral mono" style="font-size:0.7rem;letter-spacing:0.04em">SYSTEM_READY · 0 ORDERS</span>
              </div>
            </td>
          </tr>
        `;
      } else {
        recentTbody.innerHTML = state.orders.slice(0, 5).map((o) => `
          <tr>
            <td class="mono" style="font-weight:700;color:var(--accent)">${esc(o.order_code)}</td>
            <td>
              <div style="font-weight:700">${esc(o.customer_name)}</div>
              <div style="font-size:0.75rem;color:var(--text-muted)">${esc(o.governorate)} • <span class="mono">${esc(o.customer_phone)}</span></div>
            </td>
            <td><span class="badge badge-neutral mono">${esc(o.payment_method)} (${esc(o.payment_provider)})</span></td>
            <td class="num" style="font-weight:700">${formatIQD(o.total_iqd)}</td>
            <td>${renderPaymentStatusBadge(o.payment_status)}</td>
            <td>${renderOrderStatusBadge(o.order_status)}</td>
          </tr>
        `).join('');
      }
    }

    // Full Orders table
    const tbody = document.getElementById('admin-orders-tbody');
    if (!tbody) return;

    if (state.orders.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="padding:54px 20px;text-align:center">
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;max-width:460px;margin:0 auto">
              <div style="width:48px;height:48px;border-radius:var(--r-md);background:var(--bg-card);border:1px solid var(--line);display:flex;align-items:center;justify-content:center;color:var(--text-muted)">
                ${icon('package', 'icon icon-md')}
              </div>
              <div>
                <div style="font-weight:700;font-size:0.95rem;color:var(--text);margin-bottom:4px">${state.orderStatusFilter ? 'لا توجد طلبات في هذا الفلتر حالياً.' : 'سجل الطلبات نظيف وفارغ تماماً'}</div>
                <div style="font-size:0.82rem;color:var(--text-secondary);line-height:1.5">${state.orderStatusFilter ? 'لم يتم العثور على أي طلبات مطابقة لهذا الفلتر، يمكنك النقر على تصنيف آخر أو استعراض كل الطلبات.' : 'تم تطهير جميع الطلبات السابقة بنجاح. بمجرد إتمام مشتري جديد لعملية دفع ستظهر تفاصيله وخيارات توثيق الدفع والشحن هنا.'}</div>
              </div>
              <span class="badge badge-neutral mono" style="font-size:0.7rem;letter-spacing:0.04em">${state.orderStatusFilter ? 'FILTER_EMPTY' : 'AWAITING_INCOMING_ORDERS'}</span>
            </div>
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = state.orders.map((o) => {
      const itemsSummary = (o.items || []).map((i) => `${esc(i.name)} (×${i.qty})`).join('، ');
      return `
        <tr>
          <td>
            <div class="mono" style="font-weight:700;color:var(--accent)">${esc(o.order_code)}</div>
            <div class="mono" style="font-size:0.72rem;color:var(--text-muted)">${esc(o.created_at || '')}</div>
          </td>
          <td>
            <div style="font-weight:700">${esc(o.customer_name)}</div>
            <div class="mono" style="font-size:0.78rem;color:var(--text-secondary)">${esc(o.customer_phone)}</div>
          </td>
          <td>
            <div>${esc(o.governorate)} — ${esc(o.city)}</div>
            <div style="font-size:0.76rem;color:var(--text-muted)">${esc(o.landmark)}</div>
          </td>
          <td style="max-width:220px;font-size:0.82rem">${itemsSummary}</td>
          <td>
            <div style="margin-bottom:4px">${renderPaymentStatusBadge(o.payment_status)}</div>
            <div class="mono" style="font-size:0.75rem;color:var(--text-secondary)">${esc(o.payment_method)} / ${esc(o.payment_provider)}</div>
            ${o.transaction_ref ? `<div class="mono" style="font-size:0.75rem;color:var(--warning)">Ref: ${esc(o.transaction_ref)}</div>` : ''}
            ${o.sender_phone ? `<div class="mono" style="font-size:0.72rem;color:var(--text-muted)">من: ${esc(o.sender_phone)}</div>` : ''}
          </td>
          <td class="num" style="font-weight:800">${formatIQD(o.total_iqd)}</td>
          <td>
            <div class="flex gap-2" style="flex-wrap:wrap">
              ${o.payment_status !== 'verified_paid' ? `
                <button type="button" class="btn btn-primary btn-sm" data-verify-order="${esc(o.order_code)}">
                  ${icon('check')}
                  <span>توثيق الدفع</span>
                </button>
              ` : ''}
              <select class="select" aria-label="حالة الطلب" style="width:auto;padding:4px 8px;font-size:0.78rem" data-order-status-select="${esc(o.order_code)}">
                <option value="pending" ${o.order_status === 'pending' ? 'selected' : ''}>قيد المراجعة</option>
                <option value="confirmed" ${o.order_status === 'confirmed' ? 'selected' : ''}>مؤكد</option>
                <option value="shipped" ${o.order_status === 'shipped' ? 'selected' : ''}>تم الشحن</option>
                <option value="delivered" ${o.order_status === 'delivered' ? 'selected' : ''}>تم التسليم</option>
                <option value="cancelled" ${o.order_status === 'cancelled' ? 'selected' : ''}>ملغي</option>
              </select>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderPaymentStatusBadge(status) {
    if (status === 'verified_paid' || status === 'paid_sandbox') {
      return `<span class="badge badge-positive">مدفوع وموثق</span>`;
    }
    if (status === 'verification_pending') {
      return `<span class="badge badge-warning">بانتظار مطابقة التحويل</span>`;
    }
    if (status === 'failed') {
      return `<span class="badge badge-negative">مرفوض</span>`;
    }
    return `<span class="badge badge-neutral">عند الاستلام (COD)</span>`;
  }

  function renderOrderStatusBadge(status) {
    if (status === 'delivered') return `<span class="badge badge-positive">تم التسليم</span>`;
    if (status === 'shipped') return `<span class="badge badge-accent">قيد التوصيل</span>`;
    if (status === 'confirmed') return `<span class="badge badge-positive">مؤكد</span>`;
    if (status === 'cancelled') return `<span class="badge badge-negative">ملغي</span>`;
    return `<span class="badge badge-warning">جديد / قيد المراجعة</span>`;
  }

  // 4. Coupons CRUD
  async function loadCoupons() {
    try {
      const res = await fetch('/api/admin/coupons', { credentials: 'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      state.coupons = Array.isArray(data.coupons) ? data.coupons : [];
      renderCouponsTable();
    } catch (_) {}
  }

  function renderCouponsTable() {
    const tbody = document.getElementById('admin-coupons-tbody');
    if (!tbody) return;

    tbody.innerHTML = state.coupons.map((c) => `
      <tr>
        <td class="mono" style="font-weight:800;color:var(--accent)">${esc(c.code)}</td>
        <td>${esc(c.description || '')}</td>
        <td class="mono">${c.discount_type === 'percent' ? `${c.discount_value}%` : formatIQD(c.discount_value)}</td>
        <td class="num">${formatIQD(c.min_order_iqd || 0)}</td>
        <td class="num">${c.used_count || 0} / ${c.max_uses || 100}</td>
        <td>${c.is_active ? `<span class="badge badge-positive">مفعل</span>` : `<span class="badge badge-neutral">معطل</span>`}</td>
        <td>
          <button type="button" class="btn btn-ghost btn-sm text-danger" data-del-coupon="${esc(c.code)}" title="حذف الكوبون" aria-label="حذف الكوبون ${esc(c.code)}">
            ${icon('trash')}
          </button>
        </td>
      </tr>
    `).join('');
  }

  // 5. Changelog CRUD
  async function loadChangelog() {
    try {
      const res = await fetch('/api/changelog');
      if (!res.ok) return;
      const data = await res.json();
      state.changelog = Array.isArray(data.items) ? data.items : [];
      const countEl = document.getElementById('kpi-changelog-count');
      if (countEl) countEl.textContent = String(state.changelog.length);
      renderChangelogTable();
    } catch (_) {}
  }

  function renderChangelogTable() {
    const tbody = document.getElementById('admin-changelog-tbody');
    if (!tbody) return;

    tbody.innerHTML = state.changelog.map((item) => `
      <tr>
        <td class="mono" style="font-weight:700;color:var(--accent)">${esc(item.version)}</td>
        <td>
          <div style="font-weight:700">${esc(item.title)}</div>
          <div style="font-size:0.78rem;color:var(--text-secondary)">${esc(item.summary)}</div>
        </td>
        <td><span class="badge badge-neutral">${esc(item.status)}</span></td>
        <td class="mono" style="font-size:0.76rem;color:var(--text-muted)">${esc(item.release_date || '')}</td>
        <td>
          <button type="button" class="btn btn-ghost btn-sm text-danger" data-del-changelog="${item.id}" title="حذف التحديث" aria-label="حذف التحديث ${esc(item.version)}">
            ${icon('trash')}
          </button>
        </td>
      </tr>
    `).join('');
  }

  function switchTab(tabKey) {
    if (!TAB_META[tabKey]) return;
    if (window.C9ZTacticalUI && typeof window.C9ZTacticalUI.closeActiveSelect === 'function') {
      window.C9ZTacticalUI.closeActiveSelect();
    }
    state.activeTab = tabKey;

    document.querySelectorAll('#dashboard-nav .sidebar-link').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabKey);
    });

    document.querySelectorAll('.dash-tab-panel').forEach((panel) => {
      panel.style.display = panel.id === `tab-${tabKey}` ? 'block' : 'none';
    });

    document.getElementById('dash-view-title').textContent = TAB_META[tabKey].title;
    document.getElementById('dash-view-subtitle').textContent = TAB_META[tabKey].subtitle;

    const activePanel = document.getElementById(`tab-${tabKey}`);
    if (activePanel && window.C9ZTacticalUI && typeof window.C9ZTacticalUI.enhanceSelects === 'function') {
      window.C9ZTacticalUI.enhanceSelects(activePanel);
    }
    if (activePanel && window.C9ZMotion && typeof window.C9ZMotion.animateDashboardTab === 'function') {
      window.C9ZMotion.animateDashboardTab(activePanel);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    checkSession();

    // Login Form Submit
    const loginForm = document.getElementById('admin-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const errBox = document.getElementById('login-error-box');
        errBox.style.display = 'none';

        const username = document.getElementById('login-username').value.trim();
        const password = document.getElementById('login-password').value;

        try {
          const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ username, password })
          });
          const data = await res.json();
          if (!res.ok || !data.ok) {
            errBox.style.display = 'block';
            errBox.textContent = data.error || 'بيانات الدخول غير صحيحة.';
            return;
          }
          showDashboard(data.username, Boolean(data.user && data.user.usingDefaultPassword));
          await loadAllDashboardData();
        } catch (_) {
          errBox.style.display = 'block';
          errBox.textContent = 'تعذر الاتصال بالخادم.';
        }
      });
    }

    // Logout (clears both admin session & stealth dev gate cookie and leaves ops route)
    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
        window.location.href = '/';
      });
    }

    // Sidebar Navigation
    const nav = document.getElementById('dashboard-nav');
    if (nav) {
      nav.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-tab]');
        if (btn) switchTab(btn.getAttribute('data-tab'));
      });
    }

    document.addEventListener('click', async (e) => {
      const gotoBtn = e.target.closest('[data-goto-tab]');
      if (gotoBtn) {
        switchTab(gotoBtn.getAttribute('data-goto-tab'));
      }

      // Edit Product
      const editBtn = e.target.closest('[data-edit-prod]');
      if (editBtn) {
        const id = editBtn.getAttribute('data-edit-prod');
        const prod = state.products.find((p) => p.id === id);
        if (prod) openProductModal(prod);
      }

      // Delete Product
      const delProdBtn = e.target.closest('[data-del-prod]');
      if (delProdBtn) {
        const id = delProdBtn.getAttribute('data-del-prod');
        await fetch(`/api/admin/products/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'same-origin'
        });
        await loadProducts();
        await loadOverview();
      }

      // Verify Order Payment 1-Click
      const verifyBtn = e.target.closest('[data-verify-order]');
      if (verifyBtn) {
        const code = verifyBtn.getAttribute('data-verify-order');
        await fetch(`/api/admin/orders/${encodeURIComponent(code)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ payment_status: 'verified_paid', order_status: 'confirmed' })
        });
        await loadOrders();
        await loadOverview();
      }

      // Delete Coupon
      const delCouponBtn = e.target.closest('[data-del-coupon]');
      if (delCouponBtn) {
        const code = delCouponBtn.getAttribute('data-del-coupon');
        await fetch(`/api/admin/coupons/${encodeURIComponent(code)}`, {
          method: 'DELETE',
          credentials: 'same-origin'
        });
        await loadCoupons();
      }

      // Delete Changelog
      const delClBtn = e.target.closest('[data-del-changelog]');
      if (delClBtn) {
        const id = delClBtn.getAttribute('data-del-changelog');
        await fetch(`/api/admin/changelog/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          credentials: 'same-origin'
        });
        await loadChangelog();
      }
    });

    // Order status dropdown change
    document.addEventListener('change', async (e) => {
      const sel = e.target.closest('[data-order-status-select]');
      if (!sel) return;
      const code = sel.getAttribute('data-order-status-select');
      await fetch(`/api/admin/orders/${encodeURIComponent(code)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ order_status: sel.value })
      });
      await loadOrders();
      await loadOverview();
    });

    // Order Filter Tabs
    const orderFilters = document.getElementById('admin-order-filters');
    if (orderFilters) {
      orderFilters.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-order-status]');
        if (!btn) return;
        orderFilters.querySelectorAll('.category-tab').forEach((b) => {
          b.classList.remove('active');
          b.setAttribute('aria-selected', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        state.orderStatusFilter = btn.getAttribute('data-order-status');
        loadOrders();
      });
    }

    // Refresh Button
    const refreshBtn = document.getElementById('dash-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadAllDashboardData());
    }

    // Product Modal Controls
    const prodModal = document.getElementById('admin-product-modal');
    document.getElementById('btn-new-product')?.addEventListener('click', () => openProductModal(null));
    document.getElementById('close-prod-modal')?.addEventListener('click', closeProductModal);
    document.getElementById('cancel-prod-modal')?.addEventListener('click', closeProductModal);
    prodModal?.addEventListener('click', (e) => {
      if (e.target === prodModal) closeProductModal();
    });
    document.addEventListener('keydown', (e) => {
      if (!prodModal || !prodModal.classList.contains('open')) return;
      if (
        e.key === 'Escape' &&
        !e.defaultPrevented &&
        !document.querySelector('.c9z-select-portal.open')
      ) {
        closeProductModal();
        return;
      }
      if (e.key === 'Tab') {
        trapFocusInModal(e, prodModal);
      }
    });
    document.getElementById('admin-product-form')?.addEventListener('submit', handleProductSave);
    document.getElementById('pm-image-file')?.addEventListener('change', handleImageFileUpload);

    function showInlineFormError(form, errId, msg) {
      let box = document.getElementById(errId);
      if (!box) {
        box = document.createElement('div');
        box.id = errId;
        box.className = 'alert alert-danger mt-2';
        form.appendChild(box);
      }
      box.textContent = msg;
      box.style.display = 'block';
    }

    function clearInlineFormError(errId) {
      const box = document.getElementById(errId);
      if (box) {
        box.textContent = '';
        box.style.display = 'none';
      }
    }

    // Coupon Form Submit
    document.getElementById('admin-coupon-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearInlineFormError('cp-error-box');
      const payload = {
        code: document.getElementById('cp-code').value.trim().toUpperCase(),
        discount_type: document.getElementById('cp-type').value,
        discount_value: Number(document.getElementById('cp-val').value) || 10,
        min_order_iqd: Number(document.getElementById('cp-min').value) || 0,
        description: document.getElementById('cp-desc').value.trim(),
        is_active: true
      };
      try {
        const res = await fetch('/api/admin/coupons', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok !== false) {
          e.target.reset();
          await loadCoupons();
        } else {
          showInlineFormError(e.target, 'cp-error-box', data.error || 'تعذر حفظ الكوبون.');
        }
      } catch (_) {
        showInlineFormError(e.target, 'cp-error-box', 'تعذر الاتصال بالخادم.');
      }
    });

    // Changelog Form Submit
    document.getElementById('admin-changelog-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearInlineFormError('cl-error-box');
      const payload = {
        version: document.getElementById('cl-version').value.trim(),
        category: document.getElementById('cl-cat').value,
        title: document.getElementById('cl-title').value.trim(),
        summary: document.getElementById('cl-summary').value.trim(),
        status: document.getElementById('cl-status').value
      };
      try {
        const res = await fetch('/api/admin/changelog', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload)
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok !== false) {
          e.target.reset();
          await loadChangelog();
        } else {
          showInlineFormError(e.target, 'cl-error-box', data.error || 'تعذر حفظ التحديث.');
        }
      } catch (_) {
        showInlineFormError(e.target, 'cl-error-box', 'تعذر الاتصال بالخادم.');
      }
    });
  });
})();
