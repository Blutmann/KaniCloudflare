import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  attachMobileProgressiveFieldScroll,
  computeProgressiveScrollDelta,
} from '@/lib/kani-mobile-field-scroll';

function createMockBookingForm() {
  document.body.innerHTML = `
    <header class="site-header" style="height: 64px;"></header>
    <form class="booking-contact-form">
      <label class="field-label">
        <span>Nombre y apellido</span>
        <span class="field-control"><input name="name" type="text" /></span>
      </label>
      <label class="field-label">
        <span>Celular</span>
        <span class="field-control"><input name="phone" type="tel" /></span>
      </label>
      <label class="field-label">
        <span>Email</span>
        <span class="field-control"><input name="email" type="email" /></span>
      </label>
      <div class="booking-discount-field">
        <div class="discount-input-row">
          <span class="field-control"><input id="booking-discount-code" type="text" /></span>
          <button type="button">Aplicar</button>
        </div>
      </div>
    </form>
  `;

  const header = document.querySelector('.site-header') as HTMLElement;
  header.getBoundingClientRect = () =>
    ({ top: 0, bottom: 64, left: 0, right: 390, width: 390, height: 64, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

  const form = document.querySelector('.booking-contact-form') as HTMLFormElement;
  const nameLabel = form.querySelectorAll('.field-label')[0] as HTMLElement;
  const phoneLabel = form.querySelectorAll('.field-label')[1] as HTMLElement;
  const emailLabel = form.querySelectorAll('.field-label')[2] as HTMLElement;
  const discountField = form.querySelector('.booking-discount-field') as HTMLElement;

  const nameInput = form.querySelector('input[name="name"]') as HTMLInputElement;
  const phoneInput = form.querySelector('input[name="phone"]') as HTMLInputElement;
  const emailInput = form.querySelector('input[name="email"]') as HTMLInputElement;
  const discountInput = form.querySelector('#booking-discount-code') as HTMLInputElement;

  let scrollOffset = 0;

  const setRectsWithScroll = () => {
    nameLabel.getBoundingClientRect = () =>
      ({ top: 140 - scrollOffset, bottom: 220 - scrollOffset, left: 16, right: 374, width: 358, height: 80, x: 16, y: 140 - scrollOffset, toJSON: () => {} }) as DOMRect;
    phoneLabel.getBoundingClientRect = () =>
      ({ top: 235 - scrollOffset, bottom: 325 - scrollOffset, left: 16, right: 374, width: 358, height: 90, x: 16, y: 235 - scrollOffset, toJSON: () => {} }) as DOMRect;
    emailLabel.getBoundingClientRect = () =>
      ({ top: 340 - scrollOffset, bottom: 470 - scrollOffset, left: 16, right: 374, width: 358, height: 130, x: 16, y: 340 - scrollOffset, toJSON: () => {} }) as DOMRect;
    discountField.getBoundingClientRect = () =>
      ({ top: 485 - scrollOffset, bottom: 580 - scrollOffset, left: 16, right: 374, width: 358, height: 95, x: 16, y: 485 - scrollOffset, toJSON: () => {} }) as DOMRect;
  };

  setRectsWithScroll();

  return {
    form,
    nameInput,
    phoneInput,
    emailInput,
    discountInput,
    emailLabel,
    discountField,
    applyScroll: (delta: number) => {
      scrollOffset += delta;
      setRectsWithScroll();
    },
  };
}

describe('KANI V12.47.12.1 — Scroll anticipativo en formularios mobile', () => {
  const vvListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  let mockVvHeight = 460;
  let scrollBySpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vvListeners.clear();
    mockVvHeight = 460; // Teclado abierto en iPhone (844 - teclado => 460px visibles, safeBottom = 436)
    document.body.removeAttribute('data-payway-modal-open');

    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });

    scrollBySpy = vi.fn();
    Object.defineProperty(window, 'scrollBy', { value: scrollBySpy, configurable: true });

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        get height() {
          return mockVvHeight;
        },
        offsetTop: 0,
        addEventListener: (type: string, cb: EventListenerOrEventListenerObject) => {
          if (!vvListeners.has(type)) vvListeners.set(type, new Set());
          vvListeners.get(type)!.add(cb);
        },
        removeEventListener: (type: string, cb: EventListenerOrEventListenerObject) => {
          vvListeners.get(type)?.delete(cb);
        },
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('1. Al enfocar Celular con teclado abierto, anticipa inmediatamente para mostrar Email COMPLETO por encima del teclado', () => {
    const { form, nameInput, phoneInput, emailInput, discountInput, emailLabel, discountField, applyScroll } =
      createMockBookingForm();

    scrollBySpy.mockImplementation(({ top }: { top: number }) => applyScroll(top));
    const handle = attachMobileProgressiveFieldScroll(form);

    // 1. Nombre enfocado: Nombre (140..220) y Celular (235..325) ya están cómodamente visibles (< safeBottom 436)
    nameInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(scrollBySpy).not.toHaveBeenCalled();

    // 2. Celular enfocado (aunque Celular 235..325 ya es visible, Email 340..470 queda debajo de safeBottom 436)
    phoneInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(20); // Reacciona inmediatamente porque el teclado ya está abierto
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(1);
    expect(scrollBySpy.mock.calls[0][0].top).toBe(34); // 470 - 436 = 34px
    expect(emailLabel.getBoundingClientRect().bottom).toBeLessThanOrEqual(460 - 24);

    // 3. Email enfocado: anticipa Código de descuento (485..580 => actual 451..546 > safeBottom 436)
    emailInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(2);
    expect(discountField.getBoundingClientRect().bottom).toBeLessThanOrEqual(460 - 24);

    // 4. Código de descuento ya visible cómodamente -> sin scroll extra innecesario
    discountInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(2);

    handle.destroy();
  });

  it('2. Prioriza mantener visible el campo actual si el siguiente no cabe completo, y respeta scroll manual o escritura', () => {
    const { form, phoneInput, emailInput } = createMockBookingForm();
    // Hacer el campo actual muy alto (casi todo el viewport) para verificar que no lo empuja arriba del header
    const phoneLabel = form.querySelectorAll('.field-label')[1] as HTMLElement;
    phoneLabel.getBoundingClientRect = () =>
      ({ top: 90, bottom: 320, left: 16, right: 374, width: 358, height: 230, x: 16, y: 90, toJSON: () => {} }) as DOMRect;

    const delta = computeProgressiveScrollDelta(phoneInput, form);
    // safeTop = 74, phoneLabel.top = 90 -> maxKeepingCurrentVisible = 16px (no oculta Celular por debajo del header)
    expect(delta).toBe(16);

    const handle = attachMobileProgressiveFieldScroll(form);
    emailInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    window.dispatchEvent(new Event('touchmove'));
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(scrollBySpy).not.toHaveBeenCalled();

    handle.destroy();
  });

  it('3. Espera estabilización de visualViewport cuando el teclado recién abre y no actúa en desktop ni con modal Payway', () => {
    mockVvHeight = 844; // Teclado inicialmente cerrado
    const { form, phoneInput } = createMockBookingForm();
    const handle = attachMobileProgressiveFieldScroll(form);

    phoneInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    // Todavía no disparó antes de que resize estabilice
    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(scrollBySpy).not.toHaveBeenCalled();

    // El teclado abre y visualViewport se reduce a 460
    mockVvHeight = 460;
    vvListeners.get('resize')?.forEach(cb => (typeof cb === 'function' ? cb(new Event('resize')) : cb.handleEvent(new Event('resize'))));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(1);

    // Con modal Payway abierto no actúa
    document.body.setAttribute('data-payway-modal-open', 'true');
    const emailInput = form.querySelector('input[name="email"]') as HTMLInputElement;
    emailInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(1);

    handle.destroy();
  });
});
