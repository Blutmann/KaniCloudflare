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

  nameLabel.getBoundingClientRect = () =>
    ({ top: 140, bottom: 210, left: 16, right: 374, width: 358, height: 70, x: 16, y: 140, toJSON: () => {} }) as DOMRect;
  phoneLabel.getBoundingClientRect = () =>
    ({ top: 230, bottom: 390, left: 16, right: 374, width: 358, height: 160, x: 16, y: 230, toJSON: () => {} }) as DOMRect;
  emailLabel.getBoundingClientRect = () =>
    ({ top: 360, bottom: 445, left: 16, right: 374, width: 358, height: 85, x: 16, y: 360, toJSON: () => {} }) as DOMRect;
  discountField.getBoundingClientRect = () =>
    ({ top: 430, bottom: 520, left: 16, right: 374, width: 358, height: 90, x: 16, y: 430, toJSON: () => {} }) as DOMRect;

  return { form, nameInput, phoneInput, emailInput, discountInput };
}

describe('KANI V12.47.12 — Scroll progresivo inteligente en formularios mobile', () => {
  const vvListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  let mockVvHeight = 460;
  let scrollBySpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vvListeners.clear();
    mockVvHeight = 460;
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

  it('1. Sigue la secuencia Nombre (sin scroll) -> Celular -> Email -> Código de descuento usando visualViewport', () => {
    const { form, nameInput, phoneInput, emailInput, discountInput } = createMockBookingForm();
    const handle = attachMobileProgressiveFieldScroll(form);

    // 1. Nombre ya está cómodamente visible (top 140 >= safeTop 88, bottom 210 <= safeBottom 386)
    nameInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(scrollBySpy).not.toHaveBeenCalled();

    // 2. Celular: bottom 390 > safeBottom 386 -> pequeño scroll tras estabilizar visualViewport
    phoneInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    mockVvHeight = 440; // teclado virtual reduce visualViewport
    vvListeners.get('resize')?.forEach(cb => (typeof cb === 'function' ? cb(new Event('resize')) : cb.handleEvent(new Event('resize'))));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(1);
    expect(scrollBySpy).toHaveBeenLastCalledWith({
      top: expect.any(Number),
      behavior: 'smooth',
    });
    expect(scrollBySpy.mock.calls[0][0].top).toBeGreaterThan(0);

    // 3. Email: desplazamiento suave adicional
    emailInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(2);
    expect(scrollBySpy.mock.calls[1][0].top).toBeGreaterThan(20);

    // 4. Código de descuento: incluye input + botón Aplicar
    discountInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(3);
    expect(scrollBySpy.mock.calls[2][0].top).toBeGreaterThan(50);

    handle.destroy();
  });

  it('2. No dispara scrolls repetidos al escribir caracteres ni cuando el usuario hace scroll manual', () => {
    const { form, emailInput } = createMockBookingForm();
    const handle = attachMobileProgressiveFieldScroll(form);

    emailInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(160);
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(1);

    // Simular escritura en el mismo campo: no vuelve a disparar
    emailInput.value = 'tomas@kani.com';
    emailInput.dispatchEvent(new Event('input', { bubbles: true }));
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(1);

    // Si el usuario mueve manualmente la pantalla antes de completar el debounce, se cancela el auto-scroll
    const phoneInput = form.querySelector('input[name="phone"]') as HTMLInputElement;
    phoneInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    window.dispatchEvent(new Event('touchmove'));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(1);

    handle.destroy();
  });

  it('3. No interfiere en desktop ni cuando el modal Payway está abierto, y limpia listeners al destruir', () => {
    const { form, emailInput } = createMockBookingForm();
    const handle = attachMobileProgressiveFieldScroll(form);

    // Modal Payway abierto -> no scrollea el formulario de fondo
    document.body.setAttribute('data-payway-modal-open', 'true');
    emailInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(scrollBySpy).not.toHaveBeenCalled();

    // Desktop (>= 1024px) sin pointer coarse -> delta 0 / no scrollea
    document.body.removeAttribute('data-payway-modal-open');
    Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => ({ matches: false }),
    });
    const discountInput = form.querySelector('#booking-discount-code') as HTMLInputElement;
    discountInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(scrollBySpy).not.toHaveBeenCalled();

    // Limpieza al cambiar de paso
    handle.destroy();
    expect(vvListeners.get('resize')?.size ?? 0).toBe(0);
    expect(computeProgressiveScrollDelta(emailInput)).toBeGreaterThan(0);
  });
});
