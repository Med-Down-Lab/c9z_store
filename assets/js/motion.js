/* ==========================================================================
   C9Z Web v2.0 — GSAP 3.15.1 + ScrollTrigger + Flip + DrawSVG + ScrambleText
   Principles:
   - Only GPU-accelerated properties (transform, opacity) & DrawSVG stroke
   - Calm tactical easing (power3.out), 35-45ms staggers
   - Dynamic DOM reveal & ScrollTrigger.refresh() after async fetches
   - Post-login & tab-switch lifecycle hooks for Developer Dashboard
   - Full respect for prefers-reduced-motion
   ========================================================================== */
(function (global) {
  'use strict';

  function isReducedMotion() {
    return Boolean(
      global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function hasFinePointer() {
    return Boolean(
      global.matchMedia &&
      global.matchMedia('(hover: hover) and (pointer: fine)').matches
    );
  }

  function registerPlugins() {
    if (!global.gsap) return null;
    const gsap = global.gsap;
    const plugins = [];
    if (global.ScrollTrigger) plugins.push(global.ScrollTrigger);
    if (global.Flip) plugins.push(global.Flip);
    if (global.DrawSVGPlugin) plugins.push(global.DrawSVGPlugin);
    if (global.ScrambleTextPlugin) plugins.push(global.ScrambleTextPlugin);
    if (plugins.length > 0) {
      gsap.registerPlugin(...plugins);
    }
    return gsap;
  }

  function attachMagnetic(root = document) {
    if (isReducedMotion() || !hasFinePointer() || !global.gsap || !root) return;
    const gsap = global.gsap;
    const targets = root.querySelectorAll(
      '.hero-cta-row .btn-primary, .hero-cta-row .btn-secondary, .spotlight-actions .btn-primary, .spotlight-actions .btn-secondary, .cart-trigger-btn'
    );

    targets.forEach((btn) => {
      if (btn.dataset.c9zMagneticBound === '1') return;
      btn.dataset.c9zMagneticBound = '1';

      const xTo = gsap.quickTo(btn, 'x', { duration: 0.24, ease: 'power3.out' });
      const yTo = gsap.quickTo(btn, 'y', { duration: 0.24, ease: 'power3.out' });

      btn.addEventListener('pointermove', (e) => {
        if (btn.disabled) return;
        const rect = btn.getBoundingClientRect();
        if (!rect.width || !rect.height) return;
        const relX = e.clientX - (rect.left + rect.width * 0.5);
        const relY = e.clientY - (rect.top + rect.height * 0.5);
        const pullX = Math.max(-5, Math.min(5, relX * 0.16));
        const pullY = Math.max(-5, Math.min(5, relY * 0.22));
        xTo(pullX);
        yTo(pullY);
      });

      const reset = () => {
        xTo(0);
        yTo(0);
      };

      btn.addEventListener('pointerleave', reset);
      btn.addEventListener('pointercancel', reset);
      btn.addEventListener('blur', reset);
    });
  }

  function scrambleTelemetryTag(el, targetText) {
    if (isReducedMotion() || !global.gsap || !global.ScrambleTextPlugin || !el) return;
    const text = targetText || el.textContent.trim();
    if (!text || /[\u0600-\u06FF]/.test(text)) return; // Strict guard: never scramble Arabic
    global.gsap.to(el, {
      duration: 0.55,
      ease: 'power2.out',
      scrambleText: {
        text,
        chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/-:',
        revealDelay: 0.1,
        speed: 0.65
      }
    });
  }

  function initMotion() {
    const gsap = registerPlugins();
    if (!gsap || isReducedMotion()) return;

    // 1. Hero Split Choreography (runs once on page load)
    const heroEls = document.querySelectorAll('[data-hero-anim]');
    if (heroEls.length > 0) {
      gsap.fromTo(
        heroEls,
        { opacity: 0, y: 12 },
        {
          opacity: 1,
          y: 0,
          duration: 0.46,
          stagger: 0.055,
          ease: 'power3.out',
          clearProps: 'transform,opacity'
        }
      );
    }

    const heroVisual = document.querySelector('[data-hero-visual]');
    if (heroVisual) {
      gsap.fromTo(
        heroVisual,
        { opacity: 0, scale: 0.98, y: 10 },
        {
          opacity: 1,
          scale: 1,
          y: 0,
          duration: 0.54,
          delay: 0.08,
          ease: 'power3.out',
          clearProps: 'transform,opacity'
        }
      );
    }

    // Subtle Latin-only tactical telemetry decode on brand tag / HUD chips
    const brandTag = document.querySelector('.brand-tag');
    if (brandTag && !brandTag.dataset.scrambled) {
      brandTag.dataset.scrambled = '1';
      scrambleTelemetryTag(brandTag);
    }

    // 2. ScrollTrigger Section Headers & Static Cards (skip empty async containers)
    if (global.ScrollTrigger) {
      const revealBlocks = document.querySelectorAll('[data-reveal="up"]');
      revealBlocks.forEach((el) => {
        if (el.id === 'bestseller-spotlight' && el.children.length === 0) return;
        gsap.fromTo(
          el,
          { opacity: 0, y: 12 },
          {
            opacity: 1,
            y: 0,
            duration: 0.4,
            ease: 'power3.out',
            clearProps: 'transform,opacity',
            scrollTrigger: {
              trigger: el,
              start: 'top 89%',
              once: true
            }
          }
        );
      });

      const staggerGroups = document.querySelectorAll('[data-stagger-group]');
      staggerGroups.forEach((group) => {
        const items = group.querySelectorAll('[data-stagger-item], .product-card, .feature-card, .kpi-card, .footer-comp-card, .social-card');
        if (items.length === 0) return;
        gsap.fromTo(
          items,
          { opacity: 0, y: 10 },
          {
            opacity: 1,
            y: 0,
            duration: 0.36,
            stagger: 0.042,
            ease: 'power3.out',
            clearProps: 'transform,opacity',
            scrollTrigger: {
              trigger: group,
              start: 'top 87%',
              once: true
            }
          }
        );
      });
    }

    // 3. Tabular Counter Animation
    const counters = document.querySelectorAll('[data-count-to]');
    counters.forEach((node) => {
      const target = Number(node.getAttribute('data-count-to')) || 0;
      const suffix = node.getAttribute('data-count-suffix') || '';
      const prefix = node.getAttribute('data-count-prefix') || '';
      const obj = { val: 0 };

      gsap.to(obj, {
        val: target,
        duration: 0.85,
        ease: 'power3.out',
        onUpdate() {
          node.textContent = prefix + Math.round(obj.val).toLocaleString('en-US') + suffix;
        }
      });
    });

    // 4. Magnetic micro-pull on primary/cart CTAs
    attachMagnetic(document);
  }

  function isBelowFold(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return false;
    const vh = global.innerHeight || document.documentElement.clientHeight || 800;
    return el.getBoundingClientRect().top > vh * 0.96;
  }

  function killContainerTriggers(container) {
    if (!global.ScrollTrigger || !container) return;
    global.ScrollTrigger.getAll().forEach((st) => {
      if (st && st.trigger === container) st.kill();
    });
  }

  function captureFlipState(container) {
    if (!container || isReducedMotion() || !global.Flip) return null;
    const items = container.querySelectorAll('.product-card[data-flip-id]');
    if (items.length === 0) return null;
    return global.Flip.getState(items);
  }

  function animateReveal(container) {
    if (!container) return;
    attachMagnetic(container);

    if (isReducedMotion() || !global.gsap) return;
    const gsap = global.gsap;

    const items = container.querySelectorAll(
      '.product-card, .feature-card, .spotlight-card, .kpi-card, .footer-comp-card, .social-card'
    );
    const targets = items.length > 0 ? items : container.children;
    if (!targets || targets.length === 0) return;

    gsap.killTweensOf(targets);
    killContainerTriggers(container);

    const useScroll = Boolean(global.ScrollTrigger && isBelowFold(container));
    gsap.fromTo(
      targets,
      { opacity: 0, y: 12 },
      {
        opacity: 1,
        y: 0,
        duration: 0.36,
        stagger: 0.04,
        ease: 'power3.out',
        clearProps: 'transform,opacity',
        ...(useScroll
          ? {
              scrollTrigger: {
                trigger: container,
                start: 'top 90%',
                once: true
              }
            }
          : {})
      }
    );

    if (global.ScrollTrigger) {
      global.requestAnimationFrame(() => global.ScrollTrigger.refresh());
    }
  }

  function animateProductSwap(container, flipState = null) {
    if (!container) return;
    attachMagnetic(container);

    if (isReducedMotion() || !global.gsap) return;
    const cards = container.querySelectorAll('.product-card');
    if (cards.length === 0) return;

    global.gsap.killTweensOf(cards);
    killContainerTriggers(container);

    if (flipState && global.Flip && container.querySelector('.product-card[data-flip-id]')) {
      global.Flip.from(flipState, {
        targets: cards,
        duration: 0.36,
        ease: 'power3.out',
        stagger: 0.024,
        scale: false,
        prune: true,
        absolute: false,
        onEnter(elements) {
          return global.gsap.fromTo(
            elements,
            { opacity: 0, y: 10 },
            {
              opacity: 1,
              y: 0,
              duration: 0.28,
              stagger: 0.024,
              ease: 'power3.out',
              clearProps: 'transform,opacity'
            }
          );
        },
        onComplete() {
          global.gsap.set(cards, { clearProps: 'transform,opacity' });
        }
      });
    } else {
      const useScroll = Boolean(global.ScrollTrigger && !flipState && isBelowFold(container));
      global.gsap.fromTo(
        cards,
        { opacity: 0, y: 9 },
        {
          opacity: 1,
          y: 0,
          duration: 0.28,
          stagger: 0.032,
          ease: 'power3.out',
          clearProps: 'transform,opacity',
          ...(useScroll
            ? {
                scrollTrigger: {
                  trigger: container,
                  start: 'top 90%',
                  once: true
                }
              }
            : {})
        }
      );
    }

    if (global.ScrollTrigger) {
      global.requestAnimationFrame(() => global.ScrollTrigger.refresh());
    }
  }

  function animateChartDraw(chartRoot) {
    if (isReducedMotion() || !global.gsap || !chartRoot) return;
    const line = chartRoot.querySelector('.c9z-chart-line');
    if (!line) return;
    const gsap = global.gsap;

    if (global.DrawSVGPlugin) {
      gsap.killTweensOf(line);
      gsap.fromTo(
        line,
        { drawSVG: '0%' },
        { drawSVG: '100%', duration: 0.85, ease: 'power3.out', clearProps: 'strokeDasharray,strokeDashoffset' }
      );
    }

    const area = chartRoot.querySelector('.c9z-chart-area');
    if (area) {
      gsap.fromTo(
        area,
        { opacity: 0 },
        { opacity: 1, duration: 0.6, delay: 0.15, ease: 'power2.out', clearProps: 'opacity' }
      );
    }
  }

  function animateDashboardEntrance(shell) {
    if (!shell || isReducedMotion() || !global.gsap) return;
    const gsap = global.gsap;

    const kpis = shell.querySelectorAll('#tab-overview .kpi-card');
    if (kpis.length > 0) {
      gsap.killTweensOf(kpis);
      gsap.fromTo(
        kpis,
        { opacity: 0, y: 12 },
        {
          opacity: 1,
          y: 0,
          duration: 0.36,
          stagger: 0.045,
          ease: 'power3.out',
          clearProps: 'transform,opacity'
        }
      );
    }

    const panels = shell.querySelectorAll('#tab-overview .chart-panel, #tab-overview .data-table-wrap');
    if (panels.length > 0) {
      gsap.killTweensOf(panels);
      gsap.fromTo(
        panels,
        { opacity: 0, y: 12 },
        {
          opacity: 1,
          y: 0,
          duration: 0.4,
          delay: 0.08,
          stagger: 0.06,
          ease: 'power3.out',
          clearProps: 'transform,opacity'
        }
      );
    }

    const chart = shell.querySelector('#overview-svg-chart');
    if (chart) animateChartDraw(chart);
  }

  function animateDashboardTab(panel) {
    if (!panel || isReducedMotion() || !global.gsap) return;
    const gsap = global.gsap;
    const blocks = panel.querySelectorAll('.kpi-card, .chart-panel, .data-table-wrap');
    if (blocks.length > 0) {
      gsap.killTweensOf(blocks);
      gsap.fromTo(
        blocks,
        { opacity: 0, y: 10 },
        {
          opacity: 1,
          y: 0,
          duration: 0.32,
          stagger: 0.045,
          ease: 'power3.out',
          clearProps: 'transform,opacity'
        }
      );
    }
    if (panel.id === 'tab-overview') {
      const chart = panel.querySelector('#overview-svg-chart');
      if (chart) animateChartDraw(chart);
    }
  }

  global.C9ZMotion = {
    init: initMotion,
    captureFlipState,
    animateReveal,
    animateProductSwap,
    animateGridCards: animateProductSwap,
    animateChartDraw,
    animateDashboardEntrance,
    animateDashboardTab,
    attachMagnetic,
    scrambleTelemetryTag
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMotion);
  } else {
    initMotion();
  }
})(window);
