/**
 * V12.47.12.1 · Scroll anticipativo en formularios mobile (/reservar).
 *
 * Anticipa el siguiente campo de la secuencia (Nombre -> Celular -> Email -> Código de descuento)
 * usando `window.visualViewport` para que el siguiente campo quede completamente visible
 * por encima del teclado virtual con un margen de seguridad de 24px, priorizando siempre
 * mantener visible y utilizable el campo enfocado y respetando el scroll manual del usuario.
 */

export interface ProgressiveScrollHandle {
  destroy: () => void;
}

const SAFE_BOTTOM_MARGIN_PX = 24;

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

function isVirtualKeyboardAlreadyOpen(): boolean {
  if (typeof window === 'undefined' || !window.visualViewport) return false;
  return window.visualViewport.height < window.innerHeight - 100;
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
  return Math.min(Math.max(rect.bottom, 0), 112) + 10;
}

function getFocusAnchorElement(target: HTMLElement): HTMLElement {
  return (
    (target.closest('.booking-discount-field') as HTMLElement | null) ??
    (target.closest('.field-label') as HTMLElement | null) ??
    (target.closest('.field-control') as HTMLElement | null) ??
    target
  );
}

function getNextSequenceAnchor(target: HTMLElement, formElement?: HTMLFormElement | null): HTMLElement | null {
  const form = formElement ?? (target.closest('form') as HTMLFormElement | null);
  if (!form) return null;

  const fieldOrder: Array<{ match: string; nextSelector: string }> = [
    { match: 'input[name="name"]', nextSelector: 'input[name="phone"]' },
    { match: 'input[name="phone"]', nextSelector: 'input[name="email"]' },
    { match: 'input[name="email"]', nextSelector: '#booking-discount-code, .booking-discount-field' },
  ];

  for (const step of fieldOrder) {
    if (target.matches(step.match)) {
      const nextEl = form.querySelector(step.nextSelector) as HTMLElement | null;
      return nextEl ? getFocusAnchorElement(nextEl) : null;
    }
  }

  return null;
}

export function computeProgressiveScrollDelta(target: HTMLElement, formElement?: HTMLFormElement | null): number {
  if (typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  const visibleTopOffset = vv?.offsetTop ?? 0;
  const visibleHeight = vv?.height ?? window.innerHeight;
  if (visibleHeight <= 0) return 0;

  const visibleBottom = visibleTopOffset + visibleHeight;
  const safeTop = visibleTopOffset + getHeaderBottomInset();
  const safeBottom = visibleBottom - SAFE_BOTTOM_MARGIN_PX;

  if (safeBottom <= safeTop + 24) return 0;

  const currentAnchor = getFocusAnchorElement(target);
  const currentRect = currentAnchor.getBoundingClientRect();
  const nextAnchor = getNextSequenceAnchor(target, formElement);
  const nextRect = nextAnchor ? nextAnchor.getBoundingClientRect() : null;

  // If current is above safeTop, scroll up enough to keep current visible
  if (currentRect.top < safeTop) {
    return currentRect.top - safeTop;
  }

  // Check if both current and next (when present) are already comfortably visible
  const bottomBoundaryToCheck = nextRect ? Math.max(currentRect.bottom, nextRect.bottom) : currentRect.bottom;
  if (currentRect.top >= safeTop && bottomBoundaryToCheck <= safeBottom) {
    return 0;
  }

  // Scroll down enough to reveal the next field completely, while prioritizing keeping currentRect visible
  const neededForCurrent = Math.max(0, currentRect.bottom - safeBottom);
  if (nextRect && nextRect.bottom > safeBottom) {
    const neededForNext = nextRect.bottom - safeBottom;
    const maxKeepingCurrentVisible = Math.max(0, currentRect.top - safeTop);
    if (neededForCurrent > 0) {
      // Current itself is below safeBottom: ensure current fits first, plus any remaining room up to nextRect
      return Math.max(neededForCurrent, Math.min(neededForNext, maxKeepingCurrentVisible));
    }
    return Math.min(neededForNext, maxKeepingCurrentVisible);
  }

  if (neededForCurrent > 0) {
    const maxKeepingCurrentTopVisible = Math.max(0, currentRect.top - safeTop);
    return currentRect.height <= safeBottom - safeTop
      ? neededForCurrent
      : Math.min(neededForCurrent, maxKeepingCurrentTopVisible);
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

    const deltaY = computeProgressiveScrollDelta(target, formElement);
    if (Math.abs(deltaY) < 4) return;

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
    const movingBetweenFormFields = Boolean(lastFocusedTarget && formElement.contains(lastFocusedTarget));
    lastFocusedTarget = target;
    activeTarget = target;
    userScrolledManually = false;
    clearTimers();

    if (movingBetweenFormFields || isVirtualKeyboardAlreadyOpen()) {
      // Keyboard already open: react immediately to focus change with a single smooth scroll
      scheduleEvaluation(16);
      return;
    }

    // Keyboard opening: wait for visualViewport resize to stabilize before computing scroll
    scheduleEvaluation(140);
    maxWaitTimer = window.setTimeout(applyScrollForTarget, 380);
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
    scheduleEvaluation(85);
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
