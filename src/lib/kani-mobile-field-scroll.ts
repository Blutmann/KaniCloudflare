/**
 * V12.47.12.2 · Corrección definitiva del scroll anticipativo en iOS (/reservar).
 *
 * Considera:
 * 1. Área realmente visible en `window.visualViewport` (teclado virtual abierto).
 * 2. Obstrucción visual de la barra inferior fija (`.booking-cta` / «Volver» / «Pagar seña»).
 * 3. Límite máximo de scroll disponible del contenedor real (agregando padding temporal al form
 *    solo mientras el teclado/foco está activo si falta espacio desplazable al final).
 * 4. Reajuste único tras el scroll nativo de iOS Safari si el campo siguiente aún queda obstruido.
 */

export interface ProgressiveScrollHandle {
  destroy: () => void;
}

const SAFE_BOTTOM_MARGIN_PX = 20;

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
  return Math.min(Math.max(rect.bottom, 0), 112) + 8;
}

function getFixedBottomBarTop(visibleBottom: number, safeTop: number): number {
  if (typeof document === 'undefined') return visibleBottom;
  const ctaRoot = document.querySelector('.booking-cta:not(.mobile-menu-cta)') as HTMLElement | null;
  if (!ctaRoot) return visibleBottom;

  const ctaStyle = window.getComputedStyle(ctaRoot);
  if (ctaStyle.display === 'none' || ctaStyle.visibility === 'hidden') {
    return visibleBottom;
  }

  const ctaVisualTarget =
    (ctaRoot.querySelector('.booking-cta-inner') as HTMLElement | null) ?? ctaRoot;
  const rect = ctaVisualTarget.getBoundingClientRect();
  if (rect.height <= 0 || rect.top <= safeTop + 24) {
    return visibleBottom;
  }

  // On iOS Safari, a fixed bottom bar can sit either at the bottom of visualViewport
  // or slightly above the keyboard; whenever it overlaps the visible viewport,
  // treat its top edge as the real unobstructed bottom boundary.
  if (rect.top < visibleBottom) {
    return Math.min(visibleBottom, rect.top);
  }

  return visibleBottom;
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
  const unobstructedBottom = getFixedBottomBarTop(visibleBottom, safeTop);
  const safeBottom = unobstructedBottom - SAFE_BOTTOM_MARGIN_PX;

  if (safeBottom <= safeTop + 24) return 0;

  const currentAnchor = getFocusAnchorElement(target);
  const currentRect = currentAnchor.getBoundingClientRect();
  const nextAnchor = getNextSequenceAnchor(target, formElement);
  const nextRect = nextAnchor ? nextAnchor.getBoundingClientRect() : null;

  // If current is above safeTop, scroll up enough to keep current visible
  if (currentRect.top < safeTop) {
    return currentRect.top - safeTop;
  }

  // Check if both current and next (when present) are already comfortably visible above fixed CTA
  const bottomBoundaryToCheck = nextRect ? Math.max(currentRect.bottom, nextRect.bottom) : currentRect.bottom;
  if (currentRect.top >= safeTop && bottomBoundaryToCheck <= safeBottom) {
    return 0;
  }

  // Scroll down enough to reveal the next field completely above keyboard + fixed CTA,
  // while prioritizing keeping the current focused field visible below the header.
  const neededForCurrent = Math.max(0, currentRect.bottom - safeBottom);
  if (nextRect && nextRect.bottom > safeBottom) {
    const neededForNext = nextRect.bottom - safeBottom;
    const maxKeepingCurrentVisible = Math.max(0, currentRect.top - safeTop);
    if (neededForCurrent > 0) {
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

function ensureScrollRoom(
  container: HTMLElement | Window,
  formElement: HTMLFormElement,
  neededDeltaY: number,
  currentTempPadding: number,
): number {
  if (neededDeltaY <= 0) return currentTempPadding;

  const vvHeight = window.visualViewport?.height ?? window.innerHeight;
  let availableRoom = 0;

  if (container === window) {
    const docEl = document.scrollingElement ?? document.documentElement;
    const scrollHeight = docEl?.scrollHeight ?? 0;
    const scrollTop = window.scrollY ?? docEl?.scrollTop ?? 0;
    availableRoom = Math.max(0, scrollHeight - vvHeight - scrollTop);
  } else {
    const el = container as HTMLElement;
    availableRoom = Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop);
  }

  if (neededDeltaY <= availableRoom) {
    return currentTempPadding;
  }

  const extraNeeded = Math.ceil(neededDeltaY - availableRoom + 24);
  const nextPadding = currentTempPadding + extraNeeded;
  formElement.style.paddingBottom = `${nextPadding}px`;
  return nextPadding;
}

export function attachMobileProgressiveFieldScroll(formElement: HTMLFormElement): ProgressiveScrollHandle {
  if (typeof window === 'undefined') {
    return { destroy: () => {} };
  }

  let primaryTimer: number | null = null;
  let settleVerifyTimer: number | null = null;
  let maxWaitTimer: number | null = null;
  let activeTarget: HTMLElement | null = null;
  let lastFocusedTarget: HTMLElement | null = null;
  let userScrolledManually = false;
  let tempBottomPaddingPx = 0;

  const vv = window.visualViewport;

  const clearTimers = () => {
    if (primaryTimer !== null) {
      window.clearTimeout(primaryTimer);
      primaryTimer = null;
    }
    if (settleVerifyTimer !== null) {
      window.clearTimeout(settleVerifyTimer);
      settleVerifyTimer = null;
    }
    if (maxWaitTimer !== null) {
      window.clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const resetTemporaryPadding = () => {
    if (tempBottomPaddingPx > 0) {
      formElement.style.removeProperty('padding-bottom');
      formElement.style.paddingBottom = '';
      tempBottomPaddingPx = 0;
    }
  };

  const runScrollPass = (isVerificationPass: boolean) => {
    const target = activeTarget;
    if (!target || userScrolledManually || !target.isConnected) {
      if (!isVerificationPass) activeTarget = null;
      return;
    }
    if (document.activeElement !== target) {
      activeTarget = null;
      return;
    }
    if (!isMobileOrTouchViewport() || isPaywayModalOpen()) {
      activeTarget = null;
      return;
    }

    const deltaY = computeProgressiveScrollDelta(target, formElement);
    if (Math.abs(deltaY) < (isVerificationPass ? 8 : 4)) {
      if (isVerificationPass) activeTarget = null;
      return;
    }

    const container = findRealScrollContainer(target);
    tempBottomPaddingPx = ensureScrollRoom(container, formElement, deltaY, tempBottomPaddingPx);

    if (typeof container.scrollBy === 'function') {
      container.scrollBy({ top: deltaY, behavior: 'smooth' });
    }

    if (isVerificationPass) {
      activeTarget = null;
    }
  };

  const scheduleScrollSequence = (initialDelayMs: number) => {
    clearTimers();
    primaryTimer = window.setTimeout(() => {
      primaryTimer = null;
      runScrollPass(false);
    }, initialDelayMs);

    // Single post-native-scroll verification pass for iOS Safari, which can scroll
    // natively after focusin and leave the next field behind the fixed bottom bar.
    settleVerifyTimer = window.setTimeout(() => {
      settleVerifyTimer = null;
      runScrollPass(true);
    }, initialDelayMs + 190);
  };

  const handleFocusIn = (event: FocusEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target || !formElement.contains(target)) return;
    if (!target.matches('input, textarea, select')) return;
    if (!isMobileOrTouchViewport() || isPaywayModalOpen()) return;

    if (lastFocusedTarget === target && activeTarget === null) return;
    const movingBetweenFormFields = Boolean(lastFocusedTarget && formElement.contains(lastFocusedTarget));
    lastFocusedTarget = target;
    activeTarget = target;
    userScrolledManually = false;

    if (movingBetweenFormFields || isVirtualKeyboardAlreadyOpen()) {
      scheduleScrollSequence(50);
      return;
    }

    scheduleScrollSequence(140);
    maxWaitTimer = window.setTimeout(() => {
      maxWaitTimer = null;
      runScrollPass(true);
    }, 420);
  };

  const handleFocusOut = (event: FocusEvent) => {
    const next = event.relatedTarget as HTMLElement | null;
    if (!next || !formElement.contains(next)) {
      lastFocusedTarget = null;
      activeTarget = null;
      clearTimers();
      resetTemporaryPadding();
    }
  };

  const handleViewportResize = () => {
    if (!isVirtualKeyboardAlreadyOpen()) {
      clearTimers();
      resetTemporaryPadding();
      return;
    }
    if (!activeTarget || userScrolledManually) return;
    scheduleScrollSequence(90);
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
      resetTemporaryPadding();
      formElement.removeEventListener('focusin', handleFocusIn);
      formElement.removeEventListener('focusout', handleFocusOut);
      vv?.removeEventListener('resize', handleViewportResize);
      window.removeEventListener('wheel', handleManualUserScroll);
      window.removeEventListener('touchmove', handleManualUserScroll);
    },
  };
}
