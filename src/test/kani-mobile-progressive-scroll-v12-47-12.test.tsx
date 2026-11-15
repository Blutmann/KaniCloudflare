import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import {
  attachMobileProgressiveFieldScroll,
  computeProgressiveScrollDelta,
} from '@/lib/kani-mobile-field-scroll';

function createMockBookingForm(options: { withBottomCta?: boolean; scrollHeight?: number } = {}) {
  const { withBottomCta = true, scrollHeight = 1400 } = options;
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
    ${
      withBottomCta
        ? `<div class="booking-cta"><div class="booking-cta-inner"><button>Volver</button><button>Pagar seña</button></div></div>`
        : ''
    }
  `;

  const header = document.querySelector('.site-header') as HTMLElement;
  header.getBoundingClientRect = () =>
    ({ top: 0, bottom: 64, left: 0, right: 390, width: 390, height: 64, x: 0, y: 0, toJSON: () => {} }) as DOMRect;

  if (withBottomCta) {
    const ctaInner = document.querySelector('.booking-cta-inner') as HTMLElement;
    ctaInner.getBoundingClientRect = () =>
      ({ top: 396, bottom: 460, left: 0, right: 390, width: 390, height: 64, x: 0, y: 396, toJSON: () => {} }) as DOMRect;
  }

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

  Object.defineProperty(document.documentElement, 'scrollHeight', {
    configurable: true,
    get: () => scrollHeight + (parseInt(form.style.paddingBottom || '0', 10) || 0),
  });
  Object.defineProperty(window, 'scrollY', {
    configurable: true,
    get: () => scrollOffset,
  });

  const setRectsWithScroll = () => {
    nameLabel.getBoundingClientRect = () =>
      ({ top: 140 - scrollOffset, bottom: 220 - scrollOffset, left: 16, right: 374, width: 358, height: 80, x: 16, y: 140 - scrollOffset, toJSON: () => {} }) as DOMRect;
    phoneLabel.getBoundingClientRect = () =>
      ({ top: 235 - scrollOffset, bottom: 325 - scrollOffset, left: 16, right: 374, width: 358, height: 90, x: 16, y: 235 - scrollOffset, toJSON: () => {} }) as DOMRect;
    emailLabel.getBoundingClientRect = () =>
      ({ top: 335 - scrollOffset, bottom: 425 - scrollOffset, left: 16, right: 374, width: 358, height: 90, x: 16, y: 335 - scrollOffset, toJSON: () => {} }) as DOMRect;
    discountField.getBoundingClientRect = () =>
      ({ top: 440 - scrollOffset, bottom: 530 - scrollOffset, left: 16, right: 374, width: 358, height: 90, x: 16, y: 440 - scrollOffset, toJSON: () => {} }) as DOMRect;
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

describe('KANI V12.47.12.2 — Scroll anticipativo iOS considerando barra fija .booking-cta y límite de scroll', () => {
  const vvListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  let mockVvHeight = 460;
  let scrollBySpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vvListeners.clear();
    mockVvHeight = 460; // Teclado numérico abierto en iPhone; .booking-cta-inner ocupa 396..460
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

  it('1. Al enfocar Celular con teclado abierto, evita que Email quede detrás de «Volver» / «Pagar seña» (.booking-cta)', () => {
    const { form, nameInput, phoneInput, emailInput, emailLabel, discountField, applyScroll } =
      createMockBookingForm({ withBottomCta: true });

    scrollBySpy.mockImplementation(({ top }: { top: number }) => applyScroll(top));
    const handle = attachMobileProgressiveFieldScroll(form);

    // Nombre: Nombre (140..220) y Celular (235..325) ya están encima de .booking-cta (top 396 - 20 = 376)
    nameInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(scrollBySpy).not.toHaveBeenCalled();

    // Celular: Email (335..425) queda parcialmente detrás de .booking-cta (396)!
    // safeBottom = 396 - 20 = 376 -> delta = 425 - 376 = 49px
    phoneInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(1);
    expect(scrollBySpy.mock.calls[0][0].top).toBe(49);
    expect(emailLabel.getBoundingClientRect().bottom).toBeLessThanOrEqual(396 - 20);

    // Email: anticipa Código de descuento (440..530 => actual 391..481 > safeBottom 376)
    emailInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(scrollBySpy).toHaveBeenCalledTimes(2);
    expect(discountField.getBoundingClientRect().bottom).toBeLessThanOrEqual(396 - 20);

    handle.destroy();
  });

  it('2. Expande temporalmente el padding inferior si el documento alcanza el límite máximo de scroll y lo limpia al cerrar teclado', () => {
    // scrollHeight 470 con vvHeight 460 -> solo hay 10px disponibles para scrollear, pero necesitamos 49px!
    const { form, phoneInput, applyScroll } = createMockBookingForm({ withBottomCta: true, scrollHeight: 470 });
    scrollBySpy.mockImplementation(({ top }: { top: number }) => applyScroll(top));
    const handle = attachMobileProgressiveFieldScroll(form);

    phoneInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(160);
    });

    expect(scrollBySpy).toHaveBeenCalledTimes(1);
    expect(parseInt(form.style.paddingBottom || '0', 10)).toBeGreaterThanOrEqual(49);

    // Al cerrar el teclado (visualViewport vuelve a altura completa), limpia paddingBottom temporal
    mockVvHeight = 844;
    vvListeners.get('resize')?.forEach(cb => (typeof cb === 'function' ? cb(new Event('resize')) : cb.handleEvent(new Event('resize'))));
    expect(form.style.paddingBottom).toBe('');

    handle.destroy();
  });

  it('3. Respeta scroll manual y compensa si el navegador hace un scroll nativo posterior antes de estabilizarse', () => {
    const { form, phoneInput, emailInput, emailLabel, applyScroll } = createMockBookingForm({ withBottomCta: true });
    scrollBySpy.mockImplementation(({ top }: { top: number }) => applyScroll(top));
    const handle = attachMobileProgressiveFieldScroll(form);

    phoneInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    act(() => {
      vi.advanceTimersByTime(60);
    });
    expect(emailLabel.getBoundingClientRect().bottom).toBe(376);

    // Simular scroll nativo de iOS Safari que retrocede 25px antes de la segunda pasada (+190ms)
    applyScroll(-25);
    expect(emailLabel.getBoundingClientRect().bottom).toBe(401);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(emailLabel.getBoundingClientRect().bottom).toBe(376);

    // Si el usuario hace scroll manual, se cancela cualquier ajuste pendiente
    emailInput.focus();
    form.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    window.dispatchEvent(new Event('touchmove'));
    const callsBefore = scrollBySpy.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(scrollBySpy.mock.calls.length).toBe(callsBefore);

    handle.destroy();
    expect(computeProgressiveScrollDelta(phoneInput, form)).toBe(0);
  });
});
