/* ==========================================================================
   C9Z Web v2.0 — Tactical Interactive UI Engine
   Components:
   1. C9ZTacticalSelect — WAI-ARIA APG Select-Only Combobox (RTL Portal, Keyboard, Type-Ahead)
   2. Delegated rAF Card Spotlight & Border Illumination (Hover + Neighbors)
   3. Hero & Spotlight 3D Micro-Tilt (±4deg) + Coordinate Telemetry HUD
   4. Non-Blocking Trailing Tactical Reticle (Preserves Native OS Cursor)
   5. WAI-ARIA Tablist RTL Arrow Navigation
   ========================================================================== */
(function (global) {
  'use strict';

  const SELECT_SELECTOR = 'select.select, select[data-tactical-select]';
  const GLOW_CARD_SELECTOR =
    '.product-card, .feature-card, .kpi-card, .chart-panel, .payment-method-card, .login-card, .hero-visual-card, .spotlight-card, .footer-comp-card, .social-card, .c9z-hw-card, .c9z-pillar-card, .c9z-release-card, .matrix-spec-card';
  const TILT_CARD_SELECTOR = '.hero-visual-card, .spotlight-card';

  const hasFinePointer =
    global.matchMedia && global.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const prefersReduced =
    global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let uidCounter = 0;
  let activeSelect = null;
  const enhancedSelectMap = new WeakMap();
  const activeRegistry = new Set();

  function iconSvg(name, cls) {
    if (global.C9ZIcons && typeof global.C9ZIcons.render === 'function') {
      return global.C9ZIcons.render(name, cls || 'icon icon-sm');
    }
    return '';
  }

  function normalizeText(str, keepSpaces = false) {
    const out = String(str || '')
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670]/g, '')
      .replace(/[أإآ]/g, 'ا')
      .replace(/ة/g, 'ه')
      .replace(/ى/g, 'ي');
    return keepSpaces ? out.replace(/\s+/g, ' ') : out.trim();
  }

  // =========================================================================
  // 1. WAI-ARIA APG Select-Only Combobox (C9ZTacticalSelect)
  // =========================================================================
  class C9ZTacticalSelect {
    constructor(nativeSelect) {
      this.select = nativeSelect;
      this.id = ++uidCounter;
      this.menuId = `c9z-listbox-${this.id}`;
      this.isOpen = false;
      this.activeIndex = -1;
      this.typeBuffer = '';
      this.typeTimer = null;
      this.optionEls = [];

      this.isCompact =
        nativeSelect.hasAttribute('data-order-status-select') ||
        nativeSelect.classList.contains('select-compact');
      this.isInline =
        !this.isCompact &&
        (nativeSelect.id === 'shop-sort-select' ||
          nativeSelect.id === 'home-quick-sort' ||
          nativeSelect.classList.contains('c9z-deck-select') ||
          nativeSelect.style.width === 'auto');

      this.buildDOM();
      this.proxyNativeValue();
      this.rebuildOptions();
      this.bindEvents();

      enhancedSelectMap.set(nativeSelect, this);
      activeRegistry.add(this);
    }

    buildDOM() {
      const sel = this.select;
      const parent = sel.parentNode;

      this.wrap = document.createElement('div');
      this.wrap.className = 'c9z-select-wrap';
      if (this.isInline) this.wrap.classList.add('is-inline');
      if (this.isCompact) this.wrap.classList.add('is-compact');

      if (sel.id === 'shop-sort-select') {
        this.wrap.style.minWidth = '165px';
      }

      parent.insertBefore(this.wrap, sel);
      this.wrap.appendChild(sel);

      sel.classList.add('c9z-native-select-hidden');
      sel.setAttribute('tabindex', '-1');
      sel.setAttribute('aria-hidden', 'true');
      sel.dataset.c9zSelectEnhanced = '1';

      this.trigger = document.createElement('button');
      this.trigger.type = 'button';
      this.trigger.className = 'c9z-select-trigger';
      this.trigger.setAttribute('role', 'combobox');
      this.trigger.setAttribute('aria-haspopup', 'listbox');
      this.trigger.setAttribute('aria-expanded', 'false');
      this.trigger.setAttribute('aria-controls', this.menuId);
      if (sel.disabled) this.trigger.disabled = true;

      this.applyAccessibleName();

      this.labelEl = document.createElement('span');
      this.labelEl.className = 'c9z-select-label';

      this.chevronWrap = document.createElement('span');
      this.chevronWrap.setAttribute('aria-hidden', 'true');
      this.chevronWrap.style.display = 'inline-flex';
      this.chevronWrap.innerHTML = iconSvg('chevron-down', 'icon icon-sm c9z-select-chevron');

      this.trigger.appendChild(this.labelEl);
      this.trigger.appendChild(this.chevronWrap);
      this.wrap.appendChild(this.trigger);

      this.menu = document.createElement('div');
      this.menu.className = 'c9z-select-portal';
      this.menu.id = this.menuId;
      this.menu.setAttribute('role', 'listbox');
      this.menu.setAttribute('tabindex', '-1');
      this.menu.setAttribute('dir', 'rtl');
      if (this.trigger.getAttribute('aria-label')) {
        this.menu.setAttribute('aria-label', this.trigger.getAttribute('aria-label'));
      } else if (this.trigger.getAttribute('aria-labelledby')) {
        this.menu.setAttribute('aria-labelledby', this.trigger.getAttribute('aria-labelledby'));
      }
      document.body.appendChild(this.menu);
    }

    applyAccessibleName() {
      const sel = this.select;
      const explicitLabel = sel.getAttribute('aria-label');
      const explicitLabelledBy = sel.getAttribute('aria-labelledby');
      if (explicitLabel) {
        this.trigger.setAttribute('aria-label', explicitLabel);
        return;
      }
      if (explicitLabelledBy) {
        this.trigger.setAttribute('aria-labelledby', explicitLabelledBy);
        return;
      }
      if (sel.id) {
        const assocLabel = document.querySelector(`label[for="${CSS.escape(sel.id)}"]`);
        if (assocLabel) {
          if (!assocLabel.id) assocLabel.id = `c9z-lbl-${this.id}`;
          this.trigger.setAttribute('aria-labelledby', assocLabel.id);
          assocLabel.addEventListener('click', (e) => {
            e.preventDefault();
            this.trigger.focus();
          });
          return;
        }
      }
      if (sel.hasAttribute('data-order-status-select')) {
        this.trigger.setAttribute('aria-label', 'حالة الطلب');
      }
    }

    proxyNativeValue() {
      const sel = this.select;
      const self = this;
      const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
      const idxDesc = Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        'selectedIndex'
      );

      if (valueDesc && valueDesc.configurable) {
        Object.defineProperty(sel, 'value', {
          configurable: true,
          get() {
            return valueDesc.get.call(this);
          },
          set(val) {
            valueDesc.set.call(this, val);
            self.syncFromNative();
          }
        });
      }

      if (idxDesc && idxDesc.configurable) {
        Object.defineProperty(sel, 'selectedIndex', {
          configurable: true,
          get() {
            return idxDesc.get.call(this);
          },
          set(val) {
            idxDesc.set.call(this, val);
            self.syncFromNative();
          }
        });
      }
    }

    rebuildOptions() {
      const sel = this.select;
      this.menu.innerHTML = '';
      this.optionEls = [];

      const options = Array.from(sel.options);
      options.forEach((opt, idx) => {
        const row = document.createElement('div');
        row.className = 'c9z-select-option';
        row.id = `${this.menuId}-opt-${idx}`;
        row.setAttribute('role', 'option');
        row.setAttribute('data-index', String(idx));
        row.setAttribute('data-value', opt.value);
        row.setAttribute('aria-selected', opt.selected ? 'true' : 'false');
        if (opt.disabled) row.setAttribute('aria-disabled', 'true');

        const textSpan = document.createElement('span');
        textSpan.className = 'c9z-select-opt-text';
        textSpan.textContent = opt.textContent;

        const checkWrap = document.createElement('span');
        checkWrap.setAttribute('aria-hidden', 'true');
        checkWrap.style.display = 'inline-flex';
        checkWrap.innerHTML = iconSvg('check', 'c9z-select-check');

        row.appendChild(textSpan);
        row.appendChild(checkWrap);
        this.menu.appendChild(row);
        this.optionEls.push(row);
      });

      this.syncFromNative();
    }

    syncFromNative() {
      const sel = this.select;
      const idx = sel.selectedIndex >= 0 ? sel.selectedIndex : 0;
      const selectedOpt = sel.options[idx] || null;

      this.labelEl.textContent = selectedOpt ? selectedOpt.textContent : '';
      this.labelEl.classList.toggle(
        'is-placeholder',
        Boolean(selectedOpt && selectedOpt.value === '')
      );

      this.optionEls.forEach((row, i) => {
        const isSel = i === idx;
        row.setAttribute('aria-selected', isSel ? 'true' : 'false');
      });

      if (this.isOpen) {
        this.setActiveIndex(idx);
      }
    }

    isTriggerVisible() {
      if (!this.trigger || !document.body.contains(this.trigger)) return false;
      if (this.trigger.offsetParent === null && getComputedStyle(this.trigger).position !== 'fixed') {
        return false;
      }
      const rect = this.trigger.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    positionMenu() {
      const rect = this.trigger.getBoundingClientRect();
      if (!rect.width && !rect.height) return;

      const clientW = document.documentElement.clientWidth;
      const viewportH = window.innerHeight;
      const minW = this.isCompact ? 148 : 165;
      const menuWidth = Math.min(Math.max(rect.width, minW), clientW - 16);

      // Strictly anchor via rect.left clamped to clientWidth - menuWidth - 8
      const left = Math.max(8, Math.min(rect.left, clientW - menuWidth - 8));

      this.menu.style.width = `${menuWidth}px`;
      this.menu.style.maxHeight = '280px';
      this.menu.style.left = `${left}px`;

      const naturalHeight = Math.min(this.menu.scrollHeight + 4, 280);
      const spaceBelow = viewportH - rect.bottom - 8;
      const spaceAbove = rect.top - 8;

      if (spaceBelow < Math.min(naturalHeight, 170) && spaceAbove > spaceBelow) {
        const maxH = Math.max(72, Math.min(280, spaceAbove));
        const usedH = Math.min(naturalHeight, maxH);
        this.menu.classList.add('open-up');
        this.menu.style.maxHeight = `${maxH}px`;
        this.menu.style.top = `${Math.max(8, rect.top - usedH - 6)}px`;
      } else {
        const maxH = Math.max(72, Math.min(280, spaceBelow));
        const usedH = Math.min(naturalHeight, maxH);
        this.menu.classList.remove('open-up');
        this.menu.style.maxHeight = `${maxH}px`;
        this.menu.style.top = `${Math.min(rect.bottom + 6, Math.max(8, viewportH - usedH - 8))}px`;
      }
    }

    openMenu(initialIndex) {
      if (this.select.disabled || this.isOpen || !this.isTriggerVisible()) return;
      if (activeSelect && activeSelect !== this) {
        activeSelect.closeMenu(false);
      }

      this.isOpen = true;
      this.openedAt = performance.now();
      activeSelect = this;
      this.positionMenu();
      this.menu.classList.add('open');
      this.trigger.setAttribute('aria-expanded', 'true');

      if (
        document.activeElement !== this.trigger &&
        !this.menu.contains(document.activeElement)
      ) {
        try {
          this.trigger.focus({ preventScroll: true });
        } catch (_) {
          this.trigger.focus();
        }
      }

      const startIdx =
        typeof initialIndex === 'number'
          ? initialIndex
          : this.select.selectedIndex >= 0
            ? this.select.selectedIndex
            : this.findNextEnabled(-1, 1);

      this.setActiveIndex(startIdx);
    }

    closeMenu(restoreFocus = false) {
      if (!this.isOpen) return;
      this.isOpen = false;
      if (activeSelect === this) activeSelect = null;

      this.menu.classList.remove('open');
      this.trigger.setAttribute('aria-expanded', 'false');
      this.trigger.removeAttribute('aria-activedescendant');
      this.optionEls.forEach((el) => el.classList.remove('is-active'));
      this.activeIndex = -1;

      if (restoreFocus) {
        this.trigger.focus();
      }
    }

    setActiveIndex(idx) {
      if (idx < 0 || idx >= this.optionEls.length) return;
      this.optionEls.forEach((el, i) => {
        el.classList.toggle('is-active', i === idx);
      });
      this.activeIndex = idx;
      const activeEl = this.optionEls[idx];
      if (activeEl) {
        this.trigger.setAttribute('aria-activedescendant', activeEl.id);
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }

    findNextEnabled(fromIdx, step) {
      const len = this.optionEls.length;
      if (len === 0) return -1;
      let idx = fromIdx + step;
      while (idx >= 0 && idx < len) {
        if (this.optionEls[idx].getAttribute('aria-disabled') !== 'true') {
          return idx;
        }
        idx += step;
      }
      return fromIdx >= 0 && fromIdx < len ? fromIdx : -1;
    }

    commitIndex(idx) {
      if (idx < 0 || idx >= this.select.options.length) return;
      const optEl = this.optionEls[idx];
      if (optEl && optEl.getAttribute('aria-disabled') === 'true') return;

      const changed = this.select.selectedIndex !== idx;
      const valDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
      if (valDesc && valDesc.set) {
        valDesc.set.call(this.select, idx);
      } else {
        this.select.selectedIndex = idx;
      }

      this.syncFromNative();
      this.closeMenu(true);

      if (changed) {
        this.select.dispatchEvent(new Event('input', { bubbles: true }));
        this.select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    handleTypeAhead(char) {
      const normChar = normalizeText(char, true);
      if (!normChar) return;

      this.typeBuffer = (this.typeBuffer + normChar).replace(/\s+/g, ' ');
      clearTimeout(this.typeTimer);
      this.typeTimer = setTimeout(() => {
        this.typeBuffer = '';
      }, 550);

      const q = this.typeBuffer.trim();
      if (!q) return;

      const total = this.optionEls.length;
      if (total === 0) return;

      const start = this.activeIndex >= 0 ? this.activeIndex : 0;
      const isRepeatedSameChar =
        q.length > 1 && new Set(q.replace(/\s/g, '').split('')).size === 1;

      const searchPrefix = (term, fromOffset) => {
        for (let step = 0; step < total; step++) {
          const idx = (fromOffset + step) % total;
          const row = this.optionEls[idx];
          if (row.getAttribute('aria-disabled') === 'true') continue;
          const text = normalizeText(row.textContent);
          if (text.startsWith(term)) return idx;
        }
        return -1;
      };

      const searchContains = (term, fromOffset) => {
        for (let step = 0; step < total; step++) {
          const idx = (fromOffset + step) % total;
          const row = this.optionEls[idx];
          if (row.getAttribute('aria-disabled') === 'true') continue;
          const text = normalizeText(row.textContent);
          if (text.includes(term)) return idx;
        }
        return -1;
      };

      const offsetStart = q.length === 1 ? (start + 1) % total : start;
      let matchIdx = searchPrefix(q, offsetStart);
      if (matchIdx === -1 && isRepeatedSameChar) {
        matchIdx = searchPrefix(q[0], (start + 1) % total);
      }
      if (matchIdx === -1) {
        matchIdx = searchContains(q, offsetStart);
      }
      if (matchIdx === -1 && isRepeatedSameChar) {
        matchIdx = searchContains(q[0], (start + 1) % total);
      }

      if (matchIdx !== -1) {
        if (!this.isOpen) {
          this.openMenu(matchIdx);
        } else {
          this.setActiveIndex(matchIdx);
        }
      }
    }

    bindEvents() {
      this.trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isOpen) {
          this.closeMenu(false);
        } else {
          this.openMenu();
        }
      });

      this.trigger.addEventListener('keydown', (e) => {
        const key = e.key;
        if (!this.isOpen) {
          if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
            e.preventDefault();
            this.openMenu();
          } else if (key === 'Home') {
            e.preventDefault();
            this.openMenu(this.findNextEnabled(-1, 1));
          } else if (key === 'End') {
            e.preventDefault();
            this.openMenu(this.findNextEnabled(this.optionEls.length, -1));
          } else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            this.handleTypeAhead(key);
          }
          return;
        }

        // Menu is open
        if (key === 'ArrowDown') {
          e.preventDefault();
          const next = this.findNextEnabled(this.activeIndex, 1);
          if (next !== -1) this.setActiveIndex(next);
        } else if (key === 'ArrowUp') {
          e.preventDefault();
          const prev = this.findNextEnabled(this.activeIndex, -1);
          if (prev !== -1) this.setActiveIndex(prev);
        } else if (key === 'Home') {
          e.preventDefault();
          const first = this.findNextEnabled(-1, 1);
          if (first !== -1) this.setActiveIndex(first);
        } else if (key === 'End') {
          e.preventDefault();
          const last = this.findNextEnabled(this.optionEls.length, -1);
          if (last !== -1) this.setActiveIndex(last);
        } else if (key === 'Enter') {
          e.preventDefault();
          this.commitIndex(this.activeIndex >= 0 ? this.activeIndex : this.select.selectedIndex);
        } else if (key === ' ') {
          e.preventDefault();
          if (this.typeBuffer.length > 0) {
            this.handleTypeAhead(' ');
          } else {
            this.commitIndex(this.activeIndex >= 0 ? this.activeIndex : this.select.selectedIndex);
          }
        } else if (key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          this.closeMenu(true);
        } else if (key === 'Tab') {
          this.closeMenu(false);
        } else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          this.handleTypeAhead(key);
        }
      });

      this.menu.addEventListener('pointermove', (e) => {
        const row = e.target.closest('.c9z-select-option');
        if (!row) return;
        const idx = Number(row.getAttribute('data-index'));
        if (!Number.isNaN(idx) && idx !== this.activeIndex) {
          this.setActiveIndex(idx);
        }
      });

      this.menu.addEventListener('click', (e) => {
        const row = e.target.closest('.c9z-select-option');
        if (!row) return;
        e.stopPropagation();
        const idx = Number(row.getAttribute('data-index'));
        if (!Number.isNaN(idx)) {
          this.commitIndex(idx);
        }
      });

      this.select.addEventListener('change', () => this.syncFromNative());
      this.select.addEventListener('focus', () => this.trigger.focus());

      if (this.select.form) {
        this.select.form.addEventListener('reset', () => {
          setTimeout(() => this.syncFromNative(), 0);
        });
      }

      this.optionObserver = new MutationObserver(() => this.rebuildOptions());
      this.optionObserver.observe(this.select, { childList: true });
    }

    destroy() {
      clearTimeout(this.typeTimer);
      if (activeSelect === this) this.closeMenu(false);
      if (this.optionObserver) this.optionObserver.disconnect();
      if (this.menu && this.menu.parentNode) this.menu.parentNode.removeChild(this.menu);
      activeRegistry.delete(this);
      enhancedSelectMap.delete(this.select);
    }
  }

  function enhanceSelects(root = document) {
    if (!root || !root.querySelectorAll) return;
    const selects = root.querySelectorAll(SELECT_SELECTOR);
    selects.forEach((sel) => {
      if (sel.dataset.c9zSelectEnhanced === '1' || sel.hasAttribute('data-native-select')) return;
      new C9ZTacticalSelect(sel);
    });
  }

  function setupGlobalSelectLifecycle() {
    const closeIfOutside = (target) => {
      if (!activeSelect) return;
      if (activeSelect.wrap.contains(target) || activeSelect.menu.contains(target)) return;
      activeSelect.closeMenu(false);
    };

    document.addEventListener('pointerdown', (e) => closeIfOutside(e.target));
    document.addEventListener('click', (e) => closeIfOutside(e.target));
    document.addEventListener('focusin', (e) => closeIfOutside(e.target));

    // Global capture scroll: keep menu open while scrolling inside the portal menu itself!
    document.addEventListener(
      'scroll',
      (e) => {
        if (!activeSelect) return;
        if (performance.now() - (activeSelect.openedAt || 0) < 120) return;
        if (activeSelect.menu.contains(e.target)) return;
        activeSelect.closeMenu(false);
      },
      true
    );

    window.addEventListener('resize', () => {
      if (activeSelect) activeSelect.closeMenu(false);
    });

    // Capture Escape so open dropdown closes BEFORE modal Escape handlers
    document.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && activeSelect) {
          e.preventDefault();
          e.stopPropagation();
          activeSelect.closeMenu(true);
        }
      },
      true
    );

    // Watch DOM for dynamically injected selects, detached selects, or hidden ancestor panels
    const domObserver = new MutationObserver((mutations) => {
      let needsScan = false;
      for (const m of mutations) {
        if (m.type === 'childList' && m.addedNodes && m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === 1) {
              if (node.matches && node.matches(SELECT_SELECTOR)) {
                needsScan = true;
              } else if (node.querySelector && node.querySelector(SELECT_SELECTOR)) {
                needsScan = true;
              }
            }
          }
        }
      }
      if (needsScan) enhanceSelects(document);

      // Clean up portal menus whose native <select> was removed from document
      for (const inst of activeRegistry) {
        if (!document.body.contains(inst.select)) {
          inst.destroy();
        }
      }

      // Close open menu immediately if its trigger became hidden (e.g. tab switch / modal close)
      if (activeSelect && !activeSelect.isTriggerVisible()) {
        activeSelect.closeMenu(false);
      }
    });

    domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden']
    });
  }

  // =========================================================================
  // 2. Delegated rAF Card Spotlight & Neighbor Border Illumination
  // =========================================================================
  function initCardSpotlights() {
    if (!hasFinePointer) return;

    let pointerX = -9999;
    let pointerY = -9999;
    let rafId = 0;

    function updateSpotlights() {
      rafId = 0;
      const cards = document.querySelectorAll(GLOW_CARD_SELECTOR);
      const rects = [];

      // Read phase
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const rect = card.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.bottom < -280 || rect.top > window.innerHeight + 280) continue;
        rects.push({ card, rect });
      }

      // Write phase
      const radius = 280;
      for (let i = 0; i < rects.length; i++) {
        const { card, rect } = rects[i];
        const dx =
          pointerX < rect.left
            ? rect.left - pointerX
            : pointerX > rect.right
              ? pointerX - rect.right
              : 0;
        const dy =
          pointerY < rect.top
            ? rect.top - pointerY
            : pointerY > rect.bottom
              ? pointerY - rect.bottom
              : 0;

        if (dx * dx + dy * dy <= radius * radius) {
          card.style.setProperty('--mx', `${(pointerX - rect.left).toFixed(1)}px`);
          card.style.setProperty('--my', `${(pointerY - rect.top).toFixed(1)}px`);
          card.style.setProperty('--spot-active', '1');
        } else if (card.style.getPropertyValue('--spot-active') === '1') {
          card.style.setProperty('--spot-active', '0');
        }
      }
    }

    function clearSpotlights() {
      document.querySelectorAll(GLOW_CARD_SELECTOR).forEach((card) => {
        card.style.setProperty('--spot-active', '0');
      });
    }

    document.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') {
          clearSpotlights();
          return;
        }
        pointerX = e.clientX;
        pointerY = e.clientY;
        if (!rafId) {
          rafId = requestAnimationFrame(updateSpotlights);
        }
      },
      { passive: true }
    );

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') {
          clearSpotlights();
        }
      },
      { passive: true }
    );

    document.addEventListener('mouseleave', clearSpotlights);
  }

  // =========================================================================
  // 3. Hero & Spotlight 3D Micro-Tilt (±4deg max) + Coordinate HUD
  // =========================================================================
  function initTacticalTilt() {
    if (!hasFinePointer || prefersReduced) return;

    let currentCard = null;
    let rafTilt = 0;
    let lastClientX = 0;
    let lastClientY = 0;

    function resetCard(card) {
      if (!card) return;
      if (global.gsap) {
        global.gsap.to(card, {
          rotateX: 0,
          rotateY: 0,
          duration: 0.35,
          ease: 'power3.out',
          clearProps: 'transform'
        });
      } else {
        card.style.transform = '';
      }
    }

    function applyTilt() {
      rafTilt = 0;
      if (!currentCard) return;
      const rect = currentCard.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const px = Math.max(0, Math.min(rect.width, lastClientX - rect.left));
      const py = Math.max(0, Math.min(rect.height, lastClientY - rect.top));
      const nx = (px / rect.width) * 2 - 1;
      const ny = (py / rect.height) * 2 - 1;

      const maxTilt = currentCard.classList.contains('spotlight-card') ? 2.2 : 4;
      const rotY = Math.max(-maxTilt, Math.min(maxTilt, nx * maxTilt));
      const rotX = Math.max(-maxTilt, Math.min(maxTilt, -ny * maxTilt));

      if (global.gsap) {
        global.gsap.to(currentCard, {
          rotateX: rotX,
          rotateY: rotY,
          transformPerspective: 1050,
          duration: 0.24,
          ease: 'power2.out',
          overwrite: 'auto'
        });
      } else {
        currentCard.style.transform = `perspective(1050px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg)`;
      }

      const hud = currentCard.querySelector('[data-hud-coords]');
      if (hud) {
        const xStr = String(Math.round(px)).padStart(3, '0');
        const yStr = String(Math.round(py)).padStart(3, '0');
        hud.textContent = `TRK // X:${xStr} Y:${yStr}`;
      }
    }

    function clearTilt() {
      if (currentCard) {
        resetCard(currentCard);
        currentCard = null;
      }
    }

    document.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') {
          clearTilt();
          return;
        }
        if (!e.target || typeof e.target.closest !== 'function') return;
        const card = e.target.closest(TILT_CARD_SELECTOR);
        if (card !== currentCard) {
          if (currentCard) resetCard(currentCard);
          currentCard = card;
        }
        if (!currentCard) return;
        lastClientX = e.clientX;
        lastClientY = e.clientY;
        if (!rafTilt) {
          rafTilt = requestAnimationFrame(applyTilt);
        }
      },
      { passive: true }
    );

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') {
          clearTilt();
        }
      },
      { passive: true }
    );

    document.addEventListener('mouseleave', clearTilt);
  }

  // =========================================================================
  // 4. Non-Blocking Trailing Tactical Reticle (Preserves Native OS Cursor)
  // =========================================================================
  function initTacticalReticle() {
    if (!hasFinePointer || prefersReduced) return;

    const reticle = document.createElement('div');
    reticle.className = 'c9z-reticle';
    reticle.setAttribute('aria-hidden', 'true');
    reticle.setAttribute('data-state', 'hidden');
    reticle.innerHTML = '<div class="c9z-reticle-ring"></div><div class="c9z-reticle-core"></div>';
    document.body.appendChild(reticle);

    let tx = -100;
    let ty = -100;
    let rx = -100;
    let ry = -100;
    let initialized = false;
    let rafLoop = 0;

    function tick() {
      const dx = tx - rx;
      const dy = ty - ry;
      rx += dx * 0.2;
      ry += dy * 0.2;
      reticle.style.transform = `translate3d(${rx.toFixed(2)}px, ${ry.toFixed(2)}px, 0)`;

      if (Math.abs(dx) > 0.25 || Math.abs(dy) > 0.25) {
        rafLoop = requestAnimationFrame(tick);
      } else {
        rx = tx;
        ry = ty;
        reticle.style.transform = `translate3d(${rx.toFixed(2)}px, ${ry.toFixed(2)}px, 0)`;
        rafLoop = 0;
      }
    }

    document.addEventListener(
      'pointerdown',
      (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') {
          reticle.setAttribute('data-state', 'hidden');
        }
      },
      { passive: true }
    );

    document.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType && e.pointerType !== 'mouse') {
          reticle.setAttribute('data-state', 'hidden');
          return;
        }
        tx = e.clientX;
        ty = e.clientY;

        if (!initialized) {
          rx = tx;
          ry = ty;
          initialized = true;
        }

        const target = e.target;
        if (target && target.closest('input, textarea, select, [contenteditable="true"]')) {
          reticle.setAttribute('data-state', 'hidden');
        } else if (
          target &&
          target.closest(
            'a, button, .btn, .category-tab, .c9z-select-trigger, .sidebar-link, .product-card-media, .payment-method-card, .c9z-chart-hit, .footer-comp-card, .social-card'
          )
        ) {
          reticle.setAttribute('data-state', 'interactive');
        } else {
          reticle.setAttribute('data-state', 'active');
        }

        if (!rafLoop) {
          rafLoop = requestAnimationFrame(tick);
        }
      },
      { passive: true }
    );

    document.addEventListener('mouseleave', () => {
      reticle.setAttribute('data-state', 'hidden');
    });
  }

  // =========================================================================
  // 5. WAI-ARIA Tablist RTL Arrow Navigation
  // =========================================================================
  function initTablistKeyboard() {
    document.addEventListener('keydown', (e) => {
      const tab = e.target.closest('[role="tablist"] [role="tab"]');
      if (!tab) return;
      const tablist = tab.closest('[role="tablist"]');
      const tabs = Array.from(tablist.querySelectorAll('[role="tab"]:not([disabled])'));
      if (tabs.length < 2) return;

      const idx = tabs.indexOf(tab);
      let nextIdx = -1;

      // In RTL, ArrowLeft advances forward and ArrowRight goes back
      if (e.key === 'ArrowLeft') {
        nextIdx = (idx + 1) % tabs.length;
      } else if (e.key === 'ArrowRight') {
        nextIdx = (idx - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        nextIdx = 0;
      } else if (e.key === 'End') {
        nextIdx = tabs.length - 1;
      }

      if (nextIdx !== -1) {
        e.preventDefault();
        tabs[nextIdx].focus();
        tabs[nextIdx].click();
      }
    });
  }

  // =========================================================================
  // 6. Stealth Developer Gate (DevTools Console + Encrypted Hotkey Modal)
  // =========================================================================
  function initDeveloperStealthGate() {
    if (global.location && global.location.pathname.startsWith('/__c9z-ops')) return;

    async function unlockDevGate(rawKey) {
      const key = String(rawKey || '').trim();
      if (!key) return { ok: false, error: 'يرجى إدخال مفتاح وصول المطور.' };
      try {
        const res = await fetch('/api/auth/dev-gate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ key })
        });
        const data = await res.json();
        if (res.ok && data.ok && data.redirect) {
          global.location.href = data.redirect;
          return { ok: true };
        }
        return { ok: false, error: (data && data.error) || 'فشل التحقق من المفتاح.' };
      } catch (_) {
        return { ok: false, error: 'تعذر الاتصال بالخادم.' };
      }
    }

    // Expose Developer Console entry: window.c9z.dev('<DEV_ACCESS_KEY>')
    try {
      global.c9z = Object.freeze({
        dev: async (key) => {
          const r = await unlockDevGate(key);
          if (!r.ok) console.warn('[C9Z-OPS]', r.error);
          return r;
        }
      });
    } catch (_) {}

    function openDevPromptModal() {
      let modal = document.getElementById('c9z-dev-gate-modal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'c9z-dev-gate-modal';
        modal.className = 'c9z-dev-gate-backdrop';
        modal.innerHTML = `
          <div class="c9z-dev-gate-dialog" role="dialog" aria-modal="true" aria-labelledby="c9z-dg-title" dir="rtl">
            <div class="c9z-dev-gate-head">
              <div class="c9z-dev-gate-title-wrap">
                <span class="c9z-dev-gate-dot" aria-hidden="true"></span>
                <span id="c9z-dg-title" class="mono">C9Z-OPS // DEVELOPER STEALTH GATE</span>
              </div>
              <button type="button" class="c9z-dev-gate-close" id="c9z-dg-close" aria-label="إغلاق">×</button>
            </div>
            <p class="c9z-dev-gate-desc">أدخل مفتاح بوابة العمليات المشفر للوصول إلى جلسة المطور المعزولة.</p>
            <form id="c9z-dg-form" novalidate>
              <input type="password" id="c9z-dg-key" class="input mono" placeholder="DEV_ACCESS_KEY..." autocomplete="off" required>
              <div id="c9z-dg-err" class="c9z-dev-gate-err" style="display:none"></div>
              <div class="c9z-dev-gate-actions">
                <button type="submit" class="btn btn-primary btn-sm" id="c9z-dg-submit">فتح البوابة السرية</button>
                <button type="button" class="btn btn-ghost btn-sm" id="c9z-dg-cancel">إلغاء</button>
              </div>
            </form>
          </div>
        `;
        document.body.appendChild(modal);

        const closeModal = () => {
          modal.classList.remove('open');
        };
        modal.querySelector('#c9z-dg-close').addEventListener('click', closeModal);
        modal.querySelector('#c9z-dg-cancel').addEventListener('click', closeModal);
        modal.addEventListener('click', (ev) => {
          if (ev.target === modal) closeModal();
        });

        const form = modal.querySelector('#c9z-dg-form');
        form.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          const errEl = modal.querySelector('#c9z-dg-err');
          const keyEl = modal.querySelector('#c9z-dg-key');
          const btnEl = modal.querySelector('#c9z-dg-submit');
          errEl.style.display = 'none';
          btnEl.disabled = true;
          const result = await unlockDevGate(keyEl.value);
          if (!result.ok) {
            btnEl.disabled = false;
            errEl.textContent = result.error;
            errEl.style.display = 'block';
            keyEl.focus();
          }
        });
      }

      modal.classList.add('open');
      const input = modal.querySelector('#c9z-dg-key');
      if (input) {
        input.value = '';
        setTimeout(() => input.focus(), 40);
      }
    }

    // Encrypted Hotkey: Ctrl + Shift + Alt + D
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.altKey && (e.key === 'D' || e.key === 'd' || e.code === 'KeyD')) {
        e.preventDefault();
        openDevPromptModal();
      }
    });

    // Stealth Gesture: Shift + Alt + 5 rapid clicks on [data-dev-trigger]
    let clickCount = 0;
    let clickTimer = null;
    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-dev-trigger]');
      if (!trigger || !e.shiftKey || !e.altKey) return;
      clickCount += 1;
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => {
        clickCount = 0;
      }, 1600);
      if (clickCount >= 5) {
        clickCount = 0;
        e.preventDefault();
        openDevPromptModal();
      }
    });
  }

  function init() {
    enhanceSelects(document);
    setupGlobalSelectLifecycle();
    initCardSpotlights();
    initTacticalTilt();
    initTacticalReticle();
    initTablistKeyboard();
    initDeveloperStealthGate();
  }

  global.C9ZTacticalUI = {
    init,
    enhanceSelects,
    closeActiveSelect: () => {
      if (activeSelect) activeSelect.closeMenu(false);
    },
    getSelectInstance: (el) => enhancedSelectMap.get(el) || null
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})(window);
