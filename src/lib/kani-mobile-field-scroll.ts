/**
 * V12.47.12.3 · Ajuste final de scroll anticipativo en iOS (/reservar).
 *
 * Considera:
 * 1. Área realmente visible en `window.visualViewport` (teclado virtual abierto).
 * 2. Límite superior real: `.site-header` y `.booking-progress` (stepper cuando es sticky/fixed).
 * 3. Obstrucción visual de la barra inferior fija (`.booking-cta` / «Volver» / «Pagar seña»).
 * 4. Bloque objetivo completo: al enfocar Celular o Email, anticipa los campos posteriores
 *    (incluyendo mensajes de validación y el bloque de Código de descuento + botón Aplicar)
 *    aprovechando el espacio disponible debajo del header/stepper sin ocultar el campo enfocado.
 * 5. Recálculo acotado ante aparición/desaparición de mensajes de validación, sin bucles.
 * 6. Límite máximo de scroll disponible del contenedor real (padding inferior temporal mientras
 *    el teclado/foco está activo) y reajuste único tras el scroll nativo de iOS Safari.
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

function getTopSafeInset(visibleTopOffset: number): number {
  if (typeof document === 'undefined') return 16;
  let inset = 16;

  const header = document.querySelector('.site-header');
  if (header) {
    const rect = header.getBoundingClientRect();
    if (rect.height > 0 && rect.bottom > visibleTopOffset) {
      inset = Math.max(inset, Math.min(rect.bottom - visibleTopOffset, 112) + 8);
    }
  }

  const stepper = document.querySelector('.booking-progress') as HTMLElement | null;
  if (stepper) {
    const stepperStyle = window.getComputedStyle(stepper);
    if (stepperStyle.position === 'fixed' || stepperStyle.position === 'sticky') {
      const rect = stepper.getBoundingClientRect();
      if (rect.height > 0 && rect.bottom > visibleTopOffset) {
        inset = Math.max(inset, Math.min(rect.bottom - visibleTopOffset, 160) + 8);
      }
    }
  }

  return inset;
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

function getTargetSequenceAnchors(target: HTMLElement, formElement?: HTMLFormElement | null): HTMLElement[] {
  const currentAnchor = getFocusAnchorElement(target);
  const form = formElement ?? (target.closest('form') as HTMLFormElement | null);
  if (!form) return [currentAnchor];

  const fieldOrder: Array<{ match: string; nextSelectors: string[] }> = [
    { match: 'input[name="name"]', nextSelectors: ['input[name="phone"]'] },
    { match: 'input[name="phone"]', nextSelectors: ['input[name="email"]', '#booking-discount-code, .booking-discount-field'] },
    { match: 'input[name="email"]', nextSelectors: ['#booking-discount-code, .booking-discount-field'] },
  ];

  const anchors: HTMLElement[] = [currentAnchor];
  for (const step of fieldOrder) {
    if (target.matches(step.match)) {
      for (const selector of step.nextSelectors) {
        const nextEl = form.querySelector(selector) as HTMLElement | null;
        const anchor = nextEl ? getFocusAnchorElement(nextEl) : null;
        if (anchor && !anchors.includes(anchor)) {
          anchors.push(anchor);
        }
      }
      break;
    }
  }

  return anchors;
}

export function computeProgressiveScrollDelta(target: HTMLElement, formElement?: HTMLFormElement | null): number {
  if (typeof window === 'undefined') return 0;
  const vv = window.visualViewport;
  const visibleTopOffset = vv?.offsetTop ?? 0;
  const visibleHeight = vv?.height ?? window.innerHeight;
  if (visibleHeight <= 0) return 0;

  const visibleBottom = visibleTopOffset + visibleHeight;
  const safeTop = visibleTopOffset + getTopSafeInset(visibleTopOffset);
  const unobstructedBottom = getFixedBottomBarTop(visibleBottom, safeTop);
  const safeBottom = unobstructedBottom - SAFE_BOTTOM_MARGIN_PX;

  if (safeBottom <= safeTop + 24) return 0;

  const anchors = getTargetSequenceAnchors(target, formElement);
  const currentAnchor = anchors[0];
  const currentRect = currentAnchor.getBoundingClientRect();

  // If current focused block is above safeTop, scroll up enough to keep it visible below header/stepper
  if (currentRect.top < safeTop) {
    return currentRect.top - safeTop;
  }

  const desiredBottom = anchors.reduce(
    (maxBottom, anchor) => Math.max(maxBottom, anchor.getBoundingClientRect().bottom),
    currentRect.bottom,
  );

  // Already fits comfortably between safeTop and safeBottom
  if (desiredBottom <= safeBottom) {
    return 0;
  }

  const neededForTargetArea = Math.max(0, desiredBottom - safeBottom);
  const maxKeepingCurrentVisible = Math.max(0, currentRect.top - safeTop);

  if (anchors.length > 1) {
    const neededForCurrent = Math.max(0, currentRect.bottom - safeBottom);
    if (neededForCurrent > 0) {
      return Math.max(neededForCurrent, Math.min(neededForTargetArea, maxKeepingCurrentVisible));
    }
    return Math.min(neededForTargetArea, maxKeepingCurrentVisible);
  }

  return currentRect.height <= safeBottom - safeTop
    ? neededForTargetArea
    : Math.min(neededForTargetArea, maxKeepingCurrentVisible);
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
  let validationGeometryTimer: number | null = null;
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
    if (validationGeometryTimer !== null) {
      window.clearTimeout(validationGeometryTimer);
      validationGeometryTimer = null;
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

  const handleValidationGeometryChange = () => {
    if (!activeTarget || userScrolledManually || document.activeElement !== activeTarget) return;
    if (!isMobileOrTouchViewport() || isPaywayModalOpen()) return;
    if (validationGeometryTimer !== null) {
      window.clearTimeout(validationGeometryTimer);
    }
    validationGeometryTimer = window.setTimeout(() => {
      validationGeometryTimer = null;
      if (!activeTarget || userScrolledManually || document.activeElement !== activeTarget) return;
      const deltaY = computeProgressiveScrollDelta(activeTarget, formElement);
      if (Math.abs(deltaY) >= 8) {
        scheduleScrollSequence(20);
      }
    }, 60);
  };

  const mutationObserver =
    typeof MutationObserver !== 'undefined'
      ? new MutationObserver(() => {
          handleValidationGeometryChange();
        })
      : null;
  mutationObserver?.observe(formElement, { childList: true, subtree: true });

  formElement.addEventListener('focusin', handleFocusIn);
  formElement.addEventListener('focusout', handleFocusOut);
  vv?.addEventListener('resize', handleViewportResize);
  window.addEventListener('wheel', handleManualUserScroll, { passive: true });
  window.addEventListener('touchmove', handleManualUserScroll, { passive: true });

  return {
    destroy: () => {
      clearTimers();
      resetTemporaryPadding();
      mutationObserver?.disconnect();
      formElement.removeEventListener('focusin', handleFocusIn);
      formElement.removeEventListener('focusout', handleFocusOut);
      vv?.removeEventListener('resize', handleViewportResize);
      window.removeEventListener('wheel', handleManualUserScroll);
      window.removeEventListener('touchmove', handleManualUserScroll);
    },
  };
}
