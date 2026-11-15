/**
 * V12.47.12 · Scroll progresivo inteligente en formularios mobile (/reservar).
 *
 * Ajusta suavemente el contenedor de scroll real cuando un campo recibe foco en mobile,
 * esperando a que `window.visualViewport` estabilice el teclado virtual y respetando
 * siempre el scroll manual del usuario.
 */

export interface ProgressiveScrollHandle {
  destroy: () => void;
}

function isMobileOrTouchViewport(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth <= 767) return true;
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

function isPaywayModalOpen(): boolean {
  if (typeof document === 'undefined') return false;
  if (document.body?.getAttribute('data-payway-modal-open') === 'true') return true;
  return Boolean(document.querySelector('[role="dialog"].payway-checkout'));
}

export function findRealScrollContainer(element: HTMLElement): HTMLElement | Window {
  let current: HTMLElement | null = element.parentElement;
  while (current && current !== document.body && current !== document.documentElement) {
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY;
    const isScrollableStyle = overflowY === 'auto' || overflowY === 'scroll';
    if (isScrollableStyle && current.scrollHeight > current.clientHeight + 2) {
      return current;
    }
    current = current.parentElement;
  }
  return window;
}

function getHeaderBottomInset(): number {
  if (typeof document === 'undefined') return 16;
  const header = document.querySelector('.site-header');
  if (!header) return 16;
  const rect = header.getBoundingClientRect();
  if (rect.height <= 0 || rect.bottom <= 0) return 16;
  return Math.min(Math.max(rect.bottom, 0), 112) + 12;
}

function getFocusAnchorElement(target: HTMLElement): HTMLElement {
  return (
    (target.closest('.booking-discount-field') as HTMLElement | null) ??
    (target.closest('.field-label') as HTMLElement | null) ??
    (target.closest('.field-control') as HTMLElement | null) ??
    target
  );
}

export function computeProgressiveScrollDelta(target: HTMLElement): number {
  if (typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  const visibleTopOffset = vv?.offsetTop ?? 0;
  const visibleHeight = vv?.height ?? window.innerHeight;
  if (visibleHeight <= 0) return 0;

  const visibleBottom = visibleTopOffset + visibleHeight;
  const safeTop = visibleTopOffset + getHeaderBottomInset();
  const bottomMargin = Math.round(Math.min(Math.max(visibleHeight * 0.16, 56), 112));
  const safeBottom = visibleBottom - bottomMargin;

  if (safeBottom <= safeTop + 24) return 0;

  const anchor = getFocusAnchorElement(target);
  const rect = anchor.getBoundingClientRect();

  // Already comfortably visible: avoid unnecessary scroll
  if (rect.top >= safeTop && rect.bottom <= safeBottom) {
    return 0;
  }

  if (rect.bottom > safeBottom) {
    const neededDown = rect.bottom - safeBottom;
    const maxWithoutHidingTop = Math.max(0, rect.top - safeTop);
    return Math.min(neededDown, maxWithoutHidingTop);
  }

  if (rect.top < safeTop) {
    return rect.top - safeTop;
  }

  return 0;
}

export function attachMobileProgressiveFieldScroll(formElement: HTMLFormElement): ProgressiveScrollHandle {
  if (typeof window === 'undefined') {
    return { destroy: () => {} };
  }

  let debounceTimer: number | null = null;
  let maxWaitTimer: number | null = null;
  let activeTarget: HTMLElement | null = null;
  let lastFocusedTarget: HTMLElement | null = null;
  let userScrolledManually = false;

  const vv = window.visualViewport;

  const clearTimers = () => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer !== null) {
      window.clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const applyScrollForTarget = () => {
    clearTimers();
    const target = activeTarget;
    activeTarget = null;
    if (!target || userScrolledManually || !target.isConnected) return;
    if (document.activeElement !== target) return;
    if (!isMobileOrTouchViewport() || isPaywayModalOpen()) return;

    const deltaY = computeProgressiveScrollDelta(target);
    if (Math.abs(deltaY) < 6) return;

    const container = findRealScrollContainer(target);
    if (typeof container.scrollBy === 'function') {
      container.scrollBy({ top: deltaY, behavior: 'smooth' });
    }
  };

  const scheduleEvaluation = (delayMs: number) => {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(applyScrollForTarget, delayMs);
  };

  const handleFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || !formElement.contains(target)) return;
    if (!target.matches('input, textarea, select')) return;
    if (!isMobileOrTouchViewport() || isPaywayModalOpen()) return;

    // Avoid repeating scroll adjustments while staying inside the same control
    if (lastFocusedTarget === target && activeTarget === null) return;
    lastFocusedTarget = target;
    activeTarget = target;
    userScrolledManually = false;
    clearTimers();

    // Give visualViewport time to report keyboard resize if it opens, or settle quickly if already open
    scheduleEvaluation(140);
    maxWaitTimer = window.setTimeout(applyScrollForTarget, 420);
  };

  const handleFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as HTMLElement | null;
    if (!next || !formElement.contains(next)) {
      lastFocusedTarget = null;
      activeTarget = null;
      clearTimers();
    }
  };

  const handleViewportResize = () => {
    if (!activeTarget || userScrolledManually) return;
    scheduleEvaluation(90);
  };

  const handleManualUserScroll = () => {
    if (activeTarget) {
      userScrolledManually = true;
      clearTimers();
    }
  };

  formElement.addEventListener('focusin', handleFocusIn);
  formElement.addEventListener('focusout', handleFocusOut);
  vv?.addEventListener('resize', handleViewportResize);
  window.addEventListener('wheel', handleManualUserScroll, { passive: true });
  window.addEventListener('touchmove', handleManualUserScroll, { passive: true });

  return {
    destroy: () => {
      clearTimers();
      formElement.removeEventListener('focusin', handleFocusIn);
      formElement.removeEventListener('focusout', handleFocusOut);
      vv?.removeEventListener('resize', handleViewportResize);
      window.removeEventListener('wheel', handleManualUserScroll);
      window.removeEventListener('touchmove', handleManualUserScroll);
    },
  };
}
